// Bot brains for every seat that isn't the local player.
// Bots only use what they could plausibly know: what they saw (vision + line of sight),
// what was said in meetings, and their own role. They act through the same Game actions
// as a human, so the rules are enforced the same way.

import { findPath } from './path.js';
import { FIX_TIME } from './tasks/defs.js';
import { ventNeighbors } from './map.js';

const PERCEIVE_EVERY = 0.25;

const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];

export class Bots {
  constructor(game) {
    this.game = game;
    this.rng = game.rng;
    this.brains = new Map();
    this.publicSus = new Map(); // what the table as a whole has been told
    for (const p of game.players) if (p.isBot) this.brains.set(p.id, this.newBrain(p));
    this.offs = [
      game.on('kill', (e) => this.onKill(e)),
      game.on('vent', (e) => this.onVent(e)),
      game.on('sabotage', (e) => this.onSabotage(e)),
      game.on('sabotageFixed', () => this.onSabotageFixed()),
      game.on('meeting', (e) => this.onMeeting(e)),
      game.on('meetingStage', (e) => this.onStage(e)),
      game.on('chat', (m) => this.onChat(m)),
      game.on('eject', (e) => this.onEject(e)),
      game.on('resume', () => this.onResume()),
      game.on('doors', () => this.brains.forEach((b) => (b.path = null))),
    ];
  }

  destroy() {
    this.offs.forEach((f) => f());
  }

  /** Take over a seat, e.g. when its human disconnects mid-game. */
  addBrain(p) {
    p.isBot = true;
    p.remote = false;
    p.input.x = p.input.y = 0;
    this.brains.set(p.id, this.newBrain(p));
  }

  newBrain(p) {
    return {
      id: p.id,
      goal: null,
      path: null,
      pi: 0,
      busyUntil: 0,
      nextPerceive: this.rng() * PERCEIVE_EVERY,
      nextThink: 0,
      lastPos: [p.x, p.y],
      stuckT: 0,
      seen: new Map(), // id -> { t, x, y, room }
      sus: new Map(),
      cleared: new Set(),
      evidence: [], // { kind: 'kill'|'vent'|'near', who, victim?, room, t }
      reported: new Set(),
      chatQueue: [],
      said: new Set(),
      voteAt: Infinity,
      lastKillT: -99,
      skill: 0.75 + this.rng() * 0.25,
    };
  }

  // ---------- helpers ----------
  P(id) {
    return this.game.players[id];
  }

  sus(b, id) {
    return b.sus.get(id) || 0;
  }

  addSus(b, id, v) {
    if (id === b.id) return;
    b.sus.set(id, this.sus(b, id) + v);
  }

  go(b, x, y) {
    const p = this.P(b.id);
    b.path = p.alive ? findPath(this.game.world, p.x, p.y, x, y) : [[x, y]];
    b.pi = 0;
    b.dest = [x, y];
    if (!b.path) b.path = [[x, y]];
  }

  arrived(b, x, y, r = 0.6) {
    const p = this.P(b.id);
    return Math.hypot(p.x - x, p.y - y) <= r;
  }

  steer(b, dt) {
    const g = this.game;
    const p = this.P(b.id);
    if (!b.path || b.pi >= b.path.length) {
      g.setInput(b.id, 0, 0);
      return;
    }
    const [wx, wy] = b.path[b.pi];
    const dx = wx - p.x;
    const dy = wy - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.2) {
      b.pi++;
      if (b.pi >= b.path.length) g.setInput(b.id, 0, 0);
      return;
    }
    const slow = b.pi === b.path.length - 1 && d < 0.5 ? d / 0.5 : 1;
    g.setInput(b.id, (dx / d) * slow, (dy / d) * slow);
    // Stuck detection: replan if we barely moved for a second.
    const moved = Math.hypot(p.x - b.lastPos[0], p.y - b.lastPos[1]);
    b.stuckT = moved < 0.02 ? b.stuckT + dt : 0;
    b.lastPos = [p.x, p.y];
    if (b.stuckT > 0.8 && b.dest) {
      b.stuckT = 0;
      const [tx, ty] = b.dest;
      this.go(b, tx + (this.rng() - 0.5) * 0.4, ty + (this.rng() - 0.5) * 0.4);
    }
  }

  stand(b) {
    b.path = null;
    this.game.setInput(b.id, 0, 0);
  }

  roomOf(p) {
    return this.game.roomName(p.x, p.y) || 'the hallway';
  }

  /** Crewmates (alive, not `except`) that could see a point right now. */
  watchers(x, y, except = []) {
    const g = this.game;
    return g.players.filter((q) => q.alive && q.role !== 'impostor' && !except.includes(q.id) && !q.inVent && g.sees(q, x, y));
  }

  // ---------- main loop ----------
  tick(dt) {
    const g = this.game;
    if (g.phase === 'meeting') return this.tickMeeting();
    if (g.phase !== 'play') return;
    for (const b of this.brains.values()) {
      const p = this.P(b.id);
      if (g.t >= b.nextPerceive) {
        b.nextPerceive = g.t + PERCEIVE_EVERY;
        if (p.alive) this.perceive(b, p);
      }
      if (g.phase !== 'play') return;
      if (p.role === 'impostor') this.thinkImpostor(b, p, dt);
      else this.thinkCrew(b, p, dt);
      if (g.phase !== 'play') return;
      if (!p.inVent && g.t >= b.busyUntil) this.steer(b, dt);
    }
  }

  perceive(b, p) {
    const g = this.game;
    const visible = g.players.filter((q) => q !== p && q.alive && g.seesPlayer(p, q));
    for (const q of visible) {
      const near = visible.filter((o) => o !== q && Math.hypot(o.x - q.x, o.y - q.y) < 4.5).map((o) => o.id);
      if (Math.hypot(p.x - q.x, p.y - q.y) < 4.5) near.push(p.id);
      b.seen.set(q.id, { t: g.t, x: q.x, y: q.y, room: this.roomOf(q), near });
      const fx = g.visualFx.get(q.id);
      if (fx && fx.kind === 'scan' && p.role !== 'impostor' && !b.cleared.has(q.id)) {
        b.cleared.add(q.id);
        b.sus.set(q.id, -6);
        b.chatQueue.push({ text: `${q.colorName.toLowerCase()} is safe, saw them scan`, prio: 1 });
      }
    }
    if (p.role === 'impostor' || b.goal?.kind === 'report') return;
    for (const body of g.bodies) {
      if (b.reported.has(body.id) || !g.sees(p, body.x, body.y - 0.3)) continue;
      b.reported.add(body.id);
      if (g.t - body.t < 3) {
        for (const q of g.players) {
          if (q === p || !q.alive || q.inVent || Math.hypot(q.x - body.x, q.y - body.y) > 2 || !g.seesPlayer(p, q)) continue;
          this.addSus(b, q.id, 8);
          b.evidence.push({ kind: 'over', who: q.id, victim: body.id, room: g.roomName(body.x, body.y) || 'the hallway', t: g.t });
        }
      }
      // Who was close to the body recently?
      for (const [qid, s] of b.seen) {
        if (qid === body.id || !this.P(qid).alive) continue;
        if (g.t - s.t < 8 && Math.hypot(s.x - body.x, s.y - body.y) < 7) {
          this.addSus(b, qid, 1.5);
          b.evidence.push({ kind: 'near', who: qid, victim: body.id, room: g.roomName(body.x, body.y), t: g.t });
        }
      }
      if (this.rng() < 0.95) {
        b.goal = { kind: 'report', body: body.id, at: g.t + 0.3 + this.rng() * 0.8 };
        this.go(b, body.x, body.y);
      }
    }
  }

  // ---------- crew ----------
  thinkCrew(b, p, dt) {
    const g = this.game;
    if (!p.alive) return this.thinkGhost(b, p);
    const goal = b.goal;
    if (goal?.kind === 'report') {
      const body = g.bodies.find((x) => x.id === goal.body);
      if (!body) b.goal = null;
      else if (g.t >= goal.at && g.reportable(p)) return void g.report(b.id);
      else if (!b.path) this.go(b, body.x, body.y);
      return;
    }
    if (goal?.kind === 'button') {
      const btn = g.map.button;
      if (g.emergencyBlock(p)) {
        if (g.sab.active || p.emergencyLeft <= 0) b.goal = null;
        return;
      }
      if (g.nearButton(p)) return void g.callEmergency(b.id);
      if (!b.path) this.go(b, btn.x, btn.y + 2.6);
      return;
    }
    if (goal?.kind === 'fix') return this.doFix(b, p, goal);
    if (g.t < b.busyUntil) return;
    if (goal?.kind === 'task') {
      const st = g.map.stations[goal.station];
      if (this.arrived(b, st.x, st.y, 0.9)) {
        if (!goal.started) {
          goal.started = true;
          this.stand(b);
          b.busyUntil = g.t + goal.step.bot * (1.6 - b.skill * 0.3);
          const task = p.tasks[goal.taskIndex];
          if (task.visual) g.setVisual(b.id, task.id, true);
          return;
        }
        g.setVisual(b.id, null, false);
        g.completeStep(b.id, goal.taskIndex);
        b.goal = null;
        b.busyUntil = g.t + 0.5 + this.rng() * 1.5;
        if (this.rng() < 0.45) this.wander(b);
        return;
      }
      if (!b.path) this.go(b, st.x, st.y);
      return;
    }
    if (goal?.kind === 'wander') {
      if (!b.path || b.pi >= b.path.length) {
        if (!goal.until) goal.until = g.t + 2 + this.rng() * 5;
        if (g.t > goal.until) b.goal = null;
      }
      return;
    }
    if (goal?.kind === 'follow') {
      const q = this.P(goal.target);
      if (!q.alive || q.inVent || g.t > goal.until || !g.seesPlayer(p, q)) {
        b.goal = null;
        return;
      }
      if (Math.hypot(q.x - p.x, q.y - p.y) < 1.8) this.stand(b);
      else if (!b.path || g.t >= (b.repath || 0)) {
        b.repath = g.t + 0.8;
        this.go(b, q.x, q.y);
      }
      return;
    }
    if (this.rng() < 0.22 && this.buddyUp(b, p)) return;
    this.pickTask(b, p) || this.wander(b);
  }

  /** Stick with someone for a while, like careful players do. */
  buddyUp(b, p) {
    const g = this.game;
    const near = g.players.filter((q) => q !== p && q.alive && !q.inVent && g.seesPlayer(p, q) && Math.hypot(q.x - p.x, q.y - p.y) < 8);
    if (!near.length) return false;
    const q = pickOne(this.rng, near);
    b.goal = { kind: 'follow', target: q.id, until: g.t + 8 + this.rng() * 12 };
    return true;
  }

  pickTask(b, p) {
    const g = this.game;
    let best = null;
    let bd = Infinity;
    p.tasks.forEach((task, i) => {
      if (task.done || task.fake || g.t < task.readyAt) return;
      const step = task.steps[task.step];
      const st = g.map.stations[step.station];
      const d = Math.hypot(st.x - p.x, st.y - p.y) + this.rng() * 6;
      if (d < bd) {
        bd = d;
        best = { kind: 'task', taskIndex: i, station: step.station, step };
      }
    });
    if (!best) return false;
    b.goal = best;
    const st = g.map.stations[best.station];
    this.go(b, st.x, st.y);
    return true;
  }

  wander(b) {
    const g = this.game;
    const rooms = g.map.rooms;
    const r = pickOne(this.rng, rooms);
    const [x0, y0, x1, y1] = r.rect;
    for (let i = 0; i < 10; i++) {
      const x = x0 + 1 + this.rng() * (x1 - x0 - 2);
      const y = y0 + 1 + this.rng() * (y1 - y0 - 2);
      if (g.world.passable(Math.floor(x), Math.floor(y))) {
        b.goal = { kind: 'wander' };
        this.go(b, x, y);
        return;
      }
    }
  }

  thinkGhost(b, p) {
    const g = this.game;
    if (p.role === 'impostor') {
      this.maybeSabotage(b, p);
      if (!b.path || b.pi >= b.path.length) this.wander(b);
      return;
    }
    if (g.t < b.busyUntil) return;
    const goal = b.goal;
    if (goal?.kind === 'task') {
      const st = g.map.stations[goal.station];
      if (this.arrived(b, st.x, st.y, 0.5)) {
        if (!goal.started) {
          goal.started = true;
          this.stand(b);
          b.busyUntil = g.t + goal.step.bot;
          return;
        }
        g.completeStep(b.id, goal.taskIndex);
        b.goal = null;
        return;
      }
      if (!b.path) this.go(b, st.x, st.y);
      return;
    }
    if (goal?.kind === 'wander' && b.path && b.pi < b.path.length) return;
    this.pickTask(b, p) || this.wander(b);
  }

  doFix(b, p, goal) {
    const g = this.game;
    const s = g.sab.active;
    if (!s || g.fixPointDone(goal.station)) {
      if (goal.holding) g.fixAction(b.id, goal.station, { type: 'hold', on: false });
      b.goal = null;
      return;
    }
    const st = g.map.stations[goal.station];
    if (!this.arrived(b, st.x, st.y, 0.9)) {
      if (!b.path) this.go(b, st.x, st.y);
      return;
    }
    this.stand(b);
    if (s.type === 'reactor') {
      if (!goal.holding) {
        goal.holding = true;
        g.fixAction(b.id, goal.station, { type: 'hold', on: true });
      }
      return;
    }
    if (!goal.doneAt) goal.doneAt = g.t + FIX_TIME[s.type] * (1.2 - b.skill * 0.3);
    if (g.t >= goal.doneAt) {
      const action = s.type === 'lights' ? { type: 'allOn' } : { type: s.type };
      g.fixAction(b.id, goal.station, action);
      b.goal = null;
    }
  }

  // ---------- impostor ----------
  thinkImpostor(b, p, dt) {
    const g = this.game;
    if (!p.alive) return this.thinkGhost(b, p);
    this.maybeSabotage(b, p);
    if (p.inVent) return this.inVent(b, p);
    const goal = b.goal;
    if (goal?.kind === 'selfReport') {
      if (g.t >= goal.at) {
        if (g.reportable(p)) g.report(b.id);
        b.goal = null;
      }
      return;
    }
    if (goal?.kind === 'escape') {
      if (goal.vent) {
        const v = g.map.vents[goal.vent];
        if (this.arrived(b, v.x, v.y, 0.9)) {
          if (!this.watchers(p.x, p.y - 0.4).filter((o) => g.seesPlayer(p, o)).length && g.enterVent(b.id)) {
            goal.ventUntil = g.t + 0.8 + this.rng() * 1.2;
            goal.hops = 1 + Math.floor(this.rng() * 2);
            return;
          }
          b.goal = null;
          return;
        }
        if (!b.path) this.go(b, v.x, v.y);
        return;
      }
      if (!b.path || b.pi >= b.path.length) b.goal = null;
      return;
    }
    // Hunting, after a short random hesitation once the cooldown is ready.
    if (p.killCooldown > 0) b.huntAt = null;
    else if (b.huntAt == null) b.huntAt = g.t + 14 + this.rng() * 24;
    if (p.killCooldown <= 0 && g.t >= b.huntAt) {
      const target = this.isolatedTarget(b, p, g.t - Math.max(b.lastKillT, 0) > 45);
      if (target && target.id !== b.isoTarget) {
        b.isoTarget = target.id;
        b.isoSince = g.t;
      }
      if (!target) b.isoTarget = null;
      if (target) {
        if (g.t - b.isoSince > 0.8 && g.killTarget(p) === target && g.kill(b.id, target.id)) return this.afterKill(b, p);
        b.goal = { kind: 'hunt', target: target.id };
        if (!b.path || g.t >= (b.repath || 0)) {
          b.repath = g.t + 0.4;
          this.go(b, target.x, target.y);
        }
        return;
      }
      // Drift toward someone we last saw, to find a lone target.
      if (goal?.kind !== 'stalk' || !b.path || b.pi >= b.path.length || g.t > goal.until) {
        const crew = g.players.filter((q) => q.alive && q.role !== 'impostor');
        const q = pickOne(this.rng, crew);
        if (q) {
          const s = b.seen.get(q.id);
          const [tx, ty] = s && g.t - s.t < 20 ? [s.x, s.y] : [q.x, q.y];
          b.goal = { kind: 'stalk', target: q.id, until: g.t + 6 + this.rng() * 6 };
          this.go(b, tx, ty);
        }
      }
      return;
    }
    // Waiting for cooldown: fake tasks.
    if (g.t < b.busyUntil) return;
    if (goal?.kind === 'fake') {
      const st = g.map.stations[goal.station];
      if (this.arrived(b, st.x, st.y, 0.9)) {
        this.stand(b);
        b.busyUntil = g.t + 2 + this.rng() * 4;
        b.goal = null;
        return;
      }
      if (!b.path) this.go(b, st.x, st.y);
      return;
    }
    const tasks = p.tasks.filter((t) => !t.done);
    const fake = tasks.length && this.rng() < 0.75 ? pickOne(this.rng, tasks) : null;
    const station = fake
      ? fake.steps[fake.step].station
      : pickOne(
          this.rng,
          Object.keys(g.map.stations).filter((k) => !g.map.stations[k].sabotage),
        );
    if (station === 'scan_mb') return this.wander(b); // can't fake a visual task
    b.goal = { kind: 'fake', station };
    const st = g.map.stations[station];
    this.go(b, st.x, st.y);
  }

  /** A visible crewmate nobody else could see us kill. Risky: ignore watchers far from the target. */
  isolatedTarget(b, p, risky = false) {
    const g = this.game;
    let best = null;
    let bd = Infinity;
    for (const q of g.players) {
      if (!q.alive || q.role === 'impostor' || q.inVent || !g.seesPlayer(p, q)) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > 9) continue;
      // Only crewmates the impostor can actually see count, and a far one is sometimes misjudged.
      let others = this.watchers(q.x, q.y - 0.4, [q.id])
        .concat(this.watchers(p.x, p.y - 0.4, [q.id]))
        .filter((o) => g.seesPlayer(p, o))
        .filter((o) => Math.hypot(o.x - q.x, o.y - q.y) < 4.5 || this.rng() > 0.12 * (1.6 - b.skill));
      // Overdue for a kill, or already right next to the target: only nearby watchers count.
      if (risky || d < 2.6) others = others.filter((o) => Math.hypot(o.x - q.x, o.y - q.y) < 4.5);
      if (others.length) continue;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    return best;
  }

  afterKill(b, p) {
    const g = this.game;
    b.lastKillT = g.t;
    this.stand(b);
    if (this.rng() < 0.12) {
      b.goal = { kind: 'selfReport', at: g.t + 1.5 + this.rng() * 2.5 };
      return;
    }
    const vent = g.nearestVent(p, 9);
    if (vent && this.rng() < 0.7) {
      b.goal = { kind: 'escape', vent };
      return;
    }
    b.goal = { kind: 'escape' };
    const far = g.map.rooms.filter((r) => Math.hypot((r.rect[0] + r.rect[2]) / 2 - p.x, (r.rect[1] + r.rect[3]) / 2 - p.y) > 20);
    const r = pickOne(this.rng, far);
    if (r) this.go(b, (r.rect[0] + r.rect[2]) / 2, (r.rect[1] + r.rect[3]) / 2 + 1);
  }

  inVent(b, p) {
    const g = this.game;
    const goal = b.goal || {};
    if (g.t < (goal.ventUntil || 0)) return;
    if (goal.hops > 0) {
      goal.hops--;
      const next = pickOne(this.rng, ventNeighbors(p.inVent));
      if (next) g.ventTo(b.id, next);
      goal.ventUntil = g.t + 0.6 + this.rng() * 0.8;
      return;
    }
    if (!this.watchers(p.x, p.y - 0.4).length || g.t > (goal.ventUntil || 0) + 6) {
      g.exitVent(b.id);
      b.goal = null;
      b.path = null;
    } else {
      goal.ventUntil = g.t + 0.5;
    }
  }

  maybeSabotage(b, p) {
    const g = this.game;
    if (g.sabotageCooldown() > 0 || !g.canSabotage(p)) return;
    if (this.rng() > 0.004) return; // roughly one try every ~4 s of bot-time per impostor
    const hunting = b.goal?.kind === 'hunt' || b.goal?.kind === 'stalk';
    const r = this.rng();
    let type;
    if (hunting && r < 0.5) type = 'lights';
    else type = pickOne(this.rng, ['lights', 'comms', 'o2', 'reactor', 'reactor', 'o2']);
    g.sabotage(b.id, type);
  }

  // ---------- events ----------
  onKill({ killer, victim, from }) {
    const g = this.game;
    for (const b of this.brains.values()) {
      const p = this.P(b.id);
      if (!p.alive || p === killer || p.role === 'impostor') continue;
      const saw = g.sees(p, from.x, from.y - 0.4) || g.sees(p, victim.x, victim.y - 0.4);
      if (!saw) continue;
      const room = g.roomName(victim.x, victim.y) || 'the hallway';
      b.evidence.push({ kind: 'kill', who: killer.id, victim: victim.id, room, t: g.t });
      this.addSus(b, killer.id, 100);
      b.reported.add(victim.id);
      b.goal = { kind: 'report', body: victim.id, at: g.t + 0.4 + this.rng() * 0.6 };
      this.go(b, victim.x, victim.y);
    }
  }

  onVent({ player, vent }) {
    const g = this.game;
    const v = g.map.vents[vent];
    for (const b of this.brains.values()) {
      const p = this.P(b.id);
      if (!p.alive || p === player || p.role === 'impostor') continue;
      if (!g.sees(p, v.x, v.y - 0.3)) continue;
      b.evidence.push({ kind: 'vent', who: player.id, room: g.roomName(v.x, v.y) || 'the hallway', t: g.t });
      this.addSus(b, player.id, 60);
      if (p.emergencyLeft > 0 && this.rng() < 0.6 && b.goal?.kind !== 'report') {
        b.goal = { kind: 'button' };
        b.path = null;
      }
    }
  }

  onSabotage({ type }) {
    const g = this.game;
    const fixers = [...this.brains.values()].filter((b) => {
      const p = this.P(b.id);
      return p.alive && p.role !== 'impostor' && b.goal?.kind !== 'report';
    });
    const stations = Object.entries(g.map.stations).filter(([, st]) => st.sabotage === type);
    const assign = (stationId, n) => {
      const st = g.map.stations[stationId];
      fixers
        .filter((b) => b.goal?.kind !== 'fix')
        .sort((a, c) => Math.hypot(this.P(a.id).x - st.x, this.P(a.id).y - st.y) - Math.hypot(this.P(c.id).x - st.x, this.P(c.id).y - st.y))
        .slice(0, n)
        .forEach((b) => {
          g.setVisual(b.id, null, false);
          b.busyUntil = 0;
          b.goal = { kind: 'fix', station: stationId };
          this.go(b, st.x, st.y);
        });
    };
    if (type === 'lights') assign('lights_el', fixers.length > 5 ? 2 : 1);
    else if (type === 'comms') assign('comms_co', 1);
    else for (const [id] of stations) assign(id, fixers.length >= 6 ? 2 : 1);
  }

  onSabotageFixed() {
    for (const b of this.brains.values()) {
      if (b.goal?.kind === 'fix') {
        b.goal = null;
        b.path = null;
      }
    }
  }

  // ---------- meetings ----------
  onMeeting({ meeting, caller }) {
    this.heard = new Set();
    for (const b of this.brains.values()) {
      const p = this.P(b.id);
      b.goal = null;
      b.path = null;
      b.busyUntil = 0;
      b.voteAt = Infinity;
      b.chatQueue = b.chatQueue.filter((c) => c.prio >= 1).slice(-1);
      b.said.clear();
      b.accusedReply = false;
      if (!p.alive) continue;
      b.meetingRoom = this.roomOf(p);
      if (p.role !== 'impostor') this.recallVictims(b);
      this.planLines(b, p, meeting, caller);
    }
  }

  /** "I last saw red with blue": suspicion for whoever was with each new victim. */
  recallVictims(b) {
    const g = this.game;
    b.knownDead ||= new Set();
    for (const v of g.players) {
      if (v.alive || v.ejected || b.knownDead.has(v.id)) continue;
      b.knownDead.add(v.id);
      const rec = b.seen.get(v.id);
      if (!rec || g.t - rec.t > 30) continue;
      // Only "alone with the victim" is worth raising.
      const withVictim = rec.near.filter((id) => id !== b.id);
      if (withVictim.length !== 1 || !this.P(withVictim[0]).alive) continue;
      this.addSus(b, withVictim[0], 3);
      b.evidence.push({ kind: 'with', who: withVictim[0], victim: v.id, room: rec.room, t: rec.t });
    }
  }

  planLines(b, p, meeting, caller) {
    const g = this.game;
    const rng = this.rng;
    const name = (id) => this.P(id).colorName.toLowerCase();
    const lines = [];
    const victim = meeting.bodyId != null ? this.P(meeting.bodyId) : null;
    if (p.role === 'impostor') {
      if (caller === p && victim) lines.push(`${name(victim.id)} dead in ${meeting.bodyRoom?.toLowerCase() || 'hallway'}`);
      else lines.push(pickOne(rng, victim ? ['where', 'who', 'where was the body?', 'wow'] : ['why?', 'what happened', 'who called']));
      lines.push(`i was in ${b.meetingRoom.toLowerCase()}`);
      // Frame someone the table can't verify.
      const crew = g.players.filter((q) => q.alive && q.role !== 'impostor' && q !== p);
      const target = crew.sort((a, c) => (this.publicSus.get(c.id) || 0) - (this.publicSus.get(a.id) || 0))[0];
      if (target && rng() < 0.55)
        lines.push(pickOne(rng, [`${name(target.id)} sus`, `${name(target.id)} was following me`, `i think ${name(target.id)}`]));
      else lines.push(pickOne(rng, ['skip?', 'no info, skip', 'idk']));
    } else {
      const kill = b.evidence.filter((e) => (e.kind === 'kill' || e.kind === 'over') && this.P(e.who).alive).pop();
      const vent = b.evidence.filter((e) => e.kind === 'vent' && this.P(e.who).alive).pop();
      if (caller === p && victim) lines.push(`${name(victim.id)} dead in ${meeting.bodyRoom?.toLowerCase() || 'hallway'}`);
      if (kill?.kind === 'over') {
        lines.push(`${name(kill.who)} was standing over ${name(kill.victim)}'s body`);
        lines.push(`vote ${name(kill.who)}`);
      } else if (kill) {
        lines.push(`${name(kill.who)} killed ${name(kill.victim)}!!`);
        lines.push(`i saw it in ${kill.room.toLowerCase()}, vote ${name(kill.who)}`);
      } else if (vent) {
        lines.push(`${name(vent.who)} vented in ${vent.room.toLowerCase()}`);
        lines.push(`vote ${name(vent.who)}`);
      } else if (b.evidence.some((e) => e.kind === 'with' && this.P(e.who).alive && !this.P(e.victim).alive && g.t - e.t < 120)) {
        const e = b.evidence.filter((x) => x.kind === 'with' && this.P(x.who).alive).pop();
        if (caller !== p) lines.push(pickOne(rng, ['where?', 'where was the body']));
        lines.push(`${name(e.who)} was with ${name(e.victim)} in ${e.room.toLowerCase()}`);
        if (this.sus(b, e.who) >= 3) lines.push(`its ${name(e.who)}`);
      } else {
        const top = this.topSuspect(b);
        if (caller === p && !victim) lines.push(top ? `${name(top)} is acting sus` : 'just checking in');
        else if (!victim) lines.push(pickOne(rng, ['why the meeting?', 'what happened', 'who called it', 'why?']));
        else if (caller !== p) lines.push(pickOne(rng, ['where?', 'who?', 'where was it', 'body where']));
        if (top && this.sus(b, top) >= 2)
          lines.push(pickOne(rng, [`${name(top)} sus`, `${name(top)} was near there`, `i think ${name(top)}`]));
        else lines.push(rng() < 0.5 ? `i was in ${b.meetingRoom.toLowerCase()}` : pickOne(rng, ['skip', 'no info', 'idk who']));
      }
    }
    let at = 0.8 + rng() * 2.5 + (caller === p ? 0 : 1.5);
    for (const text of lines) {
      b.chatQueue.push({ text, at, prio: 0 });
      at += 2 + rng() * 4;
    }
  }

  topSuspect(b) {
    let best = null;
    let bv = 0;
    for (const [id, v] of b.sus) {
      if (!this.P(id).alive || b.cleared.has(id)) continue;
      if (v > bv) {
        bv = v;
        best = id;
      }
    }
    return best;
  }

  onStage({ stage }) {
    const g = this.game;
    if (stage === 'discussion') this.meetingT0 = g.t;
    if (stage !== 'voting') return;
    const span = Math.min(g.settings.votingTime - 2, 22);
    for (const b of this.brains.values()) b.voteAt = g.t + 3 + this.rng() * span;
  }

  tickMeeting() {
    const g = this.game;
    const m = g.meeting;
    if (!m || m.stage === 'splash') return;
    const t0 = this.meetingT0 ?? g.t;
    for (const b of this.brains.values()) {
      const p = this.P(b.id);
      if (!p.alive) continue;
      const next = b.chatQueue[0];
      if (next && g.t - t0 >= (next.at ?? 0) && (m.stage === 'discussion' || m.stage === 'voting')) {
        b.chatQueue.shift();
        if (!b.said.has(next.text)) {
          b.said.add(next.text);
          g.chat(b.id, next.text);
          if (g.phase !== 'meeting') return;
        }
      }
      if (m.stage === 'voting' && p.vote == null && g.t >= b.voteAt) this.castVote(b, p);
      if (g.phase !== 'meeting' || g.meeting?.stage !== m.stage) return;
    }
  }

  castVote(b, p) {
    const g = this.game;
    const alive = g.players.filter((q) => q.alive && q !== p);
    let target = 'skip';
    if (p.role === 'impostor') {
      const crew = alive.filter((q) => q.role !== 'impostor');
      const topCrew = crew.sort((a, c) => (this.publicSus.get(c.id) || 0) - (this.publicSus.get(a.id) || 0))[0];
      const mates = alive.filter((q) => q.role === 'impostor');
      const hotMate = mates.find((q) => (this.publicSus.get(q.id) || 0) >= 8);
      if (hotMate && this.rng() < 0.4) target = hotMate.id;
      else if (topCrew && (this.publicSus.get(topCrew.id) || 0) >= 2) target = topCrew.id;
      else if (this.rng() < 0.2 && topCrew) target = topCrew.id;
    } else {
      const ranked = alive
        .filter((q) => !b.cleared.has(q.id))
        .map((q) => [q.id, this.sus(b, q.id)])
        .sort((a, c) => c[1] - a[1]);
      if (ranked.length && ranked[0][1] >= 4 && (ranked.length < 2 || ranked[0][1] - ranked[1][1] >= 1.5)) target = ranked[0][0];
    }
    g.vote(b.id, target);
  }

  /** React to chat from anyone (bots and the human). */
  onChat(msg) {
    const g = this.game;
    if (msg.dead) return;
    const speaker = this.P(msg.from);
    const text = msg.text.toLowerCase();
    const named = g.players.filter(
      (q) => q !== speaker && (text.includes(q.colorName.toLowerCase()) || text.split(/\W+/).includes(q.name.toLowerCase())),
    );
    if (!named.length) return;
    const kill = /kill|killed|saw (it|them)|murder|standing over/.test(text);
    const vent = /vent/.test(text);
    const withV = / was with /.test(text);
    const sus = /sus|impostor|imposter|vote|following|it'?s |think/.test(text);
    const lying = /lying|liar/.test(text);
    const safe = /safe|clear|innocent|with me|scan|not /.test(text) && !kill && !vent && !withV;
    this.heard ||= new Set();
    for (const q of named.slice(0, 1)) {
      let w = kill ? 5 : vent ? 4 : withV ? 2.2 : sus ? 1 : lying ? 0.6 : 0;
      if (safe) w = -2;
      if (!w) continue;
      const key = `${msg.from}>${q.id}`;
      if (w > 0 && this.heard.has(key)) continue;
      this.heard.add(key);
      this.publicSus.set(q.id, (this.publicSus.get(q.id) || 0) + w);
      for (const b of this.brains.values()) {
        const p = this.P(b.id);
        if (!p.alive || p === speaker) continue;
        if (p.role === 'impostor') continue;
        let trust = speaker.isBot ? 0.75 : 0.9;
        if (b.cleared.has(speaker.id)) trust = 1.2;
        if (this.sus(b, speaker.id) >= 4) trust = 0.25;
        if (q === p) {
          // Accused: defend once, and distrust the accuser if we know we're innocent.
          if (w > 0) {
            this.addSus(b, speaker.id, 1.5);
            if (!b.accusedReply) {
              b.accusedReply = true;
              b.chatQueue.unshift({
                text: pickOne(this.rng, [
                  `not me, i was in ${b.meetingRoom?.toLowerCase() || 'the hallway'}`,
                  'wasnt me',
                  `${speaker.colorName.toLowerCase()} is lying`,
                ]),
                at: 0,
                prio: 1,
              });
            }
          }
          continue;
        }
        if (b.cleared.has(q.id) && w > 0) continue;
        this.addSus(b, q.id, w * trust * b.skill);
      }
      // Impostor bots defend themselves too.
      if (q.isBot && q.role === 'impostor' && q.alive && w > 0) {
        const b = this.brains.get(q.id);
        if (b && !b.accusedReply) {
          b.accusedReply = true;
          const counter =
            this.rng() < 0.4
              ? `${speaker.colorName.toLowerCase()} is lying`
              : pickOne(this.rng, ['wasnt me', 'no, i was doing tasks', `i was in ${b.meetingRoom?.toLowerCase() || 'admin'}`]);
          b.chatQueue.unshift({ text: counter, at: 0, prio: 1 });
        }
      }
    }
  }

  onEject({ player }) {
    if (!player) return;
    for (const b of this.brains.values()) {
      b.sus.delete(player.id);
      b.evidence = b.evidence.filter((e) => e.who !== player.id);
    }
    this.publicSus.delete(player.id);
  }

  onResume() {
    for (const b of this.brains.values()) {
      b.goal = null;
      b.path = null;
      b.busyUntil = this.game.t + this.rng() * 1.5;
      b.chatQueue = [];
      for (const [id, v] of b.sus) b.sus.set(id, v * 0.7);
    }
    for (const [id, v] of this.publicSus) this.publicSus.set(id, v * 0.5);
  }
}
