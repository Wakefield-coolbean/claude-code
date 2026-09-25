// Generates every block texture, validates coverage/sizes, times generation and writes
// contact sheets for visual review.
//   node tools/preview-block-textures.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { collectBlockTextureNames } from '../src/registry/blocks.js';
import { generateBlockTextures, lastFallbacks } from '../src/textures/blockTextures.js';
import { contactSheet, writePNG } from './png.mjs';

const OUT = process.argv[2] ?? '/tmp/claude-0/-home-user-claude-code/1054d6a7-65b9-540d-9b00-48ba961164e3/scratchpad/tex';
fs.mkdirSync(OUT, { recursive: true });

const names = collectBlockTextureNames();

// warm-up-free timing of a full, cold generation
const t0 = performance.now();
const tex = generateBlockTextures();
const ms = performance.now() - t0;

// ---------- validation ----------
const errors = [];
const expectFrames = {
  water_still: 32, water_flow: 32, lava_still: 20, lava_flow: 16, fire_0: 16, fire_1: 16,
  nether_portal: 32, soul_fire_0: 16, magma_block: 3,
};
for (const n of names) {
  const frames = tex.get(n);
  if (!frames) { errors.push(`missing: ${n}`); continue; }
  if (!Array.isArray(frames) || frames.length === 0) { errors.push(`no frames: ${n}`); continue; }
  frames.forEach((f, i) => {
    if (!(f instanceof Uint8ClampedArray) || f.length !== 16 * 16 * 4) errors.push(`bad frame ${n}[${i}] (${f?.length})`);
  });
  if (expectFrames[n] && frames.length !== expectFrames[n]) errors.push(`${n}: expected ${expectFrames[n]} frames, got ${frames.length}`);
  if (!expectFrames[n] && frames.length !== 1) errors.push(`${n}: static texture has ${frames.length} frames`);
}
if (lastFallbacks.length) errors.push(`fallback textures used for: ${lastFallbacks.join(', ')}`);

// cutout textures must only use alpha 0/255
const CUTOUT = [
  /_sapling$/, /^(dandelion|poppy|blue_orchid|allium|azure_bluet|red_tulip|orange_tulip|white_tulip|pink_tulip|oxeye_daisy|cornflower|lily_of_the_valley)$/,
  /_mushroom$/, /^(grass|fern|dead_bush|sugar_cane|seagrass|cobweb|torch|ladder|oak_door_top|oak_door_bottom|oak_trapdoor|glass|glass_pane_top|spawner|lily_pad)$/,
  /^sweet_berry_bush_stage/, /^wheat_stage/, /^carrots_stage/, /^potatoes_stage/, /^fire_/, /_leaves$/, /^destroy_stage_/,
  /^grass_block_side_overlay$/, /^(crimson|warped)_(fungus|roots)$/, /^nether_wart_stage/, /^lantern$/, /^soul_fire_/,
];
for (const n of names) {
  if (!CUTOUT.some((r) => r.test(n))) continue;
  for (const f of tex.get(n)) {
    for (let i = 3; i < f.length; i += 4) if (f[i] !== 0 && f[i] !== 255) { errors.push(`${n}: semi-transparent pixel in cutout texture`); break; }
  }
}
// grayscale (tinted) textures
const GRAYSCALE = ['grass_block_top', 'grass_block_side_overlay', 'grass', 'fern', 'sugar_cane', 'water_still', 'water_flow', 'lily_pad', ...names.filter((n) => n.endsWith('_leaves'))];
for (const n of GRAYSCALE) {
  for (const f of tex.get(n)) {
    for (let i = 0; i < f.length; i += 4) if (f[i + 3] && (f[i] !== f[i + 1] || f[i] !== f[i + 2])) { errors.push(`${n}: not grayscale`); break; }
  }
}
// opaque solid textures (spot check)
for (const n of ['stone', 'dirt', 'cobblestone', 'oak_planks', 'packed_ice', 'lava_still', 'lava_flow', 'deepslate', 'netherrack',
  'crimson_nylium_side', 'warped_nylium_side', 'magma_block', 'soul_sand', 'crying_obsidian', 'enchanting_table_top', 'anvil', 'anvil_top']) {
  for (const f of tex.get(n)) for (let i = 3; i < f.length; i += 4) if (f[i] !== 255) { errors.push(`${n}: not opaque`); break; }
}

// nether portal: semi-transparent (alpha ~170-220)
for (const f of tex.get('nether_portal') ?? []) {
  for (let i = 3; i < f.length; i += 4) if (f[i] < 165 || f[i] > 225) { errors.push(`nether_portal: alpha ${f[i]} out of range`); break; }
}
// lantern: only the documented atlas regions may be opaque
{
  const regions = [[0, 2, 6, 7], [0, 9, 6, 6], [1, 0, 4, 2], [11, 1, 3, 4]];
  const f = tex.get('lantern')[0];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const inside = regions.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);
    if (!inside && f[(y * 16 + x) * 4 + 3]) { errors.push(`lantern: opaque pixel outside atlas regions at ${x},${y}`); break; }
  }
}

console.log(`generated ${tex.size} textures (${names.length} required by the registry) in ${ms.toFixed(1)} ms`);
if (ms > 300) console.warn(`WARNING: generation took ${ms.toFixed(1)} ms (> 300 ms target)`);
if (errors.length) {
  console.error('VALIDATION FAILED:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else console.log('validation OK: all names present, correct frame sizes, zero fallbacks');

// ---------- contact sheets ----------
const TINT = {
  grass_block_top: 0x91bd59, grass_block_side_overlay: 0x91bd59, grass: 0x91bd59, fern: 0x91bd59, sugar_cane: 0x91bd59,
  oak_leaves: 0x77ab2f, jungle_leaves: 0x77ab2f, acacia_leaves: 0x77ab2f, dark_oak_leaves: 0x77ab2f,
  spruce_leaves: 0x619961, birch_leaves: 0x80a755, water_still: 0x3f76e4, water_flow: 0x3f76e4, lily_pad: 0x208030,
};
function tinted(data, tint) {
  if (tint == null) return data;
  const r = (tint >> 16) & 255, g = (tint >> 8) & 255, b = tint & 255;
  const out = new Uint8ClampedArray(data);
  for (let i = 0; i < out.length; i += 4) { out[i] = out[i] * r / 255; out[i + 1] = out[i + 1] * g / 255; out[i + 2] = out[i + 2] * b / 255; }
  return out;
}
const img = (data, w = 16, h = 16) => ({ w, h, data });
const save = (file, sheet) => { writePNG(path.join(OUT, file), sheet.w, sheet.h, sheet.data); };

// 1. all first frames (raw, as stored) at 4x
save('all_raw.png', contactSheet(names.map((n) => img(tex.get(n)[0])), { cols: 16, scale: 4 }));
// 2. all first frames tinted, split in chunks at 8x for detailed review
const CHUNK = 40;
const index = [];
for (let i = 0; i < names.length; i += CHUNK) {
  const part = names.slice(i, i + CHUNK);
  const file = `review_${String(i / CHUNK).padStart(2, '0')}.png`;
  save(file, contactSheet(part.map((n) => img(tinted(tex.get(n)[0], TINT[n]))), { cols: 8, scale: 8, pad: 4 }));
  index.push(`${file}: ${part.map((n, j) => `${j}:${n}`).join(' ')}`);
}
fs.writeFileSync(path.join(OUT, 'index.txt'), index.join('\n') + '\n');

// 3. seamless tiling check: 3x3 repetitions of key terrain textures
function tile3(data, tint, under = null) {
  const out = new Uint8ClampedArray(48 * 48 * 4);
  const src = tinted(data, tint);
  const base = under ? under : null;
  for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
    const si = ((y % 16) * 16 + (x % 16)) * 4, di = (y * 48 + x) * 4;
    let r = src[si], g = src[si + 1], b = src[si + 2], a = src[si + 3] / 255;
    if (base) { r = r * a + base[si] * (1 - a); g = g * a + base[si + 1] * (1 - a); b = b * a + base[si + 2] * (1 - a); a = 1; }
    out[di] = r; out[di + 1] = g; out[di + 2] = b; out[di + 3] = a * 255;
  }
  return img(out, 48, 48);
}
const T = (n) => tex.get(n)[0];
const tiles = [
  tile3(T('grass_block_top'), 0x91bd59),
  tile3(T('grass_block_side_overlay'), 0x91bd59, T('dirt')),
  tile3(T('dirt')), tile3(T('stone')), tile3(T('cobblestone')), tile3(T('oak_planks')),
  tile3(T('sand')), tile3(T('gravel')), tile3(T('oak_leaves'), 0x77ab2f), tile3(T('water_still'), 0x3f76e4),
  tile3(T('water_flow'), 0x3f76e4), tile3(T('lava_still')), tile3(T('deepslate')), tile3(T('bricks')),
  tile3(T('stone_bricks')), tile3(T('oak_log')), tile3(T('spruce_planks')), tile3(T('birch_log')),
  tile3(T('snow')), tile3(T('grass_block_snow')), tile3(T('white_wool')), tile3(T('red_wool')),
  tile3(T('sandstone')), tile3(T('bedrock')),
  tile3(T('netherrack')), tile3(T('nether_bricks')), tile3(T('crimson_nylium')), tile3(T('warped_nylium')),
  tile3(T('soul_sand')), tile3(T('nether_portal')), tile3(T('basalt_side')), tile3(T('blackstone')),
  tile3(T('crimson_planks')), tile3(T('warped_stem')), tile3(T('magma_block')), tile3(T('quartz_block_side')),
];
save('tiling.png', contactSheet(tiles, { cols: 6, scale: 4, pad: 6 }));

// 4. animation strips
for (const n of ['water_still', 'water_flow', 'lava_still', 'lava_flow', 'fire_0', 'fire_1', 'nether_portal', 'soul_fire_0', 'magma_block']) {
  const frames = tex.get(n).map((f) => img(tinted(f, TINT[n])));
  save(`anim_${n}.png`, contactSheet(frames, { cols: 16, scale: 5, pad: 2 }));
}
// 5. destroy stages over stone
{
  const stone = T('stone');
  const imgs = [];
  for (let s = 0; s < 10; s++) {
    const d = T(`destroy_stage_${s}`);
    const out = new Uint8ClampedArray(stone);
    for (let i = 0; i < out.length; i += 4) if (d[i + 3]) { out[i] = d[i]; out[i + 1] = d[i + 1]; out[i + 2] = d[i + 2]; }
    imgs.push(img(out));
  }
  save('destroy.png', contactSheet(imgs, { cols: 10, scale: 6, pad: 4 }));
}
console.log(`wrote sheets to ${OUT}`);
