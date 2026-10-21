import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, maxImpostors } from '../src/game.js';
import { defaultSettings, TIMING } from '../src/config.js';

function newGame(over = {}) {
  const g = new Game({
    settings: { ...defaultSettings(), players: 6, impostors: 1, ...over },
    seed: 7,
    local: { name: 'Me', color: 0, role: 'crew' },
  });
  g.tick(TIMING.shhh + TIMING.roleReveal + 0.1); // past the intro
  return g;
}

const imp = (g) => g.players.find((p) => p.role === 'impostor');
const crew = (g) => g.players.filter((p) => p.role === 'crew');

function run(g, seconds, dt = 1 / 30) {
  for (let t = 0; t < seconds && g.phase !== 'over'; t += dt) g.tick(dt);
}

function meetingToVoting(g) {
  run(g, TIMING.meetingSplash + g.settings.discussionTime + 0.2);
  assert.equal(g.meeting.stage, 'voting');
}

test('impostor count is capped by player count like the original', () => {
  assert.equal(maxImpostors(6), 1);
  assert.equal(maxImpostors(8), 2);
  assert.equal(maxImpostors(10), 3);
  const g = new Game({ settings: { ...defaultSettings(), players: 5, impostors: 3 }, seed: 1, local: null });
  assert.equal(g.players.filter((p) => p.role === 'impostor').length, 1);
});

test('a forced role is respected and impostors only get fake tasks', () => {
  const g = new Game({
    settings: { ...defaultSettings(), players: 8, impostors: 2 },
    seed: 3,
    local: { name: 'Me', color: 4, role: 'impostor' },
  });
  assert.equal(g.local.role, 'impostor');
  assert.ok(g.local.tasks.every((t) => t.fake));
  assert.ok(crew(g).every((p) => p.tasks.length === 4 && p.tasks.every((t) => !t.fake)));
});

test('kills need the impostor role, range, line of sight and a ready cooldown', () => {
  const g = newGame();
  const k = imp(g);
  const [v, other] = crew(g);
  k.x = 62.5;
  k.y = 18;
  v.x = 63.5;
  v.y = 18;
  assert.equal(g.kill(k.id, v.id), false, 'first cooldown is still running');
  k.killCooldown = 0;
  assert.equal(g.kill(other.id, k.id), false, 'crew cannot kill');
  v.x = 70;
  assert.equal(g.kill(k.id, v.id), false, 'out of range');
  v.x = 63.5;
  assert.equal(g.kill(k.id, v.id), true);
  assert.equal(v.alive, false);
  assert.equal(g.bodies.length, 1);
  assert.equal(k.x, v.x, 'killer lands on the victim');
  assert.equal(k.killCooldown, g.settings.killCooldown);
});

test('ties and skip majorities eject no one; a plurality ejects', () => {
  const g = newGame({ players: 6 });
  const ids = g.players.map((p) => p.id);
  const vote = (votes) => {
    g.players.forEach((p, i) => (p.vote = votes[i]));
    return g.tallyVotes();
  };
  assert.equal(vote([1, 1, 1, 2, 2, 'skip']).ejected, 1);
  assert.deepEqual([vote([1, 1, 2, 2, 'skip', null]).ejected, vote([1, 1, 2, 2, 'skip', null]).why], [null, 'tie']);
  assert.deepEqual([vote(['skip', 'skip', 'skip', 1, 1, 2]).ejected, vote(['skip', 'skip', 'skip', 1, 1, 2]).why], [null, 'skipped']);
  assert.equal(vote([1, 1, 'skip', 'skip', 2, null]).ejected, null, 'skip tied with the top player');
  assert.equal(vote([null, null, null, null, null, null]).ejected, null);
  assert.ok(ids.length === 6);
});

test('emergency meeting, discussion, voting, ejection, then everyone respawns', () => {
  const g = newGame();
  const me = g.local;
  me.x = 62.5;
  me.y = 15.3;
  assert.match(g.emergencyBlock(me), /available in/);
  run(g, g.settings.emergencyCooldown + 0.1);
  assert.equal(g.callEmergency(me.id), true);
  assert.equal(g.phase, 'meeting');
  assert.equal(me.emergencyLeft, 0);
  meetingToVoting(g);
  const target = crew(g).find((p) => p !== me);
  for (const p of g.alive()) g.vote(p.id, target.id);
  assert.equal(g.meeting.stage, 'results', 'voting ends once everyone voted');
  run(g, TIMING.voteResults + 0.1);
  assert.equal(g.phase, 'eject');
  assert.equal(target.alive, false);
  assert.match(g.ejection.line1, /was not The Impostor/);
  run(g, TIMING.ejection + 0.1);
  assert.equal(g.phase, 'play');
  assert.ok(g.players.every((p) => Math.hypot(p.x - g.map.spawn.x, p.y - g.map.spawn.y) < 6));
});

test('ejecting the last impostor wins for the crew', () => {
  const g = newGame();
  g.startMeeting('emergency', g.local, null);
  meetingToVoting(g);
  for (const p of g.alive()) g.vote(p.id, imp(g).id);
  run(g, TIMING.voteResults + TIMING.ejection + 0.5);
  assert.equal(g.phase, 'over');
  assert.deepEqual(g.result, { winner: 'crew', reason: 'vote' });
});

test('impostors win when they equal the crew', () => {
  const g = newGame({ players: 4 });
  const k = imp(g);
  const victims = crew(g);
  for (const v of victims.slice(0, 2)) {
    k.killCooldown = 0;
    v.x = k.x + 1;
    v.y = k.y;
    assert.equal(g.kill(k.id, v.id), true);
  }
  assert.deepEqual(g.result, { winner: 'impostor', reason: 'kills' });
});

test('finishing every task wins for the crew, including dead crewmates tasks', () => {
  const g = newGame();
  const c = crew(g);
  c[0].alive = false;
  for (const p of c) {
    p.tasks.forEach((t, i) => {
      while (!t.done) {
        t.readyAt = 0;
        g.completeStep(p.id, i);
      }
    });
  }
  assert.deepEqual(g.result, { winner: 'crew', reason: 'tasks' });
});

test('reactor needs two different players holding at once; time out loses', () => {
  const g = newGame();
  run(g, TIMING.firstSabotageCooldown);
  const k = imp(g);
  const [a, b] = crew(g);
  assert.equal(g.sabotage(k.id, 'reactor'), true);
  assert.match(g.emergencyBlock(a), /CRISES/);
  g.fixAction(a.id, 'reactor_a', { type: 'hold', on: true });
  g.fixAction(a.id, 'reactor_b', { type: 'hold', on: true });
  run(g, 2);
  assert.ok(g.sab.active, 'one player on both pads does not count');
  g.fixAction(b.id, 'reactor_b', { type: 'hold', on: true });
  run(g, 1.2);
  assert.equal(g.sab.active, null);
  assert.equal(g.sabotageCooldown() > 25, true, 'cooldown after a fix');
  run(g, TIMING.sabotageCooldown);
  g.sabotage(k.id, 'reactor');
  run(g, TIMING.reactorMeltdown + 0.5);
  assert.deepEqual(g.result, { winner: 'impostor', reason: 'sabotage' });
});

test('O2 needs both keypads, lights needs every switch, meetings cancel critical sabotage', () => {
  const g = newGame();
  run(g, TIMING.firstSabotageCooldown);
  const k = imp(g);
  const c = crew(g)[0];
  g.sabotage(k.id, 'o2');
  g.fixAction(c.id, 'o2_o2', { type: 'o2' });
  assert.ok(g.sab.active);
  g.fixAction(c.id, 'o2_ad', { type: 'o2' });
  assert.equal(g.sab.active, null);

  g.sab.readyAt = 0;
  g.sabotage(k.id, 'lights');
  const sw = g.sab.active.switches;
  sw.forEach((on, i) => !on && g.fixAction(c.id, 'lights_el', { type: 'toggle', index: i }));
  assert.equal(g.sab.active, null);

  g.sab.readyAt = 0;
  g.sabotage(k.id, 'reactor');
  c.x = 62;
  c.y = 18;
  g.startMeeting('body', c, { id: 99, x: 62, y: 18 });
  assert.equal(g.sab.active, null, 'meeting resets reactor');
});

test('doors lock for 10 seconds, then reopen, and respect their cooldown', () => {
  const g = newGame();
  const k = imp(g);
  k.x = 100;
  k.y = 38;
  assert.equal(g.closeDoors(k.id, 'medbay'), true);
  const door = g.map.doors.find((d) => d.room === 'medbay');
  assert.equal(g.world.doorClosed[door.id], 1);
  assert.equal(g.closeDoors(k.id, 'medbay'), false);
  run(g, TIMING.doorsClosed + 0.1);
  assert.equal(g.world.doorClosed[door.id], 0);
  run(g, TIMING.doorCooldown);
  assert.equal(g.closeDoors(k.id, 'medbay'), true);
});

test('ghosts float through walls', () => {
  const g = newGame();
  const p = crew(g)[1];
  p.alive = false;
  p.x = 70;
  p.y = 20;
  g.setInput(p.id, 0, 1);
  run(g, 3);
  assert.ok(p.y > 30, 'ghost passed the cafeteria wall');
});

test('cameras: watch only at the Security desk, lights on while watched, comms cuts them, moving stops watching', () => {
  const g = newGame();
  const c = crew(g)[0];
  const st = g.map.stations.cams_se;
  c.x = 62.5;
  c.y = 18;
  assert.equal(g.setWatching(c.id, 'cams'), false, 'too far from the desk');
  c.x = st.x;
  c.y = st.y;
  assert.equal(g.usable(c).kind, 'cams');
  assert.equal(g.setWatching(c.id, 'cams'), true);
  assert.equal(g.camsInUse(), true);
  const hall = g.map.cameras.find((cam) => cam.id === 'adminHall');
  assert.equal(g.onCamera(61, 37), hall);
  assert.equal(g.onCamera(62.5, 12.5), null, 'the cafeteria has no camera');

  const k = imp(g);
  run(g, TIMING.firstSabotageCooldown);
  g.sabotage(k.id, 'comms');
  assert.equal(g.camsInUse(), false);
  assert.equal(g.onCamera(61, 37), null);
  g.sab.active = null;

  g.setInput(c.id, 1, 0);
  run(g, 0.2);
  assert.equal(c.watching, null, 'walking away stops watching');
  assert.equal(g.camsInUse(), false);
});
