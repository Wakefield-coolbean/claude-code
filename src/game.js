// The simulation. No DOM: every rule of the game lives here so it can later run on a
// server unchanged. UI, bots and audio react to events and call the action methods.

import { COLORS, BOT_NAMES, DIST, TIMING, defaultSettings } from './config.js';
import { getMap, roomAt, ventNeighbors } from './map.js';
import { World } from './grid.js';
import { dealTasks } from './tasks/defs.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAJOR = ['lights', 'comms', 'o2', 'reactor'];
const CRITICAL = ['o2', 'reactor'];

export function maxImpostors(players) {
  return players <= 6 ? 1 : players <= 8 ? 2 : 3;
}

/**
 * Seat list for a game: the given humans first, then bots with unused names and colors
 * until there are `total` seats. Entries: { name, color, isBot?, remote?, role? }.
 */
export function buildRoster(humans, total, rng) {
  const roster = humans.map((h) => ({ ...h }));
  const taken = new Set(roster.map((h) => h.color));
  const colors = [...COLORS.keys()].filter((c) => !taken.has(c)).sort(() => rng() - 0.5);
  const usedNames = new Set(roster.map((h) => h.name.toLowerCase()));
  const names = BOT_NAMES.filter((n) => !usedNames.has(n.toLowerCase())).sort(() => rng() - 0.5);
  while (roster.length < total && colors.length) roster.push({ name: names.pop() || 'Bot', color: colors.pop(), isBot: true });
  return roster;
}

export class Game {
  /**
   * @param {object} opts
   * @param {object} opts.settings  lobby settings (see config.js)
   * @param {number} opts.seed
   * @param {{name: string, color: number, role?: 'random'|'crew'|'impostor'}|null} opts.local
   *        shortcut for "me plus bots" (null with no roster = bots only)
   * @param {Array} [opts.roster]  explicit seats, see buildRoster()
   * @param {number} [opts.localId]  seat of the player on this device
   * @param {string} [opts.mapId]  'kestrel' or 'dropship'
   * @param {boolean} [opts.replica]  mirror of a server game: no roles or tasks are dealt here
   * @param {string} [opts.phase]  starting phase ('lobby' for the dropship)
   */
  constructor({
    settings = defaultSettings(),
    seed = Date.now(),
    local = null,
    roster = null,
    localId,
    mapId = 'kestrel',
    replica = false,
    phase,
  } = {}) {
    this.settings = { ...defaultSettings(), ...settings };
    this.replica = replica;
    this.rng = mulberry32(seed);
    this.map = getMap(mapId);
    this.world = new World(this.map);
    this.t = 0;
    this.phase = phase || 'intro';
    this.phaseEnd = TIMING.shhh + TIMING.roleReveal;
    this.listeners = {};
    this.bodies = [];
    this.meeting = null;
    this.ejection = null;
    this.result = null;
    this.lights = 1; // crew vision multiplier from the lights sabotage
    this.visualFx = new Map(); // playerId -> visual task kind
    this.ventUsed = {}; // ventId -> last time it opened
    this.chatLog = [];
    this.camsNet = false; // replica: someone is watching the cameras (from the host)
    this.adminNet = null; // replica: admin table counts (from the host)
    this.taskBarShown = 0;
    this.buttonReadyAt = this.settings.emergencyCooldown;
    this.sab = { active: null, readyAt: TIMING.firstSabotageCooldown, doors: {} };
    if (!roster) {
      const me = local ? [{ name: local.name || COLORS[local.color][0], color: local.color, role: local.role }] : [];
      roster = buildRoster(me, this.settings.players, this.rng);
    }
    this.createPlayers(roster, replica);
    this.localId = localId ?? (local ? 0 : -1);
  }

  // ---------- events ----------
  on(type, fn) {
    (this.listeners[type] ||= []).push(fn);
    return () => (this.listeners[type] = this.listeners[type].filter((f) => f !== fn));
  }

  emit(type, data = {}) {
    for (const fn of this.listeners[type] || []) fn(data);
    for (const fn of this.listeners['*'] || []) fn(type, data);
  }

  // ---------- setup ----------
  createPlayers(roster, replica) {
    const n = roster.length;
    const rng = this.rng;
    this.players = [];
    for (let i = 0; i < n; i++) {
      const r = roster[i];
      const [cname, color, shadow] = COLORS[r.color];
      this.players.push({
        id: i,
        name: r.name || cname,
        colorIndex: r.color,
        colorName: cname,
        color,
        shadow,
        isBot: !!r.isBot,
        remote: !!r.remote, // position comes from a network client
        role: 'crew',
        alive: true,
        x: 0,
        y: 0,
        input: { x: 0, y: 0 },
        facing: 1,
        moving: false,
        walk: 0,
        inVent: null,
        watching: null, // 'cams' or 'admin' while using that room tool
        killCooldown: TIMING.firstKillCooldown,
        emergencyLeft: this.settings.emergencyMeetings,
        tasks: [],
        deathT: null,
        ejected: false,
        vote: null,
      });
    }
    if (replica) {
      this.respawn();
      return;
    }

    // Roles (a seat may ask to be crew or impostor, e.g. in freeplay).
    const impCount = Math.min(this.settings.impostors, maxImpostors(n));
    const imps = roster.flatMap((r, i) => (r.role === 'impostor' ? [i] : [])).slice(0, impCount);
    const pool = roster.flatMap((r, i) => (r.role === 'crew' || imps.includes(i) ? [] : [i]));
    while (imps.length < impCount && pool.length) imps.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    imps.forEach((id) => (this.players[id].role = 'impostor'));

    const deal = dealTasks(this.settings, rng);
    for (const p of this.players) {
      p.tasks = deal();
      if (p.role === 'impostor') p.tasks.forEach((t) => (t.fake = true));
    }
    this.respawn();
    this.taskBarShown = 0;
  }

  respawn() {
    const { spawn } = this.map;
    const n = this.players.length;
    this.players.forEach((p, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      p.x = spawn.x + Math.cos(a) * spawn.radius;
      p.y = spawn.y + Math.sin(a) * spawn.radius * 0.85;
      p.facing = Math.cos(a) > 0 ? -1 : 1;
      p.inVent = null;
      p.input.x = p.input.y = 0;
      p.moving = false;
      p.holding = null;
    });
  }

  // ---------- queries ----------
  get local() {
    return this.players[this.localId] || null;
  }

  isImpostor(p) {
    return p.role === 'impostor';
  }

  alive() {
    return this.players.filter((p) => p.alive);
  }

  counts() {
    let crew = 0;
    let imp = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.role === 'impostor') imp++;
      else crew++;
    }
    return { crew, imp };
  }

  roomName(x, y) {
    return roomAt(this.map, x, y)?.name || null;
  }

  /** Vision radius in cells; Infinity for ghosts. */
  visionOf(p) {
    if (!p.alive) return Infinity;
    if (p.role === 'impostor') return DIST.vision * this.settings.impostorVision;
    return DIST.vision * this.settings.crewVision * this.lights;
  }

  /** Eye position: roughly the middle of the body. */
  eye(p) {
    return [p.x, p.y - 0.6];
  }

  /** Can `viewer` see point (x, y)? */
  sees(viewer, x, y) {
    if (!viewer.alive) return true;
    const [ex, ey] = this.eye(viewer);
    return this.world.canSee(ex, ey, this.visionOf(viewer), x, y);
  }

  /** Can `viewer` see player `p` right now? */
  seesPlayer(viewer, p) {
    if (p === viewer) return true;
    if (p.inVent) return false;
    if (!p.alive) return !viewer.alive; // ghosts are only visible to ghosts
    return this.sees(viewer, p.x, p.y - 0.55);
  }

  killRange() {
    return DIST.kill[this.settings.killDistance] || DIST.kill.normal;
  }

  /** Nearest player `killer` could kill right now, or null. */
  killTarget(killer) {
    if (this.phase !== 'play' || !killer.alive || killer.role !== 'impostor' || killer.inVent) return null;
    let best = null;
    let bd = this.killRange();
    for (const p of this.players) {
      if (p === killer || !p.alive || p.role === 'impostor' || p.inVent) continue;
      const d = Math.hypot(p.x - killer.x, p.y - killer.y);
      if (d <= bd && !this.world.blocked(killer.x, killer.y - 0.3, p.x, p.y - 0.3)) {
        best = p;
        bd = d;
      }
    }
    return best;
  }

  /** Nearest body `p` could report, or null. */
  reportable(p) {
    if (this.phase !== 'play' || !p.alive || p.inVent) return null;
    let best = null;
    let bd = DIST.report;
    for (const b of this.bodies) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d <= bd && !this.world.blocked(p.x, p.y - 0.3, b.x, b.y - 0.2)) {
        best = b;
        bd = d;
      }
    }
    return best;
  }

  nearestVent(p, range = DIST.use) {
    let best = null;
    let bd = range;
    for (const [id, v] of Object.entries(this.map.vents)) {
      const d = Math.hypot(v.x - p.x, v.y - p.y);
      if (d <= bd) {
        best = id;
        bd = d;
      }
    }
    return best;
  }

  canVent(p) {
    return this.phase === 'play' && p.alive && p.role === 'impostor' && (p.inVent || this.nearestVent(p));
  }

  /** Why the emergency button can't be pressed, or null if it can. */
  emergencyBlock(p) {
    if (this.sab.active) return 'EMERGENCY MEETINGS CANNOT BE CALLED DURING CRISES';
    if (p.emergencyLeft <= 0) return `${p.name} has no emergency meetings left`;
    if (this.t < this.buttonReadyAt) return `Emergency meetings available in ${Math.ceil(this.buttonReadyAt - this.t)}s`;
    return null;
  }

  nearButton(p) {
    const b = this.map.button;
    return !!b && p.alive && Math.hypot(p.x - b.x, p.y - b.y) <= b.useRadius;
  }

  /** Task steps `p` can do at a station now: [{ task, index }]. */
  stepsAt(p, stationId) {
    const out = [];
    p.tasks.forEach((task, index) => {
      if (task.done || task.fake) return;
      const step = task.steps[task.step];
      if (step.station === stationId && this.t >= task.readyAt) out.push({ task, index, step });
    });
    return out;
  }

  /** The thing `p` would interact with by pressing USE, or null. */
  usable(p) {
    if (this.phase === 'lobby') {
      const st = this.map.stations.laptop;
      return st && Math.hypot(st.x - p.x, st.y - p.y) <= DIST.use + 0.4 ? { kind: 'laptop', station: 'laptop' } : null;
    }
    if (this.phase !== 'play' || p.inVent) return null;
    let best = null;
    let bd = DIST.use;
    const consider = (d, item) => {
      if (d <= bd) {
        bd = d;
        best = item;
      }
    };
    for (const [id, st] of Object.entries(this.map.stations)) {
      const d = Math.hypot(st.x - p.x, st.y - p.y);
      if (d > DIST.use) continue;
      if (st.sabotage) {
        if (p.alive && this.sab.active?.type === st.sabotage && !this.fixPointDone(id))
          consider(d, { kind: 'fix', station: id, type: st.sabotage });
      } else if (st.tool) {
        if (p.alive) consider(d + 0.3, { kind: st.tool, station: id });
      } else {
        const steps = this.stepsAt(p, id);
        if (steps.length) consider(d, { kind: 'task', station: id, taskIndex: steps[0].index });
      }
    }
    if (this.nearButton(p)) {
      const b = this.map.button;
      consider(Math.max(0, Math.hypot(p.x - b.x, p.y - b.y) - 2.1), { kind: 'button' });
    }
    return best;
  }

  /** Is `p` close enough to use a room tool ('cams' or 'admin')? */
  nearTool(p, tool) {
    return Object.values(this.map.stations).some((st) => st.tool === tool && Math.hypot(st.x - p.x, st.y - p.y) <= DIST.use + 0.8);
  }

  /** Start (kind 'cams' or 'admin') or stop (null) watching a room tool. */
  setWatching(id, kind) {
    const p = this.players[id];
    if (!p) return false;
    if (kind && (this.phase !== 'play' || !p.alive || p.inVent || !this.nearTool(p, kind))) return false;
    p.watching = kind || null;
    return true;
  }

  /** Comms sabotage cuts the camera feeds and the admin table. */
  camsDown() {
    return this.sab.active?.type === 'comms';
  }

  /** Is anyone watching the cameras? (Their red lights blink.) */
  camsInUse() {
    if (this.replica) return this.camsNet;
    return !this.camsDown() && this.players.some((p) => p.alive && p.watching === 'cams');
  }

  /** The camera whose feed shows point (x, y), or null. */
  onCamera(x, y) {
    if (this.camsDown()) return null;
    return this.map.cameras.find(({ view: [x0, y0, x1, y1] }) => x >= x0 && x < x1 && y >= y0 && y < y1) || null;
  }

  /** Living crewmates per room index, as the admin table shows them. */
  adminCounts() {
    if (this.replica) return new Map(this.adminNet || []);
    const counts = new Map();
    for (const p of this.players) {
      if (!p.alive || p.inVent) continue;
      const r = this.map.room[Math.floor(p.y) * this.map.W + Math.floor(p.x)];
      if (r >= 0) counts.set(r, (counts.get(r) || 0) + 1);
    }
    return counts;
  }

  /** Total task progress 0..1 (actual, not the displayed bar). */
  taskProgress() {
    let total = 0;
    let done = 0;
    for (const p of this.players) {
      if (p.role === 'impostor') continue;
      for (const t of p.tasks) {
        total++;
        if (t.done) done++;
      }
    }
    return total ? done / total : 1;
  }

  /** Task bar as the HUD should show it (respects the "task bar updates" setting). */
  taskBar() {
    const mode = this.settings.taskBarUpdates;
    if (mode === 'never') return null;
    return mode === 'always' ? this.taskProgress() : this.taskBarShown;
  }

  // ---------- actions ----------
  setInput(id, x, y) {
    const p = this.players[id];
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    p.input.x = x;
    p.input.y = y;
  }

  kill(killerId, victimId) {
    const killer = this.players[killerId];
    const victim = this.players[victimId];
    if (!killer || !victim || this.killTarget(killer) == null) return false;
    if (killer.killCooldown > 0) return false;
    const range = this.killRange();
    if (!victim.alive || victim.role === 'impostor' || Math.hypot(victim.x - killer.x, victim.y - killer.y) > range) return false;
    victim.alive = false;
    victim.deathT = this.t;
    victim.holding = null;
    victim.watching = null;
    this.visualFx.delete(victim.id);
    const body = { id: victim.id, x: victim.x, y: victim.y, color: victim.color, shadow: victim.shadow, t: this.t };
    this.bodies.push(body);
    const from = { x: killer.x, y: killer.y };
    killer.x = victim.x;
    killer.y = victim.y;
    killer.killCooldown = this.settings.killCooldown;
    this.emit('kill', { killer, victim, body, from });
    this.checkWin();
    return true;
  }

  enterVent(id) {
    const p = this.players[id];
    if (!this.canVent(p) || p.inVent) return false;
    const vent = this.nearestVent(p);
    const v = this.map.vents[vent];
    p.inVent = vent;
    p.x = v.x;
    p.y = v.y;
    p.moving = false;
    this.ventUsed[vent] = this.t;
    this.visualFx.delete(id);
    this.emit('vent', { player: p, vent, enter: true });
    return true;
  }

  ventTo(id, ventId) {
    const p = this.players[id];
    if (!p.inVent || !ventNeighbors(p.inVent).includes(ventId)) return false;
    const v = this.map.vents[ventId];
    p.inVent = ventId;
    p.x = v.x;
    p.y = v.y;
    this.emit('ventMove', { player: p, vent: ventId });
    return true;
  }

  exitVent(id) {
    const p = this.players[id];
    if (!p.inVent) return false;
    const vent = p.inVent;
    p.inVent = null;
    this.ventUsed[vent] = this.t;
    this.emit('vent', { player: p, vent, enter: false });
    return true;
  }

  report(id) {
    const p = this.players[id];
    const body = this.reportable(p);
    if (!body) return false;
    this.startMeeting('body', p, body);
    return true;
  }

  callEmergency(id) {
    const p = this.players[id];
    if (this.phase !== 'play' || !this.nearButton(p) || this.emergencyBlock(p)) return false;
    p.emergencyLeft--;
    this.startMeeting('emergency', p, null);
    return true;
  }

  completeStep(id, taskIndex) {
    const p = this.players[id];
    const task = p.tasks[taskIndex];
    if (!task || task.done || task.fake || this.phase === 'over') return false;
    const step = task.steps[task.step];
    task.step++;
    if (step.waitAfter) task.readyAt = this.t + step.waitAfter;
    if (task.step >= task.steps.length) {
      task.done = true;
      this.emit('taskDone', { player: p, task });
      this.checkWin();
    } else {
      this.emit('taskStep', { player: p, task });
    }
    return true;
  }

  /** Visual task effect on/off (Submit Scan, Clear Asteroids, Prime Shields, Empty Garbage). */
  setVisual(id, kind, on) {
    const p = this.players[id];
    if (on && p.alive && this.settings.visualTasks) this.visualFx.set(id, { kind, t: this.t });
    else this.visualFx.delete(id);
  }

  // ---------- sabotage ----------
  canSabotage(p) {
    return this.phase === 'play' && p.role === 'impostor' && !p.inVent;
  }

  sabotageCooldown() {
    if (this.sab.active) return Infinity;
    return Math.max(0, this.sab.readyAt - this.t);
  }

  doorCooldown(roomId) {
    const d = this.sab.doors[roomId];
    if (!d) return 0;
    return Math.max(0, d.readyAt - this.t);
  }

  sabotage(id, type) {
    const p = this.players[id];
    if (!this.canSabotage(p) || !MAJOR.includes(type) || this.sabotageCooldown() > 0) return false;
    const rng = this.rng;
    const s = { type, start: this.t, by: id };
    if (type === 'lights') {
      s.switches = Array.from({ length: 5 }, () => rng() < 0.5);
      s.switches[Math.floor(rng() * 5)] = false;
    } else if (type === 'comms') {
      s.target = 0.1 + rng() * 0.8;
    } else if (type === 'o2') {
      s.deadline = this.t + TIMING.o2Depletion;
      s.code = String(Math.floor(rng() * 100000)).padStart(5, '0');
      s.done = { o2_o2: false, o2_ad: false };
    } else if (type === 'reactor') {
      s.deadline = this.t + TIMING.reactorMeltdown;
      s.holders = { reactor_a: null, reactor_b: null };
      s.both = 0;
    }
    this.sab.active = s;
    this.emit('sabotage', { type, by: p });
    return true;
  }

  closeDoors(id, roomId) {
    const p = this.players[id];
    if (!this.canSabotage(p) || !p.alive || this.doorCooldown(roomId) > 0) return false;
    const doors = this.map.doors.filter((d) => d.room === roomId);
    if (!doors.length) return false;
    // Never shut a door on someone standing in the doorway.
    doors.forEach((d) => {
      const occupied = this.players.some((q) => q.alive && !q.inVent && d.cells.includes(Math.floor(q.y) * this.map.W + Math.floor(q.x)));
      if (!occupied) this.world.setDoor(d.id, true);
    });
    this.sab.doors[roomId] = { closedUntil: this.t + TIMING.doorsClosed, readyAt: this.t + TIMING.doorsClosed + TIMING.doorCooldown };
    this.emit('doors', { room: roomId, closed: true });
    return true;
  }

  fixPointDone(stationId) {
    const s = this.sab.active;
    if (!s) return true;
    if (s.type === 'o2') return !!s.done[stationId];
    return false;
  }

  /** Actions from sabotage panels (players and bots). */
  fixAction(id, stationId, action) {
    const s = this.sab.active;
    const p = this.players[id];
    if (!s || !p.alive || this.phase !== 'play') return false;
    const st = this.map.stations[stationId];
    if (!st || st.sabotage !== s.type) return false;
    if (s.type === 'lights' && action.type === 'toggle') {
      s.switches[action.index] = !s.switches[action.index];
      if (s.switches.every(Boolean)) this.fixSabotage(p);
    } else if (s.type === 'lights' && action.type === 'allOn') {
      s.switches.fill(true);
      this.fixSabotage(p);
    } else if (s.type === 'comms' && action.type === 'comms') {
      this.fixSabotage(p);
    } else if (s.type === 'o2' && action.type === 'o2') {
      s.done[stationId] = true;
      this.emit('fixPart', { station: stationId });
      if (Object.values(s.done).every(Boolean)) this.fixSabotage(p);
    } else if (s.type === 'reactor' && action.type === 'hold') {
      if (action.on) s.holders[stationId] = id;
      else if (s.holders[stationId] === id) s.holders[stationId] = null;
    } else {
      return false;
    }
    return true;
  }

  fixSabotage(by) {
    const s = this.sab.active;
    if (!s) return;
    this.sab.active = null;
    this.sab.readyAt = this.t + TIMING.sabotageCooldown;
    this.emit('sabotageFixed', { type: s.type, by });
  }

  // ---------- meetings ----------
  startMeeting(reason, caller, body) {
    if (this.phase !== 'play') return;
    this.phase = 'meeting';
    if (this.settings.taskBarUpdates === 'meetings') this.taskBarShown = this.taskProgress();
    for (const p of this.players) {
      if (p.inVent) this.exitVent(p.id);
      p.input.x = p.input.y = 0;
      p.moving = false;
      p.vote = null;
      p.holding = null;
      p.watching = null;
    }
    this.visualFx.clear();
    if (this.sab.active && CRITICAL.includes(this.sab.active.type)) {
      const type = this.sab.active.type;
      this.sab.active = null;
      this.emit('sabotageFixed', { type, by: null });
    }
    for (const d of this.map.doors) this.world.setDoor(d.id, false);
    for (const k of Object.keys(this.sab.doors)) this.sab.doors[k].closedUntil = 0;
    const dead = this.bodies.map((b) => b.id);
    this.meeting = {
      reason,
      callerId: caller.id,
      bodyId: body ? body.id : null,
      bodyRoom: body ? this.roomName(body.x, body.y) : null,
      deadSince: dead,
      stage: 'splash',
      stageEnd: this.t + TIMING.meetingSplash,
      chat: [],
      result: null,
    };
    this.bodies = [];
    this.emit('meeting', { meeting: this.meeting, caller, body });
  }

  setMeetingStage(stage, duration) {
    const m = this.meeting;
    m.stage = stage;
    m.stageEnd = this.t + duration;
    this.emit('meetingStage', { meeting: m, stage });
  }

  canVote(p) {
    return this.phase === 'meeting' && this.meeting.stage === 'voting' && p.alive && p.vote == null;
  }

  vote(id, target) {
    const p = this.players[id];
    if (!this.canVote(p)) return false;
    if (target !== 'skip') {
      const t = this.players[target];
      if (!t || !t.alive) return false;
    }
    p.vote = target;
    this.emit('vote', { player: p });
    if (this.alive().every((q) => q.vote != null)) this.endVoting();
    return true;
  }

  chat(id, text) {
    const p = this.players[id];
    if (this.phase !== 'meeting' || this.meeting.stage === 'splash') return false;
    text = String(text).slice(0, 100).trim();
    if (!text) return false;
    const msg = { t: this.t, from: id, text, dead: !p.alive };
    this.meeting.chat.push(msg);
    this.emit('chat', msg);
    return true;
  }

  tallyVotes() {
    const counts = new Map();
    let skip = 0;
    for (const p of this.alive()) {
      if (p.vote == null) continue;
      if (p.vote === 'skip') skip++;
      else counts.set(p.vote, (counts.get(p.vote) || 0) + 1);
    }
    let top = null;
    let topN = 0;
    let tie = false;
    for (const [id, n] of counts) {
      if (n > topN) {
        top = id;
        topN = n;
        tie = false;
      } else if (n === topN) tie = true;
    }
    let ejected = top;
    let why = null;
    if (top == null || skip >= topN) {
      ejected = null;
      why = skip === topN && top != null ? 'tie' : 'skipped';
    } else if (tie) {
      ejected = null;
      why = 'tie';
    }
    return { ejected, why, skip, counts };
  }

  endVoting() {
    const m = this.meeting;
    if (m.stage !== 'voting') return;
    m.result = this.tallyVotes();
    this.setMeetingStage('results', TIMING.voteResults);
  }

  startEjection() {
    const r = this.meeting.result;
    const p = r.ejected != null ? this.players[r.ejected] : null;
    if (p) {
      p.alive = false;
      p.ejected = true;
      p.deathT = this.t;
    }
    const { imp } = this.counts();
    let line1;
    let line2 = '';
    if (!p) line1 = `No one was ejected. (${r.why === 'tie' ? 'Tie' : 'Skipped'})`;
    else if (this.settings.confirmEjects) line1 = `${p.name} was ${p.role === 'impostor' ? '' : 'not '}The Impostor.`;
    else line1 = `${p.name} was ejected.`;
    if (this.settings.confirmEjects || !p) line2 = `${imp} Impostor${imp === 1 ? '' : 's'} remain${imp === 1 ? 's' : ''}.`;
    this.ejection = { player: p, line1, line2, end: this.t + TIMING.ejection };
    this.phase = 'eject';
    this.emit('eject', this.ejection);
  }

  endEjection() {
    this.ejection = null;
    this.meeting = null;
    this.respawn();
    for (const p of this.players) p.killCooldown = this.settings.killCooldown;
    this.buttonReadyAt = this.t + this.settings.emergencyCooldown;
    this.sab.readyAt = Math.max(this.sab.readyAt, this.t + TIMING.firstSabotageCooldown);
    this.phase = 'play';
    if (!this.checkWin()) this.emit('resume');
  }

  // ---------- win ----------
  checkWin() {
    if (this.phase === 'over') return true;
    const { crew, imp } = this.counts();
    if (imp === 0) return this.end('crew', 'vote');
    if (imp >= crew) return this.end('impostor', 'kills');
    if (this.taskProgress() >= 1) return this.end('crew', 'tasks');
    return false;
  }

  end(winner, reason) {
    // Ejection results wait until the cutscene finishes.
    if (this.phase === 'eject' || this.phase === 'meeting') {
      if (reason !== 'tasks' && reason !== 'sabotage') return false;
    }
    this.phase = 'over';
    this.result = { winner, reason };
    this.emit('gameOver', this.result);
    return true;
  }

  // ---------- tick ----------
  /** Move one player by its input for dt seconds (shared with client-side prediction). */
  stepPlayer(p, dt) {
    const { x: ix, y: iy } = p.input;
    if (!ix && !iy) {
      p.moving = false;
      return;
    }
    const speed = DIST.speed * this.settings.playerSpeed;
    const dx = ix * speed * dt;
    const dy = iy * speed * dt;
    if (p.alive) [p.x, p.y] = this.world.move(p.x, p.y, dx, dy, DIST.playerRadius);
    else {
      p.x = Math.max(1, Math.min(this.map.W - 1, p.x + dx));
      p.y = Math.max(1, Math.min(this.map.H - 1, p.y + dy));
    }
    if (Math.abs(ix) > 0.15) p.facing = ix > 0 ? 1 : -1;
    p.moving = true;
    p.walk += dt;
    if (this.visualFx.has(p.id)) this.visualFx.delete(p.id);
  }

  tick(dt) {
    if (this.phase === 'over') return;
    this.t += dt;
    const t = this.t;
    if (this.phase === 'lobby') {
      for (const p of this.players) if (!p.remote) this.stepPlayer(p, dt);
      return;
    }
    if (this.phase === 'intro') {
      if (t >= this.phaseEnd) {
        this.phase = 'play';
        this.emit('start');
      }
      return;
    }
    if (this.phase === 'meeting') return this.tickMeeting();
    if (this.phase === 'eject') {
      if (t >= this.ejection.end) this.endEjection();
      return;
    }

    // Movement (remote players report their own positions).
    for (const p of this.players) {
      if (p.alive) p.killCooldown = Math.max(0, p.killCooldown - dt);
      if (p.watching && (!p.alive || p.inVent || p.moving)) p.watching = null;
      if (p.inVent || p.remote) continue;
      this.stepPlayer(p, dt);
    }

    // Lights fade.
    const targetLights = this.sab.active?.type === 'lights' ? DIST.lightsOutFactor : 1;
    const step = (dt / TIMING.lightsFade) * (1 - DIST.lightsOutFactor);
    this.lights = targetLights < this.lights ? Math.max(targetLights, this.lights - step) : Math.min(targetLights, this.lights + step);

    // Doors reopen.
    for (const [roomId, d] of Object.entries(this.sab.doors)) {
      if (d.closedUntil && t >= d.closedUntil) {
        d.closedUntil = 0;
        this.map.doors.filter((x) => x.room === roomId).forEach((x) => this.world.setDoor(x.id, false));
        this.emit('doors', { room: roomId, closed: false });
      }
    }

    // Critical sabotage.
    const s = this.sab.active;
    if (s && s.type === 'reactor') {
      const { reactor_a: a, reactor_b: b } = s.holders;
      const ok = a != null && b != null && a !== b && this.players[a].alive && this.players[b].alive;
      s.both = ok ? s.both + dt : 0;
      if (s.both >= 1) this.fixSabotage(this.players[a]);
    }
    if (this.sab.active?.deadline && t >= this.sab.active.deadline) {
      this.end('impostor', 'sabotage');
    }
  }

  tickMeeting() {
    const m = this.meeting;
    if (this.t < m.stageEnd) return;
    if (m.stage === 'splash') this.setMeetingStage('discussion', this.settings.discussionTime);
    else if (m.stage === 'discussion') this.setMeetingStage('voting', this.settings.votingTime);
    else if (m.stage === 'voting') this.endVoting();
    else if (m.stage === 'results') this.startEjection();
  }
}
