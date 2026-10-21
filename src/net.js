// Online play: a client session that mirrors the server's game.
// The server owns the rules. This side predicts our own movement, smooths everyone
// else's, turns server messages into the same Game events freeplay uses, and sends
// actions instead of applying them, so the HUD, meetings and minigames work unchanged.

import { Game } from './game.js';
import { packLook, unpackLook } from './room.js';

const SEND_HZ = 15;
const INTERP_DELAY = 0.12;

export function defaultServerUrl() {
  try {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    }
  } catch {
    /* no location */
  }
  return 'ws://localhost:8080/ws';
}

const now = () => performance.now() / 1000;

/**
 * A message pipe to a room: send(string) and close(); set onmessage(fn) and onclose(fn).
 * Messages that arrive before onmessage is set are kept until it is.
 */
export class Link {
  constructor() {
    this.queue = [];
    this.handler = null;
    this.onclose = null;
    this.open = true;
  }

  set onmessage(fn) {
    this.handler = fn;
    const q = this.queue;
    this.queue = [];
    q.forEach((d) => fn(d));
  }

  receive(data) {
    if (this.handler) this.handler(data);
    else this.queue.push(data);
  }

  closed() {
    if (!this.open) return;
    this.open = false;
    this.onclose?.();
  }

  send() {}

  close() {}
}

/** Link to a dedicated server over a WebSocket. */
export function wsLink(url) {
  return new Promise((resolve, reject) => {
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      reject(new Error(`"${url}" is not a valid server address.`));
      return;
    }
    const link = new Link();
    let opened = false;
    const fail = () => reject(new Error(`Can't reach a game server at ${url}. Check the address in Settings, or switch to peer-to-peer.`));
    const timer = setTimeout(() => {
      ws.close();
      fail();
    }, 6000);
    ws.onopen = () => {
      clearTimeout(timer);
      opened = true;
      resolve(link);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      if (!opened) fail();
    };
    ws.onmessage = (e) => link.receive(e.data);
    ws.onclose = () => link.closed();
    link.send = (d) => ws.readyState === 1 && ws.send(d);
    link.close = () => ws.close();
  });
}

function toSab(s) {
  if (!s) return null;
  return {
    type: s.type,
    deadline: s.dl ?? undefined,
    switches: s.sw ?? undefined,
    code: s.code ?? undefined,
    target: s.tg ?? undefined,
    done: s.dn ?? undefined,
    holders: s.type === 'reactor' ? { reactor_a: s.h >= 1 ? -1 : null, reactor_b: s.h >= 2 ? -1 : null } : undefined,
  };
}

/** Move a remote player along its buffered server positions. */
function interpolate(p, rt) {
  const b = p.buf;
  if (!b || !b.length) return;
  while (b.length >= 2 && b[1][0] <= rt) b.shift();
  if (b.length >= 2 && b[0][0] <= rt) {
    const [t0, x0, y0] = b[0];
    const [t1, x1, y1] = b[1];
    const k = Math.min(1, (rt - t0) / Math.max(1e-3, t1 - t0));
    p.x = x0 + (x1 - x0) * k;
    p.y = y0 + (y1 - y0) * k;
  } else {
    p.x = b[0][1];
    p.y = b[0][2];
  }
}

export class NetSession {
  constructor(prefs, handlers) {
    this.online = true;
    this.prefs = prefs;
    this.h = handlers;
    this.link = null;
    this.room = null;
    this.you = null;
    this.game = null;
    this.lobbyGame = null;
    this.countdown = 0;
    this.sendAt = 0;
    this.listWaiters = [];
    this.api = this.makeApi();
  }

  // ---------- connection ----------
  /** Attach a transport: WebSocket (dedicated server), in-page (P2P host) or WebRTC (P2P guest). */
  useLink(link, mode) {
    this.mode = mode;
    this.link = link;
    link.onmessage = (data) => {
      try {
        this.onMessage(JSON.parse(data));
      } catch (err) {
        console.error(err);
      }
    };
    link.onclose = () => {
      const was = this.link;
      this.link = null;
      if (was && !this.closing) this.h.onClosed?.(this);
    };
  }

  async connect(url) {
    this.useLink(await wsLink(url), 'server');
  }

  get connected() {
    return !!this.link;
  }

  send(m) {
    this.link?.send(JSON.stringify(m));
  }

  list() {
    return new Promise((resolve) => {
      this.listWaiters.push(resolve);
      this.send({ t: 'list' });
      setTimeout(() => resolve([]), 4000);
    });
  }

  host(settings, pub) {
    this.send({ t: 'host', name: this.prefs.name, color: this.prefs.color, settings, pub });
  }

  join(code) {
    this.send({ t: 'join', code, name: this.prefs.name, color: this.prefs.color });
  }

  leave() {
    this.closing = true;
    this.send({ t: 'leave' });
    this.link?.close();
  }

  get isHost() {
    return !!this.room && this.room.host === this.you;
  }

  get code() {
    return this.room?.code || null;
  }

  // ---------- lobby ----------
  setMe(me) {
    this.send({ t: 'me', ...me });
  }

  setSettings(settings, pub) {
    this.send({ t: 'settings', settings, pub });
  }

  start() {
    this.send({ t: 'start' });
  }

  kick(id) {
    this.send({ t: 'kick', id });
  }

  roomPlayers() {
    return (this.room?.players || []).map((p) => ({ id: p.id, name: p.name, color: p.color, you: p.id === this.you }));
  }

  syncLobby() {
    const ps = this.room.players;
    const sig = ps.map((p) => `${p.id}:${p.name}:${p.color}`).join('|');
    if (this.lobbyGame && sig === this.lobbySig) {
      this.lobbyGame.settings = { ...this.lobbyGame.settings, ...this.room.settings };
      return;
    }
    const old = this.lobbyGame;
    const roster = ps.map((p) => ({ name: p.name, color: p.color, remote: p.id !== this.you }));
    const g = new Game({
      mapId: 'dropship',
      phase: 'lobby',
      replica: true,
      roster,
      settings: this.room.settings,
      localId: ps.findIndex((p) => p.id === this.you),
    });
    g.players.forEach((p, i) => {
      p.netId = ps[i].id;
      const prev = old?.players.find((q) => q.netId === p.netId);
      p.x = prev ? prev.x : ps[i].x;
      p.y = prev ? prev.y : ps[i].y;
      p.facing = prev ? prev.facing : 1;
      p.buf = [];
    });
    this.lobbyGame = g;
    this.lobbySig = sig;
    this.h.onLobby?.(g);
  }

  tickLobby(dt, [mx, my]) {
    const g = this.lobbyGame;
    if (!g) return;
    const me = g.local;
    if (me) g.setInput(me.id, mx, my);
    g.tick(dt);
    const rt = now() - INTERP_DELAY;
    for (const p of g.players) {
      if (p === me) continue;
      interpolate(p, rt);
      if (p.moving) p.walk += dt;
    }
    if (me && now() >= this.sendAt) {
      this.sendAt = now() + 1 / 10;
      this.send({
        t: 'lp',
        x: Math.round(me.x * 100) / 100,
        y: Math.round(me.y * 100) / 100,
        f: me.facing,
        m: me.moving ? 1 : 0,
        l: packLook(me.look),
      });
    }
  }

  // ---------- messages ----------
  onMessage(m) {
    switch (m.t) {
      case 'joined':
        this.you = m.you;
        break;
      case 'room': {
        const first = !this.room;
        const before = this.room?.players.length || 0;
        this.room = m;
        this.syncLobby();
        this.h.onRoom?.(m, { first, joined: m.players.length > before && !first, left: m.players.length < before });
        break;
      }
      case 'ls': {
        const g = this.lobbyGame;
        if (!g) break;
        const t = now();
        for (const [id, x, y, f, mv, look] of m.ps) {
          const p = g.players.find((q) => q.netId === id);
          if (!p || p === g.local) continue;
          p.facing = f;
          p.moving = !!mv;
          p.look = unpackLook(look);
          p.buf.push([t, x, y]);
          if (p.buf.length > 8) p.buf.shift();
        }
        break;
      }
      case 'countdown':
        this.countdown = m.n;
        this.h.onCountdown?.(m.n);
        break;
      case 'start':
        this.startGame(m);
        break;
      case 's':
        this.applySnap(m);
        break;
      case 'e':
        this.applyEvent(m.ev, m.d);
        break;
      case 'tp':
        if (this.game?.local) {
          this.game.local.x = m.x;
          this.game.local.y = m.y;
        }
        break;
      case 'tasks':
        if (this.game?.local) this.game.local.tasks = m.tasks;
        break;
      case 'list':
        this.listWaiters.splice(0).forEach((f) => f(m.rooms));
        break;
      case 'err':
        this.h.onError?.(m.msg);
        break;
      case 'kicked':
        this.closing = true;
        this.h.onKicked?.();
        break;
    }
  }

  startGame(m) {
    this.countdown = 0;
    const roster = m.roster.map((r) => ({ name: r.name, color: r.color, isBot: r.bot, remote: true }));
    const g = new Game({ settings: m.settings, roster, localId: m.pid, replica: true });
    g.t = m.T;
    g.phaseEnd = m.phaseEnd;
    const me = g.local;
    me.remote = false;
    me.role = m.role;
    for (const id of m.mates) g.players[id].role = 'impostor';
    me.tasks = m.tasks;
    for (const p of g.players) p.buf = [];
    this.bar = m.settings.taskBarUpdates === 'never' ? null : 0;
    g.taskBar = () => this.bar;
    this.game = g;
    this.h.onStart?.(g);
  }

  applySnap(s) {
    const g = this.game;
    if (!g) return;
    if (Math.abs(g.t - s.T) > 0.5) g.t = s.T;
    else g.t += (s.T - g.t) * 0.2;
    if (g.phase === 'intro' && s.ph === 'play') g.phase = 'play';
    const t = now();
    const me = g.local;
    const seen = new Set();
    for (const [id, x, y, f, mv, al, look] of s.ps) {
      const p = g.players[id];
      seen.add(id);
      p.alive = !!al;
      p.facing = f;
      p.moving = !!mv;
      p.look = unpackLook(look);
      p.inVent = null;
      if (p.hiddenNet) {
        p.hiddenNet = false;
        p.buf = [];
        p.x = x;
        p.y = y;
      }
      p.buf.push([t, x, y]);
      if (p.buf.length > 8) p.buf.shift();
    }
    for (const p of g.players) {
      if (p === me || seen.has(p.id)) continue;
      // Out of sight: park far away so nothing draws or targets a stale position.
      p.hiddenNet = true;
      p.buf = [];
      p.x = -1000;
      p.y = -1000;
    }
    me.killCooldown = s.kc;
    me.emergencyLeft = s.el;
    me.inVent = s.v;
    me.alive = !!s.al;
    g.bodies = s.b.map(([id, x, y]) => ({ id, x, y, color: g.players[id].color, shadow: g.players[id].shadow, t: g.t }));
    g.sab.active = toSab(s.sab);
    if (s.sr != null) g.sab.readyAt = s.sr;
    if (s.dc) g.sab.doors = Object.fromEntries(Object.entries(s.dc).map(([k, [closedUntil, readyAt]]) => [k, { closedUntil, readyAt }]));
    const closed = new Set(s.dr);
    for (const d of g.map.doors) g.world.setDoor(d.id, closed.has(d.id));
    g.lights = s.L;
    g.buttonReadyAt = s.btn;
    this.bar = s.bar;
    g.visualFx = new Map(s.fx.map(([id, kind]) => [id, { kind, t: g.t }]));
    g.camsNet = !!s.cam;
    g.adminNet = s.ad || null;
  }

  applyEvent(ev, d) {
    const g = this.game;
    if (!g) return;
    const P = (id) => g.players[id];
    const me = g.local;
    switch (ev) {
      case 'start':
        g.phase = 'play';
        g.emit('start');
        break;
      case 'kill': {
        const killer = P(d.killer);
        const victim = P(d.victim);
        victim.alive = false;
        victim.deathT = g.t;
        const body = { id: d.body.id, x: d.body.x, y: d.body.y, color: victim.color, shadow: victim.shadow, t: g.t };
        if (!g.bodies.some((b) => b.id === body.id)) g.bodies.push(body);
        g.emit('kill', { killer, victim, body, from: d.from });
        break;
      }
      case 'vent': {
        const p = P(d.player);
        p.inVent = d.enter ? d.vent : null;
        g.ventUsed[d.vent] = g.t;
        if (p === me && d.enter) {
          const v = g.map.vents[d.vent];
          me.x = v.x;
          me.y = v.y;
        }
        g.emit('vent', { player: p, vent: d.vent, enter: d.enter });
        break;
      }
      case 'ventMove': {
        const v = g.map.vents[d.vent];
        me.inVent = d.vent;
        me.x = v.x;
        me.y = v.y;
        g.emit('ventMove', { player: me, vent: d.vent });
        break;
      }
      case 'sabotage':
        g.sab.active = toSab(d.sab);
        g.emit('sabotage', { type: d.kind });
        break;
      case 'sabotageFixed':
        g.sab.active = null;
        g.emit('sabotageFixed', { type: d.kind });
        break;
      case 'fixPart':
        if (g.sab.active?.done) g.sab.active.done[d.station] = true;
        g.emit('fixPart', { station: d.station });
        break;
      case 'doors':
        for (const door of g.map.doors) if (door.room === d.room) g.world.setDoor(door.id, d.closed);
        g.emit('doors', { room: d.room, closed: d.closed });
        break;
      case 'meeting': {
        g.phase = 'meeting';
        for (const id of d.dead) P(id).alive = false;
        for (const p of g.players) {
          p.vote = null;
          p.inVent = null;
          p.moving = false;
        }
        g.bodies = [];
        g.visualFx.clear();
        if (g.sab.active && (g.sab.active.type === 'reactor' || g.sab.active.type === 'o2')) g.sab.active = null;
        g.meeting = {
          reason: d.reason,
          callerId: d.caller,
          bodyId: d.body,
          bodyRoom: d.bodyRoom,
          stage: 'splash',
          stageEnd: d.stageEnd,
          chat: [],
          result: null,
        };
        g.emit('meeting', { meeting: g.meeting, caller: P(d.caller), body: d.body != null ? { id: d.body } : null });
        break;
      }
      case 'meetingStage': {
        const m = g.meeting;
        if (!m) break;
        m.stage = d.stage;
        m.stageEnd = d.stageEnd;
        if (d.result) {
          m.result = { ejected: d.result.ejected, why: d.result.why };
          for (const p of g.players) p.vote = null;
          for (const [voter, target] of d.result.votes) P(voter).vote = target;
        }
        g.emit('meetingStage', { meeting: m, stage: d.stage });
        break;
      }
      case 'vote': {
        const p = P(d.player);
        if (p.vote == null) p.vote = 'hidden';
        g.emit('vote', { player: p });
        break;
      }
      case 'chat': {
        const msg = { t: g.t, from: d.from, text: d.text, dead: d.dead };
        g.meeting?.chat.push(msg);
        g.emit('chat', msg);
        break;
      }
      case 'eject': {
        const p = d.player != null ? P(d.player) : null;
        if (p) {
          p.alive = false;
          p.ejected = true;
        }
        g.ejection = { player: p, line1: d.line1, line2: d.line2, end: d.end };
        g.phase = 'eject';
        g.emit('eject', g.ejection);
        break;
      }
      case 'resume':
        for (const [id, x, y, f] of d.pos) {
          const p = P(id);
          p.x = x;
          p.y = y;
          p.facing = f;
          p.buf = [];
          p.inVent = null;
          p.vote = null;
        }
        g.meeting = null;
        g.ejection = null;
        g.buttonReadyAt = d.btn;
        me.killCooldown = g.settings.killCooldown;
        g.phase = 'play';
        g.emit('resume');
        break;
      case 'gameOver':
        d.roles.forEach((r, i) => (g.players[i].role = r));
        d.alive.forEach((a, i) => (g.players[i].alive = !!a));
        g.phase = 'over';
        g.result = { winner: d.winner, reason: d.reason };
        g.emit('gameOver', g.result);
        break;
    }
  }

  tickGame(dt, [mx, my], canMove) {
    const g = this.game;
    if (!g) return;
    const me = g.local;
    g.t += dt;
    me.killCooldown = Math.max(0, me.killCooldown - dt);
    if (g.phase === 'play' && !me.inVent) {
      me.input.x = canMove ? mx : 0;
      me.input.y = canMove ? my : 0;
      g.stepPlayer(me, dt);
    } else {
      me.moving = false;
    }
    const rt = now() - INTERP_DELAY;
    for (const p of g.players) {
      if (p === me || p.hiddenNet) continue;
      interpolate(p, rt);
      if (p.moving) p.walk += dt;
    }
    if (g.phase === 'play' && !me.inVent && now() >= this.sendAt) {
      this.sendAt = now() + 1 / SEND_HZ;
      const look = packLook(me.look);
      const key = `${me.x.toFixed(2)},${me.y.toFixed(2)},${me.facing},${me.moving},${look}`;
      if (key !== this.lastSent) {
        this.lastSent = key;
        this.send({
          t: 'p',
          x: Math.round(me.x * 100) / 100,
          y: Math.round(me.y * 100) / 100,
          f: me.facing,
          m: me.moving ? 1 : 0,
          l: look,
        });
      }
    }
  }

  backToLobby() {
    this.game = null;
  }

  // ---------- actions (same signatures as Game) ----------
  makeApi() {
    const act = (a, extra = {}) => {
      this.send({ t: 'a', a, ...extra });
      return true;
    };
    return {
      kill: (id, target) => act('kill', { target }),
      report: () => act('report'),
      callEmergency: () => act('emergency'),
      enterVent: () => act('vent'),
      exitVent: () => act('unvent'),
      ventTo: (id, vent) => act('ventTo', { vent }),
      sabotage: (id, kind) => this.game.sabotageCooldown() <= 0 && act('sabotage', { kind }),
      closeDoors: (id, room) => this.game.doorCooldown(room) <= 0 && act('doors', { room }),
      completeStep: (id, task) => {
        // Optimistic, so the task list updates at once; the server's copy follows.
        const t = this.game.local.tasks[task];
        if (t && !t.done) {
          const step = t.steps[t.step];
          t.step++;
          if (step.waitAfter) t.readyAt = this.game.t + step.waitAfter;
          if (t.step >= t.steps.length) t.done = true;
        }
        return act('step', { task });
      },
      setVisual: (id, kind, on) => act('visual', { kind, on }),
      setWatching: (id, kind) => {
        this.game.local.watching = kind || null;
        return act('watch', { kind });
      },
      fixAction: (id, station, action) => {
        const s = this.game.sab.active;
        if (s?.type === 'lights' && action.type === 'toggle') s.switches[action.index] = !s.switches[action.index];
        return act('fix', { station, action });
      },
      vote: (id, target) => {
        const me = this.game.local;
        if (!this.game.canVote(me)) return false;
        me.vote = target;
        return act('vote', { target });
      },
      chat: (id, text) => act('chat', { text }),
    };
  }
}
