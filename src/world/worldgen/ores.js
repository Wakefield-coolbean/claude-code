// Ore veins and stone blobs with Minecraft 1.18 distributions (OreFeature port).
// Veins are seeded per source chunk; generating chunk (cx,cz) replays the veins of its 3x3
// neighbourhood and writes only the blocks inside itself, so results are order independent.
import { MIN_Y } from '../../constants.js';
import { Rng, hash32, hashf } from './noise.js';
import * as I from './ids.js';

// replace-target sets
const T_STONE = 1, T_DEEP = 2, T_BASE = 4; // stone-ish / deepslate-ish / any base stone
const TARGET = new Uint8Array(4096);
TARGET[I.STONE] = T_STONE | T_BASE;
TARGET[I.GRANITE] = T_STONE | T_BASE;
TARGET[I.DIORITE] = T_STONE | T_BASE;
TARGET[I.ANDESITE] = T_STONE | T_BASE;
TARGET[I.DEEPSLATE] = T_DEEP | T_BASE;
TARGET[I.TUFF] = T_DEEP | T_BASE;

// kind: 'ore' (stone->ore, deepslate->deep ore) | 'blob' (replace base stone with block)
// dist: 'u' uniform [min,max] | 't' triangle [min,max]
// count: attempts per chunk; rarity: 1/n chance of a single attempt
const MOUNTAIN_BIOMES = new Set(['windswept_hills', 'meadow', 'grove', 'snowy_slopes', 'jagged_peaks', 'frozen_peaks', 'stony_peaks']);
export const VEINS = [
  { name: 'dirt', kind: 'blob', block: I.DIRT, count: 7, dist: 'u', min: 0, max: 160, size: 33, mask: T_BASE },
  { name: 'gravel', kind: 'blob', block: I.GRAVEL, count: 14, dist: 'u', min: -64, max: 319, size: 33, mask: T_BASE },
  { name: 'granite_upper', kind: 'blob', block: I.GRANITE, rarity: 6, dist: 'u', min: 64, max: 128, size: 64, mask: T_STONE },
  { name: 'granite_lower', kind: 'blob', block: I.GRANITE, count: 2, dist: 'u', min: 0, max: 60, size: 64, mask: T_STONE },
  { name: 'diorite_upper', kind: 'blob', block: I.DIORITE, rarity: 6, dist: 'u', min: 64, max: 128, size: 64, mask: T_STONE },
  { name: 'diorite_lower', kind: 'blob', block: I.DIORITE, count: 2, dist: 'u', min: 0, max: 60, size: 64, mask: T_STONE },
  { name: 'andesite_upper', kind: 'blob', block: I.ANDESITE, rarity: 6, dist: 'u', min: 64, max: 128, size: 64, mask: T_STONE },
  { name: 'andesite_lower', kind: 'blob', block: I.ANDESITE, count: 2, dist: 'u', min: 0, max: 60, size: 64, mask: T_STONE },
  { name: 'tuff', kind: 'blob', block: I.TUFF, count: 2, dist: 'u', min: -64, max: 0, size: 64, mask: T_BASE },
  { name: 'coal_upper', kind: 'ore', ore: I.COAL_ORE, deep: I.DEEPSLATE_COAL_ORE, count: 30, dist: 'u', min: 136, max: 319, size: 17 },
  { name: 'coal_lower', kind: 'ore', ore: I.COAL_ORE, deep: I.DEEPSLATE_COAL_ORE, count: 20, dist: 't', min: 0, max: 192, size: 17, discard: 0.5 },
  { name: 'iron_upper', kind: 'ore', ore: I.IRON_ORE, deep: I.DEEPSLATE_IRON_ORE, count: 90, dist: 't', min: 80, max: 384, size: 9 },
  { name: 'iron_middle', kind: 'ore', ore: I.IRON_ORE, deep: I.DEEPSLATE_IRON_ORE, count: 10, dist: 't', min: -24, max: 56, size: 9 },
  { name: 'iron_small', kind: 'ore', ore: I.IRON_ORE, deep: I.DEEPSLATE_IRON_ORE, count: 10, dist: 'u', min: -64, max: 72, size: 4 },
  { name: 'copper', kind: 'ore', ore: I.COPPER_ORE, deep: I.DEEPSLATE_COPPER_ORE, count: 16, dist: 't', min: -16, max: 112, size: 10 },
  { name: 'gold', kind: 'ore', ore: I.GOLD_ORE, deep: I.DEEPSLATE_GOLD_ORE, count: 4, dist: 't', min: -64, max: 32, size: 9, discard: 0.5 },
  { name: 'gold_lower', kind: 'ore', ore: I.GOLD_ORE, deep: I.DEEPSLATE_GOLD_ORE, rarity: 2, dist: 'u', min: -64, max: -48, size: 9, discard: 0.5 },
  { name: 'redstone', kind: 'ore', ore: I.REDSTONE_ORE, deep: I.DEEPSLATE_REDSTONE_ORE, count: 4, dist: 'u', min: -64, max: 15, size: 8 },
  { name: 'redstone_lower', kind: 'ore', ore: I.REDSTONE_ORE, deep: I.DEEPSLATE_REDSTONE_ORE, count: 8, dist: 't', min: -96, max: -32, size: 8 },
  { name: 'lapis', kind: 'ore', ore: I.LAPIS_ORE, deep: I.DEEPSLATE_LAPIS_ORE, count: 2, dist: 't', min: -32, max: 32, size: 7 },
  { name: 'lapis_buried', kind: 'ore', ore: I.LAPIS_ORE, deep: I.DEEPSLATE_LAPIS_ORE, count: 4, dist: 'u', min: -64, max: 64, size: 7, discard: 1 },
  { name: 'diamond', kind: 'ore', ore: I.DIAMOND_ORE, deep: I.DEEPSLATE_DIAMOND_ORE, count: 7, dist: 't', min: -144, max: 16, size: 4, discard: 0.5 },
  { name: 'diamond_large', kind: 'ore', ore: I.DIAMOND_ORE, deep: I.DEEPSLATE_DIAMOND_ORE, rarity: 9, dist: 't', min: -144, max: 16, size: 12, discard: 0.7 },
  { name: 'diamond_buried', kind: 'ore', ore: I.DIAMOND_ORE, deep: I.DEEPSLATE_DIAMOND_ORE, count: 4, dist: 't', min: -144, max: 16, size: 8, discard: 1 },
  { name: 'emerald', kind: 'ore', ore: I.EMERALD_ORE, deep: I.DEEPSLATE_EMERALD_ORE, count: 100, dist: 't', min: -16, max: 480, size: 3, biomes: MOUNTAIN_BIOMES },
];
VEINS.forEach((v, i) => { v.salt = 0x0e5 + i * 7919; });

const sph = new Float64Array(64 * 4); // sphere scratch (x, y, z, r)

// ctx: { cx, cz, buf, seed, topMax (highest terrain y in chunk), biomeAt(x,z) -> biome name, colBiomeName(lx,lz) }
export function placeVeins(ctx) {
  const { cx, cz, seed } = ctx;
  const rng = new Rng(0);
  const X0 = cx << 4, Z0 = cz << 4;
  const topMax = ctx.topMax;
  for (let vi = 0; vi < VEINS.length; vi++) {
    const v = VEINS[vi];
    const reach = Math.ceil(v.size / 8 + v.size / 16 + 3);
    for (let sx = cx - 1; sx <= cx + 1; sx++) {
      for (let sz = cz - 1; sz <= cz + 1; sz++) {
        rng.seed(hash32(seed, sx, sz, v.salt));
        let n = v.count ?? 0;
        if (v.rarity) n = rng.int(v.rarity) === 0 ? 1 : 0;
        for (let a = 0; a < n; a++) {
          const x = sx * 16 + rng.int(16);
          const z = sz * 16 + rng.int(16);
          let y;
          if (v.dist === 'u') y = v.min + rng.int(v.max - v.min + 1);
          else { const h = (v.max - v.min) >> 1; y = v.min + rng.int(h + 1) + rng.int(h + 1); }
          const vs = rng.int(0x7fffffff);
          // cheap culls: out of chunk reach, out of world, above terrain
          if (x + reach < X0 || x - reach > X0 + 15 || z + reach < Z0 || z - reach > Z0 + 15) continue;
          if (y - reach > topMax || y + reach < MIN_Y) continue;
          if (v.biomes) {
            const bn = ctx.biomeNameAt(x, z);
            if (!v.biomes.has(bn)) continue;
          }
          placeVein(ctx, v, x, y, z, vs);
        }
      }
    }
  }
}

function placeVein(ctx, v, x, y, z, vs) {
  const r = new Rng(vs);
  const size = v.size;
  const f = r.next() * Math.PI;
  const g = size / 8;
  const sx = Math.sin(f) * g, sz = Math.cos(f) * g;
  const d = x + sx, e = x - sx, h = z + sz, j = z - sz;
  const l = y + r.int(3) - 2, m = y + r.int(3) - 2;
  // big blobs: fewer, slightly larger spheres (same overall shape, far fewer block tests)
  const step = size > 24 ? Math.max(1, size >> 4) : 1;
  let ns = 0;
  for (let s = 0; s < size; s += step) {
    const t = s / size;
    const rr = r.next() * size / 16;
    const rad = ((Math.sin(Math.PI * t) + 1) * rr + 1) / 2 + (step > 1 ? 0.35 : 0);
    sph[ns * 4] = d + (e - d) * t;
    sph[ns * 4 + 1] = l + (m - l) * t;
    sph[ns * 4 + 2] = h + (j - h) * t;
    sph[ns * 4 + 3] = rad;
    ns++;
  }
  const X0 = ctx.cx << 4, Z0 = ctx.cz << 4;
  const buf = ctx.buf;
  const isOre = v.kind === 'ore';
  const mask = isOre ? (T_STONE | T_DEEP) : v.mask;
  const discard = v.discard ?? 0;
  for (let s = 0; s < ns; s++) {
    const cxs = sph[s * 4], cys = sph[s * 4 + 1], czs = sph[s * 4 + 2], rad = sph[s * 4 + 3];
    const x1 = Math.max(X0, Math.floor(cxs - rad)), x2 = Math.min(X0 + 15, Math.floor(cxs + rad));
    if (x1 > x2) continue;
    const z1 = Math.max(Z0, Math.floor(czs - rad)), z2 = Math.min(Z0 + 15, Math.floor(czs + rad));
    if (z1 > z2) continue;
    const y1 = Math.max(MIN_Y + 1, Math.floor(cys - rad)), y2 = Math.min(318, Math.floor(cys + rad));
    const inv = 1 / (rad * rad);
    for (let bx = x1; bx <= x2; bx++) {
      const dx = bx + 0.5 - cxs;
      const dx2 = dx * dx * inv;
      if (dx2 >= 1) continue;
      for (let bz = z1; bz <= z2; bz++) {
        const dz = bz + 0.5 - czs;
        const dxz = dx2 + dz * dz * inv;
        if (dxz >= 1) continue;
        const col = ((bz - Z0) << 4) | (bx - X0);
        for (let by = y1; by <= y2; by++) {
          const dy = by + 0.5 - cys;
          if (dxz + dy * dy * inv >= 1) continue;
          const idx = ((by - MIN_Y) << 8) | col;
          const cur = buf[idx];
          const t = TARGET[cur];
          if (!(t & mask)) continue;
          if (discard > 0 && exposed(buf, idx, bx - X0, by, bz - Z0) && hashf(bx, by, bz, v.salt) < discard) continue;
          if (isOre) buf[idx] = (t & T_DEEP) ? v.deep : v.ore;
          else buf[idx] = v.block;
        }
      }
    }
  }
}

// true if any in-chunk neighbour is air/fluid
function exposed(buf, idx, lx, y, lz) {
  if (lx > 0 && isOpen(buf[idx - 1])) return true;
  if (lx < 15 && isOpen(buf[idx + 1])) return true;
  if (lz > 0 && isOpen(buf[idx - 16])) return true;
  if (lz < 15 && isOpen(buf[idx + 16])) return true;
  if (y > MIN_Y && isOpen(buf[idx - 256])) return true;
  if (y < 318 && isOpen(buf[idx + 256])) return true;
  return false;
}
function isOpen(v) { return v === I.AIR || v === I.WATER || v === I.LAVA; }
