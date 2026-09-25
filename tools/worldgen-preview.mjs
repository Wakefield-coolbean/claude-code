// World generation preview: renders top-down maps, biome maps, cross-sections and an ore histogram.
//
//   node tools/worldgen-preview.mjs [seedA] [seedB] [chunks=32] [--center=origin|spawn] [--type=default] [--out=dir]
//
// For each seed it generates a chunks x chunks area (plus a 1-chunk ring so every inner chunk can
// receive features), applies all features through an in-memory getBlock/setBlock world, and writes:
//   <seed>_top.png      top-down map, coloured by top block, hill-shaded from the heightmap
//   <seed>_biomes.png   surface biome map (hill-shaded)
//   <seed>_xsec_N.png   vertical x-y slices (512 wide x 384 tall) showing caves, ores, aquifers
//   <seed>_large.png    1:8 overview (4096 blocks) of biomes/heights from the 2D climate only
//   <seed>_view.png     oblique 3D view (looking north) of the central (up to) 256x256 blocks
// and prints feature counts, sanity checks (water breaches, chunk seams, determinism) and ore / cave
// statistics per y band. --at=x,z centres the area on a block position; --center=spawn on the spawn.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writePNG } from './png.mjs';
import { WorldGenerator } from '../src/world/worldgen/generator.js';
import { BlockById } from '../src/registry/blocks.js';
import { BiomeById } from '../src/registry/biomes.js';
import { MIN_Y, MAX_Y, SEA_LEVEL } from '../src/constants.js';

const args = process.argv.slice(2);
const opt = (k, d) => { const a = args.find((s) => s.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const pos = args.filter((s) => !s.startsWith('--'));
const seeds = [Number(pos[0] ?? 3) | 0, Number(pos[1] ?? 42) | 0];
const N = Number(pos[2] ?? 32);
const CENTER = opt('center', 'origin');
const TYPE = opt('type', 'default');
const SCRATCH = '/tmp/claude-0/-home-user-claude-code/1054d6a7-65b9-540d-9b00-48ba961164e3/scratchpad';
const OUT = opt('out', (fs.existsSync(SCRATCH) ? path.join(SCRATCH, 'wg') : path.join(os.tmpdir(), 'worldgen-preview')) + '/');
fs.mkdirSync(OUT, { recursive: true });

// ---------------- colours ----------------
const C = {
  stone: [125, 125, 125], granite: [154, 106, 89], diorite: [188, 188, 188], andesite: [136, 136, 137], deepslate: [80, 80, 86],
  tuff: [108, 109, 102], calcite: [223, 224, 220], bedrock: [30, 30, 30], dirt: [134, 96, 67], coarse_dirt: [119, 85, 59],
  podzol: [91, 63, 24], grass_block: [95, 159, 53], sand: [219, 207, 163], red_sand: [190, 102, 33], sandstone: [216, 203, 155],
  gravel: [131, 127, 126], clay: [160, 166, 179], terracotta: [152, 94, 67], water: [44, 88, 230], lava: [255, 110, 10],
  ice: [145, 183, 253], packed_ice: [141, 180, 250], snow: [249, 254, 254], snow_block: [240, 250, 250],
  oak_log: [109, 85, 50], spruce_log: [58, 37, 16], birch_log: [216, 215, 210], jungle_log: [85, 67, 25], acacia_log: [103, 96, 86], dark_oak_log: [60, 46, 26],
  oak_leaves: [48, 110, 30], spruce_leaves: [40, 80, 50], birch_leaves: [90, 130, 60], jungle_leaves: [40, 130, 20], acacia_leaves: [80, 110, 25], dark_oak_leaves: [30, 80, 20],
  coal_ore: [20, 20, 20], deepslate_coal_ore: [20, 20, 20], iron_ore: [216, 175, 147], deepslate_iron_ore: [216, 175, 147],
  copper_ore: [226, 120, 70], deepslate_copper_ore: [226, 120, 70], gold_ore: [252, 238, 75], deepslate_gold_ore: [252, 238, 75],
  redstone_ore: [255, 0, 0], deepslate_redstone_ore: [255, 0, 0], lapis_ore: [30, 60, 220], deepslate_lapis_ore: [30, 60, 220],
  diamond_ore: [80, 255, 240], deepslate_diamond_ore: [80, 255, 240], emerald_ore: [20, 230, 80], deepslate_emerald_ore: [20, 230, 80],
  mossy_cobblestone: [90, 120, 80], cobblestone: [110, 110, 110], spawner: [255, 0, 255], chest: [160, 110, 40],
  dripstone_block: [134, 107, 92], moss_block: [89, 109, 45], obsidian: [20, 10, 30],
  grass: [80, 150, 50], fern: [70, 130, 50], dead_bush: [140, 100, 40], cactus: [80, 125, 40], sugar_cane: [140, 190, 100],
  pumpkin: [227, 140, 30], melon: [110, 150, 30], seagrass: [40, 110, 60], lily_pad: [30, 110, 40], sweet_berry_bush: [60, 90, 50],
  brown_mushroom: [150, 110, 80], red_mushroom: [200, 40, 40],
};
const FLOWER = [230, 60, 160];
const colorOf = new Array(BlockById.length);
for (const b of BlockById) {
  colorOf[b.id] = C[b.name] ?? (b.flower ? FLOWER : [255, 0, 255]);
}
const BIOME_COL = {
  plains: [141, 179, 96], sunflower_plains: [181, 219, 136], forest: [5, 102, 33], flower_forest: [45, 162, 73],
  birch_forest: [48, 146, 88], dark_forest: [44, 61, 16], taiga: [11, 102, 89], snowy_taiga: [49, 85, 74],
  snowy_plains: [240, 250, 255], desert: [250, 148, 24], savanna: [189, 178, 95], jungle: [83, 153, 9],
  swamp: [7, 219, 158], beach: [250, 222, 85], snowy_beach: [250, 240, 192], stony_shore: [162, 162, 132],
  river: [0, 0, 255], frozen_river: [160, 160, 255], ocean: [0, 0, 112], deep_ocean: [0, 0, 48],
  warm_ocean: [0, 60, 172], lukewarm_ocean: [0, 30, 144], cold_ocean: [32, 32, 112], frozen_ocean: [112, 112, 214],
  windswept_hills: [96, 116, 96], meadow: [126, 204, 106], grove: [180, 210, 190], snowy_slopes: [200, 220, 240],
  jagged_peaks: [230, 230, 255], frozen_peaks: [170, 200, 255], stony_peaks: [140, 140, 140], badlands: [217, 69, 21],
  mushroom_fields: [255, 0, 255],
};
const hex = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
const mul = (c, t) => [c[0] * t[0] / 255, c[1] * t[1] / 255, c[2] * t[2] / 255];
const GRAY_GRASS = [200, 200, 200];

// ---------------- in-memory world ----------------
class World {
  constructor() { this.chunks = new Map(); }
  key(cx, cz) { return cx + ',' + cz; }
  get(cx, cz) { return this.chunks.get(this.key(cx, cz)); }
  getBlock(x, y, z) {
    if (y < MIN_Y || y >= MAX_Y) return 0;
    const c = this.get(x >> 4, z >> 4);
    if (!c) return 0;
    const s = c.sections[(y - MIN_Y) >> 4];
    return s ? s[((y - MIN_Y) & 15) * 256 + (z & 15) * 16 + (x & 15)] : 0;
  }
  setBlock(x, y, z, v) {
    if (y < MIN_Y || y >= MAX_Y) return;
    const c = this.get(x >> 4, z >> 4);
    if (!c) { this.lost = (this.lost ?? 0) + 1; return; }
    const si = (y - MIN_Y) >> 4;
    let s = c.sections[si];
    if (!s) { if (!v) return; s = c.sections[si] = new Uint16Array(4096); }
    s[((y - MIN_Y) & 15) * 256 + (z & 15) * 16 + (x & 15)] = v;
  }
  top(x, z) { // highest non-air y
    const c = this.get(x >> 4, z >> 4);
    for (let si = c.sections.length - 1; si >= 0; si--) {
      const s = c.sections[si];
      if (!s) continue;
      for (let ly = 15; ly >= 0; ly--) {
        const v = s[ly * 256 + (z & 15) * 16 + (x & 15)];
        if (v) return MIN_Y + si * 16 + ly;
      }
    }
    return MIN_Y - 1;
  }
}

function runSeed(seed) {
  const gen = new WorldGenerator(seed, { type: TYPE });
  const spawn = gen.getSpawnPoint();
  let ccx = CENTER === 'spawn' ? spawn.x >> 4 : 0, ccz = CENTER === 'spawn' ? spawn.z >> 4 : 0;
  const AT = opt('at', null);
  if (AT) { const [ax, az] = AT.split(',').map(Number); ccx = ax >> 4; ccz = az >> 4; }
  const cx0 = ccx - N / 2, cz0 = ccz - N / 2;
  const world = new World();
  let t = performance.now();
  let tMax = 0;
  for (let cz = cz0 - 1; cz <= cz0 + N; cz++) {
    for (let cx = cx0 - 1; cx <= cx0 + N; cx++) {
      const t1 = performance.now();
      world.chunks.set(world.key(cx, cz), gen.generateColumn(cx, cz));
      tMax = Math.max(tMax, performance.now() - t1);
    }
  }
  const gTime = (performance.now() - t) / ((N + 2) * (N + 2));
  t = performance.now();
  const fstat = {};
  for (let cz = cz0; cz < cz0 + N; cz++) {
    for (let cx = cx0; cx < cx0 + N; cx++) {
      for (const f of world.get(cx, cz).features) {
        const k = f.type === 'tree' ? f.kind : f.type + (f.fluid ? '_' + f.fluid : '');
        const ok = gen.placeFeature(world, f);
        fstat[k] = fstat[k] ?? [0, 0];
        fstat[k][0]++; if (ok) fstat[k][1]++;
      }
    }
  }
  const fTime = performance.now() - t;
  console.log(`\n=== seed ${seed} (${TYPE}) center chunk ${ccx},${ccz}  spawn ${JSON.stringify(spawn)} ===`);
  console.log(`generate avg ${gTime.toFixed(2)} ms/column (max ${tMax.toFixed(1)}), features ${fTime.toFixed(0)} ms total, lost writes ${world.lost ?? 0}`);
  console.log('features (attempted/placed): ' + Object.entries(fstat).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', '));

  const W = N * 16, X0 = cx0 * 16, Z0 = cz0 * 16;
  // ---------- top-down + biome maps ----------
  const hm = new Int16Array(W * W);
  const topV = new Uint16Array(W * W);
  const waterDepth = new Int16Array(W * W);
  const biomeArr = new Uint8Array(W * W);
  const bcount = {};
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const wx = X0 + x, wz = Z0 + z;
      let y = world.top(wx, wz);
      let v = world.getBlock(wx, y, wz);
      let depth = 0;
      if ((v & 0xfff) === WATER_ID) {
        let yy = y;
        while (yy > MIN_Y && (world.getBlock(wx, yy, wz) & 0xfff) === WATER_ID) yy--;
        depth = y - yy;
      }
      hm[z * W + x] = y; topV[z * W + x] = v; waterDepth[z * W + x] = depth;
      const c = world.get(wx >> 4, wz >> 4);
      const b = c.biomes[(wz & 15) * 16 + (wx & 15)];
      biomeArr[z * W + x] = b;
      const bn = BiomeById[b].name; bcount[bn] = (bcount[bn] ?? 0) + 1;
    }
  }
  const top = new Uint8ClampedArray(W * W * 4), bio = new Uint8ClampedArray(W * W * 4);
  for (let z = 0; z < W; z++) {
    for (let x = 0; x < W; x++) {
      const i = z * W + x;
      const h = hm[i];
      const hl = hm[z * W + Math.max(0, x - 1)], hu = hm[Math.max(0, z - 1) * W + x];
      const hr = hm[z * W + Math.min(W - 1, x + 1)], hd = hm[Math.min(W - 1, z + 1) * W + x];
      let shade = 1 + ((hl - hr) + (hu - hd)) * 0.07;
      shade = Math.max(0.5, Math.min(1.45, shade));
      const v = topV[i] & 0xfff;
      const bdef = BiomeById[biomeArr[i]];
      const name = BlockById[v].name;
      let c = colorOf[v];
      if (name === 'grass_block' || name === 'grass' || name === 'fern' || name === 'sugar_cane') c = mul(GRAY_GRASS, hex(bdef.grass));
      else if (name === 'oak_leaves' || name === 'jungle_leaves' || name === 'acacia_leaves' || name === 'dark_oak_leaves') c = mul([150, 150, 150], hex(bdef.foliage));
      else if (name === 'birch_leaves') c = [110, 140, 80];
      else if (name === 'spruce_leaves') c = [55, 90, 60];
      if (v === WATER_ID) {
        const d = Math.min(1, waterDepth[i] / 24);
        const wc = hex(bdef.water);
        c = [wc[0] * (1 - d * 0.7), wc[1] * (1 - d * 0.7), wc[2] * (1 - d * 0.45)];
        shade = 1;
      }
      top[i * 4] = c[0] * shade; top[i * 4 + 1] = c[1] * shade; top[i * 4 + 2] = c[2] * shade; top[i * 4 + 3] = 255;
      const bc = BIOME_COL[bdef.name] ?? [255, 0, 255];
      const s2 = 0.75 + (shade - 1) * 0.6 + 0.25;
      bio[i * 4] = bc[0] * s2; bio[i * 4 + 1] = bc[1] * s2; bio[i * 4 + 2] = bc[2] * s2; bio[i * 4 + 3] = 255;
    }
  }
  // chunk grid ticks + spawn marker on the biome map
  const sx = spawn.x - X0, sz = spawn.z - Z0;
  for (let d = -4; d <= 4; d++) {
    for (const [px, pz] of [[sx + d, sz], [sx, sz + d]]) {
      if (px >= 0 && px < W && pz >= 0 && pz < W) { const i = (pz * W + px) * 4; top[i] = 255; top[i + 1] = 0; top[i + 2] = 0; bio[i] = 255; bio[i + 1] = 0; bio[i + 2] = 0; }
    }
  }
  writePNG(`${OUT}${seed}_top.png`, W, W, top);
  writePNG(`${OUT}${seed}_biomes.png`, W, W, bio);
  const tot = W * W;
  console.log('biomes: ' + Object.entries(bcount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / tot * 100).toFixed(1)}%`).join(', '));
  let hs = [...hm].sort((a, b) => a - b);
  console.log('surface y percentiles 1/10/50/90/99/max: ' + [0.01, 0.1, 0.5, 0.9, 0.99].map((p) => hs[Math.floor(p * hs.length)]).join(' ') + ' ' + hs[hs.length - 1]);

  // ---------- cross-sections ----------
  const H = MAX_Y - MIN_Y;
  const rows = [Math.floor(W * 0.5), Math.floor(W * 0.22), Math.floor(W * 0.78)];
  rows.forEach((row, n) => {
    const img = new Uint8ClampedArray(W * H * 4);
    const wz = Z0 + row;
    for (let x = 0; x < W; x++) {
      const wx = X0 + x;
      let sky = true;
      for (let y = MAX_Y - 1; y >= MIN_Y; y--) {
        const v = world.getBlock(wx, y, wz) & 0xfff;
        let c;
        if (v === 0) c = sky ? [170, 205, 255] : [12, 10, 16];
        else {
          c = colorOf[v];
          if (BlockById[v].opaque || v === WATER_ID || v === LAVA_ID) sky = false;
        }
        const i = ((MAX_Y - 1 - y) * W + x) * 4;
        img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
      }
    }
    // y markers every 64 blocks (left edge) and sea level tick
    for (let y = MIN_Y; y < MAX_Y; y += 64) for (let x = 0; x < 6; x++) { const i = ((MAX_Y - 1 - y) * W + x) * 4; img[i] = 255; img[i + 1] = 255; img[i + 2] = 0; }
    for (let x = 0; x < 10; x++) { const i = ((MAX_Y - 1 - SEA_LEVEL) * W + x) * 4; img[i] = 0; img[i + 1] = 255; img[i + 2] = 255; }
    writePNG(`${OUT}${seed}_xsec_${n}.png`, W, H, img);
  });

  // ---------- sanity checks ----------
  {
    // (a) water directly above cave/open air, or water beside air below sea level (would flow)
    let waterOverAir = 0, waterBesideAir = 0;
    // (b) seams: mean |dh| across chunk borders vs inside chunks
    let seam = 0, seamN = 0, inner = 0, innerN = 0;
    for (let z = 1; z < W - 1; z++) for (let x = 1; x < W - 1; x++) {
      const d = Math.abs(hm[z * W + x] - hm[z * W + x - 1]);
      if (((X0 + x) & 15) === 0) { seam += d; seamN++; } else { inner += d; innerN++; }
    }
    for (let cz = cz0; cz < cz0 + N; cz++) for (let cx = cx0; cx < cx0 + N; cx++) {
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx, z = cz * 16 + lz;
        for (let y = MIN_Y + 1; y <= SEA_LEVEL; y++) {
          if ((world.getBlock(x, y, z) & 0xfff) !== WATER_ID) continue;
          if (world.getBlock(x, y - 1, z) === 0) waterOverAir++;
          if (world.getBlock(x + 1, y, z) === 0 || world.getBlock(x - 1, y, z) === 0 ||
            world.getBlock(x, y, z + 1) === 0 || world.getBlock(x, y, z - 1) === 0) waterBesideAir++;
        }
      }
    }
    console.log(`checks: water-over-air ${waterOverAir}, water-beside-air (y<=63) ${waterBesideAir} (whole area); ` +
      `mean |dh| across chunk borders ${(seam / seamN).toFixed(2)} vs inside ${(inner / innerN).toFixed(2)}`);
    // (c) determinism: regenerate a few chunks in a different order with a fresh generator
    const g2 = new WorldGenerator(seed, { type: TYPE });
    let diff = 0;
    for (const [dx, dz] of [[5, 7], [0, 0], [N - 1, 3], [2, N - 1]]) {
      const a = world.get(cx0 + dx, cz0 + dz), b = g2.generateColumn(cx0 + dx, cz0 + dz);
      const a0 = gen.generateColumn(cx0 + dx, cz0 + dz);
      for (let si = 0; si < a0.sections.length; si++) {
        const s1 = a0.sections[si], s2 = b.sections[si];
        if (!s1 !== !s2) { diff++; continue; }
        if (s1) for (let i = 0; i < 4096; i++) if (s1[i] !== s2[i]) { diff++; break; }
      }
      if (JSON.stringify(a0.features) !== JSON.stringify(b.features)) diff++;
    }
    console.log(`checks: determinism across generators/order: ${diff === 0 ? 'OK' : diff + ' differing sections'}`);
  }

  // ---------- ore / cave histogram ----------
  const ORES = ['coal', 'iron', 'copper', 'gold', 'redstone', 'lapis', 'diamond', 'emerald'];
  const oreIdx = new Int8Array(BlockById.length).fill(-1);
  for (const b of BlockById) {
    const m = b.name.replace('deepslate_', '').replace('_ore', '');
    if (b.name.endsWith('_ore')) oreIdx[b.id] = ORES.indexOf(m);
  }
  const BAND = 16, NB = H / BAND;
  const counts = ORES.map(() => new Float64Array(NB));
  const cave = new Float64Array(NB), wat = new Float64Array(NB), lav = new Float64Array(NB), solid = new Float64Array(NB);
  const other = {};
  const OTHER = new Set(['granite', 'diorite', 'andesite', 'tuff', 'gravel', 'dirt', 'dripstone_block', 'moss_block', 'deepslate',
    'sugar_cane', 'cactus', 'lily_pad', 'pumpkin', 'melon', 'sweet_berry_bush', 'seagrass', 'dead_bush', 'grass', 'fern', 'snow',
    'ice', 'packed_ice', 'brown_mushroom', 'red_mushroom', 'spawner', 'chest', 'mossy_cobblestone', 'clay', 'podzol', 'coarse_dirt',
    'calcite', 'terracotta', 'red_sand', 'snow_block', 'obsidian', 'dandelion', 'poppy', 'cornflower', 'blue_orchid', 'lily_of_the_valley']);
  for (let cz = cz0; cz < cz0 + N; cz++) for (let cx = cx0; cx < cx0 + N; cx++) {
    const c = world.get(cx, cz);
    for (let col = 0; col < 256; col++) {
      const topY = c.heightmap[col];
      const tz = cz * 16 + (col >> 4), tx = cx * 16 + (col & 15);
      for (let y = topY + 1; y < Math.min(MAX_Y, topY + 40); y++) {
        const v = world.getBlock(tx, y, tz) & 0xfff;
        if (!v) continue;
        const nm = BlockById[v].name;
        if (OTHER.has(nm)) other[nm] = (other[nm] ?? 0) + 1;
      }
      for (let y = MIN_Y; y <= topY; y++) {
        const s = c.sections[(y - MIN_Y) >> 4];
        const v = s ? s[((y - MIN_Y) & 15) * 256 + col] & 0xfff : 0;
        const band = ((y - MIN_Y) / BAND) | 0;
        const oi = oreIdx[v];
        if (oi >= 0) counts[oi][band]++;
        if (v === 0) cave[band]++;
        else if (v === WATER_ID && y < SEA_LEVEL - 12) wat[band]++;
        else if (v === LAVA_ID) lav[band]++;
        else solid[band]++;
        const nm = BlockById[v].name;
        if (OTHER.has(nm)) other[nm] = (other[nm] ?? 0) + 1;
      }
    }
  }
  const chunks = N * N;
  console.log(`ore blocks per chunk by y band (${BAND} tall), plus air-below-surface % (caves), deep water, lava:`);
  console.log('   y from  ' + ORES.map((o) => o.padStart(8)).join('') + '   cave%  water  lava');
  for (let b = NB - 1; b >= 0; b--) {
    const y = MIN_Y + b * BAND;
    const total = cave[b] + wat[b] + lav[b] + solid[b];
    if (total === 0) continue;
    console.log(String(y).padStart(9) + '  ' + ORES.map((o, i) => (counts[i][b] / chunks).toFixed(2).padStart(8)).join('') +
      '  ' + (cave[b] / total * 100).toFixed(1).padStart(6) + (wat[b] / chunks).toFixed(1).padStart(7) + (lav[b] / chunks).toFixed(1).padStart(6));
  }
  console.log('   total  ' + ORES.map((o, i) => (counts[i].reduce((a, b) => a + b, 0) / chunks).toFixed(1).padStart(8)).join(''));
  console.log('other blocks per chunk: ' + Object.entries(other).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(v / chunks).toFixed(v / chunks < 10 ? 2 : 0)}`).join(', '));

  // ---------- oblique 3D view ----------
  {
    const VW = Math.min(256, W), x0 = X0 + (W - VW) / 2, z0 = Z0 + (W - VW) / 2;
    const SX = Math.max(3, Math.floor(768 / VW)), TILT = 0.5, VS = 0.87, yRef = 300;
    const IW = VW * SX, IH = Math.ceil((VW * TILT + (yRef + 64) * VS) * SX) + 20;
    const img = new Uint8ClampedArray(IW * IH * 4);
    for (let i = 0; i < IW * IH; i++) { img[i * 4] = 150; img[i * 4 + 1] = 190; img[i * 4 + 2] = 240; img[i * 4 + 3] = 255; }
    const put = (px, py, c, f, hgt) => {
      for (let dy = 0; dy < hgt; dy++) for (let dx = 0; dx < SX; dx++) {
        const X = px + dx, Y = py + dy;
        if (X < 0 || Y < 0 || X >= IW || Y >= IH) continue;
        const i = (Y * IW + X) * 4; img[i] = c[0] * f; img[i + 1] = c[1] * f; img[i + 2] = c[2] * f;
      }
    };
    const solidTop = (x, z) => { // highest opaque block
      for (let y = world.top(x, z); y > MIN_Y; y--) { const v = world.getBlock(x, y, z) & 0xfff; if (v && (BlockById[v].opaque || v === WATER_ID)) return y; }
      return MIN_Y;
    };
    const DIRT = colorOf[BlockById.findIndex((b) => b.name === 'dirt')];
    let minPy = IH, maxPy = 0;
    for (let z = z0; z < z0 + VW; z++) {
      for (let x = x0; x < x0 + VW; x++) {
        const c0 = world.get(x >> 4, z >> 4);
        const ht = world.top(x, z);
        const bdef = BiomeById[c0.biomes[(z & 15) * 16 + (x & 15)]];
        const front = z === z0 + VW - 1;
        const southTop = front ? 30 : solidTop(x, z + 1);
        for (let y = Math.max(MIN_Y, Math.min(ht - 2, southTop) - 1); y <= ht; y++) {
          const v = world.getBlock(x, y, z) & 0xfff;
          if (v === 0) continue;
          const up = world.getBlock(x, y + 1, z) & 0xfff, south = world.getBlock(x, y, z + 1) & 0xfff;
          const upOpen = up === 0 || !BlockById[up].opaque;
          const sOpen = front || ((south === 0 || !BlockById[south].opaque) && y > southTop - 1);
          if (!upOpen && !sOpen) continue;
          if (v === WATER_ID && up === WATER_ID) continue;
          const name = BlockById[v].name;
          let c = colorOf[v];
          if (name === 'grass_block' || name === 'grass' || name === 'fern') c = mul(GRAY_GRASS, hex(bdef.grass));
          else if (name.endsWith('_leaves') && name !== 'birch_leaves' && name !== 'spruce_leaves') c = mul([150, 150, 150], hex(bdef.foliage));
          if (v === WATER_ID) c = hex(bdef.water);
          const px = (x - x0) * SX, py = Math.round(((z - z0) * TILT + (yRef - y) * VS) * SX) + 10;
          if (upOpen) put(px, py, c, 1, Math.ceil(TILT * SX));
          if (sOpen) put(px, py + Math.ceil(TILT * SX) - 1, name === 'grass_block' ? DIRT : c, 0.66, Math.ceil(VS * SX) + 1);
          if (py < minPy) minPy = py;
          if (py > maxPy) maxPy = py;
        }
      }
    }
    const top0 = Math.max(0, minPy - 20), bot = Math.min(IH, maxPy + 30);
    writePNG(`${OUT}${seed}_view.png`, IW, bot - top0, img.subarray(top0 * IW * 4, bot * IW * 4));
  }

  // ---------- large-scale overview (2D climate only) ----------
  const L = 512, S = 8;
  const big = new Uint8ClampedArray(L * L * 4);
  const bh = new Float32Array(L * L);
  const bb = new Uint8Array(L * L);
  const ox = spawn.x - (L * S) / 2, oz = spawn.z - (L * S) / 2;
  for (let j = 0; j < L; j++) for (let i = 0; i < L; i++) {
    bh[j * L + i] = gen.getHeightEstimate(ox + i * S, oz + j * S);
    bb[j * L + i] = gen.getBiomeAt(ox + i * S, oz + j * S);
  }
  for (let j = 0; j < L; j++) for (let i = 0; i < L; i++) {
    const k = j * L + i;
    const hl = bh[Math.max(0, j - 1) * L + Math.max(0, i - 1)];
    const shade = Math.max(0.55, Math.min(1.4, 1 + (hl - bh[k]) * 0.05));
    const c = BIOME_COL[BiomeById[bb[k]].name] ?? [255, 0, 255];
    big[k * 4] = c[0] * shade; big[k * 4 + 1] = c[1] * shade; big[k * 4 + 2] = c[2] * shade; big[k * 4 + 3] = 255;
  }
  // outline of the detailed area
  for (let q = 0; q < (N * 16) / S; q++) {
    for (const [pi, pj] of [[(X0 - ox) / S + q, (Z0 - oz) / S], [(X0 - ox) / S + q, (Z0 - oz) / S + (N * 16) / S], [(X0 - ox) / S, (Z0 - oz) / S + q], [(X0 - ox) / S + (N * 16) / S, (Z0 - oz) / S + q]]) {
      const ii = Math.floor(pi), jj = Math.floor(pj);
      if (ii >= 0 && ii < L && jj >= 0 && jj < L) { const k = (jj * L + ii) * 4; big[k] = 255; big[k + 1] = 0; big[k + 2] = 0; }
    }
  }
  writePNG(`${OUT}${seed}_large.png`, L, L, big);
}

const WATER_ID = BlockById.findIndex((b) => b.name === 'water');
const LAVA_ID = BlockById.findIndex((b) => b.name === 'lava');
for (const s of seeds) runSeed(s);
console.log(`\nimages written to ${OUT}`);
