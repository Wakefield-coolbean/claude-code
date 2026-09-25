// Nether fortresses (Java 1.16-1.18 style, simplified piece set).
//
// One fortress per REGION x REGION block region at a hashed position. The piece layout for a region
// is a pure function of (seed, rx, rz): a random-but-deterministic expansion from a central bridge
// crossing into bridges, crossings, a blaze "throne", castle entrances, corridors (with fence windows,
// crossings, turns with chests, stairs) and nether-wart rooms. Every chunk re-evaluates (and caches)
// the layouts of nearby regions and rasterises only the blocks inside itself, so fortresses are
// seamless and independent of generation order.
import { Rng, hash32 } from './noise.js';
import { packBlock } from '../../constants.js';
import * as I from './ids.js';

export const REGION = 384;        // 24 chunks
const MAX_REACH = 112;            // max horizontal distance of a piece from the start
const MAX_PIECES = 120;

// directions use the facing-meta convention: 0 north (-z), 1 south (+z), 2 west (-x), 3 east (+x)
const FX = [0, 0, -1, 1], FZ = [-1, 1, 0, 0];
const RX = [1, -1, 0, 0], RZ = [0, 0, -1, 1];           // "right" of each direction
const dirOf = (fx, fz) => (fz < 0 ? 0 : fz > 0 ? 1 : fx < 0 ? 2 : 3);
const leftOf = (d) => dirOf(-RX[d], -RZ[d]);
const rightOf = (d) => dirOf(RX[d], RZ[d]);
const backOf = (d) => dirOf(-FX[d], -FZ[d]);

// Piece templates: half width, length, local vertical extent [lo, hi] (relative to walking level).
const T = {
  crossing: { hw: 9, L: 19, lo: -7, hi: 3 },
  bridge: { hw: 2, L: 19, lo: -5, hi: 3 },
  end: { hw: 2, L: 8, lo: -3, hi: 2 },
  throne: { hw: 3, L: 9, lo: -4, hi: 5 },
  entrance: { hw: 6, L: 13, lo: -3, hi: 6 },
  corridor: { hw: 2, L: 5, lo: -3, hi: 3 },
  ccross: { hw: 2, L: 5, lo: -3, hi: 3 },
  turn: { hw: 2, L: 5, lo: -3, hi: 3 },
  cstairs: { hw: 2, L: 10, lo: -3, hi: 9 },
  wart: { hw: 6, L: 13, lo: -3, hi: 7 },
  cap: { hw: 2, L: 1, lo: 0, hi: 3 },
};

function makePiece(type, ex, ey, ez, d, extra) {
  const t = T[type];
  const L = extra && extra.L ? extra.L : t.L;
  // world bbox from local corners
  const xs = [ex + RX[d] * -t.hw, ex + RX[d] * t.hw, ex + RX[d] * -t.hw + FX[d] * (L - 1), ex + RX[d] * t.hw + FX[d] * (L - 1)];
  const zs = [ez + RZ[d] * -t.hw, ez + RZ[d] * t.hw, ez + RZ[d] * -t.hw + FZ[d] * (L - 1), ez + RZ[d] * t.hw + FZ[d] * (L - 1)];
  return {
    type, ex, ey, ez, d, L, hw: t.hw,
    x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs), y0: ey + t.lo, y1: ey + t.hi,
    ...extra,
  };
}

// exits: [entry lx, entry ly, entry lz, direction]
function exitsOf(p) {
  const d = p.d, e = [];
  const at = (lx, ly, lz, nd) => e.push({ x: p.ex + RX[d] * lx + FX[d] * lz, y: p.ey + ly, z: p.ez + RZ[d] * lx + FZ[d] * lz, d: nd });
  switch (p.type) {
    case 'crossing': at(0, 0, 19, d); at(-10, 0, 9, leftOf(d)); at(10, 0, 9, rightOf(d)); if (p.start) at(0, 0, -1, backOf(d)); break;
    case 'bridge': case 'corridor': case 'entrance': at(0, 0, p.L, d); break;
    case 'ccross': at(0, 0, 5, d); at(-3, 0, 2, leftOf(d)); at(3, 0, 2, rightOf(d)); break;
    case 'turn': at(3 * p.side, 0, 2, p.side > 0 ? rightOf(d) : leftOf(d)); break;
    case 'cstairs': at(0, 6, 10, d); break;
    case 'wart': at(0, 0, 13, d); at(-7, 0, 6, leftOf(d)); at(7, 0, 6, rightOf(d)); break;
    default:
  }
  return e;
}

const overlaps = (a, b) => a.x0 <= b.x1 && a.x1 >= b.x0 && a.z0 <= b.z1 && a.z1 >= b.z0 && a.y0 <= b.y1 && a.y1 >= b.y0;

export class FortressPlanner {
  constructor(seed) {
    this.seed = seed | 0;
    this.cache = new Map();
  }

  // Start (centre of the first bridge crossing, walking level) for region (rx, rz), or null.
  startOf(rx, rz) {
    const h = hash32(this.seed, rx, rz, 0xf047);
    if ((h & 255) < 20) return null; // ~8% of regions have none
    const x = rx * REGION + 96 + ((h >>> 8) % 192);
    const z = rz * REGION + 96 + ((h >>> 16) % 192);
    const y = 58 + ((h >>> 24) % 14);
    return { x, y, z };
  }

  layout(rx, rz) {
    const key = rx + ',' + rz;
    let L = this.cache.get(key);
    if (L !== undefined) return L;
    L = this._build(rx, rz);
    if (this.cache.size > 64) this.cache.clear();
    this.cache.set(key, L);
    return L;
  }

  _build(rx, rz) {
    const s = this.startOf(rx, rz);
    if (!s) return null;
    const r = new Rng(hash32(this.seed, rx, rz, 0xb21d));
    const start = makePiece('crossing', s.x, s.y, s.z - 9, 1, { start: true, seed: r.int(0x7fffffff) });
    const pieces = [start];
    const pending = exitsOf(start).map((e) => ({ ...e, depth: 1, mode: 'bridge' }));
    const count = { throne: 0, entrance: 0, wart: 0, chest: 0, crossing: 1, cstairs: 0 };
    const fits = (p) => {
      const cx = (p.x0 + p.x1) / 2 - s.x, cz = (p.z0 + p.z1) / 2 - s.z;
      if (cx * cx + cz * cz > MAX_REACH * MAX_REACH || p.y0 < 8 || p.y1 > 118) return false;
      for (const q of pieces) if (overlaps(p, q)) return false;
      return true;
    };
    const grow = () => { while (pending.length && pieces.length < MAX_PIECES) {
      // expand the bridge network first (random among bridge exits), then the castle
      let nb = 0;
      for (const e of pending) if (e.mode === 'bridge') nb++;
      let pick;
      if (nb > 0) {
        let k = r.int(nb);
        pick = pending.findIndex((e) => e.mode === 'bridge' && k-- === 0);
      } else pick = r.int(pending.length);
      const ex = pending.splice(pick, 1)[0];
      const cands = [];
      if (ex.mode === 'bridge') {
        if (ex.depth >= 2 && count.throne === 0) cands.push('throne');
        if (ex.depth >= 2 && count.entrance === 0) cands.push('entrance');
        if (ex.depth > 7) cands.push(count.throne < 2 && r.next() < 0.4 ? 'throne' : 'end');
        else {
          for (let k = 0; k < 4; k++) {
            const w = r.next() * 100;
            if (w < 52) cands.push('bridge');
            else if (w < 70) cands.push(count.crossing < 5 ? 'crossing' : 'bridge');
            else if (w < 80) cands.push(count.entrance < 3 && ex.depth >= 2 ? 'entrance' : 'bridge');
            else if (w < 90) cands.push(count.throne < 2 ? 'throne' : 'bridge');
            else cands.push(ex.depth >= 3 ? 'end' : 'bridge');
          }
        }
        cands.push('end');
      } else {
        if (ex.depth >= 2 && count.wart === 0) cands.push('wart');
        if (ex.depth > 13) cands.push('cap');
        else {
          for (let k = 0; k < 4; k++) {
            const w = r.next() * 100;
            if (w < 40) cands.push('corridor');
            else if (w < 56) cands.push('ccross');
            else if (w < 80) cands.push('turn');
            else if (w < 90) cands.push(count.cstairs < 4 && ex.y < 96 ? 'cstairs' : 'corridor');
            else cands.push(count.wart < 3 ? 'wart' : 'corridor');
          }
        }
        cands.push('cap');
      }
      for (const type of cands) {
        const extra = { seed: r.int(0x7fffffff) };
        if (type === 'end') extra.L = 3 + r.int(6);
        if (type === 'turn') {
          extra.side = r.next() < 0.5 ? -1 : 1;
          extra.chest = count.chest === 0 || r.next() < 0.12;
        }
        const p = makePiece(type, ex.x, ex.y, ex.z, ex.d, extra);
        if (!fits(p)) continue;
        pieces.push(p);
        if (type === 'throne' || type === 'entrance' || type === 'wart' || type === 'crossing' || type === 'cstairs') count[type]++;
        if (type === 'turn' && p.chest) count.chest++;
        const mode = type === 'entrance' || ex.mode === 'castle' ? 'castle' : 'bridge';
        for (const e of exitsOf(p)) pending.push({ ...e, depth: ex.depth + 1, mode });
        break;
      }
    } };
    grow();
    // guarantee a castle wing with a wart room and a chest: attach an entrance to a free bridge exit
    // (or in place of a dead-end bridge) and keep growing
    for (let attempt = 0; attempt < 4 && (count.wart === 0 || count.chest === 0); attempt++) {
      let done = false;
      for (let i = 0; i < pieces.length && !done; i++) {
        const b = pieces[i];
        const spots = b.type === 'end' ? [{ x: b.ex, y: b.ey, z: b.ez, d: b.d }] :
          b.type === 'bridge' || b.type === 'crossing' ? exitsOf(b) : [];
        for (const e of spots) {
          if (b.type === 'end') pieces.splice(i, 1);
          const p = makePiece('entrance', e.x, e.y, e.z, e.d, { seed: b.seed ^ (0x77 + attempt) });
          if (!fits(p)) { if (b.type === 'end') pieces.splice(i, 0, b); continue; }
          pieces.push(p); count.entrance++;
          for (const e2 of exitsOf(p)) pending.push({ ...e2, depth: 2, mode: 'castle' });
          done = true;
          break;
        }
      }
      if (!done) break;
      grow();
    }
    // guarantee a blaze room: turn a dead-end bridge (or any free bridge exit) into a throne
    if (count.throne === 0) {
      for (let i = 0; i < pieces.length && count.throne === 0; i++) {
        const e = pieces[i];
        if (e.type !== 'end') continue;
        pieces.splice(i, 1);
        const p = makePiece('throne', e.ex, e.ey, e.ez, e.d, { seed: e.seed });
        if (fits(p)) { pieces.push(p); count.throne++; } else pieces.splice(i, 0, e);
      }
      for (let i = 0; i < pieces.length && count.throne === 0; i++) {
        const b = pieces[i];
        if (b.type !== 'bridge' && b.type !== 'crossing') continue;
        for (const e of exitsOf(b)) {
          const p = makePiece('throne', e.x, e.y, e.z, e.d, { seed: b.seed ^ 0x55 });
          if (fits(p)) { pieces.push(p); count.throne++; break; }
        }
      }
    }
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (const p of pieces) {
      x0 = Math.min(x0, p.x0); z0 = Math.min(z0, p.z0); x1 = Math.max(x1, p.x1); z1 = Math.max(z1, p.z1);
    }
    return { start: s, pieces, x0, z0, x1, z1 };
  }

  // Layouts whose bbox (expanded by `m`) touches the block rectangle.
  near(bx0, bz0, bx1, bz1, m = 0) {
    const out = [];
    const rx0 = Math.floor((bx0 - 200) / REGION), rx1 = Math.floor((bx1 + 200) / REGION);
    const rz0 = Math.floor((bz0 - 200) / REGION), rz1 = Math.floor((bz1 + 200) / REGION);
    for (let rx = rx0; rx <= rx1; rx++) {
      for (let rz = rz0; rz <= rz1; rz++) {
        const L = this.layout(rx, rz);
        if (!L) continue;
        if (L.x1 + m < bx0 || L.x0 - m > bx1 || L.z1 + m < bz0 || L.z0 - m > bz1) continue;
        out.push(L);
      }
    }
    return out;
  }

  // true if (x,y,z) is inside (or within m blocks of) any fortress piece
  inside(x, y, z, m = 2) {
    for (const L of this.near(x, z, x, z, m)) {
      for (const p of L.pieces) {
        if (x >= p.x0 - m && x <= p.x1 + m && z >= p.z0 - m && z <= p.z1 + m && y >= p.y0 - m && y <= p.y1 + m) return true;
      }
    }
    return false;
  }

  nearest(x, z) {
    const crx = Math.floor(x / REGION), crz = Math.floor(z / REGION);
    let best = null, bd = Infinity;
    for (let ring = 0; ring <= 4; ring++) {
      for (let rx = crx - ring; rx <= crx + ring; rx++) {
        for (let rz = crz - ring; rz <= crz + ring; rz++) {
          if (Math.max(Math.abs(rx - crx), Math.abs(rz - crz)) !== ring) continue;
          const s = this.startOf(rx, rz);
          if (!s) continue;
          const d = (s.x - x) ** 2 + (s.z - z) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
      }
      if (best && Math.sqrt(bd) < ring * REGION) break;
    }
    return best ? { x: best.x, y: best.y, z: best.z } : null;
  }

  // Rasterise all pieces touching chunk (cx, cz) into `buf` (384-high overworld layout, y offset 64).
  writeChunk(cx, cz, buf) {
    const X0 = cx << 4, Z0 = cz << 4;
    const W = new Writer(buf, X0, Z0);
    let n = 0;
    for (const L of this.near(X0, Z0, X0 + 15, Z0 + 15)) {
      for (const p of L.pieces) {
        if (p.x1 < X0 || p.x0 > X0 + 15 || p.z1 < Z0 || p.z0 > Z0 + 15) continue;
        W.piece = p;
        BUILD[p.type](W, p);
        n++;
      }
    }
    return n;
  }
}

// ------------------------------------------------------------------------------------------------
// Clipped writer in piece-local coordinates (lx across, ly up, lz forward).
const B = () => I.NETHER_BRICKS;
class Writer {
  constructor(buf, X0, Z0) { this.buf = buf; this.X0 = X0; this.Z0 = Z0; this.piece = null; }
  idx(x, y, z) {
    const lx = x - this.X0, lz = z - this.Z0;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 1 || y > 126) return -1;
    return ((y + 64) << 8) | (lz << 4) | lx;
  }
  wx(lx, lz) { const p = this.piece; return p.ex + RX[p.d] * lx + FX[p.d] * lz; }
  wz(lx, lz) { const p = this.piece; return p.ez + RZ[p.d] * lx + FZ[p.d] * lz; }
  set(lx, ly, lz, v) {
    const i = this.idx(this.wx(lx, lz), this.piece.ey + ly, this.wz(lx, lz));
    if (i >= 0) this.buf[i] = v;
  }
  box(lx0, ly0, lz0, lx1, ly1, lz1, v) {
    for (let lx = lx0; lx <= lx1; lx++) {
      for (let lz = lz0; lz <= lz1; lz++) {
        const x = this.wx(lx, lz), z = this.wz(lx, lz);
        if (x < this.X0 || x > this.X0 + 15 || z < this.Z0 || z > this.Z0 + 15) continue;
        for (let ly = ly0; ly <= ly1; ly++) {
          const i = this.idx(x, this.piece.ey + ly, z);
          if (i >= 0) this.buf[i] = v;
        }
      }
    }
  }
  // fill downward from ly through air / lava / fluids / plants until solid ground
  down(lx, ly, lz, v) {
    const x = this.wx(lx, lz), z = this.wz(lx, lz);
    let y = this.piece.ey + ly;
    for (; y > 0; y--) {
      const i = this.idx(x, y, z);
      if (i < 0) { if (y > 126) continue; return; }
      const c = this.buf[i] & 0xfff;
      if (!(c === 0 || c === I.LAVA || c === I.FIRE || c === I.SOUL_FIRE || c === I.CRIMSON_ROOTS || c === I.WARPED_ROOTS ||
        c === I.CRIMSON_FUNGUS || c === I.WARPED_FUNGUS)) return;
      this.buf[i] = v;
    }
  }
  downBox(lx0, lz0, lx1, lz1, ly, v) {
    for (let lx = lx0; lx <= lx1; lx++) for (let lz = lz0; lz <= lz1; lz++) this.down(lx, ly, lz, v);
  }
  // per-position deterministic random in [0,1)
  rand(lx, ly, lz, salt = 0) {
    const p = this.piece;
    return hash32(p.seed, this.wx(lx, lz), p.ey + ly, this.wz(lx, lz) ^ salt) / 4294967296;
  }
  stairs(lx, ly, lz, localDir, upsideDown = false) {
    // localDir: 0 forward, 1 back, 2 left, 3 right  -> world facing meta
    const p = this.piece;
    const d = localDir === 0 ? p.d : localDir === 1 ? backOf(p.d) : localDir === 2 ? leftOf(p.d) : rightOf(p.d);
    this.set(lx, ly, lz, packBlock(I.NETHER_BRICK_STAIRS, d | (upsideDown ? 4 : 0)));
  }
}

const AIR = 0;
const FENCE = () => I.NETHER_BRICK_FENCE;

// corridor shell (5 wide): floor 2 thick, 3x3 interior, walls, roof, supports
function corridorShell(w, lz0, lz1, windows) {
  w.box(-2, -2, lz0, 2, -1, lz1, B());
  w.box(-1, 0, lz0, 1, 2, lz1, AIR);
  w.box(-2, 0, lz0, -2, 3, lz1, B());
  w.box(2, 0, lz0, 2, 3, lz1, B());
  w.box(-1, 3, lz0, 1, 3, lz1, B());
  if (windows) {
    for (let lz = lz0; lz <= lz1; lz++) {
      if (((lz - lz0) & 1) === 1) { w.box(-2, 1, lz, -2, 2, lz, FENCE()); w.box(2, 1, lz, 2, 2, lz, FENCE()); }
    }
  }
  w.downBox(-2, lz0, 2, lz1, -3, B());
}

const BUILD = {
  bridge(w, p) {
    w.box(-2, -2, 0, 2, -1, 18, B());
    w.box(-1, 0, 0, 1, 2, 18, AIR);
    w.box(-2, 0, 0, -2, 0, 18, B());
    w.box(2, 0, 0, 2, 0, 18, B());
    w.box(-2, 1, 0, -2, 1, 18, FENCE());
    w.box(2, 1, 0, 2, 1, 18, FENCE());
    w.box(-2, 2, 0, -2, 3, 18, AIR);
    w.box(2, 2, 0, 2, 3, 18, AIR);
    // arched underside and end piers
    w.box(-2, -3, 0, 2, -3, 5, B()); w.box(-2, -3, 13, 2, -3, 18, B());
    w.box(-2, -4, 0, 2, -4, 3, B()); w.box(-2, -4, 15, 2, -4, 18, B());
    w.downBox(-2, 0, 2, 3, -5, B());
    w.downBox(-2, 15, 2, 18, -5, B());
  },

  crossing(w, p) {
    w.box(-2, -2, 0, 2, -1, 18, B());
    w.box(-9, -2, 7, 9, -1, 11, B());
    w.box(-1, 0, 0, 1, 2, 18, AIR);
    w.box(-9, 0, 8, 9, 2, 10, AIR);
    w.box(-2, 0, 7, 2, 3, 11, AIR);
    for (const [a, b] of [[0, 6], [12, 18]]) {
      w.box(-2, 0, a, -2, 0, b, B()); w.box(2, 0, a, 2, 0, b, B());
      w.box(-2, 1, a, -2, 1, b, FENCE()); w.box(2, 1, a, 2, 1, b, FENCE());
    }
    for (const [a, b] of [[-9, -3], [3, 9]]) {
      w.box(a, 0, 7, b, 0, 7, B()); w.box(a, 0, 11, b, 0, 11, B());
      w.box(a, 1, 7, b, 1, 7, FENCE()); w.box(a, 1, 11, b, 1, 11, FENCE());
    }
    // corner posts at the junction
    for (const [x, z] of [[-2, 7], [2, 7], [-2, 11], [2, 11]]) w.box(x, 0, z, x, 2, z, B());
    // central pier + arm-end piers
    w.box(-2, -6, 7, 2, -3, 11, B());
    w.downBox(-2, 7, 2, 11, -7, B());
    w.box(-2, -4, 0, 2, -3, 2, B()); w.downBox(-2, 0, 2, 2, -5, B());
    w.box(-2, -4, 16, 2, -3, 18, B()); w.downBox(-2, 16, 2, 18, -5, B());
    w.box(-9, -4, 7, -7, -3, 11, B()); w.downBox(-9, 7, -7, 11, -5, B());
    w.box(7, -4, 7, 9, -3, 11, B()); w.downBox(7, 7, 9, 11, -5, B());
  },

  end(w, p) {
    for (let lz = 0; lz < p.L; lz++) {
      const keep = 1 - lz / p.L * 0.85;
      for (let lx = -2; lx <= 2; lx++) {
        if (w.rand(lx, 0, lz) < keep) w.box(lx, -2, lz, lx, -1, lz, B());
        if ((lx === -2 || lx === 2) && w.rand(lx, 1, lz) < keep - 0.2) w.set(lx, 0, lz, B());
      }
      w.box(-1, 0, lz, 1, 2, lz, AIR);
    }
  },

  throne(w, p) {
    w.box(-3, 0, 0, 3, 5, 8, AIR);
    w.box(-2, -3, 0, 2, -1, 8, B());
    w.box(-2, 0, 3, 2, 0, 8, B());
    w.box(-2, 1, 5, 2, 1, 8, B());
    for (let lx = -2; lx <= 2; lx++) { w.stairs(lx, 0, 2, 0); w.stairs(lx, 1, 4, 0); }
    // fence enclosure with brick corner posts and a fence canopy
    w.box(-3, 0, 0, -3, 3, 8, FENCE()); w.box(3, 0, 0, 3, 3, 8, FENCE());
    w.box(-3, 2, 8, 3, 3, 8, FENCE());
    for (const [x, z] of [[-3, 0], [3, 0], [-3, 8], [3, 8]]) w.box(x, -1, z, x, 4, z, B());
    w.box(-3, 4, 0, 3, 4, 0, FENCE()); w.box(-3, 4, 8, 3, 4, 8, FENCE());
    w.box(-3, 4, 1, -3, 4, 7, FENCE()); w.box(3, 4, 1, 3, 4, 7, FENCE());
    w.box(-3, -1, 0, -3, -1, 8, B()); w.box(3, -1, 0, 3, -1, 8, B());
    w.set(0, 2, 6, I.SPAWNER);
    w.downBox(-3, 0, 3, 8, -4, B());
  },

  entrance(w, p) {
    w.box(-6, -2, 0, 6, -1, 12, B());
    w.box(-6, 0, 0, 6, 6, 12, B());
    w.box(-5, 0, 1, 5, 5, 11, AIR);
    w.box(-1, 0, 0, 1, 2, 0, AIR);
    w.box(-1, 0, 12, 1, 2, 12, AIR);
    for (let k = -4; k <= 4; k += 2) {
      w.box(-6, 2, k + 6, -6, 3, k + 6, FENCE()); w.box(6, 2, k + 6, 6, 3, k + 6, FENCE());
      if (Math.abs(k) >= 3) { w.box(k, 2, 0, k, 3, 0, FENCE()); w.box(k, 2, 12, k, 3, 12, FENCE()); }
    }
    // inner pillars and a lava well
    for (const [x, z] of [[-3, 3], [3, 3], [-3, 9], [3, 9]]) w.box(x, 0, z, x, 5, z, B());
    w.box(-1, -1, 5, 1, 0, 7, B());
    w.set(0, 0, 6, AIR);
    w.set(0, -1, 6, I.LAVA);
    w.downBox(-6, 0, 6, 12, -3, B());
  },

  corridor(w, p) { corridorShell(w, 0, 4, true); },

  ccross(w, p) {
    corridorShell(w, 0, 4, false);
    w.box(-2, 0, 1, -2, 2, 3, AIR);
    w.box(2, 0, 1, 2, 2, 3, AIR);
  },

  turn(w, p) {
    corridorShell(w, 0, 4, false);
    w.box(-2, 0, 4, 2, 3, 4, B());
    const s = p.side;
    w.box(2 * s, 0, 1, 2 * s, 2, 3, AIR);
    w.box(-2 * s, 1, 1, -2 * s, 2, 1, FENCE());
    w.box(-2 * s, 1, 3, -2 * s, 2, 3, FENCE());
    if (p.chest) {
      const facing = backOf(p.d);
      w.set(-s, 0, 3, packBlock(I.CHEST, facing));
    }
  },

  cstairs(w, p) {
    for (let lz = 0; lz < 10; lz++) {
      const h = Math.min(6, Math.max(0, lz - 1));
      w.box(-2, -2, lz, 2, h - 1, lz, B());
      w.box(-1, h, lz, 1, h + 2, lz, AIR);
      w.box(-2, h, lz, -2, h + 3, lz, B());
      w.box(2, h, lz, 2, h + 3, lz, B());
      w.box(-1, h + 3, lz, 1, h + 3, lz, B());
      if (lz >= 2 && lz <= 7) for (let lx = -1; lx <= 1; lx++) w.stairs(lx, h - 1, lz, 0);
      if (lz & 1) { w.box(-2, h + 1, lz, -2, h + 2, lz, FENCE()); w.box(2, h + 1, lz, 2, h + 2, lz, FENCE()); }
      // clear head room over the previous step
      if (lz > 0) w.box(-1, h + 2, lz - 1, 1, h + 2, lz - 1, AIR);
      w.downBox(-2, lz, 2, lz, -3, B());
    }
  },

  wart(w, p) {
    w.box(-6, -2, 0, 6, -1, 12, B());
    w.box(-6, 0, 0, 6, 7, 12, B());
    w.box(-5, 0, 1, 5, 6, 11, AIR);
    w.box(-1, 0, 0, 1, 2, 0, AIR);
    w.box(-1, 0, 12, 1, 2, 12, AIR);
    w.box(-6, 0, 5, -6, 2, 7, AIR);
    w.box(6, 0, 5, 6, 2, 7, AIR);
    for (let k = 2; k <= 10; k += 2) {
      if (k >= 5 && k <= 7) continue;
      w.box(-6, 3, k, -6, 4, k, FENCE()); w.box(6, 3, k, 6, 4, k, FENCE());
    }
    for (const x of [-4, -3, 3, 4]) { w.box(x, 3, 0, x, 4, 0, FENCE()); w.box(x, 3, 12, x, 4, 12, FENCE()); }
    // raised soul-sand planters with mature nether wart (aisles at lx = +-2, side doors at lz 5..7)
    for (const [a, b] of [[-5, -3], [3, 5]]) {
      for (const [c, e] of [[1, 4], [8, 11]]) {
        w.box(a, 0, c, b, 0, e, I.SOUL_SAND);
        w.box(a, 1, c, b, 1, e, I.NETHER_WART_MATURE);
      }
    }
    // central staircase up to a landing and down again
    w.box(-1, 0, 4, 1, 0, 8, B());
    w.box(-1, 1, 5, 1, 1, 7, B());
    for (let lx = -1; lx <= 1; lx++) {
      w.stairs(lx, 0, 3, 0); w.stairs(lx, 1, 4, 0);
      w.stairs(lx, 1, 8, 1); w.stairs(lx, 0, 9, 1);
    }
    w.box(-2, 2, 5, -2, 2, 7, FENCE()); w.box(2, 2, 5, 2, 2, 7, FENCE());
    w.downBox(-6, 0, 6, 12, -3, B());
  },

  cap(w, p) {
    w.box(-2, -2, 0, 2, 3, 0, B());
    w.box(0, 1, 0, 0, 2, 0, FENCE());
  },
};
