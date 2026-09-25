// Chunky 3D title logo in the spirit of the Minecraft title (original block lettering).
// renderTitleLogo(text) -> { w, h, data: Uint8ClampedArray } (transparent background).
// Pure JS; the engine scales the result up with nearest-neighbour filtering.
import { seeded } from './pixel.js';

// 5-row block glyphs; each '#' is one cell (cell x cell pixels).
const BLOCK_GLYPHS = {
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  C: ['.###', '#...', '#...', '#...', '.###'],
  D: ['###.', '#..#', '#..#', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  F: ['####', '#...', '###.', '#...', '#...'],
  G: ['.###', '#...', '#.##', '#..#', '.###'],
  H: ['#..#', '#..#', '####', '#..#', '#..#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..##', '...#', '...#', '#..#', '.##.'],
  K: ['#..#', '#.#.', '##..', '#.#.', '#..#'],
  L: ['#...', '#...', '#...', '#...', '####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  N: ['#..#', '##.#', '#.##', '#..#', '#..#'],
  O: ['.##.', '#..#', '#..#', '#..#', '.##.'],
  P: ['###.', '#..#', '###.', '#...', '#...'],
  Q: ['.##.', '#..#', '#..#', '#.#.', '.#.#'],
  R: ['###.', '#..#', '###.', '#.#.', '#..#'],
  S: ['.###', '#...', '.##.', '...#', '###.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#..#', '#..#', '#..#', '#..#', '.##.'],
  V: ['#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
  Z: ['####', '..#.', '.#..', '#...', '####'],
  0: ['.##.', '#.##', '##.#', '#..#', '.##.'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['###.', '...#', '.##.', '#...', '####'],
  3: ['###.', '...#', '.##.', '...#', '###.'],
  4: ['#..#', '#..#', '####', '...#', '...#'],
  5: ['####', '#...', '###.', '...#', '###.'],
  6: ['.##.', '#...', '###.', '#..#', '.##.'],
  7: ['####', '...#', '..#.', '.#..', '.#..'],
  8: ['.##.', '#..#', '.##.', '#..#', '.##.'],
  9: ['.##.', '#..#', '.###', '...#', '.##.'],
  ' ': ['..', '..', '..', '..', '..'],
  '!': ['#', '#', '#', '.', '#'],
  '.': ['.', '.', '.', '.', '#'],
  ',': ['.', '.', '.', '.', '#'],
  '-': ['...', '...', '###', '...', '...'],
  ':': ['.', '#', '.', '#', '.'],
  "'": ['#', '#', '.', '.', '.'],
  '?': ['###.', '...#', '.##.', '....', '.#..'],
};

export function renderTitleLogo(text, { cell = 4, depth = 4, gap = 3 } = {}) {
  const chars = [...String(text).toUpperCase()].map((ch) => BLOCK_GLYPHS[ch] ?? BLOCK_GLYPHS['?']);
  const pad = 1; // outline
  const faceW = chars.reduce((s, g) => s + g[0].length * cell + gap, 0) - gap;
  const faceH = 5 * cell;
  // extrusion goes mostly downward (slightly right) so neighbouring letters stay readable
  const offs = [];
  for (let d = 1; d <= depth; d++) offs.push([Math.ceil(d / 2), d]);
  const dxMax = offs.length ? offs[offs.length - 1][0] : 0;
  const w = Math.max(1, faceW + dxMax + pad * 2), h = faceH + depth + pad * 2;
  const data = new Uint8ClampedArray(w * h * 4);

  // face mask + cell ids (for per-block shading)
  const face = new Int32Array(w * h).fill(-1);
  let x0 = pad, cellId = 0;
  for (const g of chars) {
    const on = (r, c) => r >= 0 && r < 5 && c >= 0 && c < g[r].length && g[r][c] === '#';
    const ids = {};
    for (let r = 0; r < 5; r++) for (let c = 0; c < g[r].length; c++) {
      if (g[r][c] !== '#') continue;
      const id = ids[r * 16 + c] = cellId++;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) face[(pad + r * cell + y) * w + x0 + c * cell + x] = id;
    }
    // cells touching only at a corner get a half-cell joint so diagonal strokes read as solid
    const hc = cell >> 1;
    const fillQ = (r, c, qx, qy, id) => {
      for (let y = 0; y < hc; y++) for (let x = 0; x < hc; x++) face[(pad + r * cell + qy * hc + y) * w + x0 + c * cell + qx * hc + x] = id;
    };
    for (let r = 0; r < 4; r++) for (let c = 0; c < g[r].length; c++) {
      if (on(r, c) && on(r + 1, c + 1) && !on(r, c + 1) && !on(r + 1, c)) {
        fillQ(r, c + 1, 0, 1, ids[r * 16 + c]); fillQ(r + 1, c, 1, 0, ids[(r + 1) * 16 + c + 1]);
      }
      if (on(r, c + 1) && on(r + 1, c) && !on(r, c) && !on(r + 1, c + 1)) {
        fillQ(r, c, 1, 1, ids[r * 16 + c + 1]); fillQ(r + 1, c + 1, 0, 0, ids[(r + 1) * 16 + c]);
      }
    }
    x0 += g[0].length * cell + gap;
  }
  const isFace = (x, y) => x >= 0 && y >= 0 && x < w && y < h && face[y * w + x] >= 0;
  const put = (x, y, v, a = 255) => { const i = (y * w + x) * 4; data[i] = v[0]; data[i + 1] = v[1]; data[i + 2] = v[2]; data[i + 3] = a; };

  // extrusion: layers from far to near; bottom faces darker than right faces
  for (let d = depth; d >= 1; d--) {
    const t = (d - 1) / Math.max(1, depth - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!isFace(x, y)) continue;
      const X = x + offs[d - 1][0], Y = y + offs[d - 1][1];
      if (X >= w || Y >= h) continue;
      const bottom = !isFace(x, y + 1), right = !isFace(x + 1, y);
      let v;
      if (d === 1) v = 24; // crisp dark seam right under the face
      else if (bottom) v = 78 - t * 34;
      else if (right) v = 100 - t * 36;
      else v = 70 - t * 30;
      put(X, Y, [v, v, v + 2]);
    }
  }

  // face: cobbled stone texture, lit from the top-left
  const rnd = seeded('logo:' + text);
  const cellShade = [];
  for (let i = 0; i < cellId; i++) cellShade.push(0.9 + rnd() * 0.2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!isFace(x, y)) continue;
    const id = face[y * w + x];
    const n = rnd();
    let v = 160 * cellShade[id];
    if (n < 0.07) v -= 30; else if (n < 0.16) v -= 13; else if (n > 0.95) v += 20;
    // mortar lines between some neighbouring blocks for a cobbled look
    const lx = (x - pad) % cell, ly = (y - pad) % cell;
    const idR = isFace(x + 1, y) ? face[y * w + x + 1] : -1, idD = isFace(x, y + 1) ? face[(y + 1) * w + x] : -1;
    if ((lx === cell - 1 && idR >= 0 && (idR + id) % 3 === 0) || (ly === cell - 1 && idD >= 0 && (idD * 7 + id) % 4 === 0)) v -= 38;
    // bevel: highlight top/left edges, shade bottom/right edges
    if (!isFace(x, y - 1)) v = 222;
    else if (!isFace(x - 1, y)) v = Math.max(v, 196);
    else if (!isFace(x, y - 2) && y >= 2) v += 22;
    if (!isFace(x, y + 1)) v -= 44;
    else if (!isFace(x + 1, y)) v -= 30;
    v = Math.max(40, Math.min(240, v));
    put(x, y, [v, v, v + 3]);
  }

  // black outline around everything (8-neighbourhood)
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3] > 0;
  const out = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (solid(x, y)) continue;
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solid(x + dx, y + dy)) { hit = true; break; }
    if (hit) out.push([x, y]);
  }
  for (const [x, y] of out) put(x, y, [0, 0, 0]);
  return { w, h, data };
}

export const LOGO_GLYPHS = BLOCK_GLYPHS;
