// The Kestrel: the ship layout as plain data, plus a builder that turns it into grids.
// Coordinates are map cells; rects are [x0, y0, x1, y1) with x to the right and y down.
// Layout: two loops meet at the Cafeteria. West loop: engines, Reactor, Security,
// MedBay, Electrical. East loop: Weapons, O2, Bridge (the nose), Shields, Comms.

export const MAP_W = 122;
export const MAP_H = 80;

// theme: [floor, floor line, wall face, accent]
export const THEMES = {
  cafeteria: ['#a7b2bc', '#8e9aa5', '#68798a', '#d8e0e6'],
  medbay: ['#a9d8d2', '#88bdb6', '#4f8a8f', '#e8fffb'],
  engine: ['#8f969c', '#737b82', '#56616c', '#c9a64a'],
  reactor: ['#62759a', '#4f6083', '#3b4762', '#7fd3ff'],
  security: ['#7f8d9d', '#6a7888', '#4d5a69', '#9be37a'],
  electrical: ['#86877c', '#6e6f64', '#55564d', '#f2c230'],
  storage: ['#b09f80', '#94846a', '#776a55', '#d9c49a'],
  admin: ['#9db39a', '#83997f', '#5b7461', '#e3f2c8'],
  comms: ['#8e98ab', '#768095', '#545d70', '#7ad2ff'],
  shields: ['#93a5ba', '#7a8ca1', '#566a82', '#ffe36b'],
  o2: ['#93b48e', '#7a9b76', '#56755a', '#c8f2a8'],
  weapons: ['#8d95a8', '#757d91', '#535b70', '#ff8a5c'],
  bridge: ['#86a0bb', '#6d87a2', '#4d6580', '#c7ecff'],
  hall: ['#6f7b87', '#5d6873', '#4a5560', '#8c99a6'],
};

export const ROOMS = [
  { id: 'cafeteria', name: 'Cafeteria', theme: 'cafeteria', rect: [50, 3, 75, 23] },
  { id: 'medbay', name: 'MedBay', theme: 'medbay', rect: [28, 20, 42, 30] },
  { id: 'portEngine', name: 'Port Engine', theme: 'engine', rect: [6, 6, 22, 20] },
  { id: 'reactor', name: 'Reactor', theme: 'reactor', rect: [1, 30, 12, 47] },
  { id: 'security', name: 'Security', theme: 'security', rect: [22, 34, 30, 43] },
  { id: 'starboardEngine', name: 'Starboard Engine', theme: 'engine', rect: [6, 54, 22, 68] },
  { id: 'electrical', name: 'Electrical', theme: 'electrical', rect: [32, 41, 46, 51] },
  { id: 'storage', name: 'Storage', theme: 'storage', rect: [48, 50, 66, 70] },
  { id: 'admin', name: 'Admin', theme: 'admin', rect: [66, 32, 78, 42] },
  { id: 'comms', name: 'Comms', theme: 'comms', rect: [73, 69, 87, 77] },
  { id: 'shields', name: 'Shields', theme: 'shields', rect: [92, 54, 104, 66] },
  { id: 'o2', name: 'O2', theme: 'o2', rect: [81, 22, 90, 32] },
  { id: 'weapons', name: 'Weapons', theme: 'weapons', rect: [86, 3, 99, 17] },
  { id: 'bridge', name: 'Bridge', theme: 'bridge', rect: [106, 27, 119, 47] },
];

// Corridors (walkable, no room).
export const HALLS = [
  [22, 12, 50, 16], // Port Engine - Cafeteria
  [33, 16, 37, 20], // to MedBay
  [14, 20, 18, 54], // west spine: Port Engine - Starboard Engine
  [12, 36, 14, 40], // to Reactor
  [18, 36, 22, 40], // to Security
  [22, 58, 48, 62], // Starboard Engine - Storage
  [38, 51, 42, 58], // to Electrical
  [58, 23, 62, 50], // Cafeteria - Storage
  [62, 35, 66, 39], // to Admin
  [75, 9, 86, 13], // Cafeteria - Weapons
  [92, 17, 96, 40], // east spine: Weapons - Bridge
  [90, 25, 92, 29], // to O2
  [96, 36, 106, 40], // to Bridge
  [110, 47, 114, 61], // Bridge - Shields
  [104, 57, 110, 61],
  [66, 62, 92, 66], // Storage - Shields
  [78, 66, 82, 69], // to Comms
];

// Obstacles: block movement, not sight. circle: [x, y, r]; rect: [x0, y0, x1, y1]
export const PROPS = [
  { kind: 'table', circle: [62.5, 12.5, 2.2], button: true },
  { kind: 'table', circle: [55, 7.5, 1.5] },
  { kind: 'table', circle: [70, 7.5, 1.5] },
  { kind: 'table', circle: [55, 18.5, 1.5] },
  { kind: 'table', circle: [70, 18.5, 1.5] },
  { kind: 'bed', rect: [38, 21, 41, 23] },
  { kind: 'bed', rect: [38, 24.5, 41, 26.5] },
  { kind: 'engine', rect: [7, 9, 12.5, 17] },
  { kind: 'engine', rect: [7, 57, 12.5, 65] },
  { kind: 'core', circle: [6, 38.5, 2.6] },
  { kind: 'desk', rect: [24, 35, 29.5, 36.2] },
  { kind: 'crate', rect: [51, 53, 54, 55.5] },
  { kind: 'crate', rect: [59, 65, 62.5, 67.5] },
  { kind: 'crate', rect: [53, 61, 55.5, 63] },
  { kind: 'console', rect: [41, 45, 44, 46.6] },
  { kind: 'maptable', rect: [69, 35, 75, 38] },
  { kind: 'generator', circle: [98, 60, 1.6] },
  { kind: 'gunseat', circle: [93, 9.5, 1.5] },
  { kind: 'planter', rect: [82, 23, 85, 24.4] },
  { kind: 'planter', rect: [86.5, 30, 89.5, 31.4] },
  { kind: 'pilot', rect: [116, 33, 118, 41] },
];

// Task consoles. wall: drawn on the wall face above `y`. Use point is (x, y).
export const STATIONS = {
  wires_el: { room: 'electrical', x: 35.5, y: 41.6, wall: true, look: 'wires' },
  wires_st: { room: 'storage', x: 51, y: 50.6, wall: true, look: 'wires' },
  wires_ad: { room: 'admin', x: 68, y: 32.6, wall: true, look: 'wires' },
  wires_ca: { room: 'cafeteria', x: 53, y: 3.6, wall: true, look: 'wires' },
  wires_se: { room: 'security', x: 28.8, y: 34.6, wall: true, look: 'wires' },
  wires_br: { room: 'bridge', x: 108.5, y: 27.6, wall: true, look: 'wires' },
  swipe_ad: { room: 'admin', x: 72, y: 38.8, look: 'swipe' },
  fuel_st: { room: 'storage', x: 64.5, y: 57, look: 'fuel' },
  fuel_pe: { room: 'portEngine', x: 13.4, y: 13, look: 'none' },
  fuel_sb: { room: 'starboardEngine', x: 13.4, y: 61, look: 'none' },
  align_pe: { room: 'portEngine', x: 19, y: 6.6, wall: true, look: 'screen' },
  align_sb: { room: 'starboardEngine', x: 19, y: 54.6, wall: true, look: 'screen' },
  sample_mb: { room: 'medbay', x: 31, y: 20.6, wall: true, look: 'sample' },
  scan_mb: { room: 'medbay', x: 33.5, y: 27, look: 'scanner' },
  simon_re: { room: 'reactor', x: 8.5, y: 30.6, wall: true, look: 'screen' },
  manifolds_re: { room: 'reactor', x: 9.5, y: 45, look: 'console' },
  data_co: { room: 'comms', x: 76, y: 69.6, wall: true, look: 'screen' },
  data_we: { room: 'weapons', x: 89, y: 3.6, wall: true, look: 'screen' },
  data_br: { room: 'bridge', x: 112, y: 27.6, wall: true, look: 'screen' },
  data_el: { room: 'electrical', x: 44.5, y: 41.6, wall: true, look: 'screen' },
  data_ca: { room: 'cafeteria', x: 71.5, y: 3.6, wall: true, look: 'screen' },
  upload_ad: { room: 'admin', x: 75.5, y: 32.6, wall: true, look: 'screen' },
  asteroids_we: { room: 'weapons', x: 93, y: 11.6, look: 'none' },
  distributor_el: { room: 'electrical', x: 39.5, y: 41.6, wall: true, look: 'dial' },
  chart_br: { room: 'bridge', x: 115.2, y: 37, look: 'none' },
  steering_br: { room: 'bridge', x: 113, y: 44.5, look: 'console' },
  filter_o2: { room: 'o2', x: 83, y: 28, look: 'vent' },
  divert_el: { room: 'electrical', x: 33.6, y: 47, look: 'panel' },
  accept_we: { room: 'weapons', x: 97, y: 3.6, wall: true, look: 'switch' },
  accept_o2: { room: 'o2', x: 88.5, y: 22.6, wall: true, look: 'switch' },
  accept_br: { room: 'bridge', x: 117, y: 27.6, wall: true, look: 'switch' },
  accept_sh: { room: 'shields', x: 102, y: 54.6, wall: true, look: 'switch' },
  accept_co: { room: 'comms', x: 85.6, y: 69.6, wall: true, look: 'switch' },
  accept_se: { room: 'security', x: 23.5, y: 37.4, look: 'switch' },
  shields_sh: { room: 'shields', x: 98, y: 62.6, look: 'none' },
  garbage_ca: { room: 'cafeteria', x: 73, y: 21, look: 'chute' },
  garbage_st: { room: 'storage', x: 50.5, y: 68.4, look: 'chute' },
  // Sabotage fix points
  lights_el: { room: 'electrical', x: 44.8, y: 49.5, look: 'panel', sabotage: 'lights' },
  reactor_a: { room: 'reactor', x: 3, y: 30.6, wall: true, look: 'hand', sabotage: 'reactor' },
  reactor_b: { room: 'reactor', x: 3, y: 46.2, look: 'hand', sabotage: 'reactor' },
  o2_o2: { room: 'o2', x: 84.5, y: 22.6, wall: true, look: 'keypad', sabotage: 'o2' },
  o2_ad: { room: 'admin', x: 66.8, y: 40, look: 'keypad', sabotage: 'o2' },
  comms_co: { room: 'comms', x: 83, y: 73.5, look: 'dish', sabotage: 'comms' },
  // Room tools
  admin_map: { room: 'admin', x: 72, y: 34.4, look: 'none', tool: 'admin' },
};

// Vents: id -> position; networks list which vents connect.
export const VENTS = {
  v_pe: { x: 19.5, y: 17.5 },
  v_re: { x: 9.5, y: 33.5 },
  v_sb: { x: 19.5, y: 65.5 },
  v_mb: { x: 30, y: 28 },
  v_se: { x: 25.5, y: 41 },
  v_el: { x: 35.5, y: 49.5 },
  v_ca: { x: 73, y: 15 },
  v_ad: { x: 76, y: 40.5 },
  v_hall: { x: 102, y: 38 },
  v_we: { x: 97, y: 15 },
  v_brn: { x: 108, y: 30 },
  v_brs: { x: 108, y: 45 },
  v_sh: { x: 94, y: 64 },
};
export const VENT_NETWORKS = [
  ['v_pe', 'v_re', 'v_sb'],
  ['v_mb', 'v_se', 'v_el'],
  ['v_ca', 'v_ad', 'v_hall'],
  ['v_we', 'v_brn'],
  ['v_brs', 'v_sh'],
];

// Doors: a strip of corridor cells next to a room. vertical = strip runs top to bottom.
export const DOORS = [
  { room: 'cafeteria', rect: [49, 12, 50, 16] },
  { room: 'cafeteria', rect: [75, 9, 76, 13] },
  { room: 'cafeteria', rect: [58, 23, 62, 24] },
  { room: 'medbay', rect: [33, 19, 37, 20] },
  { room: 'portEngine', rect: [22, 12, 23, 16] },
  { room: 'portEngine', rect: [14, 20, 18, 21] },
  { room: 'starboardEngine', rect: [14, 53, 18, 54] },
  { room: 'starboardEngine', rect: [22, 58, 23, 62] },
  { room: 'security', rect: [21, 36, 22, 40] },
  { room: 'electrical', rect: [38, 51, 42, 52] },
  { room: 'storage', rect: [47, 58, 48, 62] },
  { room: 'storage', rect: [58, 49, 62, 50] },
  { room: 'storage', rect: [66, 62, 67, 66] },
];

export const EMERGENCY_BUTTON = { x: 62.5, y: 12.5, useRadius: 3.4 };
export const SPAWN = { x: 62.5, y: 12.5, radius: 4.2 };

/** Build the static grids used by collision, vision, pathfinding and rendering. */
export function buildMap() {
  const W = MAP_W;
  const H = MAP_H;
  const floor = new Uint8Array(W * H);
  const room = new Int8Array(W * H).fill(-1);
  const theme = new Array(W * H).fill(null);
  const fill = (r, f) => {
    for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) f(y * W + x);
  };
  HALLS.forEach((r) =>
    fill(r, (i) => {
      floor[i] = 1;
      theme[i] = 'hall';
    }),
  );
  ROOMS.forEach((rm, ri) =>
    fill(rm.rect, (i) => {
      floor[i] = 1;
      room[i] = ri;
      theme[i] = rm.theme;
    }),
  );

  // Wall faces: up to 2 void cells directly above a floor cell (3/4 view front walls).
  const face = new Uint8Array(W * H); // 0 none, 1 lower face row, 2 upper face row
  const faceTheme = new Array(W * H).fill(null);
  for (let x = 0; x < W; x++) {
    for (let y = 1; y < H; y++) {
      const i = y * W + x;
      if (!floor[i] || floor[i - W]) continue;
      for (let k = 1; k <= 2; k++) {
        const j = (y - k) * W + x;
        if (y - k < 0 || floor[j]) break;
        face[j] = k;
        faceTheme[j] = theme[i];
      }
    }
  }

  // Props mark blocked cells for pathfinding (with a player-radius margin).
  const blocked = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) blocked[i] = floor[i] ? 0 : 1;
  const margin = 0.35;
  for (const p of PROPS) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const cx = x + 0.5;
        const cy = y + 0.5;
        let hit = false;
        if (p.circle) {
          const [px, py, r] = p.circle;
          hit = Math.hypot(cx - px, cy - py) < r + margin;
        } else {
          const [x0, y0, x1, y1] = p.rect;
          hit = cx > x0 - margin && cx < x1 + margin && cy > y0 - margin && cy < y1 + margin;
        }
        if (hit) blocked[y * W + x] = 1;
      }
    }
  }

  const doors = DOORS.map((d, i) => {
    const [x0, , x1] = d.rect;
    return { id: i, room: d.room, rect: d.rect, vertical: x1 - x0 === 1, cells: [] };
  });
  doors.forEach((d) => fill(d.rect, (i) => d.cells.push(i)));

  const roomIndex = Object.fromEntries(ROOMS.map((r, i) => [r.id, i]));
  return {
    W,
    H,
    floor,
    room,
    theme,
    face,
    faceTheme,
    blocked,
    doors,
    rooms: ROOMS,
    roomIndex,
    props: PROPS,
    stations: STATIONS,
    vents: VENTS,
    ventNetworks: VENT_NETWORKS,
    button: EMERGENCY_BUTTON,
    spawn: SPAWN,
  };
}

/** Name of the room at a point, or null in a corridor. */
export function roomAt(map, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (cx < 0 || cy < 0 || cx >= map.W || cy >= map.H) return null;
  const r = map.room[cy * map.W + cx];
  return r >= 0 ? map.rooms[r] : null;
}

/** Vents reachable from a vent. */
export function ventNeighbors(ventId) {
  const net = VENT_NETWORKS.find((n) => n.includes(ventId));
  return net ? net.filter((v) => v !== ventId) : [];
}
