// Freeplay: you plus bots, entirely in the browser. Same interface as NetSession so the
// menu, lobby and game screens don't care which one they talk to.

import { Game, buildRoster } from './game.js';
import { Bots } from './bots.js';
import { COLORS } from './config.js';

const COUNTDOWN = 3;

export class LocalSession {
  constructor(prefs, handlers) {
    this.online = false;
    this.isHost = true;
    this.code = null;
    this.prefs = prefs;
    this.h = handlers;
    this.game = null;
    this.bots = null;
    this.countdown = 0;
    this.buildLobby();
  }

  get api() {
    return this.game;
  }

  // ---------- lobby ----------
  buildLobby() {
    const { prefs } = this;
    const old = this.lobbyGame;
    const roster = buildRoster([{ name: prefs.name, color: prefs.color, outfit: prefs.outfit }], prefs.settings.players, Math.random);
    // Keep the bots that were already standing around.
    if (old) {
      old.players.slice(1).forEach((p, i) => {
        if (roster[i + 1] && !roster.slice(0, i + 1).some((r) => r.color === p.colorIndex)) {
          roster[i + 1] = { name: p.name, color: p.colorIndex, outfit: p.outfit, isBot: true };
        }
      });
    }
    const g = new Game({ mapId: 'dropship', phase: 'lobby', replica: true, roster, settings: prefs.settings, localId: 0 });
    g.players.forEach((p, i) => {
      const prev = old?.players[i];
      if (prev && prev.colorIndex === p.colorIndex) {
        p.x = prev.x;
        p.y = prev.y;
        p.facing = prev.facing;
      }
      p.wander = { until: 0, tx: p.x, ty: p.y };
    });
    this.lobbyGame = g;
    this.h.onLobby?.(g);
  }

  roomPlayers() {
    return this.lobbyGame.players.map((p, i) => ({ id: i, name: p.name, color: p.colorIndex, outfit: p.outfit, you: i === 0, bot: i > 0 }));
  }

  setMe({ name, color, outfit }) {
    if (name != null) this.prefs.name = name;
    if (color != null) this.prefs.color = color;
    if (outfit != null) this.prefs.outfit = outfit;
    this.h.onSavePrefs?.();
    this.buildLobby();
  }

  setSettings(settings) {
    this.prefs.settings = settings;
    this.h.onSavePrefs?.();
    this.buildLobby();
  }

  tickLobby(dt, [mx, my]) {
    const g = this.lobbyGame;
    g.setInput(0, mx, my);
    // Bots mill about the cabin.
    const [x0, y0, x1, y1] = g.map.rooms[0].rect;
    for (const p of g.players.slice(1)) {
      const w = p.wander;
      const d = Math.hypot(w.tx - p.x, w.ty - p.y);
      if (g.t > w.until) {
        w.until = g.t + 2 + Math.random() * 5;
        w.tx = x0 + 1.5 + Math.random() * (x1 - x0 - 3);
        w.ty = y0 + 2 + Math.random() * (y1 - y0 - 3.5);
      }
      if (d > 0.4 && Math.random() < 0.995) g.setInput(p.id, ((w.tx - p.x) / d) * 0.6, ((w.ty - p.y) / d) * 0.6);
      else g.setInput(p.id, 0, 0);
    }
    g.tick(dt);
    if (this.countdown > 0) {
      const left = Math.ceil(this.countdownAt - performance.now() / 1000);
      if (left !== this.countdown) {
        this.countdown = Math.max(0, left);
        if (left > 0) this.h.onCountdown?.(left);
        else this.startGame();
      }
    }
  }

  start() {
    if (this.countdown > 0) return;
    this.countdownAt = performance.now() / 1000 + COUNTDOWN;
    this.countdown = COUNTDOWN;
    this.h.onCountdown?.(COUNTDOWN);
  }

  startGame() {
    this.countdown = 0;
    const { prefs } = this;
    const roster = this.lobbyGame.players.map((p, i) =>
      i === 0
        ? { name: prefs.name || COLORS[prefs.color][0], color: prefs.color, outfit: prefs.outfit, role: prefs.role }
        : { name: p.name, color: p.colorIndex, outfit: p.outfit, isBot: true },
    );
    const game = new Game({ settings: prefs.settings, seed: (Math.random() * 2 ** 32) >>> 0, roster, localId: 0 });
    this.game = game;
    this.bots = new Bots(game);
    this.h.onStart?.(game);
  }

  // ---------- game ----------
  tickGame(dt, [mx, my], canMove, speed = 1) {
    const g = this.game;
    if (!g) return;
    const me = g.local;
    const steps = speed > 1 ? Math.round(speed) : 1;
    for (let i = 0; i < steps; i++) {
      g.setInput(me.id, canMove ? mx : 0, canMove ? my : 0);
      this.bots.tick(dt);
      g.tick(dt);
    }
  }

  backToLobby() {
    this.bots?.destroy();
    this.bots = null;
    this.game = null;
    this.buildLobby();
  }

  leave() {
    this.bots?.destroy();
    this.game = null;
  }
}
