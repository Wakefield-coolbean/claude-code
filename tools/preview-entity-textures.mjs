#!/usr/bin/env node
// Generates all entity / particle / environment textures, validates names & sizes, times the
// generation, writes PNG previews and renders every mob with a tiny software box renderer so
// UV-layout mistakes are visible (assembled heads, bodies and limbs in 3/4 views).
//
//   node tools/preview-entity-textures.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { generateEntityTextures } from '../src/textures/entityTextures.js';
import { generateParticleTextures } from '../src/textures/particleTextures.js';
import { generateEnvironmentTextures } from '../src/textures/environmentTextures.js';
import { contactSheet, writePNG } from './png.mjs';

const OUT = process.argv[2]
  ?? '/tmp/claude-0/-home-user-claude-code/1054d6a7-65b9-540d-9b00-48ba961164e3/scratchpad/ent';
fs.mkdirSync(OUT, { recursive: true });

// ------------------------------------------------------------------------------------------
// Generate + validate
// ------------------------------------------------------------------------------------------
const fail = (msg) => { console.error('FAIL: ' + msg); process.exitCode = 1; throw new Error(msg); };

function timed(label, fn) {
  const t0 = performance.now();
  const r = fn();
  const t1 = performance.now();
  console.log(`${label}: ${r.size} textures in ${(t1 - t0).toFixed(1)} ms`);
  return r;
}
const entity = timed('entity', generateEntityTextures);
const particle = timed('particle', generateParticleTextures);
const env = timed('environment', generateEnvironmentTextures);

const MATS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'];
const EXPECT_ENTITY = {
  player: [64, 64], zombie: [64, 64], skeleton: [64, 32], creeper: [64, 32], spider: [64, 32],
  pig: [64, 64], cow: [64, 64], sheep: [64, 64], sheep_fur: [64, 64], chicken: [64, 32],
  enderman: [64, 32], shield: [64, 64],
};
for (const m of MATS) { EXPECT_ENTITY[`armor_${m}_1`] = [64, 32]; EXPECT_ENTITY[`armor_${m}_2`] = [64, 32]; }

const EXPECT_PARTICLE = {};
for (let i = 0; i < 8; i++) EXPECT_PARTICLE[`generic_${i}`] = [8, 8];
for (let i = 0; i < 16; i++) EXPECT_PARTICLE[`explosion_${i}`] = [16, 16];
for (const n of ['crit', 'enchanted_hit', 'heart', 'angry', 'damage', 'flame', 'lava', 'bubble',
  'splash_0', 'splash_1', 'splash_2', 'splash_3', 'drip_hang', 'drip_fall', 'drip_land', 'note']) EXPECT_PARTICLE[n] = [8, 8];
for (let i = 0; i < 8; i++) EXPECT_PARTICLE[`sweep_${i}`] = [32, 16];
for (let i = 0; i <= 10; i++) EXPECT_PARTICLE[`xp_orb_${i}`] = [16, 16];

const EXPECT_ENV = { sun: [32, 32], moon_phases: [128, 64], clouds: [256, 256], rain: [64, 256], snow: [64, 256] };

function validate(label, map, expect) {
  if (!(map instanceof Map)) fail(`${label}: expected a Map`);
  for (const [name, [w, h]] of Object.entries(expect)) {
    const t = map.get(name);
    if (!t) fail(`${label}: missing texture "${name}"`);
    if (t.w !== w || t.h !== h) fail(`${label}: ${name} is ${t.w}x${t.h}, expected ${w}x${h}`);
    if (!(t.data instanceof Uint8ClampedArray) || t.data.length !== w * h * 4) fail(`${label}: ${name} has bad data`);
    let opaque = 0;
    for (let i = 3; i < t.data.length; i += 4) if (t.data[i] > 0) opaque++;
    if (opaque === 0) fail(`${label}: ${name} is completely transparent`);
  }
  for (const name of map.keys()) if (!expect[name]) console.warn(`${label}: unexpected extra texture "${name}"`);
}
validate('entity', entity, EXPECT_ENTITY);
validate('particle', particle, EXPECT_PARTICLE);
validate('environment', env, EXPECT_ENV);

// determinism
{
  const again = generateEntityTextures();
  for (const [n, t] of entity) {
    const u = again.get(n).data;
    for (let i = 0; i < u.length; i++) if (u[i] !== t.data[i]) fail(`entity texture ${n} is not deterministic`);
  }
}

// cloud coverage
{
  const c = env.get('clouds');
  let n = 0, semi = 0;
  for (let i = 3; i < c.data.length; i += 4) { if (c.data[i] === 255) n++; else if (c.data[i] !== 0) semi++; }
  console.log(`clouds: coverage ${(100 * n / (c.w * c.h)).toFixed(1)}% (${semi} semi-transparent px)`);
}
console.log('all textures present with the expected sizes');

// ------------------------------------------------------------------------------------------
// PNG output of raw textures
// ------------------------------------------------------------------------------------------
const save = (name, img) => writePNG(path.join(OUT, name + '.png'), img.w, img.h, img.data);
function upscale(img, s) {
  const out = new Uint8ClampedArray(img.w * s * img.h * s * 4);
  for (let y = 0; y < img.h * s; y++) for (let x = 0; x < img.w * s; x++) {
    const si = ((y / s | 0) * img.w + (x / s | 0)) * 4, di = (y * img.w * s + x) * 4;
    const a = img.data[si + 3] / 255, chk = ((x >> 3) + (y >> 3)) & 1 ? 90 : 60;
    for (let k = 0; k < 3; k++) out[di + k] = img.data[si + k] * a + chk * (1 - a);
    out[di + 3] = 255;
  }
  return { w: img.w * s, h: img.h * s, data: out };
}
for (const [n, t] of entity) save('tex_' + n, upscale(t, 6));
save('sheet_entity', contactSheet([...entity.values()], { cols: 6, scale: 4 }));
save('sheet_particles', contactSheet([...particle.values()], { cols: 16, scale: 8 }));
const group = (prefix) => [...particle].filter(([n]) => n.startsWith(prefix)).map(([, t]) => t);
save('sheet_explosion', contactSheet(group('explosion_'), { cols: 8, scale: 8 }));
save('sheet_sweep', contactSheet(group('sweep_'), { cols: 4, scale: 6 }));
save('sheet_xp', contactSheet(group('xp_orb_'), { cols: 11, scale: 6 }));
save('sheet_small_particles', contactSheet([...particle].filter(([, t]) => t.w === 8).map(([, t]) => t), { cols: 12, scale: 10 }));
for (const [n, t] of env) save('env_' + n, upscale(t, n === 'sun' ? 8 : n === 'moon_phases' ? 4 : 2));

// ------------------------------------------------------------------------------------------
// Software box renderer (orthographic, z-buffered, cutout alpha, lambert flat shading)
// ------------------------------------------------------------------------------------------
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Local texel-space face definitions: origin = corner of texel (0,0), u = +1 column, v = +1 row.
// Convention: +z = front, -x = creature's right, +y = up.
function faceDefs(u, v, W, H, D) {
  return [
    { rect: [u + D, v + D, W, H], o: [0, H, D], du: [1, 0, 0], dv: [0, -1, 0] }, // front
    { rect: [u + 2 * D + W, v + D, W, H], o: [W, H, 0], du: [-1, 0, 0], dv: [0, -1, 0] }, // back
    { rect: [u, v + D, D, H], o: [0, H, 0], du: [0, 0, 1], dv: [0, -1, 0] }, // right (-x)
    { rect: [u + D + W, v + D, D, H], o: [W, H, D], du: [0, 0, -1], dv: [0, -1, 0] }, // left (+x)
    { rect: [u + D, v, W, D], o: [0, H, 0], du: [1, 0, 0], dv: [0, 0, 1] }, // top
    { rect: [u + D + W, v, W, D], o: [0, 0, D], du: [1, 0, 0], dv: [0, 0, -1] }, // bottom
  ];
}

function rotate(p, axis, deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const [x, y, z] = p;
  if (axis === 'x') return [x, y * c - z * s, y * s + z * c];
  if (axis === 'y') return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

function render(boxes, texMap, { yaw = 35, pitch = 25, scale = 8, pad = 12, bg = [58, 66, 80] } = {}) {
  const a = yaw * Math.PI / 180, e = pitch * Math.PI / 180;
  const cam = [-Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e)];
  const f = cam.map((q) => -q);
  const r = norm(cross(f, [0, 1, 0]));
  const up = cross(r, f);
  const L = norm([cam[0] * 0.8 - r[0] * 0.35, cam[1] * 0.8 + 1.1, cam[2] * 0.8 - r[2] * 0.35]);
  const proj = (p) => [dot(p, r) * scale, -dot(p, up) * scale, dot(p, f)];

  const quads = [];
  for (const b of boxes) {
    const [W, H, D] = b.size, inf = b.inflate ?? 0;
    const sx = (W + 2 * inf) / W, sy = (H + 2 * inf) / H, sz = (D + 2 * inf) / D;
    const T = (l) => {
      // mirror = Minecraft's mirrored box: the whole box is flipped in x (right/left faces swap)
      const lx = b.mirror ? W - l[0] : l[0];
      let p = [b.pos[0] - inf + lx * sx, b.pos[1] - inf + l[1] * sy, b.pos[2] - inf + l[2] * sz];
      if (b.rot) {
        const pv = b.pivot ?? [0, 0, 0];
        p = sub(p, pv);
        for (const [axis, deg] of b.rot) p = rotate(p, axis, deg);
        p = [p[0] + pv[0], p[1] + pv[1], p[2] + pv[2]];
      }
      return p;
    };
    const tex = texMap.get(b.tex);
    if (!tex) fail(`render: unknown texture ${b.tex}`);
    for (const fd of faceDefs(b.uv[0], b.uv[1], W, H, D)) {
      const O = T(fd.o);
      const U = sub(T([fd.o[0] + fd.du[0], fd.o[1] + fd.du[1], fd.o[2] + fd.du[2]]), O);
      const V = sub(T([fd.o[0] + fd.dv[0], fd.o[1] + fd.dv[1], fd.o[2] + fd.dv[2]]), O);
      let n = norm(cross(V, U));
      if (b.mirror) n = [-n[0], -n[1], -n[2]];
      quads.push({ O, U, V, n, rect: fd.rect, tex });
    }
  }
  // bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of quads) {
    const [, , fw, fh] = q.rect;
    for (const [s, t] of [[0, 0], [fw, 0], [0, fh], [fw, fh]]) {
      const p = proj([q.O[0] + q.U[0] * s + q.V[0] * t, q.O[1] + q.U[1] * s + q.V[1] * t, q.O[2] + q.U[2] * s + q.V[2] * t]);
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]);
    }
  }
  const Wd = Math.ceil(maxX - minX) + pad * 2, Hd = Math.ceil(maxY - minY) + pad * 2;
  const ox = pad - minX, oy = pad - minY;
  const img = new Uint8ClampedArray(Wd * Hd * 4);
  const zb = new Float32Array(Wd * Hd).fill(Infinity);
  for (let i = 0; i < Wd * Hd; i++) img.set([...bg, 255], i * 4);
  for (const q of quads) {
    const [rx, ry, fw, fh] = q.rect;
    const o = proj(q.O), pu = proj(q.U), pv = proj(q.V);
    o[0] += ox; o[1] += oy;
    const det = pu[0] * pv[1] - pu[1] * pv[0];
    if (Math.abs(det) < 1e-6) continue;
    const lit = 0.42 + 0.58 * Math.max(0, dot(q.n, L));
    const xs = [o[0], o[0] + pu[0] * fw, o[0] + pv[0] * fh, o[0] + pu[0] * fw + pv[0] * fh];
    const ys = [o[1], o[1] + pu[1] * fw, o[1] + pv[1] * fh, o[1] + pu[1] * fw + pv[1] * fh];
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(Wd - 1, Math.ceil(Math.max(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(Hd - 1, Math.ceil(Math.max(...ys)));
    for (let py = y0; py <= y1; py++) for (let px = x0; px <= x1; px++) {
      const dx = px + 0.5 - o[0], dy = py + 0.5 - o[1];
      const s = (dx * pv[1] - dy * pv[0]) / det, t = (pu[0] * dy - pu[1] * dx) / det;
      if (s < 0 || t < 0 || s >= fw || t >= fh) continue;
      const depth = o[2] + pu[2] * s + pv[2] * t;
      const zi = py * Wd + px;
      if (depth >= zb[zi]) continue;
      const tx = rx + Math.floor(s), ty = ry + Math.floor(t);
      const ti = (ty * q.tex.w + tx) * 4;
      if (q.tex.data[ti + 3] < 128) continue;
      zb[zi] = depth;
      img[zi * 4] = q.tex.data[ti] * lit; img[zi * 4 + 1] = q.tex.data[ti + 1] * lit; img[zi * 4 + 2] = q.tex.data[ti + 2] * lit;
    }
  }
  return { w: Wd, h: Hd, data: img };
}

function hcat(imgs, gap = 6, bg = [30, 32, 38]) {
  const W = imgs.reduce((s, i) => s + i.w, 0) + gap * (imgs.length + 1);
  const H = Math.max(...imgs.map((i) => i.h)) + gap * 2;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) out.set([...bg, 255], i * 4);
  let x = gap;
  for (const im of imgs) {
    for (let y = 0; y < im.h; y++) out.set(im.data.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((y + gap) * W + x) * 4);
    x += im.w + gap;
  }
  return { w: W, h: H, data: out };
}

// ------------------------------------------------------------------------------------------
// Models (positions in model pixels, feet at y = 0, facing +z)
// ------------------------------------------------------------------------------------------
const B = (tex, uv, size, pos, extra = {}) => ({ tex, uv, size, pos, ...extra });

function humanoid(tex, { armsForward = false, hat = true, slimLimbs = false, leftUV = true } = {}) {
  const armRot = armsForward ? { rot: [['x', -90]] } : {};
  if (slimLimbs) { // skeleton: 2x12x2 limbs shared by both sides
    return [
      B(tex, [0, 16], [2, 12, 2], [-3, 0, -1]),
      B(tex, [0, 16], [2, 12, 2], [1, 0, -1], { mirror: true }),
      B(tex, [16, 16], [8, 12, 4], [-4, 12, -2]),
      B(tex, [40, 16], [2, 12, 2], [-6, 12, -1], { ...armRot, pivot: [-5, 22, 0] }),
      B(tex, [40, 16], [2, 12, 2], [4, 12, -1], { ...armRot, pivot: [5, 22, 0], mirror: true }),
      B(tex, [0, 0], [8, 8, 8], [-4, 24, -4]),
    ];
  }
  const list = [
    B(tex, [0, 16], [4, 12, 4], [-4, 0, -2]),
    B(tex, leftUV ? [16, 48] : [0, 16], [4, 12, 4], [0, 0, -2]),
    B(tex, [16, 16], [8, 12, 4], [-4, 12, -2]),
    B(tex, [40, 16], [4, 12, 4], [-8, 12, -2], { ...armRot, pivot: [-6, 22, 0] }),
    B(tex, leftUV ? [32, 48] : [40, 16], [4, 12, 4], [4, 12, -2], { ...armRot, pivot: [6, 22, 0] }),
    B(tex, [0, 0], [8, 8, 8], [-4, 24, -4]),
  ];
  if (hat) list.push(B(tex, [32, 0], [8, 8, 8], [-4, 24, -4], { inflate: 0.5 }));
  return list;
}

function armored(mat) {
  const l1 = `armor_${mat}_1`, l2 = `armor_${mat}_2`;
  return [
    ...humanoid('player', { hat: false }),
    B(l1, [0, 0], [8, 8, 8], [-4, 24, -4], { inflate: 1 }),
    B(l1, [16, 16], [8, 12, 4], [-4, 12, -2], { inflate: 1 }),
    B(l1, [40, 16], [4, 12, 4], [-8, 12, -2], { inflate: 1 }),
    B(l1, [40, 16], [4, 12, 4], [4, 12, -2], { inflate: 1, mirror: true }),
    B(l1, [0, 16], [4, 12, 4], [-4, 0, -2], { inflate: 1 }),
    B(l1, [0, 16], [4, 12, 4], [0, 0, -2], { inflate: 1, mirror: true }),
    B(l2, [16, 16], [8, 12, 4], [-4, 12, -2], { inflate: 0.5 }),
    B(l2, [0, 16], [4, 12, 4], [-4, 0, -2], { inflate: 0.5 }),
    B(l2, [0, 16], [4, 12, 4], [0, 0, -2], { inflate: 0.5, mirror: true }),
  ];
}

function quadLegs(tex, uv, size, xs, zs, extra = {}) {
  const out = [];
  for (const z of zs) for (const x of xs) out.push(B(tex, uv, size, [x, 0, z], extra));
  return out;
}

const spiderLegs = () => {
  const legs = [];
  const zs = [1, 0, -1, -2];
  const yaws = [40, 15, -15, -40];
  zs.forEach((z, k) => {
    legs.push(B('spider', [18, 0], [16, 2, 2], [-19, 8, z - 1], { pivot: [-3, 9, z], rot: [['z', 35], ['y', yaws[k]]] }));
    legs.push(B('spider', [18, 0], [16, 2, 2], [3, 8, z - 1], { pivot: [3, 9, z], rot: [['z', -35], ['y', -yaws[k]]], mirror: true }));
  });
  return legs;
};

const MODELS = {
  player: humanoid('player'),
  zombie: humanoid('zombie', { armsForward: true }),
  skeleton: humanoid('skeleton', { slimLimbs: true }),
  creeper: [
    ...quadLegs('creeper', [0, 16], [4, 6, 4], [-4, 0], [2, -6]),
    B('creeper', [16, 16], [8, 12, 4], [-4, 6, -2]),
    B('creeper', [0, 0], [8, 8, 8], [-4, 18, -4]),
  ],
  spider: [
    B('spider', [0, 0], [6, 6, 6], [-3, 6, -3]),
    B('spider', [32, 4], [8, 8, 8], [-4, 5, 3]),
    B('spider', [0, 12], [10, 8, 12], [-5, 5, -15]),
    ...spiderLegs(),
  ],
  pig: [
    ...quadLegs('pig', [0, 16], [4, 6, 4], [-5, 1], [3, -9]),
    B('pig', [0, 32], [10, 8, 16], [-5, 6, -8]),
    B('pig', [0, 0], [8, 8, 8], [-4, 8, 6]),
    B('pig', [16, 16], [4, 3, 1], [-2, 9, 14]),
  ],
  cow: [
    ...quadLegs('cow', [0, 16], [4, 12, 4], [-6, 2], [4, -9]),
    B('cow', [0, 32], [12, 10, 18], [-6, 12, -10]),
    B('cow', [40, 0], [4, 1, 6], [-2, 11, -8]),
    B('cow', [0, 0], [8, 8, 6], [-4, 16, 8]),
    B('cow', [22, 0], [1, 3, 1], [-5, 22, 11]),
    B('cow', [22, 0], [1, 3, 1], [4, 22, 11]),
  ],
  sheep_sheared: [
    ...quadLegs('sheep', [0, 16], [4, 12, 4], [-5, 1], [3, -9]),
    B('sheep', [0, 32], [8, 6, 16], [-4, 12, -8]),
    B('sheep', [0, 0], [6, 6, 8], [-3, 16, 6]),
  ],
  sheep: [
    ...quadLegs('sheep', [0, 16], [4, 12, 4], [-5, 1], [3, -9]),
    ...quadLegs('sheep_fur', [0, 16], [4, 6, 4], [-5, 1], [3, -9], { inflate: 0.5 }).map((b) => ({ ...b, pos: [b.pos[0], 6, b.pos[2]] })),
    B('sheep', [0, 32], [8, 6, 16], [-4, 12, -8]),
    B('sheep_fur', [0, 32], [8, 6, 16], [-4, 12, -8], { inflate: 1.75 }),
    B('sheep', [0, 0], [6, 6, 8], [-3, 16, 6]),
    B('sheep_fur', [0, 0], [6, 6, 6], [-3, 16, 6], { inflate: 0.6 }),
  ],
  chicken: [
    B('chicken', [26, 0], [3, 5, 3], [-3, 0, -1]),
    B('chicken', [26, 0], [3, 5, 3], [0, 0, -1]),
    B('chicken', [0, 9], [6, 6, 8], [-3, 5, -4]),
    B('chicken', [38, 0], [1, 4, 6], [-4, 7, -3]),
    B('chicken', [38, 0], [1, 4, 6], [3, 7, -3], { mirror: true }),
    B('chicken', [0, 0], [4, 6, 3], [-2, 9, 3]),
    B('chicken', [14, 0], [4, 2, 2], [-2, 11, 6]),
    B('chicken', [14, 4], [2, 2, 2], [-1, 9, 5]),
  ],
  enderman: [
    B('enderman', [56, 0], [2, 30, 2], [-3, 0, -1]),
    B('enderman', [56, 0], [2, 30, 2], [1, 0, -1], { mirror: true }),
    B('enderman', [32, 16], [8, 12, 4], [-4, 27, -2]),
    B('enderman', [56, 0], [2, 30, 2], [-6, 9, -1]),
    B('enderman', [56, 0], [2, 30, 2], [4, 9, -1], { mirror: true }),
    B('enderman', [0, 0], [8, 8, 8], [-4, 39, -4]),
  ],
  shield: [
    B('shield', [0, 0], [12, 22, 1], [-6, 0, 0]),
    B('shield', [26, 0], [2, 6, 6], [-1, 8, -6]),
  ],
};
for (const m of MATS) MODELS['armor_' + m] = armored(m);

const all = new Map([...entity]);
const renders = [];
for (const [name, boxes] of Object.entries(MODELS)) {
  const big = ['enderman'].includes(name) ? 6 : 8;
  const views = [
    render(boxes, all, { yaw: 35, pitch: 22, scale: big }),
    render(boxes, all, { yaw: 0, pitch: 0, scale: big }),
    render(boxes, all, { yaw: 215, pitch: 22, scale: big }),
    render(boxes, all, { yaw: 90, pitch: -25, scale: big }),
  ];
  const img = hcat(views);
  save('render_' + name, img);
  renders.push(name);
}
console.log(`rendered ${renders.length} models -> ${OUT}`);
