// A room: lobby, host controls, and the authoritative game loop for up to 15 players.
// Runs on the dedicated server (server/) or in the host's browser for peer-to-peer games.
// Clients send their own position and actions; the room runs the same rules as freeplay
// (src/game.js), fills empty seats with bots, and sends each client only what that
// player can see.

import { Game, buildRoster, mulberry32 } from './game.js';
import { Bots } from './bots.js';
import { DIST, COLORS, cleanSettings } from './config.js';
import { getMap } from './map.js';

const TICK_HZ = 30;
const SNAP_EVERY = 2; // 15 snapshots per second
const LOBBY_EVERY = 3; // 10 lobby updates per second
const COUNTDOWN = 3;
const MIN_PLAYERS = 4;

const r2 = (v) => Math.round(v * 100) / 100;

export function cleanName(name, fallback) {
  const n = String(name || '')
    .replace(/[^\p{L}\p{N} _.-]/gu, '')
    .trim()
    .slice(0, 10);
  return n || fallback;
}

/** The active sabotage as every player may see it (the O2 code is on a note in the room). */
function publicSabotage(g) {
  const s = g.sab.active;
  if (!s) return null;
  return {
    type: s.type,
    dl: s.deadline ?? null,
    sw: s.switches ?? null,
    code: s.code ?? null,
    tg: s.target ?? null,
    dn: s.done ?? null,
    h: s.holders ? Object.values(s.holders).filter((v) => v != null).length : 0,
  };
}

export class Room {
  /**
   * @param {object} opts { settings, pub, ticker } where ticker(fn, hz) starts a repeating
   *        callback and returns a stop function (defaults to setInterval)
   */
  constructor(code, host, { settings, pub, ticker }, onEmpty) {
    this.code = code;
    this.pub = !!pub;
    this.settings = cleanSettings(settings);
    this.clients = new Map();
    this.hostId = host.id;
    this.phase = 'lobby';
    this.onEmpty = onEmpty;
    this.lobbyMap = getMap('dropship');
    this.tickN = 0;
    this.countdownAt = 0;
    this.clock = Date.now() / 1000;
    const start = ticker || ((fn, hz) => clearInterval.bind(null, setInterval(fn, 1000 / hz)));
    this.stop = start(() => this.pump(), TICK_HZ);
    this.add(host);
  }

  /** Run as many fixed ticks as real time calls for (catches up after timer hiccups). */
  pump() {
    const now = Date.now() / 1000;
    let n = Math.floor((now - this.clock) * TICK_HZ);
    if (n > 15) {
      this.clock = now - 15 / TICK_HZ;
      n = 15;
    }
    for (let i = 0; i < n; i++) this.tick();
    this.clock += n / TICK_HZ;
  }

  destroy() {
    this.stop();
    this.bots?.destroy();
    this.game = null;
    this.onEmpty(this);
  }

  get host() {
    return this.clients.get(this.hostId);
  }

  info() {
    return {
      code: this.code,
      host: this.host?.name || '?',
      n: this.clients.size,
      max: this.settings.players,
      imps: this.settings.impostors,
    };
  }

  // ---------- membership ----------
  canJoin() {
    if (this.phase !== 'lobby') return 'That game has already started.';
    if (this.clients.size >= this.settings.players) return 'That game is full.';
    return null;
  }

  add(c) {
    c.room = this;
    c.pid = null;
    c.color = this.freeColor(c.color, c.id);
    this.placeInLobby(c);
    this.clients.set(c.id, c);
    c.send({ t: 'joined', code: this.code, you: c.id });
    this.sendRoom();
  }

  remove(c) {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    c.room = null;
    if (this.game && c.pid != null) {
      // A bot takes over the seat so the game can continue.
      this.bots.addBrain(this.game.players[c.pid]);
    }
    c.pid = null;
    if (!this.clients.size) return this.destroy();
    if (this.hostId === c.id) this.hostId = this.clients.keys().next().value;
    if (this.countdownAt) {
      this.countdownAt = 0;
      this.broadcast({ t: 'countdown', n: 0 });
    }
    this.sendRoom();
  }

  freeColor(want, selfId) {
    const taken = new Set([...this.clients.values()].filter((o) => o.id !== selfId).map((o) => o.color));
    if (Number.isInteger(want) && want >= 0 && want < COLORS.length && !taken.has(want)) return want;
    return [...COLORS.keys()].find((i) => !taken.has(i)) ?? 0;
  }

  placeInLobby(c) {
    const { spawn } = this.lobbyMap;
    const a = Math.random() * Math.PI * 2;
    c.lobby = { x: r2(spawn.x + Math.cos(a) * spawn.radius), y: r2(spawn.y + Math.sin(a) * spawn.radius * 0.7), f: 1, m: 0 };
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const c of this.clients.values()) c.sendRaw(data);
  }

  sendRoom() {
    this.broadcast({
      t: 'room',
      code: this.code,
      host: this.hostId,
      pub: this.pub,
      phase: this.phase,
      settings: this.settings,
      players: [...this.clients.values()].map((c) => ({ id: c.id, name: c.name, color: c.color, x: c.lobby.x, y: c.lobby.y })),
    });
  }

  // ---------- messages ----------
  onMessage(c, m) {
    switch (m.t) {
      case 'lp':
        if (this.phase === 'lobby') this.lobbyPos(c, m);
        break;
      case 'me':
        if (m.name != null) c.name = cleanName(m.name, c.name);
        if (m.color != null) c.color = this.freeColor(m.color | 0, c.id);
        this.sendRoom();
        break;
      case 'settings':
        if (c.id !== this.hostId || this.phase !== 'lobby') break;
        this.settings = cleanSettings(m.settings);
        this.settings.players = Math.max(this.settings.players, this.clients.size);
        if (m.pub != null) this.pub = !!m.pub;
        this.sendRoom();
        break;
      case 'start':
        if (c.id !== this.hostId || this.phase !== 'lobby' || this.countdownAt) break;
        if (!this.settings.fillBots && this.clients.size < MIN_PLAYERS) {
          c.send({ t: 'err', msg: `Need at least ${MIN_PLAYERS} players, or turn on Fill With Bots.` });
          break;
        }
        this.countdownAt = Date.now() / 1000 + COUNTDOWN;
        this.lastCount = null;
        break;
      case 'cancel':
        if (c.id === this.hostId) this.countdownAt = 0;
        this.broadcast({ t: 'countdown', n: 0 });
        break;
      case 'kick':
        if (c.id === this.hostId && m.id !== c.id && this.clients.has(m.id) && this.phase === 'lobby') {
          const k = this.clients.get(m.id);
          k.send({ t: 'kicked' });
          this.remove(k);
        }
        break;
      case 'p':
        this.gamePos(c, m);
        break;
      case 'a':
        this.action(c, m);
        break;
    }
  }

  lobbyPos(c, m) {
    const [x0, y0, x1, y1] = this.lobbyMap.rooms[0].rect;
    const x = Number(m.x);
    const y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    c.lobby = { x: r2(Math.max(x0, Math.min(x1, x))), y: r2(Math.max(y0, Math.min(y1, y))), f: m.f < 0 ? -1 : 1, m: m.m ? 1 : 0 };
  }

  // ---------- game ----------
  startGame() {
    this.countdownAt = 0;
    const humans = [...this.clients.values()];
    const seed = (Math.random() * 2 ** 32) >>> 0;
    const total = this.settings.fillBots ? Math.max(this.settings.players, humans.length, MIN_PLAYERS) : humans.length;
    const roster = buildRoster(
      humans.map((c) => ({ name: c.name, color: c.color, remote: true })),
      total,
      mulberry32(seed),
    );
    const g = new Game({ settings: this.settings, seed, roster });
    humans.forEach((c, i) => (c.pid = i));
    this.game = g;
    this.bots = new Bots(g);
    this.phase = 'game';
    g.on('*', (type, d) => this.onEvent(type, d));
    const pub = roster.map((r) => ({ name: r.name, color: r.color, bot: !!r.isBot }));
    for (const c of humans) {
      const me = g.players[c.pid];
      const mates = me.role === 'impostor' ? g.players.filter((p) => p.role === 'impostor').map((p) => p.id) : [];
      c.send({
        t: 'start',
        pid: c.pid,
        roster: pub,
        role: me.role,
        mates,
        tasks: me.tasks,
        settings: this.settings,
        T: g.t,
        phaseEnd: g.phaseEnd,
      });
    }
    this.sendRoom();
  }

  endGame() {
    this.bots?.destroy();
    this.bots = null;
    this.game = null;
    this.phase = 'lobby';
    for (const c of this.clients.values()) {
      c.pid = null;
      this.placeInLobby(c);
    }
    this.sendRoom();
  }

  gameClients() {
    return [...this.clients.values()].filter((c) => c.pid != null);
  }

  tick() {
    this.tickN++;
    if (this.phase === 'lobby') {
      if (this.countdownAt) {
        const left = Math.ceil(this.countdownAt - Date.now() / 1000);
        if (left !== this.lastCount) {
          this.lastCount = left;
          if (left > 0) this.broadcast({ t: 'countdown', n: left });
        }
        if (left <= 0) this.startGame();
      }
      if (this.tickN % LOBBY_EVERY === 0) {
        this.broadcast({ t: 'ls', ps: [...this.clients.values()].map((c) => [c.id, c.lobby.x, c.lobby.y, c.lobby.f, c.lobby.m]) });
      }
      return;
    }
    const g = this.game;
    if (!g) return;
    const dt = 1 / TICK_HZ;
    this.bots.tick(dt);
    g.tick(dt);
    if (this.game && this.tickN % SNAP_EVERY === 0) for (const c of this.gameClients()) c.send(this.snapshot(c));
  }

  /** What one player can see right now. */
  snapshot(c) {
    const g = this.game;
    const me = g.players[c.pid];
    const ghost = !me.alive;
    const [ex, ey] = g.eye(me);
    const R = g.visionOf(me) + 1.5; // a margin so the client's own fog edge has data
    const vis = (x, y) => ghost || (Math.hypot(x - ex, y - ey) <= R && !g.world.blocked(ex, ey, x, y));
    const ps = [];
    for (const p of g.players) {
      if (p === me || p.inVent || (!p.alive && !ghost)) continue;
      if (!vis(p.x, p.y - 0.55)) continue;
      ps.push([p.id, r2(p.x), r2(p.y), p.facing, p.moving ? 1 : 0, p.alive ? 1 : 0]);
    }
    const shown = new Set(ps.map((p) => p[0]));
    const out = {
      t: 's',
      T: Math.round(g.t * 1000) / 1000,
      ph: g.phase,
      ps,
      b: g.bodies.filter((b) => vis(b.x, b.y - 0.3)).map((b) => [b.id, r2(b.x), r2(b.y)]),
      sab: publicSabotage(g),
      dr: g.map.doors.filter((d) => g.world.doorClosed[d.id]).map((d) => d.id),
      L: Math.round(g.lights * 1000) / 1000,
      btn: g.buttonReadyAt,
      bar: g.taskBar(),
      kc: r2(me.killCooldown),
      el: me.emergencyLeft,
      v: me.inVent,
      al: me.alive ? 1 : 0,
      fx: [...g.visualFx].filter(([id]) => id === me.id || shown.has(id)).map(([id, f]) => [id, f.kind]),
    };
    if (me.role === 'impostor') {
      out.sr = g.sab.readyAt;
      out.dc = Object.fromEntries(Object.entries(g.sab.doors).map(([k, v]) => [k, [v.closedUntil, v.readyAt]]));
    }
    return out;
  }

  sendTo(pid, msg) {
    for (const c of this.gameClients()) if (c.pid === pid) c.send(msg);
  }

  /** Forward game events, each only to the players who should know. */
  onEvent(type, d) {
    const g = this.game;
    const all = this.gameClients();
    const P = (c) => g.players[c.pid];
    const ev = (data) => ({ t: 'e', ev: type, d: data });
    switch (type) {
      case 'start':
        for (const c of all) c.send(ev({ T: g.t }));
        break;
      case 'kill': {
        const { killer, victim, from, body } = d;
        const msg = ev({
          killer: killer.id,
          victim: victim.id,
          from: { x: r2(from.x), y: r2(from.y) },
          body: { id: body.id, x: r2(body.x), y: r2(body.y) },
        });
        for (const c of all) {
          const v = P(c);
          if (v === victim || v === killer || v.role === 'impostor' || !v.alive || g.sees(v, victim.x, victim.y - 0.55)) c.send(msg);
        }
        this.sendTo(killer.id, { t: 'tp', x: killer.x, y: killer.y });
        break;
      }
      case 'vent': {
        const v = g.map.vents[d.vent];
        for (const c of all)
          if (P(c) === d.player || g.sees(P(c), v.x, v.y)) c.send(ev({ player: d.player.id, vent: d.vent, enter: d.enter }));
        if (d.enter) this.sendTo(d.player.id, { t: 'tp', x: v.x, y: v.y });
        break;
      }
      case 'ventMove': {
        const v = g.map.vents[d.vent];
        this.sendTo(d.player.id, ev({ player: d.player.id, vent: d.vent }));
        this.sendTo(d.player.id, { t: 'tp', x: v.x, y: v.y });
        break;
      }
      case 'sabotage':
        for (const c of all) c.send(ev({ kind: d.type, sab: publicSabotage(g) }));
        break;
      case 'sabotageFixed':
        for (const c of all) c.send(ev({ kind: d.type }));
        break;
      case 'fixPart':
        for (const c of all) c.send(ev({ station: d.station }));
        break;
      case 'doors':
        for (const c of all) c.send(ev({ room: d.room, closed: d.closed }));
        break;
      case 'meeting': {
        const m = g.meeting;
        const msg = ev({
          reason: m.reason,
          caller: m.callerId,
          body: m.bodyId,
          bodyRoom: m.bodyRoom,
          stageEnd: m.stageEnd,
          dead: g.players.filter((p) => !p.alive).map((p) => p.id),
        });
        for (const c of all) c.send(msg);
        break;
      }
      case 'meetingStage': {
        const m = g.meeting;
        const data = { stage: d.stage, stageEnd: m.stageEnd };
        if (d.stage === 'results') {
          data.result = {
            ejected: m.result.ejected,
            why: m.result.why,
            votes: g.players.filter((p) => p.alive && p.vote != null).map((p) => [p.id, p.vote]),
          };
        }
        for (const c of all) c.send(ev(data));
        break;
      }
      case 'vote':
        for (const c of all) c.send(ev({ player: d.player.id }));
        break;
      case 'chat':
        for (const c of all) if (!d.dead || !P(c).alive) c.send(ev({ from: d.from, text: d.text, dead: d.dead }));
        break;
      case 'eject':
        for (const c of all) c.send(ev({ player: d.player ? d.player.id : null, line1: d.line1, line2: d.line2, end: d.end }));
        break;
      case 'resume': {
        const msg = ev({ pos: g.players.map((p) => [p.id, r2(p.x), r2(p.y), p.facing]), btn: g.buttonReadyAt });
        for (const c of all) c.send(msg);
        break;
      }
      case 'gameOver': {
        const msg = ev({
          winner: d.winner,
          reason: d.reason,
          roles: g.players.map((p) => p.role),
          alive: g.players.map((p) => (p.alive ? 1 : 0)),
        });
        for (const c of all) c.send(msg);
        setTimeout(() => this.game === g && this.endGame(), 500);
        break;
      }
      case 'taskStep':
      case 'taskDone':
        this.sendTo(d.player.id, { t: 'tasks', tasks: d.player.tasks });
        break;
    }
  }

  /** Client-reported movement, checked for speed and walls. */
  gamePos(c, m) {
    const g = this.game;
    if (!g || c.pid == null || g.phase !== 'play') return;
    const p = g.players[c.pid];
    if (p.inVent || !p.remote) return;
    let x = Number(m.x);
    let y = Number(m.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = Date.now() / 1000;
    const dt = Math.min(1, Math.max(0.05, now - (c.posT ?? now)));
    c.posT = now;
    const maxD = DIST.speed * g.settings.playerSpeed * dt * 1.6 + 0.4;
    const tooFar = Math.hypot(x - p.x, y - p.y) > maxD;
    if (tooFar || (p.alive && g.world.blocked(p.x, p.y - 0.15, x, y - 0.15))) {
      c.send({ t: 'tp', x: r2(p.x), y: r2(p.y) });
      return;
    }
    if (p.alive) [x, y] = g.world.resolve(x, y, DIST.playerRadius);
    else {
      x = Math.max(1, Math.min(g.map.W - 1, x));
      y = Math.max(1, Math.min(g.map.H - 1, y));
    }
    p.x = x;
    p.y = y;
    p.facing = m.f < 0 ? -1 : 1;
    p.moving = !!m.m;
    if (p.moving) g.visualFx.delete(p.id);
  }

  action(c, m) {
    const g = this.game;
    if (!g || c.pid == null) return;
    const id = c.pid;
    const p = g.players[id];
    const near = (stationId) => {
      const st = g.map.stations[stationId];
      return st && Math.hypot(st.x - p.x, st.y - p.y) <= DIST.use + 0.8;
    };
    switch (m.a) {
      case 'kill':
        g.kill(id, m.target | 0);
        break;
      case 'report':
        g.report(id);
        break;
      case 'emergency':
        g.callEmergency(id);
        break;
      case 'vent':
        g.enterVent(id);
        break;
      case 'unvent':
        g.exitVent(id);
        break;
      case 'ventTo':
        g.ventTo(id, String(m.vent));
        break;
      case 'sabotage':
        g.sabotage(id, String(m.kind));
        break;
      case 'doors':
        g.closeDoors(id, String(m.room));
        break;
      case 'step': {
        const task = p.tasks[m.task | 0];
        if (task && !task.done && near(task.steps[task.step].station)) g.completeStep(id, m.task | 0);
        break;
      }
      case 'visual':
        g.setVisual(id, String(m.kind), !!m.on);
        break;
      case 'fix': {
        const a = m.action || {};
        if (near(m.station)) g.fixAction(id, String(m.station), { type: String(a.type), index: a.index | 0, on: !!a.on });
        break;
      }
      case 'vote':
        g.vote(id, m.target === 'skip' ? 'skip' : m.target | 0);
        break;
      case 'chat': {
        const now = Date.now();
        if (now - (c.chatT || 0) < 600) break;
        c.chatT = now;
        g.chat(id, String(m.text || '').slice(0, 100));
        break;
      }
    }
  }
}
