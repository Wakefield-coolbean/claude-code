// Wires menus, lobby, game screens, input and audio to a session: LocalSession for
// freeplay against bots, NetSession for online games.

import { Renderer } from './render.js';
import { Hud } from './hud.js';
import { Input } from './input.js';
import { MinigameHost } from './tasks/host.js';
import { MeetingUI } from './meeting.js';
import { Screens } from './screens.js';
import { Menu } from './menu.js';
import { LobbyUI } from './lobby.js';
import { LocalSession } from './session.js';
import { NetSession, defaultServerUrl } from './net.js';
import { hostRoom, joinRoom } from './p2p.js';
import { defaultSettings, COLORS } from './config.js';
import { sfx, setAlarm, unlock, music, ambience, footstep } from './audio.js';

const $ = (id) => document.getElementById(id);
const PREFS_KEY = 'sus-station-prefs';

function loadPrefs() {
  // net: 'p2p' (players connect browser to browser) or 'server' (dedicated server at `server`).
  // signal: PeerJS signaling server for p2p ('' = the free public one).
  const base = { name: '', color: 0, role: 'random', pub: false, net: 'p2p', server: '', signal: '', settings: defaultSettings() };
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
    if (saved) return { ...base, ...saved, settings: { ...base.settings, ...saved.settings } };
  } catch {
    /* storage unavailable */
  }
  return base;
}

function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(app.prefs));
  } catch {
    /* storage unavailable */
  }
}

const app = {
  prefs: loadPrefs(),
  scene: 'menu', // menu | lobby | game
  session: null,
  game: null,
  paused: false,
  menuOpen: false,
  speed: 1,
  offs: [],
};
window.__sus = app; // handy for debugging and automated play tests

const canvas = $('view');
const screens = new Screens($('screen'));
const host = new MinigameHost($('minigame'));
const input = new Input(canvas, $('joy'));
const renderer = new Renderer(canvas, null);
let hud = null;

const serverUrl = () => app.prefs.server || defaultServerUrl();
const api = () => app.session?.api;

const meetingUI = new MeetingUI($('meeting'), {
  onVote: (target) => {
    if (api()?.vote(app.game.localId, target)) sfx('vote');
  },
  onChat: (text) => api()?.chat(app.game.localId, text),
});

const menu = new Menu(screens, {
  prefs: app.prefs,
  savePrefs,
  serverUrl,
  setServerUrl: (url) => {
    app.prefs.server = url === defaultServerUrl() ? '' : url;
    savePrefs();
  },
  setNet: (net, signal) => {
    app.prefs.net = net;
    app.prefs.signal = signal;
    savePrefs();
  },
  onFreeplay: () => {
    if (!app.prefs.name) app.prefs.name = COLORS[app.prefs.color][0];
    savePrefs();
    app.session = new LocalSession(app.prefs, sessionHandlers);
    enterLobby();
  },
  onHost: () => goOnline('host'),
  onJoin: (code) => goOnline('join', code),
  onFind: async () => {
    if (app.prefs.net === 'p2p')
      throw new Error('Public games are listed by a dedicated server. In peer-to-peer mode, share your code with friends.');
    const s = await connect();
    return s.list();
  },
});

const lobbyUI = new LobbyUI($('lobby'), {
  onStart: () => app.session?.start(),
  onLeave: () => quit(),
  onSettingsScreen: () => {
    app.menuOpen = true;
    menu.settings(() => {
      app.menuOpen = false;
      screens.clear();
    });
  },
  onCustomize: (change) => {
    if (change.role) {
      app.prefs.role = change.role;
      savePrefs();
      lobbyUI.renderCustomize();
      return;
    }
    if (change.name) app.prefs.name = change.name;
    if (change.color != null) app.prefs.color = change.color;
    savePrefs();
    app.session.setMe(change);
    if (!app.session.online) lobbyUI.refresh();
  },
  onSettings: (settings, pub) => {
    const s = app.session;
    if (!s.isHost) return;
    if (s.online) s.setSettings(settings || s.room.settings, pub ?? s.room.pub);
    else s.setSettings(settings);
    if (settings) {
      app.prefs.settings = { ...app.prefs.settings, ...settings };
      savePrefs();
    }
    if (pub != null) app.prefs.pub = pub;
    lobbyUI.refresh();
  },
  onKick: (id) => app.session?.kick?.(id),
});

// ---------- sessions ----------
let pending = null; // NetSession while connecting

async function connect() {
  if (app.session?.online && app.session.connected) return app.session;
  if (pending) return pending;
  const s = new NetSession(app.prefs, sessionHandlers);
  pending = s
    .connect(serverUrl())
    .then(() => s)
    .finally(() => (pending = null));
  const ok = await pending;
  app.session = ok;
  return ok;
}

let joining = false;

async function goOnline(kind, code) {
  if (joining) return;
  joining = true;
  const p = app.prefs;
  try {
    if (p.net === 'p2p') {
      app.session?.leave?.();
      const link =
        kind === 'host'
          ? await hostRoom({ name: p.name, color: p.color, settings: p.settings, signal: p.signal })
          : await joinRoom(code, { name: p.name, color: p.color, signal: p.signal });
      const s = new NetSession(p, sessionHandlers);
      app.session = s;
      s.useLink(link, 'p2p');
    } else {
      const s = await connect();
      if (kind === 'host') s.host(p.settings, p.pub);
      else s.join(code);
    }
  } catch (err) {
    menu.onlineMessage(err.message);
  } finally {
    joining = false;
  }
}

const sessionHandlers = {
  onSavePrefs: savePrefs,
  onLobby: (g) => {
    if (app.scene === 'lobby') renderer.setGame(g);
  },
  onRoom: (room, info) => {
    if (info.first) {
      app.prefs.name = room.players.find((p) => p.id === app.session.you)?.name || app.prefs.name;
      enterLobby();
      return;
    }
    if (info.joined) sfx('join');
    if (info.left) sfx('leave');
    lobbyUI.refresh();
  },
  onCountdown: (n) => app.scene === 'lobby' && lobbyUI.countdown(n),
  onStart: (game) => enterGame(game),
  onError: (msg) => {
    if (app.scene === 'lobby') lobbyUI.toast(msg);
    else menu.onlineMessage(msg);
  },
  onClosed: (s) => quit(s.mode === 'p2p' ? 'The host left, so the game ended.' : 'Lost connection to the server.'),
  onKicked: () => quit('The host removed you from the lobby.'),
};

// ---------- scenes ----------
function showMenu(message) {
  app.scene = 'menu';
  $('app').className = 'in-menu';
  lobbyUI.hide();
  meetingUI.close();
  host.close();
  hud?.closeMap();
  setAlarm(false);
  ambience(false);
  music('menu');
  menu.main(message);
}

function enterLobby() {
  teardownGame();
  app.scene = 'lobby';
  $('app').className = 'in-lobby';
  screens.clear();
  renderer.setGame(app.session.lobbyGame);
  lobbyUI.show(app.session);
  ambience(false);
  music('lobby');
}

function enterGame(game) {
  teardownGame();
  app.game = game;
  app.scene = 'game';
  $('app').className = 'in-game';
  lobbyUI.hide();
  screens.clear();
  renderer.setGame(game);
  if (!hud) hud = new Hud($('hud'), game, renderer, hudHandlers);
  else hud.setGame(game, renderer);
  wire(game);
  music(null);
  ambience(true);
  screens.intro(game, () => {});
}

function teardownGame() {
  app.offs.forEach((f) => f());
  app.offs = [];
  app.game = null;
  app.paused = false;
  app.menuOpen = false;
  host.close();
  meetingUI.close();
  hud?.closeMap();
  setAlarm(false);
}

function backToLobby() {
  teardownGame();
  app.session.backToLobby();
  enterLobby();
}

function quit(message) {
  teardownGame();
  const s = app.session;
  app.session = null;
  s?.leave();
  showMenu(message);
}

// ---------- game events ----------
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
    sfx('fixed');
    const cur = host.current;
    if (cur && cur.opts.sabotage === type) setTimeout(() => host.current === cur && host.close(), 700);
  });
  on('meeting', (e) => {
    myRoom = game.roomName(me.x, me.y);
    host.close();
    hud.closeMap();
    setAlarm(false);
    ambience(false);
    screens.meetingSplash(game, e);
  });
  on('meetingStage', ({ stage }) => {
    if (stage === 'discussion') {
      screens.clear();
      meetingUI.open(game, myRoom);
    }
  });
  on('chat', (m) => meetingUI.addChat(m));
  on('vote', ({ player }) => player !== me && sfx('vote'));
  on('eject', (ej) => {
    meetingUI.close();
    screens.ejection(game, ej);
  });
  on('resume', () => {
    screens.clear();
    renderer.setGame(game);
    ambience(true);
  });
  on('gameOver', (result) => {
    setAlarm(false);
    ambience(false);
    host.close();
    hud.closeMap();
    const delay = result.reason === 'kills' ? 1800 : 900;
    setTimeout(() => {
      if (app.game !== game) return;
      meetingUI.close();
      screens.gameOver(game, result, { onAgain: backToLobby, onMenu: () => quit() });
    }, delay);
  });
}

const hudHandlers = {
  onAction: (name) => action(name),
  onVent: (ventId) => app.game && api().ventTo(app.game.localId, ventId),
  onSabotage: (type) => {
    const g = app.game;
    if (api().sabotage(g.localId, type)) hud.closeMap();
    else if (g.sab.active) hud.toast('Another sabotage is already active');
    else hud.toast(`Sabotage ready in ${Math.ceil(g.sabotageCooldown())}s`);
  },
  onDoors: (room) => {
    const g = app.game;
    if (!api().closeDoors(g.localId, room)) hud.toast('Those doors are on cooldown');
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
      if (a.type === 'visual') api().setVisual(me.id, task.id, a.on);
    },
    onComplete: () => {
      api().setVisual(me.id, null, false);
      api().completeStep(me.id, use.taskIndex);
    },
    onClose: () => api().setVisual(me.id, null, false),
  });
}

function openFix(g, me, use) {
  const s = g.sab.active;
  const station = use.station;
  const act = (a) => api().fixAction(me.id, station, a);
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
  host.open(s.type, opts);
}

function lobbyAction(name) {
  if (name === 'use') lobbyUI.use();
  else if (name === 'close') {
    if (lobbyUI.panelOpen) lobbyUI.closePanels();
  }
}

function action(name) {
  if (app.scene === 'lobby') return lobbyAction(name);
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
  if (app.paused || app.menuOpen || g.phase !== 'play' || host.isOpen) {
    if (name === 'map' && hud.mapOpen) hud.closeMap();
    return;
  }
  unlock();
  const a = api();
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
        else a.callEmergency(me.id);
      }
      break;
    }
    case 'report':
      if (g.reportable(me)) a.report(me.id);
      break;
    case 'kill': {
      const t = g.killTarget(me);
      if (t && me.killCooldown <= 0) a.kill(me.id, t.id);
      break;
    }
    case 'vent':
      if (me.inVent) a.exitVent(me.id);
      else if (g.canVent(me)) a.enterVent(me.id);
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

/** Freeplay pauses the game; online games keep running behind the menu. */
function togglePause() {
  if (app.paused || app.menuOpen) {
    app.paused = false;
    app.menuOpen = false;
    screens.clear();
    return;
  }
  if (app.session?.online) app.menuOpen = true;
  else app.paused = true;
  host.close();
  hud.closeMap();
  input.release();
  screens.pause({
    onResume: () => togglePause(),
    onQuit: () => quit(),
    onLobby: app.session?.online ? null : () => backToLobby(),
  });
}

// ---------- frame loop ----------
let last = performance.now();
let lastStep = 0;

function footsteps(p) {
  if (!p || !p.alive || !p.moving) return;
  const step = Math.floor(p.walk * 4);
  if (step !== lastStep) {
    lastStep = step;
    footstep();
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const t = now / 1000;
  const s = app.session;
  if (app.scene === 'lobby' && s?.lobbyGame) {
    for (const a of input.drain()) action(a);
    const blocked = lobbyUI.panelOpen || app.menuOpen;
    s.tickLobby(dt, blocked ? [0, 0] : input.vector());
    footsteps(s.lobbyGame.local);
    renderer.draw(dt, t);
    lobbyUI.update();
    return;
  }
  const g = app.game;
  if (app.scene === 'game' && g) {
    const me = g.local;
    for (const a of input.drain()) action(a);
    if (!app.paused) {
      const canMove = g.phase === 'play' && !host.isOpen && !hud.mapOpen && !me.inVent && !app.menuOpen;
      s.tickGame(dt, canMove ? input.vector() : [0, 0], canMove, app.speed);
      footsteps(me);
    }
    host.tick(dt, t);
    renderer.draw(dt, t);
    hud.update(t);
    meetingUI.update();
  }
}

window.addEventListener('resize', () => renderer.resize());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.scene === 'game' && !app.session?.online && app.game?.phase === 'play' && !app.paused) togglePause();
});
window.addEventListener('pointerdown', () => unlock(), { once: true });
window.addEventListener('keydown', () => unlock(), { once: true });

showMenu();
requestAnimationFrame(frame);
