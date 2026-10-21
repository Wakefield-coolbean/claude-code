import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../src/room.js';
import { startServer } from '../server/server.mjs';
import { TIMING } from '../src/config.js';
import { HATS, SKINS } from '../src/cosmetics.js';

let nextId = 1;
function fakeClient(name, color = 0) {
  const c = { id: `t${nextId++}`, name, color, inbox: [] };
  c.send = (m) => c.inbox.push(m);
  c.sendRaw = (d) => c.inbox.push(JSON.parse(d));
  c.last = (t) => [...c.inbox].reverse().find((m) => m.t === t);
  c.events = (ev) => c.inbox.filter((m) => m.t === 'e' && m.ev === ev);
  return c;
}

const rooms = [];
function newRoom(settings = {}) {
  const host = fakeClient('Host', 2);
  const room = new Room('TEST', host, { settings: { players: 6, impostors: 1, ...settings } }, () => {});
  room.stop(); // tests drive ticks by hand
  rooms.push(room);
  return { room, host };
}
after(() => rooms.forEach((r) => r.stop()));

function startedRoom() {
  const { room, host } = newRoom();
  const guest = fakeClient('Guest', 2);
  room.add(guest);
  room.startGame();
  const g = room.game;
  g.tick(TIMING.shhh + TIMING.roleReveal + 0.1);
  return { room, host, guest, g };
}

test('lobby: colors stay unique, only the host changes settings or starts', () => {
  const { room, host } = newRoom();
  const guest = fakeClient('Guest', 2);
  room.add(guest);
  assert.notEqual(guest.color, host.color);
  room.onMessage(guest, { t: 'settings', settings: { players: 15 } });
  assert.equal(room.settings.players, 6);
  room.onMessage(host, { t: 'settings', settings: { players: 9, impostors: 7, killCooldown: 'x' } });
  assert.equal(room.settings.players, 9);
  assert.equal(room.settings.impostors, 3, 'clamped to the allowed range');
  assert.equal(room.settings.killCooldown, 30, 'bad values fall back to defaults');
  room.onMessage(guest, { t: 'start' });
  assert.equal(room.countdownAt, 0);
  room.onMessage(host, { t: 'start' });
  assert.ok(room.countdownAt > 0);
});

test('start: humans get seats first, bots fill the rest, each client learns only its role', () => {
  const { room, host, guest, g } = startedRoom();
  assert.equal(g.players.length, 6);
  assert.equal(host.pid, 0);
  assert.equal(guest.pid, 1);
  assert.ok(g.players.slice(2).every((p) => p.isBot));
  const start = guest.last('start');
  assert.equal(start.role, g.players[1].role);
  if (start.role === 'crew') assert.deepEqual(start.mates, []);
  assert.equal(room.phase, 'game');
});

test('snapshots only include players the viewer can see', () => {
  const { room, host, g } = startedRoom();
  const me = g.players[host.pid];
  me.x = 62.5;
  me.y = 18;
  const near = g.players[2];
  near.x = 64;
  near.y = 18;
  const far = g.players[3];
  far.x = 6;
  far.y = 38; // Reactor
  const snap = room.snapshot(host);
  const ids = snap.ps.map((p) => p[0]);
  assert.ok(ids.includes(near.id));
  assert.ok(!ids.includes(far.id));
});

test('positions are checked for speed and walls', () => {
  const { room, host, g } = startedRoom();
  const me = g.players[host.pid];
  me.x = 62.5;
  me.y = 18;
  host.posT = Date.now() / 1000 - 0.1;
  room.onMessage(host, { t: 'p', x: 62.8, y: 18, f: 1, m: 1 });
  assert.ok(Math.abs(me.x - 62.8) < 0.01, 'a normal step is accepted');
  room.onMessage(host, { t: 'p', x: 90, y: 18, f: 1, m: 1 });
  assert.equal(host.last('tp').x, me.x, 'a teleport is corrected');
  me.x = 70;
  me.y = 22.5;
  host.posT = Date.now() / 1000 - 0.3;
  room.onMessage(host, { t: 'p', x: 70, y: 23.6, f: 1, m: 1 });
  assert.ok(me.y < 23, 'walking through the cafeteria wall is refused');
});

test('kill news goes to the victim, the killer and witnesses, not to far crewmates', () => {
  const { room, host, guest, g } = startedRoom();
  for (const p of g.players) p.role = 'crew';
  const killer = g.players[host.pid];
  killer.role = 'impostor';
  killer.killCooldown = 0;
  killer.x = 40;
  killer.y = 46; // Electrical
  const victim = g.players[2];
  victim.x = 41;
  victim.y = 46;
  const far = g.players[guest.pid];
  far.x = 112;
  far.y = 38; // Bridge
  for (const p of g.players.slice(3)) {
    p.x = 112;
    p.y = 40;
  }
  room.onMessage(host, { t: 'a', a: 'kill', target: victim.id });
  assert.equal(victim.alive, false);
  assert.equal(host.events('kill').length, 1);
  assert.ok(host.last('tp'), 'killer is moved onto the victim');
  assert.equal(guest.events('kill').length, 0);
});

test('a player who leaves mid-game is replaced by a bot; the room returns to the lobby after game over', async () => {
  const { room, host, guest, g } = startedRoom();
  const seat = g.players[guest.pid];
  room.remove(guest);
  assert.equal(seat.isBot, true);
  assert.ok(room.bots.brains.has(seat.id));
  g.end('crew', 'tasks');
  assert.ok(host.events('gameOver').length);
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(room.phase, 'lobby');
  assert.equal(room.game, null);
});

test('end to end over a real WebSocket: host, list, join', async () => {
  const server = await startServer({ port: 0, quiet: true });
  const url = `ws://localhost:${server.port}/ws`;
  const open = () =>
    new Promise((resolve) => {
      const ws = new WebSocket(url);
      const c = { ws, msgs: [] };
      ws.onmessage = (e) => c.msgs.push(JSON.parse(e.data));
      ws.onopen = () => resolve(c);
    });
  const wait = (c, t) =>
    new Promise((resolve) => {
      const check = () => {
        const m = c.msgs.find((x) => x.t === t);
        if (m) resolve(m);
        else setTimeout(check, 20);
      };
      check();
    });
  const a = await open();
  const b = await open();
  a.ws.send(JSON.stringify({ t: 'host', name: 'Ann', color: 1, settings: {}, pub: true }));
  const { code } = await wait(a, 'joined');
  b.ws.send(JSON.stringify({ t: 'list' }));
  const list = await wait(b, 'list');
  assert.ok(list.rooms.some((r) => r.code === code));
  b.ws.send(JSON.stringify({ t: 'join', code, name: 'Bob', color: 1 }));
  await wait(b, 'joined');
  const room = await wait(b, 'room');
  assert.equal(room.players.filter((p) => !p.bot).length, 2);
  a.ws.close();
  b.ws.close();
  await new Promise((r) => setTimeout(r, 100));
  server.close();
});

test('watching cams adds what the feeds show to the snapshot, and everyone sees the red lights', () => {
  const { room, host, guest, g } = startedRoom();
  const me = g.players[host.pid];
  const st = g.map.stations.cams_se;
  me.x = st.x;
  me.y = st.y;
  const other = g.players[guest.pid];
  other.x = 6;
  other.y = 38;
  const onCam = g.players[2];
  onCam.x = 98;
  onCam.y = 38; // Bridge Hall
  assert.ok(!room.snapshot(host).ps.some((p) => p[0] === onCam.id));
  assert.equal(room.snapshot(guest).cam, 0);
  room.onMessage(host, { t: 'a', a: 'watch', kind: 'cams' });
  assert.ok(
    room.snapshot(host).ps.some((p) => p[0] === onCam.id),
    'seen on the Bridge Hall feed',
  );
  assert.equal(room.snapshot(guest).cam, 1);
  room.onMessage(host, { t: 'a', a: 'watch', kind: null });
  assert.ok(!room.snapshot(host).ps.some((p) => p[0] === onCam.id));
});

test('outfits are cleaned, shared in the lobby and carried into the game', () => {
  const { room, host } = newRoom();
  const hat = HATS.at(-1).id;
  const skin = SKINS.at(-1).id;
  const guest = fakeClient('Guest', 3);
  guest.outfit = { hat, pet: 'not-a-pet' };
  room.add(guest);
  assert.deepEqual(guest.outfit, { hat, visor: 'none', skin: 'none', pet: 'none' });
  room.onMessage(host, { t: 'me', outfit: { skin } });
  assert.equal(host.last('room').players.find((p) => p.id === host.id).outfit.skin, skin);
  room.startGame();
  const start = guest.last('start');
  assert.equal(start.roster[guest.pid].outfit.hat, hat);
  assert.equal(room.game.players[host.pid].outfit.skin, skin);
  assert.ok(room.game.players.every((p) => p.outfit && typeof p.outfit.hat === 'string'));
});

test('fill with bots: bots hold the empty lobby seats, give way to joiners, and play the game', () => {
  const { room, host } = newRoom({ players: 6, fillBots: true });
  assert.equal(room.lobbyBots.length, 5);
  const botColor = room.lobbyBots[0].color;
  const guest = fakeClient('Guest', botColor);
  room.add(guest);
  assert.equal(room.lobbyBots.length, 4, 'a joiner takes a seat');
  assert.equal(guest.color, botColor, 'players get their color; bots give way');
  assert.equal(new Set(room.lobbyBots.map((b) => b.color)).size, 4, 'bot colors stay unique');
  assert.ok(room.lobbyBots.every((b) => b.color !== guest.color && b.color !== host.color));
  const ps = host.last('room').players;
  assert.equal(ps.filter((p) => p.bot).length, 4);
  const names = room.lobbyBots.map((b) => b.name);
  room.startGame();
  assert.equal(room.game.players.length, 6);
  assert.deepEqual(
    room.game.players.slice(2).map((p) => p.name),
    names,
  );
  assert.ok(room.game.players.slice(2).every((p) => p.isBot));

  const off = newRoom({ players: 6, fillBots: false }).room;
  assert.equal(off.lobbyBots.length, 0);
  off.onMessage(off.host, { t: 'settings', settings: { players: 4, fillBots: true } });
  assert.equal(off.lobbyBots.length, 3, 'four players at least');
});
