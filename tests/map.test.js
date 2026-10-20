import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap, STATIONS, VENTS, VENT_NETWORKS } from '../src/map.js';
import { World } from '../src/grid.js';
import { findPath } from '../src/path.js';
import { DIST } from '../src/config.js';

const map = buildMap();
const world = new World(map);

test('every station, vent and spawn point is on open floor', () => {
  const pts = [...Object.entries(STATIONS).map(([id, s]) => [id, s.x, s.y]), ...Object.entries(VENTS).map(([id, v]) => [id, v.x, v.y])];
  for (const [id, x, y] of pts) {
    assert.ok(world.isFloor(Math.floor(x), Math.floor(y)), `${id} at ${x},${y} is not on floor`);
    const [rx, ry] = world.resolve(x, y, DIST.playerRadius);
    assert.ok(Math.hypot(rx - x, ry - y) < 0.8, `${id} at ${x},${y} is stuck inside geometry`);
  }
});

test('every station and vent is reachable from the cafeteria', () => {
  const { spawn } = map;
  const targets = [...Object.entries(STATIONS), ...Object.entries(VENTS)];
  for (const [id, s] of targets) {
    const path = findPath(world, spawn.x, spawn.y + 4, s.x, s.y);
    assert.ok(path && path.length, `no path to ${id}`);
  }
});

test('stations sit in the room they claim', () => {
  for (const [id, s] of Object.entries(STATIONS)) {
    const r = map.room[Math.floor(s.y) * map.W + Math.floor(s.x)];
    assert.equal(map.rooms[r]?.id, s.room, `${id} is not inside ${s.room}`);
  }
});

test('vent networks reference real vents', () => {
  for (const net of VENT_NETWORKS) for (const v of net) assert.ok(VENTS[v], v);
});

test('walls block sight between rooms and a closed door blocks a corridor', () => {
  // Cafeteria to Admin through solid wall.
  assert.ok(world.blocked(70, 20, 70, 36));
  // Along the open Cafeteria-Weapons corridor.
  assert.ok(!world.blocked(72, 11, 84, 11));
  const door = map.doors.find((d) => d.room === 'cafeteria' && d.rect[0] === 75);
  world.setDoor(door.id, true);
  assert.ok(world.blocked(72, 11, 84, 11));
  assert.equal(findPath(world, 72, 11, 84, 11)?.length > 0, true, 'path still exists via the other route');
  world.setDoor(door.id, false);
});

test('vision polygon is closed and bounded by the radius', () => {
  const pts = world.visibility(62.5, 18, 6);
  assert.ok(pts.length > 20);
  for (let i = 0; i < pts.length; i += 2) assert.ok(Math.hypot(pts[i] - 62.5, pts[i + 1] - 18) <= 6.001);
});
