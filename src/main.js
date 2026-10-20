// Wires the simulation, bots, renderer, HUD, minigames and screens together.

import { Game } from './game.js';
import { Bots } from './bots.js';
import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { MinigameHost } from './tasks/host.js';
import { MeetingUI } from './meeting.js';
import { Screens } from './screens.js';
import { defaultSettings, COLORS } from './config.js';
import { sfx, setAlarm, unlock } from './audio.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'sus-station-prefs';

function loadPrefs() {
  const base = { name: '', color: 0, role: 'random', settings: defaultSettings() };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
  } catch {
    /* storage unavailable */
  }
  return base;
}

function savePrefs(p) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

const app = {
  prefs: loadPrefs(),
  game: null,
  bots: null,
  paused: false,
  speed: 1,
  offs: [],
};
window.__sus = app; // handy for debugging and automated play tests

const canvas = $('view');
const screens = new Screens($('screen'));
const host = new MinigameHost($('minigame'));
const input = new Input(canvas, $('joy'));
const meetingUI = new MeetingUI($('meeting'), {
  onVote: (target) => {
    if (app.game.vote(app.game.localId, target)) sfx('vote');
  },
  onChat: (text) => app.game.chat(app.game.localId, text),
});
let renderer = null;
let hud = null;

function menu() {
  teardown();
  $('app').classList.add('in-menu');
  screens.menu(app.prefs, start);
}

function teardown() {
  app.offs.forEach((f) => f());
  app.offs = [];
  app.bots?.destroy();
  app.bots = null;
  app.game = null;
  app.paused = false;
  host.close();
  meetingUI.close();
  hud?.closeMap();
  setAlarm(false);
}

function start() {
  teardown();
  const prefs = app.prefs;
  if (!prefs.name) prefs.name = COLORS[prefs.color][0];
  savePrefs(prefs);
  const game = new Game({
    settings: prefs.settings,
    seed: (Math.random() * 2 ** 32) >>> 0,
    local: { name: prefs.name, color: prefs.color, role: prefs.role },
  });
  app.game = game;
  app.bots = new Bots(game);
  if (!renderer) renderer = new Renderer(canvas, game);
  else renderer.setGame(game);
  if (!hud) hud = new Hud($('hud'), game, renderer, hudHandlers);
  else hud.setGame(game, renderer);
  $('app').classList.remove('in-menu');
  wire(game);
  screens.intro(game, () => {});
}

function wire(game) {
  const me = game.local;
  const on = (type, fn) => app.offs.push(game.on(type, fn));
  let myRoom = null;

  on('kill', ({ killer, victim }) => {
    if (victim === me) {
      host.close();
      hud.closeMap();
      screens.killed(killer, victim, () => {});
    } else if (killer === me) {
      sfx('kill');
      renderer.shake = 0.25;
    } else if (game.sees(me, victim.x, victim.y - 0.4)) {
      sfx('kill');
    }
  });
  on('vent', ({ player, vent }) => {
    const v = game.map.vents[vent];
    if (player === me || game.sees(me, v.x, v.y)) sfx('vent');
  });
  on('ventMove', ({ player }) => player === me && sfx('vent'));
  on('doors', ({ closed, room }) => {
    const r = game.map.rooms[game.map.roomIndex[room]];
    const [x0, y0, x1, y1] = r.rect;
    if (Math.hypot((x0 + x1) / 2 - me.x, (y0 + y1) / 2 - me.y) < 18) sfx('door');
    if (closed && me.role === 'impostor') hud.toast(`${r.name} doors locked`);
  });
  on('sabotage', ({ type }) => {
    sfx('sabotage');
    if (type === 'reactor' || type === 'o2') setAlarm(true);
    if (me.role === 'impostor') hud.closeMap();
  });
  on('sabotageFixed', ({ type }) => {
    if (type === 'reactor' || type === 'o2') setAlarm(false);
    const cur = host.current;
    if (cur && cur.opts.sabotage === type) setTimeout(() => host.current === cur && host.close(), 700);
  });
  on('meeting', (e) => {
    myRoom = game.roomName(me.x, me.y);
    host.close();
    hud.closeMap();
    setAlarm(false);
    screens.meetingSplash(game, e);
  });
  on('meetingStage', ({ stage }) => {
    if (stage === 'discussion') {
      screens.clear();
      meetingUI.open(game, myRoom);
    }
  });
  on('chat', (m) => meetingUI.addChat(m));
  on('vote', ({ player }) => player !== me && sfx('click'));
  on('eject', (ej) => {
    meetingUI.close();
    screens.ejection(game, ej);
  });
  on('resume', () => {
    screens.clear();
    renderer.setGame(game);
  });
  on('gameOver', (result) => {
    setAlarm(false);
    host.close();
    hud.closeMap();
    const delay = game.phase === 'over' && result.reason === 'kills' ? 1800 : 900;
    setTimeout(() => {
      if (app.game !== game) return;
      meetingUI.close();
      screens.gameOver(game, result, { onAgain: start, onMenu: menu });
    }, delay);
  });
}

const hudHandlers = {
  onAction: (name) => action(name),
  onVent: (ventId) => app.game?.ventTo(app.game.localId, ventId),
  onSabotage: (type) => {
    const g = app.game;
    if (g.sabotage(g.localId, type)) hud.closeMap();
    else if (g.sab.active) hud.toast('Another sabotage is already active');
    else hud.toast(`Sabotage ready in ${Math.ceil(g.sabotageCooldown())}s`);
  },
  onDoors: (room) => {
    const g = app.game;
    if (!g.closeDoors(g.localId, room)) hud.toast('Those doors are on cooldown');
  },
};

function openStep(g, me, use) {
  const task = me.tasks[use.taskIndex];
  const step = task.steps[task.step];
  const data = { ...(step.data || {}) };
  if (step.game === 'scan') data.player = { name: me.name, color: me.color, shadow: me.shadow, colorName: me.colorName };
  const title = step.game === 'data' && data.mode === 'download' ? 'Download Data' : task.name;
  host.open(step.game, {
    data,
    title,
    rng: g.rng,
    act: (a) => {
      if (a.type === 'visual') g.setVisual(me.id, task.id, a.on);
    },
    onComplete: () => {
      g.setVisual(me.id, null, false);
      g.completeStep(me.id, use.taskIndex);
    },
    onClose: () => g.setVisual(me.id, null, false),
  });
}

function openFix(g, me, use) {
  const s = g.sab.active;
  const station = use.station;
  const act = (a) => g.fixAction(me.id, station, a);
  const opts = { sabotage: s.type, doneText: 'Fixed!', act, rng: g.rng };
  if (s.type === 'lights') opts.state = () => ({ switches: g.sab.active?.switches || [true, true, true, true, true] });
  if (s.type === 'reactor') {
    opts.state = () => {
      const cur = g.sab.active;
      if (!cur || cur.type !== 'reactor') return { holders: 2, needed: 2, fixed: true };
      return { holders: Object.values(cur.holders).filter((v) => v != null).length, needed: 2, fixed: false };
    };
  }
  if (s.type === 'o2') opts.data = { code: s.code };
  if (s.type === 'comms') opts.data = { target: s.target };
  const id = { lights: 'lights', reactor: 'reactor', o2: 'o2', comms: 'comms' }[s.type];
  host.open(id, opts);
}

function action(name) {
  const g = app.game;
  if (!g || !g.local) return;
  const me = g.local;
  if (name === 'close') {
    if (host.isOpen) host.close();
    else if (hud.mapOpen) hud.closeMap();
    else if (g.phase === 'play') togglePause();
    return;
  }
  if (name === 'settings') return g.phase === 'play' && togglePause();
  if (app.paused || g.phase !== 'play' || host.isOpen) {
    if (name === 'map' && hud.mapOpen) hud.closeMap();
    return;
  }
  unlock();
  switch (name) {
    case 'use': {
      const use = g.usable(me);
      if (!use) return;
      if (use.kind === 'task') openStep(g, me, use);
      else if (use.kind === 'fix') openFix(g, me, use);
      else if (use.kind === 'admin') hud.openMap('admin');
      else if (use.kind === 'button') {
        const why = g.emergencyBlock(me);
        if (why) hud.toast(why);
        else g.callEmergency(me.id);
      }
      break;
    }
    case 'report':
      g.report(me.id);
      break;
    case 'kill': {
      const t = g.killTarget(me);
      if (t && me.killCooldown <= 0) g.kill(me.id, t.id);
      break;
    }
    case 'vent':
      if (me.inVent) g.exitVent(me.id);
      else g.enterVent(me.id);
      break;
    case 'sabotage':
      if (!g.canSabotage(me)) return;
      if (hud.mapOpen) hud.closeMap();
      else hud.openMap('sabotage');
      break;
    case 'map':
      if (hud.mapOpen) hud.closeMap();
      else hud.openMap('map');
      break;
  }
}

function togglePause() {
  if (app.paused) {
    app.paused = false;
    screens.clear();
    return;
  }
  app.paused = true;
  host.close();
  hud.closeMap();
  input.release();
  screens.pause({ onResume: () => togglePause(), onQuit: menu });
}

// ---------- frame loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const g = app.game;
  if (g && renderer) {
    const me = g.local;
    for (const a of input.drain()) action(a);
    if (!app.paused) {
      const steps = app.speed > 1 ? Math.round(app.speed) : 1;
      for (let i = 0; i < steps; i++) {
        const canMove = g.phase === 'play' && !host.isOpen && !hud.mapOpen && !me.inVent;
        const [mx, my] = canMove ? input.vector() : [0, 0];
        g.setInput(me.id, mx, my);
        app.bots.tick(dt);
        g.tick(dt);
      }
    }
    host.tick(dt, now / 1000);
    renderer.draw(dt, now / 1000);
    hud.update(now / 1000);
    meetingUI.update();
  }
}

window.addEventListener('resize', () => renderer?.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.game?.phase === 'play' && !app.paused) togglePause();
});

menu();
requestAnimationFrame(frame);
