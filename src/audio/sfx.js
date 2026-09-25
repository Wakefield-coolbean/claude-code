// Procedural sound effect definitions. Every sound is synthesised from noise,
// filters, resonators and oscillators (see dsp.js) — no samples are shipped.
//
// A definition maps a sound name to { cat, variants, gen(sr, rng, variant) -> Float32Array }.
// Aliases reuse another sound's buffers with their own category / volume / pitch.
import {
  TAU, makeRng, hashString, rand, randLog, randInt, pick, chance, clamp, smooth,
  alloc, envFn, sampled, burst, grains, mode, modes, tone, bell, bubble, pluck, creak, voice, vowelPath,
  reverb, lowpass, highpass, softClip, peakOf, layer, loopify, finalize, comb, periodic, loopBed, droneSines,
} from './dsp.js';

export const CATEGORIES = ['master', 'music', 'records', 'weather', 'blocks', 'hostile', 'neutral', 'players', 'ambient'];

const DEFS = new Map();

// o: vol (0..1 base gain), pv (random pitch spread, fraction), low (render at half rate),
//    target (loudness), peak, loop
function def(name, cat, variants, gen, o = {}) {
  DEFS.set(name, {
    name, cat, variants, gen, alias: null,
    vol: o.vol ?? 1, pitch: 1, pitchVar: o.pv ?? 0, low: !!o.low,
    target: o.target ?? 0.22, peak: o.peak ?? 0.89, loop: !!o.loop,
  });
}
function alias(name, target, o = {}) {
  const t = DEFS.get(target);
  if (!t) throw new Error('alias target missing: ' + target);
  DEFS.set(name, {
    name, alias: target, cat: o.cat ?? t.cat, variants: t.variants,
    vol: o.vol ?? t.vol, pitch: o.pitch ?? 1, pitchVar: o.pv ?? t.pitchVar, loop: t.loop,
  });
}

export function getSoundDef(name) { return DEFS.get(name) || null; }
export function listSounds() {
  return [...DEFS.values()].map((d) => ({ name: d.name, cat: d.cat, variants: d.variants, alias: d.alias, vol: d.vol, pitch: d.pitch, loop: !!d.loop }));
}
// Rate a definition renders at for a given output rate.
export function renderRate(name, sr) {
  let d = DEFS.get(name); if (!d) return sr;
  if (d.alias) d = DEFS.get(d.alias);
  return d.low ? Math.round(sr / 2) : sr;
}

// Synthesize one variant. Returns { data: Float32Array, rate, base, variant } or null.
export function synthesize(name, variant = 0, sr = 48000) {
  let d = DEFS.get(name);
  if (!d) return null;
  if (d.alias) d = DEFS.get(d.alias);
  const v = ((variant % d.variants) + d.variants) % d.variants;
  const rate = d.low ? Math.round(sr / 2) : sr;
  const r = makeRng(hashString(d.name + '#' + v));
  const raw = d.gen(rate, r, v);
  const data = finalize(raw, rate, {
    target: d.target, peak: d.peak, trim: !d.loop, fadeOut: d.loop ? 0 : 0.012, fadeIn: d.loop ? 0 : 0.0005, dc: d.loop ? 'mean' : true,
  });
  return { data, rate, base: d.name, variant: v };
}

// ------------------------------------------------------------ helpers ----
const thud = (b, sr, r, t0, f, tau, amp) =>
  burst(b, sr, r, { t0, dur: tau * 7, mode: 'lp', f, q: 0.8, a: 0.0015, d: tau, amp });
const hump = (u) => Math.sin(Math.PI * Math.min(1, 0.15 + u));

// ======================================================== BLOCK SOUNDS ====
function stoneBreak(sr, r, p = {}) {
  const lo = p.lo ?? 1, br = p.bright ?? 1, len = p.len ?? 1;
  const b = alloc(sr, 0.55 * len + (p.tail ?? 0.05));
  thud(b, sr, r, 0, [650 * lo, 200 * lo], 0.025 * len, 0.3 * (p.thump ?? 1));
  burst(b, sr, r, { dur: 0.35 * len, mode: 'bp', f: [rand(r, 2000, 2800) * br, 1100 * br], q: 0.9, a: 0.0008, d: 0.055 * len, amp: 0.32 });
  grains(b, sr, r, { dur: 0.4 * len, count: Math.round(90 * (p.dens ?? 1)), dist: 1.9, f: [1100 * br, 6500 * br], q: [3, 9], len: [0.0012, 0.005], amp: [0.3, 1], ampEnv: (u) => 1 - 0.75 * u });
  grains(b, sr, r, { t0: 0.004, dur: 0.28 * len, count: 14, dist: 1.5, f: [300 * lo, 1100 * lo], q: [2, 5], len: [0.004, 0.014], amp: [0.2, 0.5] });
  return b;
}
function stoneStep(sr, r, p = {}) {
  const lo = p.lo ?? 1, br = p.bright ?? 1;
  const b = alloc(sr, 0.22 + (p.tail ?? 0));
  thud(b, sr, r, 0, 420 * lo, 0.012, 0.4 * (p.thump ?? 1));
  burst(b, sr, r, { dur: 0.16, mode: 'bp', f: [rand(r, 2600, 3400) * br, 1700 * br], q: 1.1, a: 0.0006, d: 0.022, amp: 0.4 });
  grains(b, sr, r, { dur: 0.13, count: 16, dist: 1.7, f: [1500 * br, 6500 * br], q: [3, 8], len: [0.0008, 0.004], amp: [0.3, 1] });
  burst(b, sr, r, { t0: rand(r, 0.025, 0.06), dur: 0.09, mode: 'bp', f: 2400 * br, q: 1.4, a: 0.008, d: 0.018, amp: 0.14 });
  return b;
}

function woodBreak(sr, r) {
  const b = alloc(sr, 0.5);
  const f1 = rand(r, 130, 200);
  layer(b, sr, 0.42, (L) => {
    modes(L, sr, 0, f1, [1, rand(r, 2.1, 2.5), rand(r, 3.5, 4.2), rand(r, 5.1, 6), rand(r, 7.2, 8.6)], [0.11, 0.07, 0.045, 0.03, 0.02], [1, 0.65, 0.45, 0.3, 0.2], r, 0.03);
    modes(L, sr, rand(r, 0.018, 0.05), f1 * rand(r, 1.08, 1.35), [1, 2.3, 3.9], [0.07, 0.045, 0.03], [0.5, 0.35, 0.2], r, 0.03);
    burst(L, sr, r, { dur: 0.02, mode: 'lp', f: 1800, a: 0.0004, d: 0.003, amp: 1.2 });
  });
  burst(b, sr, r, { dur: 0.25, mode: 'bp', f: [800, 420], q: 1.8, a: 0.001, d: 0.045, amp: 0.2 });
  burst(b, sr, r, { dur: 0.04, mode: 'hp', f: 2500, a: 0.0004, d: 0.006, amp: 0.28 });
  grains(b, sr, r, { dur: 0.22, count: 32, dist: 2, f: [1400, 5000], q: [3, 7], len: [0.0015, 0.007], amp: [0.2, 0.8], ampEnv: (u) => 1 - 0.6 * u });
  return b;
}
function woodStep(sr, r, p = {}) {
  const b = alloc(sr, 0.22);
  const f1 = rand(r, 170, 300) * (p.hi ?? 1);
  layer(b, sr, 0.4, (L) => {
    modes(L, sr, 0, f1, [1, rand(r, 2.2, 2.6), rand(r, 3.8, 4.4), rand(r, 6, 6.8)], [0.05, 0.03, 0.02, 0.012], [1, 0.55, 0.35, 0.2], r, 0.02);
    burst(L, sr, r, { dur: 0.012, mode: 'lp', f: 2500, a: 0.0003, d: 0.002, amp: 1 });
  });
  burst(b, sr, r, { t0: 0.005, dur: 0.1, mode: 'bp', f: 1600, q: 1, a: 0.004, d: 0.02, amp: 0.1 });
  grains(b, sr, r, { dur: 0.06, count: 5, f: [2000, 5000], q: [3, 6], len: [0.001, 0.003], amp: [0.1, 0.4] });
  return b;
}
function ladderStep(sr, r) {
  const b = woodStep(sr, r, { hi: 1.9 });
  layer(b, sr, 0.1, (L) => creak(L, sr, r, { t0: 0.01, dur: 0.1, rate: [220, 160], res: [[700, 10, 1], [1500, 8, 0.5]], env: { a: 0.01, h: 0.03, d: 0.03, r: 0.02 } }));
  return b;
}

function gravelBreak(sr, r) {
  const b = alloc(sr, 0.55);
  thud(b, sr, r, 0, 320, 0.03, 0.35);
  grains(b, sr, r, { dur: 0.45, count: 280, dist: 1.5, f: [450, 4200], q: [1.2, 4], len: [0.0015, 0.01], amp: [0.15, 1], ampEnv: (u) => 1 - 0.7 * u });
  burst(b, sr, r, { dur: 0.4, mode: 'bp', f: [1500, 800], q: 0.7, a: 0.001, d: 0.09, amp: 0.2, am: { rate: 70, depth: 0.7 } });
  return b;
}
function gravelStep(sr, r) {
  const b = alloc(sr, 0.3);
  thud(b, sr, r, 0, 260, 0.018, 0.3);
  grains(b, sr, r, { dur: 0.22, count: 110, dist: 1.2, f: [500, 3600], q: [1.5, 4], len: [0.0015, 0.007], amp: [0.2, 1], ampEnv: hump });
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: 1300, q: 0.8, a: 0.004, d: 0.045, amp: 0.12, am: { rate: 90, depth: 0.7 } });
  return b;
}

function grassBreak(sr, r) {
  const b = alloc(sr, 0.45);
  thud(b, sr, r, 0, 260, 0.02, 0.22);
  burst(b, sr, r, { dur: 0.38, mode: 'bp', f: [rand(r, 3800, 4800), 2800], q: 0.6, a: 0.003, d: 0.085, amp: 0.3, am: { rate: 140, depth: 0.85 } });
  grains(b, sr, r, { dur: 0.34, count: 170, dist: 1.4, f: [1600, 8500], q: [0.9, 3], len: [0.0008, 0.004], amp: [0.2, 1], ampEnv: (u) => 1 - 0.65 * u });
  return b;
}
function grassStep(sr, r) {
  const b = alloc(sr, 0.26);
  thud(b, sr, r, 0, 220, 0.016, 0.3);
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: [rand(r, 3000, 4000), 2400], q: 0.7, a: 0.008, d: 0.045, amp: 0.26, am: { rate: 160, depth: 0.85 } });
  grains(b, sr, r, { dur: 0.17, count: 60, dist: 1.2, f: [1500, 7500], q: [1, 2.5], len: [0.0008, 0.0035], amp: [0.2, 1], ampEnv: (u) => Math.sin(Math.PI * Math.min(1, 0.2 + u)) });
  return b;
}

function sandBreak(sr, r) {
  const b = alloc(sr, 0.5);
  thud(b, sr, r, 0, 200, 0.025, 0.2);
  burst(b, sr, r, { dur: 0.42, mode: 'bp', f: [rand(r, 1600, 2100), 950], q: 0.5, a: 0.004, d: 0.11, amp: 0.4, am: { rate: 45, depth: 0.45 } });
  grains(b, sr, r, { dur: 0.38, count: 130, dist: 1.3, f: [700, 3500], q: [0.6, 1.4], len: [0.0015, 0.005], amp: [0.1, 0.5], ampEnv: (u) => 1 - 0.6 * u });
  return b;
}
function sandStep(sr, r) {
  const b = alloc(sr, 0.25);
  thud(b, sr, r, 0, 180, 0.015, 0.18);
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: [rand(r, 1500, 1900), 1100], q: 0.55, a: 0.01, d: 0.045, amp: 0.36, am: { rate: 60, depth: 0.45 } });
  grains(b, sr, r, { dur: 0.16, count: 40, f: [700, 3000], q: [0.6, 1.4], len: [0.0015, 0.004], amp: [0.1, 0.4] });
  return b;
}

function snowBreak(sr, r) {
  const b = alloc(sr, 0.45);
  thud(b, sr, r, 0, 240, 0.02, 0.22);
  grains(b, sr, r, { dur: 0.33, count: 120, dist: 1.1, f: [700, 2600], q: [3, 8], len: [0.003, 0.011], amp: [0.25, 1], ampEnv: (u) => Math.sin(Math.PI * Math.min(1, 0.1 + u * 0.95)) });
  burst(b, sr, r, { dur: 0.35, mode: 'lp', f: 1600, q: 0.7, a: 0.01, d: 0.08, amp: 0.14, am: { rate: 50, depth: 0.6 } });
  return b;
}
function snowStep(sr, r) {
  const b = alloc(sr, 0.26);
  thud(b, sr, r, 0, 220, 0.015, 0.2);
  grains(b, sr, r, { dur: 0.18, count: 55, f: [800, 2500], q: [3, 7], len: [0.003, 0.009], amp: [0.3, 1], ampEnv: hump });
  burst(b, sr, r, { dur: 0.18, mode: 'lp', f: 1300, q: 0.7, a: 0.01, d: 0.04, amp: 0.12 });
  return b;
}

function woolBreak(sr, r) {
  const b = alloc(sr, 0.4);
  burst(b, sr, r, { dur: 0.35, mode: 'lp', f: [950, 320], q: 0.6, a: 0.012, d: 0.07, amp: 0.45, am: { rate: 30, depth: 0.3 } });
  thud(b, sr, r, 0.004, 150, 0.035, 0.3);
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: 2200, q: 0.8, a: 0.01, d: 0.04, amp: 0.035 });
  return b;
}
function woolStep(sr, r) {
  const b = alloc(sr, 0.22);
  burst(b, sr, r, { dur: 0.18, mode: 'lp', f: [750, 350], q: 0.6, a: 0.01, d: 0.04, amp: 0.4 });
  thud(b, sr, r, 0.003, 140, 0.025, 0.25);
  return b;
}

function glassBreak(sr, r) {
  const b = alloc(sr, 1.05);
  burst(b, sr, r, { dur: 0.06, mode: 'hp', f: 2200, a: 0.0002, d: 0.009, amp: 0.55 });
  burst(b, sr, r, { dur: 0.6, mode: 'hp', f: 5500, a: 0.002, d: 0.13, amp: 0.07 });
  layer(b, sr, 0.3, (L) => {
    const n = randInt(r, 45, 70);
    for (let s = 0; s < n; s++) {
      const early = s < n * 0.4;
      const t = early ? rand(r, 0, 0.035) : 0.03 + Math.pow(r(), 1.6) * 0.55;
      const f = randLog(r, 2400, 9500);
      const tau = randLog(r, 0.012, early ? 0.09 : 0.06);
      const a = rand(r, 0.25, 1) * (early ? 1 : 0.55 * (1 - (t - 0.03) / 0.6));
      mode(L, sr, t, f, tau, a, r() * TAU);
      mode(L, sr, t, f * rand(r, 1.45, 2.6), tau * 0.6, a * 0.5, r() * TAU);
    }
  });
  grains(b, sr, r, { t0: 0.04, dur: 0.6, count: 26, dist: 1.6, f: [3000, 9000], q: [5, 14], len: [0.0008, 0.003], amp: [0.1, 0.5] });
  return b;
}

const METAL_RATIOS = [1, 1.58, 2.33, 2.95, 3.87, 4.61];
function metalBreak(sr, r) {
  const b = stoneBreak(sr, r, { lo: 1.4, bright: 1.3, len: 0.9, tail: 0.35 });
  layer(b, sr, 0.16, (L) => modes(L, sr, 0, rand(r, 520, 820), METAL_RATIOS, [0.3, 0.22, 0.16, 0.12, 0.09, 0.07], [1, 0.8, 0.6, 0.5, 0.35, 0.25], r, 0.02));
  return b;
}
function metalStep(sr, r) {
  const b = stoneStep(sr, r, { lo: 1.3, bright: 1.35, tail: 0.15 });
  layer(b, sr, 0.12, (L) => modes(L, sr, 0, rand(r, 900, 1400), METAL_RATIOS.slice(0, 4), [0.12, 0.09, 0.07, 0.05], [1, 0.7, 0.5, 0.3], r, 0.02));
  return b;
}

const deepslateBreak = (sr, r) => stoneBreak(sr, r, { lo: 0.7, bright: 0.68, len: 1.1, thump: 1.6, dens: 1.2 });
const deepslateStep = (sr, r) => stoneStep(sr, r, { lo: 0.7, bright: 0.72, thump: 1.6 });

const CRYSTAL = [[1, 1, 1], [2.32, 0.5, 0.5], [4.25, 0.25, 0.25], [6.8, 0.1, 0.12]];
function amethystBreak(sr, r) {
  const b = alloc(sr, 1.3);
  layer(b, sr, 0.28, (L) => {
    const n = randInt(r, 7, 11);
    for (let i = 0; i < n; i++) bell(L, sr, Math.pow(r(), 1.5) * 0.18, randLog(r, 1300, 3600), rand(r, 0.4, 1), rand(r, 0.35, 0.8), CRYSTAL);
  });
  grains(b, sr, r, { dur: 0.25, count: 50, dist: 1.8, f: [2500, 9000], q: [5, 12], len: [0.001, 0.004], amp: [0.2, 0.8] });
  thud(b, sr, r, 0, 400, 0.015, 0.2);
  return b;
}
function amethystStep(sr, r) {
  const b = stoneStep(sr, r, { bright: 1.2, tail: 0.5 });
  layer(b, sr, 0.14, (L) => {
    const n = randInt(r, 1, 3);
    for (let i = 0; i < n; i++) bell(L, sr, rand(r, 0, 0.05), randLog(r, 1500, 3200), rand(r, 0.5, 1), rand(r, 0.25, 0.45), CRYSTAL.slice(0, 3));
  });
  return b;
}

function cropBreak(sr, r) {
  const b = alloc(sr, 0.35);
  burst(b, sr, r, { dur: 0.28, mode: 'bp', f: [4200, 2600], q: 0.6, a: 0.002, d: 0.06, amp: 0.25, am: { rate: 150, depth: 0.85 } });
  grains(b, sr, r, { dur: 0.22, count: 90, dist: 1.6, f: [1500, 8000], q: [1, 3], len: [0.0008, 0.004], amp: [0.2, 0.8] });
  grains(b, sr, r, { dur: 0.12, count: 14, dist: 1.4, f: [1800, 5500], q: [5, 11], len: [0.001, 0.003], amp: [0.6, 1.2] });
  thud(b, sr, r, 0, 300, 0.012, 0.15);
  return b;
}

// ==================================================== MISC / ITEMS / UI ====
function pop(sr, r) {
  const b = alloc(sr, 0.12);
  const f0 = rand(r, 260, 300);
  const fn = (u) => f0 + 650 * (1 - Math.exp(-u * 0.1 / 0.012));
  tone(b, sr, { dur: 0.1, f: fn, env: { a: 0.0015, d: 0.02 }, amp: 1 });
  tone(b, sr, { dur: 0.06, f: (u) => fn(u) * 2, env: { a: 0.001, d: 0.01 }, amp: 0.22 });
  burst(b, sr, r, { dur: 0.006, mode: 'lp', f: 3000, a: 0.0002, d: 0.001, amp: 0.3 });
  return b;
}
function click(sr, r) {
  const b = alloc(sr, 0.07);
  burst(b, sr, r, { dur: 0.01, mode: 'hp', f: 1800, a: 0.0002, d: 0.0015, amp: 0.8 });
  mode(b, sr, 0, 2100, 0.006, 0.5);
  mode(b, sr, 0, 3400, 0.004, 0.3);
  mode(b, sr, 0.0005, 780, 0.012, 0.25);
  return b;
}
function bowShoot(sr, r) {
  const b = alloc(sr, 0.55);
  layer(b, sr, 0.3, (L) => pluck(L, sr, r, { f: rand(r, 95, 130), dur: 0.5, decay: 0.975, damp: 0.35, bright: 0.7 }));
  burst(b, sr, r, { t0: 0.005, dur: 0.22, mode: 'bp', f: [700, 3200], q: 1.4, env: { a: 0.03, d: 0.05, r: 0.03 }, amp: 0.3 });
  burst(b, sr, r, { dur: 0.015, mode: 'hp', f: 1500, a: 0.0003, d: 0.002, amp: 0.5 });
  mode(b, sr, 0, rand(r, 260, 320), 0.06, 0.3);
  return b;
}
function bowHit(sr, r) {
  const b = alloc(sr, 0.45);
  layer(b, sr, 0.35, (L) => {
    modes(L, sr, 0, rand(r, 220, 340), [1, 2.4, 4.1], [0.04, 0.025, 0.015], [1, 0.5, 0.3], r, 0.03);
    burst(L, sr, r, { dur: 0.015, mode: 'lp', f: 3000, a: 0.0003, d: 0.0025, amp: 1 });
  });
  const fq = rand(r, 150, 210), wob = rand(r, 22, 32);
  tone(b, sr, { t0: 0.01, dur: 0.4, f: fq, wave: 'tri', env: (t) => Math.exp(-t / 0.12) * (0.5 + 0.5 * Math.sin(TAU * wob * t)), amp: 0.2 });
  grains(b, sr, r, { dur: 0.08, count: 10, f: [1500, 4500], q: [2, 5], len: [0.001, 0.004], amp: [0.2, 0.7] });
  return b;
}
function successfulHit(sr, r) {
  const b = alloc(sr, 0.6);
  bell(b, sr, 0, 1560, 0.8, 0.18, [[1, 1, 1], [2.0, 0.35, 0.6], [3.0, 0.12, 0.4], [4.1, 0.05, 0.3]]);
  mode(b, sr, 0, 1567, 0.2, 0.3);
  return b;
}
function orb(sr, r) {
  const b = alloc(sr, 0.6);
  const f = 1760;
  bell(b, sr, 0, f, 1, 0.22, [[1, 1, 1], [2.0, 0.22, 0.5], [2.99, 0.12, 0.35], [4.2, 0.04, 0.2]]);
  mode(b, sr, 0, f * 1.004, 0.25, 0.5);
  burst(b, sr, r, { dur: 0.01, mode: 'hp', f: 4000, a: 0.0002, d: 0.0015, amp: 0.15 });
  return b;
}
function levelup(sr, r) {
  const b = alloc(sr, 2.3);
  const base = 784;
  const steps = [0, 4, 7, 12, 16, 19];
  steps.forEach((s, i) => {
    const f = base * Math.pow(2, s / 12), t = i * 0.055, a = 1 - i * 0.07;
    mode(b, sr, t, f, 0.9, a);
    mode(b, sr, t, f * 1.003, 1.0, a * 0.4);
    mode(b, sr, t, f * 2, 0.4, a * 0.3);
    mode(b, sr, t, f * 3, 0.25, a * 0.12);
  });
  // shimmering sustain of the full chord
  [0, 7, 12, 16].forEach((s) => tone(b, sr, { t0: 0.3, dur: 1.9, f: base * Math.pow(2, s / 12), vib: { rate: 5.5, depth: 0.002 }, env: { a: 0.15, d: 0.6, r: 0.2 }, amp: 0.12 }));
  grains(b, sr, r, { t0: 0.05, dur: 0.8, count: 25, dist: 1.4, f: [4000, 9000], q: [10, 20], len: [0.004, 0.012], amp: [0.05, 0.2] });
  return b;
}
function eat(sr, r) {
  const b = alloc(sr, 0.28);
  thud(b, sr, r, 0, 350, 0.02, 0.3);
  mode(b, sr, 0, rand(r, 150, 200), 0.025, 0.4);
  grains(b, sr, r, { dur: 0.18, count: 90, dist: 1.5, f: [700, 4500], q: [1, 3.5], len: [0.0015, 0.008], amp: [0.2, 1], ampEnv: (u) => 1 - 0.5 * u });
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: [1400, 900], q: 1.2, a: 0.004, d: 0.05, amp: 0.12, am: { rate: 60, depth: 0.8 } });
  return b;
}
function burp(sr, r) {
  const dur = rand(r, 0.45, 0.6);
  const b = alloc(sr, dur + 0.05);
  voice(b, sr, r, {
    dur, f0: [rand(r, 95, 115), 105, 80], jitter: 0.08, creak: 0.5, breath: 0.2,
    formants: vowelPath([[0, 'uh'], [0.5, 'er'], [1, 'o']], 0.9), bw: [120, 160, 220], tilt: 1500, drive: 1.2,
    env: { a: 0.025, h: dur * 0.5, d: dur * 0.2, r: 0.08 }, trem: { rate: 22, depth: 0.35 },
  });
  return b;
}
function drink(sr, r) {
  const b = alloc(sr, 0.5);
  const n = randInt(r, 2, 3);
  for (let i = 0; i < n; i++) {
    const t = i * rand(r, 0.13, 0.17);
    bubble(b, sr, t, rand(r, 220, 320), rand(r, 1.2, 1.8), 0.035, 0.6);
    mode(b, sr, t, rand(r, 110, 140), 0.03, 0.5);
    burst(b, sr, r, { t0: t, dur: 0.08, mode: 'lp', f: 900, a: 0.003, d: 0.02, amp: 0.2 });
  }
  return b;
}
function explode(sr, r) {
  const dur = rand(r, 3.0, 3.8);
  const b = alloc(sr, dur);
  burst(b, sr, r, { dur: 0.15, mode: 'none', a: 0.0005, d: 0.025, amp: 0.8 });
  burst(b, sr, r, { dur: 1.6, mode: 'lp', f: [4500, 180], q: 0.7, a: 0.004, d: 0.35, amp: 0.8 });
  burst(b, sr, r, { dur, mode: 'lp', f: [220, 70], q: 0.9, stages: 2, a: 0.01, d: 1.0, amp: 1.6, color: 'brown', am: { rate: 6, depth: 0.5 } });
  grains(b, sr, r, { t0: 0.1, dur: 1.4, count: 45, dist: 1.8, f: [400, 3000], q: [1, 4], len: [0.004, 0.02], amp: [0.1, 0.6], ampEnv: (u) => 1 - u });
  const pk = peakOf(b);
  for (let i = 0; i < b.length; i++) b[i] /= pk;
  softClip(b, 2.2);
  return b;
}
function fizz(sr, r) {
  const b = alloc(sr, 0.7);
  burst(b, sr, r, { dur: 0.65, mode: 'bp', f: [5200, 6200], q: 0.7, stages: 2, a: 0.004, d: 0.18, amp: 0.4, am: { rate: 40, depth: 0.5 } });
  burst(b, sr, r, { dur: 0.5, mode: 'bp', f: 3200, q: 1, a: 0.002, d: 0.12, amp: 0.15 });
  grains(b, sr, r, { dur: 0.4, count: 30, f: [3000, 9000], q: [4, 10], len: [0.0008, 0.003], amp: [0.2, 0.8] });
  return b;
}
function latch(L, sr, r, t) {
  modes(L, sr, t, rand(r, 1800, 2400), [1, 1.7, 2.6], [0.008, 0.006, 0.004], [1, 0.6, 0.3]);
  burst(L, sr, r, { t0: t, dur: 0.008, mode: 'hp', f: 2000, a: 0.0002, d: 0.0015, amp: 1 });
}
function doorOpen(sr, r) {
  const b = alloc(sr, 0.6);
  layer(b, sr, 0.3, (L) => latch(L, sr, r, 0));
  layer(b, sr, 0.22, (L) => creak(L, sr, r, {
    t0: 0.03, dur: rand(r, 0.28, 0.4), rate: [rand(r, 50, 70), rand(r, 110, 150), rand(r, 80, 100)], jitter: 0.25,
    res: [[rand(r, 380, 480), 12, 1], [rand(r, 900, 1100), 10, 0.6], [rand(r, 1700, 2100), 8, 0.35]],
  }));
  layer(b, sr, 0.25, (L) => modes(L, sr, 0.01, rand(r, 160, 220), [1, 2.3, 3.9], [0.06, 0.04, 0.025], [1, 0.5, 0.3]));
  return b;
}
function doorClose(sr, r) {
  const b = alloc(sr, 0.5);
  layer(b, sr, 0.12, (L) => creak(L, sr, r, { dur: 0.08, rate: [120, 80], res: [[420, 12, 1], [1000, 10, 0.5]] }));
  const t = 0.06;
  layer(b, sr, 0.5, (L) => {
    modes(L, sr, t, rand(r, 110, 150), [1, 2.2, 3.6, 5.3], [0.1, 0.06, 0.04, 0.025], [1, 0.6, 0.4, 0.25], r, 0.03);
    burst(L, sr, r, { t0: t, dur: 0.05, mode: 'lp', f: 1500, a: 0.0005, d: 0.008, amp: 1.5 });
  });
  layer(b, sr, 0.2, (L) => latch(L, sr, r, t + 0.015));
  return b;
}
function chestOpen(sr, r) {
  const b = alloc(sr, 0.9);
  layer(b, sr, 0.3, (L) => creak(L, sr, r, {
    t0: 0.02, dur: rand(r, 0.55, 0.7), rate: [rand(r, 40, 55), rand(r, 90, 120), rand(r, 60, 80), 45], jitter: 0.3,
    res: [[rand(r, 300, 380), 14, 1], [rand(r, 700, 850), 11, 0.7], [rand(r, 1400, 1700), 9, 0.4], [2600, 8, 0.2]],
    env: { a: 0.05, h: 0.3, d: 0.15, r: 0.05 },
  }));
  layer(b, sr, 0.25, (L) => {
    modes(L, sr, 0, rand(r, 120, 160), [1, 2.3, 3.8], [0.08, 0.05, 0.03], [1, 0.5, 0.3]);
    burst(L, sr, r, { dur: 0.03, mode: 'lp', f: 900, d: 0.006, amp: 1 });
  });
  return b;
}
function chestClose(sr, r) {
  const b = alloc(sr, 0.6);
  layer(b, sr, 0.15, (L) => creak(L, sr, r, { dur: 0.12, rate: [90, 60], res: [[350, 14, 1], [800, 10, 0.6]] }));
  const t = 0.1;
  layer(b, sr, 0.55, (L) => {
    modes(L, sr, t, rand(r, 95, 125), [1, 2.25, 3.7, 5.4], [0.13, 0.08, 0.05, 0.03], [1, 0.6, 0.4, 0.25], r, 0.03);
    burst(L, sr, r, { t0: t, dur: 0.08, mode: 'lp', f: 1200, a: 0.0006, d: 0.012, amp: 1.6 });
  });
  burst(b, sr, r, { t0: t, dur: 0.3, mode: 'bp', f: 600, q: 1.5, d: 0.05, amp: 0.1 });
  return b;
}
function toolBreak(sr, r) {
  const b = alloc(sr, 0.5);
  burst(b, sr, r, { dur: 0.05, mode: 'hp', f: 1500, a: 0.0002, d: 0.008, amp: 0.6 });
  layer(b, sr, 0.3, (L) => modes(L, sr, 0, rand(r, 1100, 1500), [1, 1.47, 2.09, 2.83, 3.6], [0.09, 0.07, 0.05, 0.04, 0.03], [1, 0.8, 0.6, 0.4, 0.3], r, 0.03));
  grains(b, sr, r, { dur: 0.25, count: 40, dist: 2, f: [1500, 7000], q: [3, 10], len: [0.001, 0.005], amp: [0.2, 0.9] });
  thud(b, sr, r, 0, 400, 0.015, 0.25);
  return b;
}
function bubbles(L, sr, r, n, t0, span, fr, dist = 1.8, fade = true) {
  for (let i = 0; i < n; i++) {
    const u = Math.pow(r(), dist), t = t0 + u * span;
    bubble(L, sr, t, randLog(r, fr[0], fr[1]), rand(r, 0.4, 1.2), randLog(r, 0.008, 0.03), rand(r, 0.3, 1) * (fade ? 1 - 0.8 * u : 1));
  }
}
function splash(sr, r) {
  const b = alloc(sr, 1.1);
  thud(b, sr, r, 0, 260, 0.05, 0.35);
  burst(b, sr, r, { dur: 0.9, mode: 'bp', f: [1300, 600], q: 0.5, a: 0.006, d: 0.22, amp: 0.4, am: { rate: 50, depth: 0.5 } });
  burst(b, sr, r, { dur: 0.5, mode: 'hp', f: 4000, a: 0.003, d: 0.1, amp: 0.2 });
  layer(b, sr, 0.18, (L) => bubbles(L, sr, r, randInt(r, 25, 40), 0.03, 0.75, [350, 1800]));
  return b;
}
function swim(sr, r) {
  const b = alloc(sr, 0.65);
  burst(b, sr, r, { dur: 0.55, mode: 'bp', f: [rand(r, 700, 900), rand(r, 1300, 1700), 800], q: 0.7, env: { a: 0.09, d: 0.14, r: 0.05 }, amp: 0.35, am: { rate: 35, depth: 0.4 } });
  layer(b, sr, 0.1, (L) => bubbles(L, sr, r, randInt(r, 8, 14), 0.05, 0.45, [400, 1400], 1));
  return b;
}
function anvilLand(sr, r) {
  const b = alloc(sr, 1.8);
  burst(b, sr, r, { dur: 0.04, mode: 'hp', f: 1000, a: 0.0002, d: 0.006, amp: 0.6 });
  layer(b, sr, 0.35, (L) => modes(L, sr, 0, rand(r, 480, 560), [1, 1.47, 2.09, 2.56, 3.39, 4.2, 5.4, 6.9], [1.2, 0.9, 0.7, 0.6, 0.45, 0.35, 0.25, 0.18], [1, 0.7, 0.8, 0.5, 0.4, 0.3, 0.2, 0.15], r, 0.01));
  thud(b, sr, r, 0, 250, 0.04, 0.35);
  return b;
}
function ignite(sr, r) {
  const b = alloc(sr, 0.55);
  const scrape = (t, len) => {
    burst(b, sr, r, { t0: t, dur: len, mode: 'hp', f: [2500, 3500], q: 0.8, a: 0.004, d: len * 0.4, amp: 0.4, am: { rate: 200, depth: 0.8 } });
    grains(b, sr, r, { t0: t, dur: len, count: 25, f: [4000, 10000], q: [3, 10], len: [0.0005, 0.002], amp: [0.3, 1] });
    mode(b, sr, t, rand(r, 3000, 3600), 0.03, 0.08);
  };
  scrape(0, 0.09);
  if (chance(r, 0.6)) scrape(rand(r, 0.1, 0.14), 0.07);
  burst(b, sr, r, { t0: 0.06, dur: 0.4, mode: 'lp', f: [300, 1400, 600], q: 0.7, env: { a: 0.12, d: 0.12, r: 0.05 }, amp: 0.12 });
  return b;
}
function crackles(b, sr, r, n, t0, span, fr = [900, 5000], scale = 1) {
  for (let i = 0; i < n; i++) {
    const t = t0 + r() * span, a = rand(r, 0.2, 1) * scale;
    burst(b, sr, r, { t0: t, dur: 0.025, mode: 'bp', f: randLog(r, fr[0], fr[1]), q: rand(r, 0.7, 2), a: 0.0002, d: randLog(r, 0.001, 0.005), amp: a });
    if (chance(r, 0.35)) burst(b, sr, r, { t0: t + rand(r, 0.008, 0.02), dur: 0.02, mode: 'bp', f: randLog(r, fr[0], fr[1]), q: 1, a: 0.0002, d: 0.002, amp: a * 0.5 });
  }
}
function fireLoop(sr, r) {
  const dur = 2.5;
  const b = alloc(sr, dur);
  const edge = (t) => Math.min(1, t / 0.15, (dur - t) / 0.3);
  burst(b, sr, r, { dur, mode: 'lp', f: 500, q: 0.6, color: 'pink', env: edge, amp: 0.25, am: { rate: 3, depth: 0.5 } });
  burst(b, sr, r, { dur, mode: 'bp', f: 1200, q: 0.5, env: edge, amp: 0.03, am: { rate: 12, depth: 0.7 } });
  crackles(b, sr, r, randInt(r, 25, 40), 0.05, dur - 0.1);
  grains(b, sr, r, { dur: dur - 0.05, count: 80, f: [2000, 8000], q: [2, 6], len: [0.0005, 0.002], amp: [0.05, 0.3] });
  return b;
}
function furnaceCrackle(sr, r) {
  const b = alloc(sr, 1.3);
  burst(b, sr, r, { dur: 1.2, mode: 'lp', f: 400, color: 'pink', env: (t) => Math.min(1, t / 0.1, (1.2 - t) / 0.2), amp: 0.12 });
  crackles(b, sr, r, randInt(r, 5, 9), 0.02, 1.08, [800, 3500]);
  return b;
}
function water(sr, r) {
  const dur = 2.6;
  const b = alloc(sr, dur);
  const edge = (t) => Math.min(1, t / 0.2, (dur - t) / 0.3);
  burst(b, sr, r, { dur, mode: 'bp', f: 1500, q: 0.4, env: edge, amp: 0.05, am: { rate: 4, depth: 0.6 } });
  layer(b, sr, 0.2, (L) => {
    const n = randInt(r, 70, 110);
    for (let i = 0; i < n; i++) {
      const t = rand(r, 0.05, dur - 0.15);
      bubble(L, sr, t, randLog(r, 350, 1400), rand(r, 0.3, 1.2), randLog(r, 0.008, 0.035), rand(r, 0.2, 1) * edge(t));
    }
  });
  return b;
}
function lava(sr, r) {
  const dur = 2.6;
  const b = alloc(sr, dur);
  const edge = (t) => Math.min(1, t / 0.3, (dur - t) / 0.3);
  burst(b, sr, r, { dur, mode: 'lp', f: 280, q: 0.8, color: 'brown', env: edge, amp: 0.5, am: { rate: 3, depth: 0.6 } });
  layer(b, sr, 0.15, (L) => {
    const n = randInt(r, 8, 14);
    for (let i = 0; i < n; i++) bubble(L, sr, rand(r, 0.05, dur - 0.3), randLog(r, 70, 200), rand(r, 0.5, 1.5), randLog(r, 0.04, 0.09), rand(r, 0.3, 1));
  });
  burst(b, sr, r, { dur, mode: 'hp', f: 3000, env: edge, amp: 0.02 });
  return b;
}
function lavaPop(sr, r) {
  const b = alloc(sr, 0.3);
  tone(b, sr, { dur: 0.1, f: [rand(r, 150, 200), rand(r, 420, 520)], env: { a: 0.001, d: 0.025 }, amp: 0.8 });
  burst(b, sr, r, { dur: 0.01, mode: 'lp', f: 2500, a: 0.0002, d: 0.0015, amp: 0.5 });
  burst(b, sr, r, { t0: 0.01, dur: 0.25, mode: 'hp', f: 4000, a: 0.005, d: 0.06, amp: 0.08 });
  return b;
}
function fuse(sr, r, creeper = false) {
  const dur = creeper ? 1.5 : 1.7;
  const b = alloc(sr, dur);
  const swell = creeper ? (t) => 0.55 + 0.45 * (t / dur) : () => 1;
  const base = envFn({ a: creeper ? 0.08 : 0.03, h: dur - 0.3, d: 0.3, r: 0.15 }, dur);
  burst(b, sr, r, { dur, mode: 'bp', f: creeper ? 4200 : 5600, q: creeper ? 0.55 : 0.7, stages: 2, env: (t) => base(t) * swell(t), amp: 0.4, am: { rate: creeper ? 15 : 25, depth: 0.35 } });
  burst(b, sr, r, { dur, mode: 'bp', f: creeper ? 2600 : 3400, q: 1.2, env: (t) => base(t) * swell(t), amp: 0.12 });
  grains(b, sr, r, { dur: dur - 0.1, count: creeper ? 20 : 45, f: [2500, 8000], q: [3, 8], len: [0.0005, 0.002], amp: [0.1, 0.6] });
  return b;
}
function thunder(sr, r) {
  const dur = rand(r, 4.5, 6);
  const b = alloc(sr, dur + 1);
  burst(b, sr, r, { dur: 0.5, mode: 'hp', f: 500, a: 0.002, d: 0.08, amp: 0.35 });
  const n = randInt(r, 4, 7), rolls = [];
  for (let i = 0; i < n; i++) {
    const t = i === 0 ? 0 : rand(r, 0.1, dur * 0.6);
    rolls.push({ t, a: rand(r, 0.02, 0.2), d: rand(r, 0.4, 1.2), g: rand(r, 0.6, 1.2) * (1 - t / dur) });
  }
  const rollEnv = sampled((t) => { let s = 0; for (const q of rolls) { const x = t - q.t; if (x > 0) s += q.g * (x < q.a ? x / q.a : Math.exp(-(x - q.a) / q.d)); } return s; }, dur);
  burst(b, sr, r, { dur, mode: 'lp', f: [randLog(r, 400, 900), 80], q: 0.7, stages: 2, color: 'brown', env: rollEnv, amp: 1 });
  burst(b, sr, r, { dur: dur * 0.6, mode: 'bp', f: [700, 250], q: 0.7, env: (t) => rollEnv(t) * Math.exp(-t / 0.8), amp: 0.08 });
  reverb(b, sr, { room: 0.85, wet: 0.35, damp: 0.5 });
  return b;
}
function rain(sr, r) {
  const dur = 3.5;
  const b = alloc(sr, dur);
  const one = () => 1;
  burst(b, sr, r, { dur, mode: 'bp', f: 2500, q: 0.35, env: one, amp: 0.12, am: { rate: 8, depth: 0.2 } });
  burst(b, sr, r, { dur, mode: 'lp', f: 600, color: 'pink', env: one, amp: 0.25 });
  grains(b, sr, r, { dur, count: 700, f: [1500, 9000], q: [1, 4], len: [0.0005, 0.002], amp: [0.05, 0.5] });
  return loopify(b, sr, 0.5);
}
function caveAmbience(sr, r, v) {
  const kind = v % 8;
  const b = alloc(sr, 6.5);
  switch (kind) {
    case 0: // deep rumble swell
      burst(b, sr, r, { dur: 4.5, mode: 'lp', f: [90, 170, 70], q: 1.2, stages: 2, color: 'brown', env: (t) => smooth(t / 1.6) * Math.exp(-Math.max(0, t - 1.6) / 0.9), amp: 1, am: { rate: 5, depth: 0.5 } });
      reverb(b, sr, { room: 0.9, wet: 0.5, damp: 0.6 });
      break;
    case 1: { // drips in a big cavern
      const n = randInt(r, 2, 4); let t = 0.15;
      for (let i = 0; i < n; i++) { bubble(b, sr, t, randLog(r, 700, 1500), rand(r, 0.4, 0.9), 0.012, rand(r, 0.5, 1)); t += rand(r, 0.35, 0.9); }
      reverb(b, sr, { room: 0.93, wet: 0.9, damp: 0.2, pre: 0.03 });
      break;
    }
    case 2: // slow creak
      layer(b, sr, 0.3, (L) => creak(L, sr, r, { t0: 0.3, dur: rand(r, 1.3, 2), rate: [15, 35, 25, 12], jitter: 0.4, res: [[180, 15, 1], [410, 12, 0.7], [900, 10, 0.3]], env: { a: 0.3, h: 0.6, d: 0.4, r: 0.2 } }));
      lowpass(b, sr, 2500);
      reverb(b, sr, { room: 0.9, wet: 0.6, damp: 0.4 });
      break;
    case 3: { // eerie moan
      const f = randLog(r, 70, 110), iv = pick(r, [1.06, 1.414, 1.189]);
      const e = { a: 1.4, d: 1.2, r: 0.6 };
      tone(b, sr, { dur: 4.2, f: [f, f * 0.96], wave: 'tri', env: e, amp: 0.5, vib: { rate: 0.7, depth: 0.004 } });
      tone(b, sr, { t0: 0.4, dur: 3.8, f: [f * iv, f * iv * 0.95], wave: 'tri', env: e, amp: 0.35, vib: { rate: 0.5, depth: 0.006 } });
      tone(b, sr, { t0: 0.8, dur: 3.2, f: [f * 2.01, f * 1.93], wave: 'sine', env: e, amp: 0.15 });
      lowpass(b, sr, 900);
      reverb(b, sr, { room: 0.92, wet: 0.6, damp: 0.5 });
      break;
    }
    case 4: // distant stones tumbling
      grains(b, sr, r, { t0: 0.1, dur: 1.5, count: 70, dist: 1.6, f: [200, 1300], q: [1, 3], len: [0.003, 0.015], amp: [0.2, 1], ampEnv: (u) => 1 - 0.7 * u });
      thud(b, sr, r, 0.1, 160, 0.06, 0.6);
      lowpass(b, sr, 1400);
      reverb(b, sr, { room: 0.9, wet: 0.7, damp: 0.5 });
      break;
    case 5: // tunnel wind / breath
      burst(b, sr, r, { dur: 4, mode: 'bp', f: [250, 700, 330], q: 2, color: 'pink', env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / 4)), 2), amp: 0.6 });
      reverb(b, sr, { room: 0.88, wet: 0.5, damp: 0.5 });
      break;
    case 6: { // two distant knocks
      layer(b, sr, 0.4, (L) => {
        const f = rand(r, 90, 140);
        modes(L, sr, 0.1, f, [1, 2.3, 3.9], [0.1, 0.06, 0.04], [1, 0.5, 0.3]);
        modes(L, sr, 0.1 + rand(r, 0.35, 0.6), f * rand(r, 0.9, 1.1), [1, 2.3, 3.9], [0.1, 0.06, 0.04], [0.7, 0.35, 0.2]);
      });
      lowpass(b, sr, 1200);
      reverb(b, sr, { room: 0.93, wet: 0.8, damp: 0.4, pre: 0.04 });
      break;
    }
    default: // low breathing growl
      layer(b, sr, 0.3, (L) => voice(L, sr, r, { t0: 0.2, dur: 2.2, f0: [48, 55, 42], jitter: 0.08, creak: 0.6, breath: 0.7, formants: vowelPath([[0, 'u'], [0.5, 'o'], [1, 'u']], 0.6), tilt: 600, env: { a: 0.8, h: 0.4, d: 0.5, r: 0.3 } }));
      lowpass(b, sr, 1000);
      reverb(b, sr, { room: 0.9, wet: 0.55, damp: 0.5 });
  }
  return b;
}

// ====================================================== PLAYER / COMBAT ====
function hurtGrunt(sr, r) {
  const dur = rand(r, 0.24, 0.32);
  const b = alloc(sr, dur + 0.06);
  const f = rand(r, 170, 210);
  layer(b, sr, 0.3, (L) => voice(L, sr, r, {
    dur, f0: [f, f * 0.85, f * 0.68], jitter: 0.03, creak: 0.2, breath: 0.35,
    formants: vowelPath([[0, 'uh'], [1, 'u']], 1), tilt: 2200, env: { a: 0.006, h: 0.04, d: 0.06, r: 0.04 }, drive: 1,
  }));
  thud(b, sr, r, 0, 280, 0.03, 0.3);
  burst(b, sr, r, { dur: 0.06, mode: 'bp', f: 1200, q: 1, a: 0.0005, d: 0.012, amp: 0.15 });
  return b;
}
function hurtDrown(sr, r) {
  const b = hurtGrunt(sr, r);
  lowpass(b, sr, 700); lowpass(b, sr, 900);
  const out = alloc(sr, 0.5); out.set(b.subarray(0, Math.min(b.length, out.length)));
  layer(out, sr, 0.12, (L) => bubbles(L, sr, r, randInt(r, 8, 14), 0, 0.35, [300, 1100], 1));
  return out;
}
function hurtFire(sr, r) {
  const b0 = hurtGrunt(sr, r);
  const b = alloc(sr, 0.5); b.set(b0.subarray(0, Math.min(b0.length, b.length)));
  burst(b, sr, r, { dur: 0.45, mode: 'hp', f: 3500, a: 0.01, d: 0.12, amp: 0.12, am: { rate: 40, depth: 0.5 } });
  crackles(b, sr, r, 4, 0.02, 0.3);
  return b;
}
function fallSmall(sr, r) {
  const b = alloc(sr, 0.3);
  thud(b, sr, r, 0, [300, 120], 0.04, 0.5);
  mode(b, sr, 0, rand(r, 80, 100), 0.05, 0.35);
  grains(b, sr, r, { dur: 0.08, count: 12, f: [400, 1800], q: [1, 3], len: [0.002, 0.006], amp: [0.1, 0.4] });
  return b;
}
function fallBig(sr, r) {
  const b = alloc(sr, 0.55);
  thud(b, sr, r, 0, [260, 90], 0.08, 0.6);
  mode(b, sr, 0, rand(r, 55, 70), 0.09, 0.5);
  grains(b, sr, r, { dur: 0.12, count: 30, dist: 1.6, f: [600, 2600], q: [2, 5], len: [0.002, 0.008], amp: [0.3, 1] });
  burst(b, sr, r, { dur: 0.05, mode: 'bp', f: 1500, q: 1.5, d: 0.01, amp: 0.25 });
  return b;
}
const bellCurve = (T, p = 2) => (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / T)), p);
function attackSweep(sr, r) {
  const b = alloc(sr, 0.4);
  burst(b, sr, r, { dur: 0.36, mode: 'bp', f: [450, 2600, 900], q: 2.2, env: bellCurve(0.34), amp: 0.4 });
  burst(b, sr, r, { dur: 0.3, mode: 'hp', f: [3000, 6000, 3500], env: bellCurve(0.3, 3), amp: 0.08 });
  tone(b, sr, { dur: 0.34, f: [700, 1700, 900], env: bellCurve(0.34, 3), amp: 0.03 });
  return b;
}
function attackCrit(sr, r) {
  const b = alloc(sr, 0.4);
  burst(b, sr, r, { dur: 0.05, mode: 'hp', f: 1200, a: 0.0002, d: 0.01, amp: 0.7 });
  thud(b, sr, r, 0, 350, 0.035, 0.45);
  layer(b, sr, 0.15, (L) => { mode(L, sr, 0, 2200, 0.06, 1); mode(L, sr, 0, 3150, 0.05, 0.7); mode(L, sr, 0, 4700, 0.03, 0.4); });
  grains(b, sr, r, { dur: 0.15, count: 20, dist: 1.5, f: [3000, 9000], q: [4, 10], len: [0.001, 0.003], amp: [0.2, 0.8] });
  return b;
}
function attackStrong(sr, r) {
  const b = alloc(sr, 0.35);
  burst(b, sr, r, { dur: 0.08, mode: 'bp', f: [800, 2400], q: 1.5, env: { a: 0.05, d: 0.01 }, amp: 0.15 });
  const t = 0.055;
  thud(b, sr, r, t, [400, 150], 0.05, 0.6);
  burst(b, sr, r, { t0: t, dur: 0.06, mode: 'bp', f: 1300, q: 1, a: 0.0005, d: 0.015, amp: 0.3 });
  mode(b, sr, t, rand(r, 90, 120), 0.05, 0.35);
  return b;
}
function attackWeak(sr, r) {
  const b = alloc(sr, 0.25);
  burst(b, sr, r, { dur: 0.1, mode: 'bp', f: [700, 1800], q: 1.2, env: { a: 0.06, d: 0.02 }, amp: 0.12 });
  thud(b, sr, r, 0.05, 450, 0.025, 0.3);
  return b;
}
function attackKnockback(sr, r) {
  const b = alloc(sr, 0.45);
  burst(b, sr, r, { dur: 0.16, mode: 'bp', f: [500, 2200], q: 1.6, env: { a: 0.12, d: 0.02 }, amp: 0.25 });
  const t = 0.12;
  thud(b, sr, r, t, [350, 110], 0.07, 0.7);
  mode(b, sr, t, 75, 0.08, 0.4);
  burst(b, sr, r, { t0: t, dur: 0.05, mode: 'bp', f: 1100, q: 1, a: 0.0005, d: 0.012, amp: 0.3 });
  return b;
}
function attackNoDamage(sr, r) {
  const b = alloc(sr, 0.25);
  burst(b, sr, r, { dur: 0.22, mode: 'bp', f: [600, 1800, 1000], q: 1.5, env: bellCurve(0.2), amp: 0.25 });
  return b;
}
function shieldBlock(sr, r) {
  const b = alloc(sr, 0.6);
  layer(b, sr, 0.4, (L) => {
    modes(L, sr, 0, rand(r, 170, 230), [1, 2.3, 3.9, 5.7], [0.08, 0.05, 0.035, 0.02], [1, 0.6, 0.4, 0.2], r, 0.03);
    burst(L, sr, r, { dur: 0.02, mode: 'lp', f: 2000, d: 0.003, amp: 1 });
  });
  layer(b, sr, 0.14, (L) => modes(L, sr, 0, rand(r, 900, 1200), [1, 1.53, 2.31, 3.1], [0.25, 0.18, 0.12, 0.08], [1, 0.7, 0.5, 0.3], r, 0.02));
  burst(b, sr, r, { dur: 0.04, mode: 'hp', f: 2000, d: 0.006, amp: 0.3 });
  return b;
}
function rustle(b, sr, r, dur, amp, f = [2000, 3000]) {
  burst(b, sr, r, { dur, mode: 'bp', f, q: 0.8, env: { a: 0.03, d: dur * 0.25, r: 0.05 }, amp, am: { rate: 50, depth: 0.8 } });
}
function clinks(sr, r, b, level, fr, ratios, taus, n, spread) {
  layer(b, sr, level, (L) => {
    for (let i = 0; i < n; i++) {
      const t = i * spread * rand(r, 0.7, 1.3) + rand(r, 0, 0.02);
      modes(L, sr, t, randLog(r, fr[0], fr[1]), ratios, taus, [1, 0.7, 0.5, 0.3], r, 0.02);
    }
  });
}
function equipGeneric(sr, r) {
  const b = alloc(sr, 0.45);
  rustle(b, sr, r, 0.35, 0.25);
  clinks(sr, r, b, 0.1, [2500, 5500], [1, 1.6], [0.02, 0.012], randInt(r, 5, 9), 0.04);
  return b;
}
function equipIron(sr, r) {
  const b = alloc(sr, 0.6);
  rustle(b, sr, r, 0.35, 0.12, 2500);
  clinks(sr, r, b, 0.3, [1400, 2600], [1, 1.51, 2.24, 2.87], [0.08, 0.06, 0.045, 0.03], randInt(r, 3, 5), 0.07);
  return b;
}
function equipDiamond(sr, r) {
  const b = alloc(sr, 0.7);
  rustle(b, sr, r, 0.3, 0.08, 3000);
  clinks(sr, r, b, 0.28, [2400, 4200], [1, 2.32, 4.25], [0.18, 0.1, 0.05], randInt(r, 3, 4), 0.08);
  return b;
}
function equipGold(sr, r) {
  const b = alloc(sr, 0.7);
  rustle(b, sr, r, 0.3, 0.08, 2200);
  clinks(sr, r, b, 0.28, [1000, 1900], [1, 1.5, 2.2, 2.9], [0.18, 0.13, 0.09, 0.06], randInt(r, 3, 4), 0.08);
  return b;
}
function equipLeather(sr, r) {
  const b = alloc(sr, 0.45);
  const n = randInt(r, 2, 3);
  for (let i = 0; i < n; i++) burst(b, sr, r, { t0: i * rand(r, 0.08, 0.12), dur: 0.12, mode: 'lp', f: [1800, 700], q: 0.9, a: 0.005, d: 0.03, amp: 0.4 });
  layer(b, sr, 0.08, (L) => creak(L, sr, r, { t0: 0.05, dur: 0.2, rate: [150, 90], res: [[500, 8, 1], [1200, 6, 0.5]] }));
  return b;
}
function till(sr, r) {
  const b = alloc(sr, 0.4);
  thud(b, sr, r, 0, 280, 0.025, 0.35);
  grains(b, sr, r, { dur: 0.3, count: 150, dist: 1.4, f: [300, 2200], q: [1.2, 3.5], len: [0.002, 0.01], amp: [0.2, 1], ampEnv: (u) => 1 - 0.7 * u });
  burst(b, sr, r, { dur: 0.3, mode: 'bp', f: [900, 500], q: 0.8, a: 0.003, d: 0.07, amp: 0.2, am: { rate: 80, depth: 0.7 } });
  return b;
}
function bucketFill(sr, r) {
  const b = alloc(sr, 0.9);
  burst(b, sr, r, { dur: 0.7, mode: 'bp', f: [700, 1300], q: 0.7, env: { a: 0.05, d: 0.2, r: 0.08 }, amp: 0.3, am: { rate: 30, depth: 0.5 } });
  layer(b, sr, 0.15, (L) => {
    const n = randInt(r, 14, 22);
    for (let i = 0; i < n; i++) { const u = i / n; bubble(L, sr, 0.03 + u * 0.55 + rand(r, 0, 0.03), randLog(r, 300, 500) * (1 + u), rand(r, 0.4, 1), randLog(r, 0.01, 0.03), rand(r, 0.4, 1)); }
  });
  layer(b, sr, 0.07, (L) => modes(L, sr, 0, rand(r, 650, 750), [1, 2.35, 3.9], [0.2, 0.12, 0.08], [1, 0.5, 0.3]));
  return b;
}
function bucketEmpty(sr, r) {
  const b = alloc(sr, 0.9);
  burst(b, sr, r, { dur: 0.75, mode: 'bp', f: [1500, 800], q: 0.5, env: { a: 0.02, d: 0.25, r: 0.08 }, amp: 0.4, am: { rate: 40, depth: 0.5 } });
  layer(b, sr, 0.15, (L) => bubbles(L, sr, r, randInt(r, 15, 25), 0.02, 0.6, [300, 1200], 1.3));
  layer(b, sr, 0.06, (L) => modes(L, sr, 0, rand(r, 650, 750), [1, 2.35, 3.9], [0.2, 0.12, 0.08], [1, 0.5, 0.3]));
  return b;
}

// ============================================================== MOBS ====
function vocal(b, sr, r, level, o) { layer(b, sr, level, (L) => voice(L, sr, r, o)); }

// Zombie
const ZOMBIE_VOWELS = [
  [[0, 'u'], [0.3, 'uh'], [0.6, 'a'], [1, 'o']],
  [[0, 'm'], [0.25, 'o'], [0.55, 'a'], [0.85, 'uh'], [1, 'u']],
  [[0, 'uh'], [0.4, 'er'], [0.7, 'a'], [1, 'u']],
];
function zombieSay(sr, r, v) {
  const dur = rand(r, 0.9, 1.4);
  const b = alloc(sr, dur + 0.1);
  const f = rand(r, 78, 100);
  vocal(b, sr, r, 0.3, {
    dur, f0: [f * 0.95, f * 1.12, f * 1.05, f * 0.8], jitter: 0.05, creak: 0.55, breath: 0.3,
    formants: vowelPath(ZOMBIE_VOWELS[v % 3], 0.92), bw: [110, 140, 200], tilt: 1400, drive: 2.2,
    trem: { rate: rand(r, 5, 8), depth: 0.3 }, env: { a: 0.14, h: dur * 0.45, d: dur * 0.2, r: 0.12 },
  });
  return b;
}
function zombieHurt(sr, r) {
  const dur = rand(r, 0.38, 0.5);
  const b = alloc(sr, dur + 0.05);
  const f = rand(r, 125, 150);
  vocal(b, sr, r, 0.3, {
    dur, f0: [f, f * 1.1, f * 0.7], jitter: 0.05, creak: 0.5, breath: 0.35,
    formants: vowelPath([[0, 'a'], [1, 'uh']], 0.95), bw: [120, 150, 220], tilt: 1800, drive: 2.5,
    env: { a: 0.012, h: 0.06, d: dur * 0.25, r: 0.06 },
  });
  return b;
}
function zombieDeath(sr, r) {
  const dur = 1.6;
  const b = alloc(sr, dur + 0.1);
  vocal(b, sr, r, 0.3, {
    dur, f0: [110, 120, 85, 55], jitter: 0.06, creak: 0.7, breath: 0.35,
    formants: vowelPath([[0, 'a'], [0.4, 'o'], [1, 'u']], 0.92), bw: [120, 150, 220], tilt: 1500, drive: 2.2,
    trem: { rate: 9, depth: 0.4 }, env: { a: 0.03, h: 0.5, d: 0.4, r: 0.2 },
  });
  return b;
}
function heavyStep(sr, r, f = 200) {
  const b = alloc(sr, 0.35);
  thud(b, sr, r, 0, f, 0.035, 0.5);
  burst(b, sr, r, { t0: 0.01, dur: 0.28, mode: 'bp', f: [1400, 900], q: 0.8, env: { a: 0.04, d: 0.06, r: 0.04 }, amp: 0.2, am: { rate: 80, depth: 0.7 } });
  grains(b, sr, r, { dur: 0.2, count: 30, f: [500, 2500], q: [1.5, 4], len: [0.002, 0.006], amp: [0.2, 0.7] });
  return b;
}

// Skeleton
function clack(b, sr, r, t, scale, amp) {
  const f = randLog(r, 900, 2400) * scale;
  modes(b, sr, t, f, [1, rand(r, 1.6, 1.9), rand(r, 2.7, 3.2)], [0.012, 0.008, 0.005], [amp, amp * 0.6, amp * 0.35]);
  burst(b, sr, r, { t0: t, dur: 0.006, mode: 'hp', f: 3000, a: 0.0002, d: 0.0012, amp: amp * 0.4 });
}
function skeletonSay(sr, r) {
  const dur = rand(r, 0.6, 0.9);
  const b = alloc(sr, dur + 0.15);
  layer(b, sr, 0.3, (L) => {
    let t = rand(r, 0, 0.05);
    const nb = randInt(r, 2, 3);
    for (let k = 0; k < nb; k++) {
      const n = randInt(r, 5, 10), rate = rand(r, 25, 40);
      for (let i = 0; i < n && t < dur; i++) { clack(L, sr, r, t, rand(r, 0.8, 1.2), rand(r, 0.4, 1)); t += (1 / rate) * rand(r, 0.6, 1.4); }
      t += rand(r, 0.05, 0.15);
    }
  });
  burst(b, sr, r, { dur, mode: 'bp', f: [1300, 1800, 1200], q: 1.3, env: { a: dur * 0.3, d: dur * 0.2, r: 0.08 }, amp: 0.1, am: { rate: 30, depth: 0.6 } });
  return b;
}
function skeletonHurt(sr, r) {
  const b = alloc(sr, 0.4);
  burst(b, sr, r, { dur: 0.04, mode: 'hp', f: 1500, a: 0.0002, d: 0.006, amp: 0.4 });
  layer(b, sr, 0.35, (L) => { let t = 0; const n = randInt(r, 6, 10); for (let i = 0; i < n; i++) { clack(L, sr, r, t, rand(r, 0.9, 1.3), rand(r, 0.5, 1) * (1 - i / n * 0.5)); t += rand(r, 0.012, 0.03); } });
  burst(b, sr, r, { dur: 0.3, mode: 'bp', f: 1600, q: 1.3, env: { a: 0.01, d: 0.08 }, amp: 0.12, am: { rate: 35, depth: 0.6 } });
  return b;
}
function skeletonDeath(sr, r) {
  const b = alloc(sr, 1.2);
  layer(b, sr, 0.3, (L) => {
    const n = randInt(r, 30, 40);
    for (let i = 0; i < n; i++) { const u = Math.pow(r(), 1.7); clack(L, sr, r, u * 1.0, 1.2 - 0.5 * u, rand(r, 0.4, 1) * (1 - 0.6 * u)); }
    for (let i = 0; i < 3; i++) mode(L, sr, rand(r, 0.1, 0.8), rand(r, 180, 300), 0.03, 0.6);
  });
  return b;
}
function skeletonStep(sr, r) {
  const b = alloc(sr, 0.22);
  layer(b, sr, 0.3, (L) => { const n = randInt(r, 2, 3); let t = 0; for (let i = 0; i < n; i++) { clack(L, sr, r, t, rand(r, 0.8, 1.1), rand(r, 0.6, 1)); t += rand(r, 0.02, 0.05); } });
  burst(b, sr, r, { dur: 0.12, mode: 'bp', f: 2000, q: 1, a: 0.004, d: 0.025, amp: 0.1 });
  return b;
}

// Creeper
function creeperRustle(sr, r, dur = 0.35, n = 140) {
  const b = alloc(sr, dur + 0.1);
  grains(b, sr, r, { dur, count: n, f: [900, 5000], q: [2, 6], len: [0.002, 0.008], amp: [0.2, 1], ampEnv: (u) => Math.sin(Math.PI * Math.min(1, 0.1 + u)) });
  burst(b, sr, r, { dur, mode: 'bp', f: 2500, q: 0.8, env: { a: 0.02, d: dur * 0.3, r: 0.04 }, amp: 0.15, am: { rate: 80, depth: 0.8 } });
  return b;
}
function creeperDeath(sr, r) {
  const b = creeperRustle(sr, r, 0.7, 260);
  thud(b, sr, r, 0, 220, 0.04, 0.3);
  return b;
}

// Spider
function chitterEnv(rateCurve, base) {
  let ph = 0, lt = 0;
  return (t) => {
    ph += rateCurve(t) * (t - lt); lt = t;
    return base(t) * Math.pow(0.5 + 0.5 * Math.sin(TAU * ph), 2.5);
  };
}
function spiderSay(sr, r) {
  const dur = rand(r, 0.7, 1.0);
  const b = alloc(sr, dur + 0.05);
  const rate = rand(r, 28, 45);
  const base = envFn({ a: 0.06, h: dur * 0.4, d: dur * 0.25, r: 0.08 }, dur);
  const ch1 = chitterEnv(() => rate, base), ch2 = chitterEnv(() => rate, base);
  burst(b, sr, r, { dur, mode: 'bp', f: [3400, 4200, 2800], q: 1.1, env: (t) => base(t) * 0.2 + 0.8 * ch1(t), amp: 0.35 });
  burst(b, sr, r, { dur, mode: 'lp', f: 600, q: 1.5, env: ch2, amp: 0.25 });
  grains(b, sr, r, { dur, count: 14, f: [2000, 6000], q: [4, 9], len: [0.001, 0.003], amp: [0.3, 0.9] });
  return b;
}
function spiderStep(sr, r) {
  const b = alloc(sr, 0.25);
  const n = randInt(r, 3, 4);
  for (let i = 0; i < n; i++) {
    const t = i * rand(r, 0.035, 0.06);
    burst(b, sr, r, { t0: t, dur: 0.02, mode: 'bp', f: randLog(r, 2000, 4000), q: 2, a: 0.0002, d: 0.003, amp: rand(r, 0.5, 1) });
    mode(b, sr, t, randLog(r, 1500, 3000), 0.004, 0.2);
  }
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: 3000, q: 1, a: 0.01, d: 0.05, amp: 0.06 });
  return b;
}
function spiderDeath(sr, r) {
  const dur = 1.2;
  const b = alloc(sr, dur + 0.05);
  const base = envFn({ a: 0.02, h: 0.3, d: 0.35, r: 0.1 }, dur);
  const rc = (t) => 45 - 30 * (t / dur);
  const ch1 = chitterEnv(rc, base), ch2 = chitterEnv(rc, base);
  burst(b, sr, r, { dur, mode: 'bp', f: [4500, 1800], q: 1.1, env: (t) => base(t) * 0.25 + 0.75 * ch1(t), amp: 0.35 });
  burst(b, sr, r, { dur, mode: 'lp', f: [800, 300], q: 1.5, env: ch2, amp: 0.25 });
  return b;
}

// Pig
function pigSay(sr, r, v) {
  const b = alloc(sr, 0.75);
  const grunts = v === 2 ? 2 : 1;
  let t = 0;
  for (let g = 0; g < grunts; g++) {
    const dur = rand(r, 0.2, 0.3) * (grunts > 1 ? 0.8 : 1);
    const f = rand(r, 150, 200);
    const o = {
      t0: t, dur, f0: [f * 0.9, f * 1.15, f * 0.8], jitter: 0.06, creak: 0.35, breath: 0.35,
      trem: { rate: rand(r, 38, 50), depth: 0.55 }, formants: vowelPath([[0, 'u'], [0.35, 'o'], [1, 'u']], 0.95),
      fg: [1, 0.7, 0.35], bw: [120, 150, 200], tilt: 2000, drive: 1.6, env: { a: 0.018, h: dur * 0.3, d: dur * 0.25, r: 0.04 },
    };
    vocal(b, sr, r, 0.3, o);
    burst(b, sr, r, { t0: t, dur: dur * 0.7, mode: 'bp', f: 1100, q: 1.3, env: { a: 0.01, d: 0.04 }, amp: 0.1 });
    t += dur + rand(r, 0.06, 0.1);
  }
  return b;
}
function pigSqueal(sr, r, death) {
  const dur = death ? 0.9 : rand(r, 0.35, 0.5);
  const b = alloc(sr, dur + 0.05);
  vocal(b, sr, r, 0.3, {
    dur, f0: death ? [800, 850, 600, 300] : [520, 880, 700], vib: { rate: 12, depth: 0.03 }, jitter: 0.04, breath: 0.25,
    wave: 'pulse', width: 0.3, formants: vowelPath([[0, 'i'], [0.5, 'e'], [1, 'i']], 1.1), fg: [0.8, 1, 0.7], direct: 0.2, tilt: 5000, drive: 1.8,
    env: { a: 0.02, h: dur * 0.4, d: dur * 0.2, r: 0.05 },
  });
  return b;
}
function hoofStep(sr, r, heavy = 1) {
  const b = alloc(sr, 0.25);
  thud(b, sr, r, 0, 300 - 100 * heavy, 0.02 + 0.02 * heavy, 0.5);
  if (heavy > 0.5) mode(b, sr, 0, rand(r, 95, 120), 0.04, 0.25 * heavy);
  burst(b, sr, r, { dur: 0.15, mode: 'bp', f: [3000, 2200], q: 0.8, a: 0.005, d: 0.035, amp: 0.13, am: { rate: 150, depth: 0.8 } });
  return b;
}

// Cow
function moo(sr, r, hurt) {
  const dur = hurt ? rand(r, 0.5, 0.65) : rand(r, 1.1, 1.6);
  const b = alloc(sr, dur + 0.1);
  const fs = rand(r, 92, 118) * (hurt ? 1.3 : 1), fp = fs * (hurt ? rand(r, 1.08, 1.18) : rand(r, 1.2, 1.4));
  const f0 = (u) => u < 0.28 ? fs + (fp - fs) * smooth(u / 0.28)
    : u < 0.7 ? fp * (1 - 0.06 * (u - 0.28) / 0.42)
      : fp * 0.94 + (fs * 0.82 - fp * 0.94) * smooth((u - 0.7) / 0.3);
  const open = hurt ? (u) => Math.min(1, u / 0.12) * (1 - 0.3 * u) : (u) => u < 0.35 ? smooth(u / 0.35) : u < 0.8 ? 1 - 0.3 * (u - 0.35) / 0.45 : 0.7 - 0.4 * smooth((u - 0.8) / 0.2);
  const sc = rand(r, 0.66, 0.74);
  vocal(b, sr, r, 0.3, {
    dur, f0, jitter: 0.012, vib: { rate: 5, depth: 0.012, delay: 0.4 }, breath: 0.08, creak: hurt ? 0.3 : 0.1,
    formants: (u) => { const k = open(u); return [(280 + 420 * k) * sc, (850 + 350 * k) * sc, (2200 + 300 * k) * sc]; },
    fg: (u) => { const k = open(u); return [1, 0.2 + 0.5 * k, 0.05 + 0.25 * k]; },
    bw: [80, 110, 180], tilt: hurt ? 1400 : 900, drive: hurt ? 1.5 : 0,
    env: hurt ? { a: 0.03, h: dur * 0.4, d: dur * 0.2, r: 0.08 } : { a: 0.15, h: dur * 0.55, d: dur * 0.12, r: 0.15 },
  });
  burst(b, sr, r, { dur, mode: 'lp', f: 800, env: { a: 0.2, h: dur * 0.5, d: 0.2, r: 0.1 }, amp: 0.02 });
  return b;
}

// Sheep
function baa(sr, r) {
  const dur = rand(r, 0.7, 1.0);
  const b = alloc(sr, dur + 0.08);
  const f = rand(r, 260, 340), rate = rand(r, 9, 13);
  vocal(b, sr, r, 0.3, {
    dur, f0: [f * 0.92, f * 1.05, f * 1.0, f * 0.86], vib: { rate, depth: 0.035 }, trem: { rate, depth: 0.55 },
    jitter: 0.02, breath: 0.22, creak: 0.15, formants: vowelPath([[0, 'm'], [0.1, 'e'], [0.5, 'ae'], [1, 'e']], rand(r, 0.95, 1.05)),
    fg: [1, 0.85, 0.6], direct: 0.2, bw: [100, 130, 200], tilt: 4000, drive: 1.4, env: { a: 0.04, h: dur * 0.5, d: dur * 0.2, r: 0.1 },
  });
  return b;
}
function shear(sr, r) {
  const b = alloc(sr, 0.35);
  for (const t of [0, rand(r, 0.1, 0.14)]) {
    burst(b, sr, r, { t0: t, dur: 0.03, mode: 'hp', f: 3000, a: 0.0002, d: 0.005, amp: 0.4 });
    modes(b, sr, t, rand(r, 2600, 3000), [1, 1.55, 2.4], [0.03, 0.02, 0.015], [0.3, 0.2, 0.12]);
    burst(b, sr, r, { t0: t, dur: 0.06, mode: 'bp', f: 5000, q: 1.2, a: 0.002, d: 0.015, amp: 0.15 });
  }
  return b;
}
function sheepStep(sr, r) {
  const b = alloc(sr, 0.22);
  thud(b, sr, r, 0, 250, 0.022, 0.4);
  burst(b, sr, r, { dur: 0.15, mode: 'lp', f: 1200, q: 0.7, a: 0.008, d: 0.035, amp: 0.2 });
  return b;
}

// Chicken
function cluck(sr, r) {
  const b = alloc(sr, 0.7);
  const n = randInt(r, 2, 4);
  let t = 0;
  const base = rand(r, 380, 480);
  for (let i = 0; i < n; i++) {
    const last = i === n - 1 && chance(r, 0.6);
    const dur = last ? rand(r, 0.12, 0.17) : rand(r, 0.05, 0.08);
    const f = base * rand(r, 0.9, 1.15);
    vocal(b, sr, r, 0.28, {
      t0: t, dur, f0: last ? [f * 0.9, f * 1.3, f * 1.05] : [f * 1.2, f * 0.8], wave: 'pulse', width: 0.3,
      jitter: 0.04, creak: 0.3, breath: 0.2, formants: vowelPath([[0, 'a'], [1, 'o']], 1.5), bw: [150, 200, 300],
      tilt: 3500, drive: 1.5, env: { a: 0.004, h: dur * 0.3, d: dur * 0.3, r: 0.01 },
    });
    t += dur + rand(r, 0.04, 0.09);
  }
  return b;
}
function squawk(sr, r) {
  const dur = rand(r, 0.25, 0.35);
  const b = alloc(sr, dur + 0.05);
  vocal(b, sr, r, 0.3, {
    dur, f0: [700, 1000, 800], trem: { rate: 60, depth: 0.5 }, jitter: 0.06, breath: 0.35, creak: 0.3,
    wave: 'pulse', width: 0.25, formants: vowelPath([[0, 'ae'], [1, 'a']], 1.5), bw: [160, 220, 320], tilt: 5000, drive: 2,
    env: { a: 0.006, h: dur * 0.3, d: dur * 0.3, r: 0.03 },
  });
  return b;
}
function plop(sr, r) {
  const b = alloc(sr, 0.2);
  tone(b, sr, { dur: 0.12, f: [380, 120], env: { a: 0.002, d: 0.04 }, amp: 0.8 });
  thud(b, sr, r, 0, 300, 0.015, 0.25);
  return b;
}
function chickenStep(sr, r) {
  const b = alloc(sr, 0.12);
  burst(b, sr, r, { dur: 0.05, mode: 'bp', f: 3000, q: 1, a: 0.0005, d: 0.008, amp: 0.3 });
  mode(b, sr, 0, rand(r, 2200, 2800), 0.004, 0.25);
  thud(b, sr, r, 0, 400, 0.006, 0.15);
  return b;
}

// Enderman
const VOWEL_NAMES = ['a', 'o', 'u', 'e', 'i', 'uh', 'aw'];
const reversedEnv = (t, u) => Math.pow(Math.min(1, u / 0.85), 1.6) * Math.min(1, (1 - u) / 0.08);
function endermanIdle(sr, r) {
  const dur = rand(r, 0.9, 1.3);
  const b = alloc(sr, dur + 0.5);
  const pts = []; const k = randInt(r, 4, 6);
  for (let i = 0; i < k; i++) pts.push(randLog(r, 110, 330));
  const seq = [0, 0.33, 0.66, 1].map((u) => [u, pick(r, VOWEL_NAMES)]);
  vocal(b, sr, r, 0.3, {
    dur, f0: pts, vib: { rate: rand(r, 5, 9), depth: 0.04 }, jitter: 0.03, breath: 0.25, creak: 0.3,
    formants: vowelPath(seq, rand(r, 0.8, 1.1)), tilt: 2500, drive: 1.8,
    ring: { f: [rand(r, 80, 140), rand(r, 60, 180)], mix: 0.55 }, env: reversedEnv,
  });
  reverb(b, sr, { room: 0.6, wet: 0.2, damp: 0.5 });
  return b;
}
function endermanScream(sr, r) {
  const dur = rand(r, 1.0, 1.3);
  const b = alloc(sr, dur + 0.5);
  const f = rand(r, 480, 620);
  layer(b, sr, 0.3, (L) => {
    voice(L, sr, r, { dur, f0: [f * 0.8, f * 1.1, f, f * 0.9], vib: { rate: 7, depth: 0.06 }, jitter: 0.05, breath: 0.35, creak: 0.3, formants: vowelPath([[0, 'a'], [0.5, 'ae'], [1, 'a']], 1.1), fg: [0.8, 1, 0.8], direct: 0.25, tilt: 5000, drive: 3, ring: { f: rand(r, 250, 330), mix: 0.45 }, env: { a: 0.03, h: dur * 0.6, d: dur * 0.15, r: 0.1 } });
    voice(L, sr, r, { dur, f0: [f * 1.2, f * 1.6, f * 1.5, f * 1.3], wave: 'pulse', vib: { rate: 7.5, depth: 0.07 }, jitter: 0.05, breath: 0.3, formants: vowelPath([[0, 'e'], [1, 'a']], 1.1), tilt: 5000, drive: 2.5, env: { a: 0.05, h: dur * 0.55, d: dur * 0.15, r: 0.1 }, amp: 0.6 });
  });
  reverb(b, sr, { room: 0.5, wet: 0.15 });
  return b;
}
function endermanHit(sr, r) {
  const dur = rand(r, 0.4, 0.5);
  const b = alloc(sr, dur + 0.4);
  vocal(b, sr, r, 0.3, {
    dur, f0: [420, 480, 250], jitter: 0.05, breath: 0.3, creak: 0.4, formants: vowelPath([[0, 'a'], [1, 'uh']], 1.05),
    tilt: 4000, drive: 3, ring: { f: rand(r, 150, 190), mix: 0.6 }, env: { a: 0.01, h: dur * 0.3, d: dur * 0.25, r: 0.05 },
  });
  reverb(b, sr, { room: 0.5, wet: 0.15 });
  return b;
}
function endermanDeath(sr, r) {
  const dur = 2.0;
  const b = alloc(sr, dur + 0.8);
  vocal(b, sr, r, 0.3, {
    dur, f0: [600, 650, 300, 110], vib: { rate: 9, depth: 0.08 }, jitter: 0.05, breath: 0.3, creak: 0.35,
    formants: vowelPath([[0, 'a'], [0.5, 'o'], [1, 'u']], 1.05), tilt: 4000, drive: 2.5,
    ring: { f: [220, 60], mix: 0.5 }, env: { a: 0.03, h: 0.8, d: 0.5, r: 0.25 },
  });
  reverb(b, sr, { room: 0.8, wet: 0.3, damp: 0.4 });
  return b;
}
function portal(sr, r, v) {
  const dur = rand(r, 0.6, 0.8);
  const b = alloc(sr, dur + 0.6);
  const up = v % 2 === 0;
  const sine = (t, u) => Math.pow(Math.sin(Math.PI * Math.min(1, u)), 1.5);
  layer(b, sr, 0.25, (L) => tone(L, sr, { dur, f: up ? [160, 900, 320] : [700, 140, 420], fm: { ratio: 1.5, index: [3, 1, 2] }, env: sine, amp: 1 }));
  layer(b, sr, 0.2, (L) => {
    burst(L, sr, r, { dur, mode: 'notch', stages: 2, f: up ? [300, 5000, 800] : [4000, 300, 1500], q: 0.8, env: sine, amp: 1 });
    burst(L, sr, r, { dur, mode: 'bp', f: up ? [400, 3000, 700] : [3000, 400, 1200], q: 3, env: sine, amp: 0.6 });
  });
  reverb(b, sr, { room: 0.7, wet: 0.25 });
  return b;
}

// ============================================================= NETHER ====
// ---- block groups
function squish(b, sr, r, t0, dur, f = 900, amp = 0.35) {
  burst(b, sr, r, { t0, dur, mode: 'bp', f: [f * 1.3, f * 0.6], q: 1.4, a: 0.006, d: dur * 0.3, amp, am: { rate: 35, depth: 0.8 } });
  for (let i = 0, n = randInt(r, 3, 6); i < n; i++) bubble(b, sr, t0 + rand(r, 0, dur * 0.6), randLog(r, f * 0.25, f * 0.6), rand(r, 0.5, 1.2), randLog(r, 0.01, 0.025), rand(r, 0.1, 0.25));
  thud(b, sr, r, t0, 250, 0.02, amp * 0.6);
}
function netherrackBreak(sr, r) {
  const b = stoneBreak(sr, r, { lo: 0.85, bright: 0.72, len: 0.95, dens: 1.1, thump: 1.2 });
  grains(b, sr, r, { dur: 0.35, count: 90, dist: 1.5, f: [400, 2500], q: [1.2, 3], len: [0.0015, 0.008], amp: [0.15, 0.6], ampEnv: (u) => 1 - 0.7 * u });
  return b;
}
function netherrackStep(sr, r) {
  const b = stoneStep(sr, r, { lo: 0.85, bright: 0.72, tail: 0.05 });
  grains(b, sr, r, { dur: 0.15, count: 35, f: [400, 2200], q: [1.2, 3], len: [0.0015, 0.006], amp: [0.15, 0.5], ampEnv: hump });
  return b;
}
function brickKnock(b, sr, r, t0, level) {
  layer(b, sr, level, (L) => {
    modes(L, sr, t0, rand(r, 900, 1300), [1, 1.72, 2.63, 3.4], [0.018, 0.012, 0.009, 0.006], [1, 0.6, 0.4, 0.25], r, 0.03);
    burst(L, sr, r, { t0, dur: 0.006, mode: 'hp', f: 2500, a: 0.0002, d: 0.001, amp: 1 });
  });
}
function netherBricksBreak(sr, r) {
  const b = stoneBreak(sr, r, { lo: 1.1, bright: 1.15, len: 0.8, thump: 0.8 });
  brickKnock(b, sr, r, 0, 0.3);
  return b;
}
function netherBricksStep(sr, r) {
  const b = stoneStep(sr, r, { lo: 1.1, bright: 1.2 });
  brickKnock(b, sr, r, 0, 0.3);
  return b;
}
function soulWhisper(b, sr, r, dur, amp) {
  burst(b, sr, r, { dur, mode: 'bp', f: [randLog(r, 450, 650), randLog(r, 800, 1100), randLog(r, 350, 500)], q: 3, color: 'pink', env: (t) => Math.pow(Math.sin(Math.PI * Math.min(1, t / dur)), 2), amp });
}
function soulSandBreak(sr, r) {
  const b = sandBreak(sr, r);
  soulWhisper(b, sr, r, 0.45, 0.14);
  return b;
}
function soulSandStep(sr, r) {
  const b = sandStep(sr, r);
  soulWhisper(b, sr, r, 0.22, 0.1);
  return b;
}
function soulSoilBreak(sr, r) {
  const b = alloc(sr, 0.5);
  thud(b, sr, r, 0, 220, 0.03, 0.3);
  burst(b, sr, r, { dur: 0.4, mode: 'bp', f: [1200, 700], q: 0.6, a: 0.004, d: 0.1, amp: 0.3, am: { rate: 50, depth: 0.5 } });
  grains(b, sr, r, { dur: 0.38, count: 150, dist: 1.4, f: [350, 2200], q: [1.2, 3], len: [0.002, 0.008], amp: [0.15, 0.7], ampEnv: (u) => 1 - 0.65 * u });
  soulWhisper(b, sr, r, 0.45, 0.08);
  return b;
}
function soulSoilStep(sr, r) {
  const b = alloc(sr, 0.25);
  thud(b, sr, r, 0, 200, 0.018, 0.3);
  burst(b, sr, r, { dur: 0.2, mode: 'bp', f: [1100, 700], q: 0.6, a: 0.008, d: 0.045, amp: 0.25, am: { rate: 60, depth: 0.5 } });
  grains(b, sr, r, { dur: 0.16, count: 50, f: [350, 2000], q: [1.2, 3], len: [0.002, 0.006], amp: [0.15, 0.6], ampEnv: hump });
  return b;
}
function nyliumBreak(sr, r) {
  const b = netherrackBreak(sr, r);
  burst(b, sr, r, { dur: 0.32, mode: 'bp', f: [3600, 2600], q: 0.7, a: 0.003, d: 0.07, amp: 0.16, am: { rate: 140, depth: 0.85 } });
  return b;
}
function nyliumStep(sr, r) {
  const b = netherrackStep(sr, r);
  burst(b, sr, r, { dur: 0.18, mode: 'bp', f: [3200, 2400], q: 0.7, a: 0.006, d: 0.04, amp: 0.14, am: { rate: 160, depth: 0.85 } });
  return b;
}
function stemBreak(sr, r) {
  const b = alloc(sr, 0.45);
  const f1 = rand(r, 110, 160);
  layer(b, sr, 0.35, (L) => {
    modes(L, sr, 0, f1, [1, rand(r, 2.1, 2.5), rand(r, 3.5, 4.2), rand(r, 5.1, 6)], [0.06, 0.04, 0.025, 0.018], [1, 0.6, 0.4, 0.25], r, 0.03);
    burst(L, sr, r, { dur: 0.02, mode: 'lp', f: 1400, a: 0.0005, d: 0.003, amp: 1 });
  });
  squish(b, sr, r, 0.005, 0.3, 1000, 0.22);
  grains(b, sr, r, { dur: 0.18, count: 18, dist: 2, f: [1200, 4000], q: [2, 5], len: [0.0015, 0.006], amp: [0.1, 0.5] });
  return b;
}
function stemStep(sr, r) {
  const b = woodStep(sr, r, { hi: 0.75 });
  squish(b, sr, r, 0.003, 0.14, 1100, 0.14);
  return b;
}
function wartBlockBreak(sr, r) {
  const b = alloc(sr, 0.45);
  squish(b, sr, r, 0, 0.35, rand(r, 700, 900), 0.4);
  thud(b, sr, r, 0, 180, 0.035, 0.35);
  return b;
}
function wartBlockStep(sr, r) {
  const b = alloc(sr, 0.22);
  squish(b, sr, r, 0, 0.16, rand(r, 800, 1000), 0.35);
  return b;
}
function shroomlightBreak(sr, r) {
  const b = alloc(sr, 0.4);
  squish(b, sr, r, 0, 0.3, rand(r, 1500, 1900), 0.35);
  tone(b, sr, { dur: 0.08, f: [rand(r, 500, 600), rand(r, 1000, 1200)], env: { a: 0.001, d: 0.02 }, amp: 0.25 });
  return b;
}
function shroomlightStep(sr, r) {
  const b = alloc(sr, 0.2);
  squish(b, sr, r, 0, 0.14, rand(r, 1500, 1900), 0.3);
  return b;
}
function fungusBreak(sr, r) {
  const b = alloc(sr, 0.3);
  squish(b, sr, r, 0, 0.2, rand(r, 1300, 1700), 0.3);
  grains(b, sr, r, { dur: 0.08, count: 10, dist: 1.5, f: [1800, 5000], q: [5, 10], len: [0.001, 0.003], amp: [0.5, 1] });
  return b;
}
function fungusStep(sr, r) {
  const b = alloc(sr, 0.16);
  squish(b, sr, r, 0, 0.1, rand(r, 1400, 1800), 0.3);
  return b;
}
function rootsBreak(sr, r) {
  const b = alloc(sr, 0.35);
  burst(b, sr, r, { dur: 0.28, mode: 'bp', f: [5200, 4000], q: 1, a: 0.002, d: 0.06, amp: 0.25, am: { rate: 180, depth: 0.9 } });
  grains(b, sr, r, { dur: 0.25, count: 70, dist: 1.5, f: [2500, 9000], q: [2, 5], len: [0.0006, 0.0025], amp: [0.2, 0.9] });
  thud(b, sr, r, 0, 350, 0.01, 0.1);
  return b;
}
function rootsStep(sr, r) {
  const b = alloc(sr, 0.2);
  burst(b, sr, r, { dur: 0.16, mode: 'bp', f: [4800, 3800], q: 1, a: 0.005, d: 0.035, amp: 0.22, am: { rate: 180, depth: 0.9 } });
  grains(b, sr, r, { dur: 0.13, count: 30, f: [2500, 8000], q: [2, 5], len: [0.0006, 0.002], amp: [0.2, 0.8], ampEnv: hump });
  return b;
}
function netherWartBreak(sr, r) {
  const b = alloc(sr, 0.35);
  squish(b, sr, r, 0, 0.22, rand(r, 900, 1200), 0.3);
  grains(b, sr, r, { dur: 0.1, count: 12, f: [1500, 4500], q: [4, 9], len: [0.001, 0.003], amp: [0.4, 1] });
  return b;
}
const basaltBreak = (sr, r) => {
  const b = stoneBreak(sr, r, { lo: 0.75, bright: 0.82, thump: 1.5, len: 1.05, dens: 0.9 });
  grains(b, sr, r, { t0: 0.003, dur: 0.3, count: 16, dist: 1.5, f: [180, 700], q: [2, 5], len: [0.006, 0.02], amp: [0.2, 0.5] });
  return b;
};
const basaltStep = (sr, r) => stoneStep(sr, r, { lo: 0.75, bright: 0.82, thump: 1.5 });
function ancientDebrisBreak(sr, r) {
  const b = stoneBreak(sr, r, { lo: 0.65, bright: 0.66, len: 1.1, thump: 1.8, dens: 1.2, tail: 0.3 });
  layer(b, sr, 0.14, (L) => modes(L, sr, 0, rand(r, 280, 420), METAL_RATIOS, [0.25, 0.18, 0.13, 0.1, 0.07, 0.05], [1, 0.8, 0.6, 0.45, 0.3, 0.2], r, 0.02));
  return b;
}
function ancientDebrisStep(sr, r) {
  const b = stoneStep(sr, r, { lo: 0.68, bright: 0.7, thump: 1.7, tail: 0.1 });
  layer(b, sr, 0.08, (L) => modes(L, sr, 0, rand(r, 350, 500), METAL_RATIOS.slice(0, 4), [0.1, 0.07, 0.05, 0.04], [1, 0.7, 0.5, 0.3], r, 0.02));
  return b;
}

// ---- portal
const edgeEnv = (dur, a, rl) => (t) => Math.max(0, Math.min(1, t / a, (dur - t) / rl));
function portalAmbient(sr, r) {
  const dur = 4.2;
  const b = alloc(sr, dur + 1);
  const sw = rand(r, 0.5, 0.9), edge = edgeEnv(dur, 0.6, 0.9);
  burst(b, sr, r, { dur, mode: 'bp', f: (u) => 700 * Math.pow(2, 1.3 * Math.sin(TAU * sw * u * dur)), q: 3, env: sampled((t) => edge(t) * (0.6 + 0.4 * Math.sin(TAU * sw * 2 * t)), dur), amp: 0.12 });
  burst(b, sr, r, { dur, mode: 'bp', f: (u) => 1800 * Math.pow(2, Math.sin(TAU * sw * 1.5 * u * dur + 1)), q: 5, env: edge, amp: 0.05 });
  const f = randLog(r, 55, 75);
  for (const [m, a] of [[1, 0.1], [1.007, 0.09], [2.01, 0.1], [3.02, 0.08], [4.5, 0.05], [6.01, 0.03]]) tone(b, sr, { dur, f: f * m, env: edge, amp: a, vib: { rate: 0.3, depth: 0.01 } });
  reverb(b, sr, { room: 0.8, wet: 0.35, damp: 0.4 });
  return b;
}
function portalTrigger(sr, r) {
  const dur = rand(r, 3.6, 4.2);
  const b = alloc(sr, dur + 1.2);
  const rise = sampled((t) => Math.pow(smooth(t / dur), 1.3) * Math.max(0, Math.min(1, (dur - t) / 0.25)), dur);
  burst(b, sr, r, { dur, mode: 'bp', f: (u) => 250 * Math.pow(2, 3.5 * u) * (1 + 0.25 * Math.sin(TAU * 5 * u * dur)), q: 4, color: 'pink', env: rise, amp: 0.4 });
  burst(b, sr, r, { dur, mode: 'bp', f: (u) => 900 * Math.pow(2, 2.5 * u) * (1 + 0.3 * Math.sin(TAU * 8 * u * dur + 2)), q: 6, env: rise, amp: 0.12 });
  tone(b, sr, { dur, f: [70, 110, 260], fm: { ratio: 1.5, index: [0.5, 2] }, env: rise, amp: 0.25, vib: { rate: 6, depth: 0.02 } });
  tone(b, sr, { dur, f: [105, 170, 400], env: rise, amp: 0.1 });
  reverb(b, sr, { room: 0.85, wet: 0.4, damp: 0.4 });
  return b;
}
function portalTravel(sr, r) {
  const dur = rand(r, 3.5, 4.2);
  const b = alloc(sr, dur + 1.5);
  burst(b, sr, r, { dur, mode: 'lp', f: [7000, 1500, 180], q: 0.9, a: 0.04, d: 0.9, amp: 0.55 });
  burst(b, sr, r, { dur, mode: 'bp', f: (u) => 2500 * Math.pow(0.1, u) * (1 + 0.3 * Math.sin(TAU * 4 * u * dur)), q: 3, color: 'pink', a: 0.05, d: 1.1, amp: 0.3 });
  tone(b, sr, { dur, f: [700, 180, 55], fm: { ratio: 1.5, index: [3, 1] }, env: { a: 0.05, d: 1.0, r: 0.3 }, amp: 0.3 });
  burst(b, sr, r, { dur, mode: 'lp', f: 120, color: 'brown', a: 0.1, d: 1.2, amp: 0.6 });
  reverb(b, sr, { room: 0.9, wet: 0.45, damp: 0.35 });
  return b;
}

// ---- nether ambience beds (seamless loops) and additions
const BED_L = 10, BED_XF = 1;
const steady = () => 1;
function drones(T, sr, L, parts) { // parts: [[freq, amp, swellCyclesPerLoop, phase]] — all periodic in L
  droneSines(T, sr, parts.map(([f, a, k = 1, ph = 0]) => [periodic(f, L), a, k / L, ph]));
}
function events(n, tot, fn) { for (let i = 0; i < n; i++) fn(i); }
function netherWastes(sr, r) {
  return loopBed(sr, BED_L, BED_XF, (T, N, tot) => {
    drones(T, sr, BED_L, [[41.2, 0.05, 1], [41.7, 0.045, 1, 2], [82.4, 0.08, 2, 1], [123.6, 0.07, 3, 0.5], [164.8, 0.05, 1, 3], [247.2, 0.025, 2, 2]]);
    burst(N, sr, r, { dur: tot, mode: 'lp', f: 110, q: 0.9, stages: 2, color: 'brown', env: steady, amp: 0.12, am: { rate: 0.5, depth: 0.6 } });
    burst(N, sr, r, { dur: tot, mode: 'bp', f: [randLog(r, 350, 550), randLog(r, 500, 800), randLog(r, 350, 550)], q: 1.6, env: steady, amp: 0.05, am: { rate: 0.6, depth: 0.7 } });
    events(randInt(r, 2, 3), tot, () => {
      const d = rand(r, 2, 3), t0 = rand(r, 0, tot - d), f = randLog(r, 160, 260);
      tone(N, sr, { t0, dur: d, f: [f, f * rand(r, 1.1, 1.3), f * 0.85], wave: 'tri', vib: { rate: 4.5, depth: 0.015 }, env: { a: d * 0.4, d: d * 0.25, r: 0.4 }, amp: 0.2 });
      tone(N, sr, { t0, dur: d, f: [f * 2.01, f * 2.4, f * 1.7], env: { a: d * 0.45, d: d * 0.2, r: 0.4 }, amp: 0.06 });
    });
    events(randInt(r, 1, 3), tot, () => thud(N, sr, r, rand(r, 0, tot - 1.5), 90, rand(r, 0.15, 0.3), rand(r, 0.2, 0.35)));
    crackles(N, sr, r, randInt(r, 4, 8), 0, tot - 0.1, [600, 2500], 0.35);
    reverb(N, sr, { room: 0.88, wet: 0.45, damp: 0.5 });
  });
}
function crimsonForest(sr, r) {
  return loopBed(sr, BED_L, BED_XF, (T, N, tot) => {
    drones(T, sr, BED_L, [[55, 0.08, 1], [55.4, 0.07, 1, 1.5], [165.2, 0.06, 3], [220.5, 0.035, 2, 1]]);
    const P = periodic(110.3, BED_L), throb = periodic(0.8, BED_L);
    tone(T, sr, { dur: BED_L, f: P, env: (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * throb * t), 2), amp: 0.12 });
    burst(N, sr, r, { dur: tot, mode: 'lp', f: 150, q: 0.8, stages: 2, color: 'brown', env: steady, amp: 0.2, am: { rate: 0.7, depth: 0.5 } });
    burst(N, sr, r, { dur: tot, mode: 'bp', f: [randLog(r, 450, 650), randLog(r, 700, 900), randLog(r, 450, 650)], q: 1, env: steady, amp: 0.06, am: { rate: 0.6, depth: 0.6 } });
    grains(N, sr, r, { dur: tot - 0.05, count: 90, f: [800, 3000], q: [2, 6], len: [0.002, 0.008], amp: [0.05, 0.25] });
    events(randInt(r, 1, 2), tot, () => {
      const d = rand(r, 2.5, 3.5), t0 = rand(r, 0, tot - d), f = randLog(r, 170, 240);
      for (const m of [1, 1.059, 1.5]) tone(N, sr, { t0, dur: d, f: f * m, wave: 'tri', env: { a: d * 0.5, d: d * 0.2, r: 0.5 }, amp: 0.1 });
    });
    events(randInt(r, 2, 4), tot, () => burst(N, sr, r, { t0: rand(r, 0, tot - 0.6), dur: 0.6, mode: 'lp', f: [250, 450], q: 1.5, env: bellCurve(0.6), amp: 0.25 }));
    reverb(N, sr, { room: 0.85, wet: 0.4, damp: 0.55 });
  });
}
function warpedForest(sr, r) {
  return loopBed(sr, BED_L, BED_XF, (T, N, tot) => {
    drones(T, sr, BED_L, [[110, 0.06, 1], [220, 0.07, 2, 1], [233.1, 0.06, 2, 2.5], [330, 0.05, 3], [440.5, 0.025, 1, 1]]);
    const wf = periodic(880, BED_L), vr = periodic(5, BED_L);
    tone(T, sr, { dur: BED_L, f: wf, vib: { rate: vr, depth: 0.004 }, env: (t) => Math.pow(0.5 + 0.5 * Math.sin(TAU * 2 * t / BED_L), 3), amp: 0.035 });
    burst(N, sr, r, { dur: tot, mode: 'lp', f: 120, q: 0.8, stages: 2, color: 'brown', env: steady, amp: 0.12, am: { rate: 0.5, depth: 0.5 } });
    burst(N, sr, r, { dur: tot, mode: 'bp', f: 2600, q: 0.8, env: steady, amp: 0.05, am: { rate: 0.4, depth: 0.7 } });
    events(randInt(r, 2, 3), tot, () => {
      const d = rand(r, 1.2, 2), t0 = rand(r, 0, tot - d), f = randLog(r, 400, 900);
      tone(N, sr, { t0, dur: d, f: [f, f * 1.5, f * 0.8], fm: { ratio: 2.01, index: [0.5, 2, 0.5] }, vib: { rate: 6, depth: 0.02 }, env: { a: d * 0.4, d: d * 0.25, r: 0.3 }, amp: 0.1 });
    });
    events(randInt(r, 1, 2), tot, () => {
      const d = rand(r, 1, 1.6), t0 = rand(r, 0, tot - d);
      burst(N, sr, r, { t0, dur: d, mode: 'bp', f: [800, 3000], q: 2, env: (t) => Math.pow(Math.min(1, t / (d * 0.9)), 2) * Math.min(1, (d - t) / 0.08), amp: 0.12 });
    });
    reverb(N, sr, { room: 0.9, wet: 0.55, damp: 0.3 });
  });
}
function soulSandValley(sr, r) {
  return loopBed(sr, BED_L, BED_XF, (T, N, tot) => {
    drones(T, sr, BED_L, [[49, 0.07, 1], [98.2, 0.06, 2, 1], [147.3, 0.03, 1, 2]]);
    const w = () => randLog(r, 300, 1000);
    burst(N, sr, r, { dur: tot, mode: 'bp', f: [w(), w(), w(), w(), w(), w()], q: 2.5, color: 'pink', env: steady, amp: 0.35, am: { rate: 0.5, depth: 0.6 } });
    burst(N, sr, r, { dur: tot, mode: 'bp', f: [randLog(r, 1200, 2000), randLog(r, 1200, 2000), randLog(r, 1200, 2000)], q: 5, env: steady, amp: 0.05, am: { rate: 0.7, depth: 0.8 } });
    events(randInt(r, 2, 3), tot, () => {
      const d = rand(r, 1.4, 2.2), t0 = rand(r, 0, tot - d), f = randLog(r, 260, 420);
      layer(N, sr, 0.08, (L) => voice(L, sr, r, { t0, dur: d, f0: [f, f * rand(r, 1.1, 1.3), f * 0.8], vib: { rate: 5, depth: 0.025 }, jitter: 0.02, breath: 0.6, formants: vowelPath([[0, 'u'], [0.5, 'o'], [1, 'u']], 1.1), tilt: 2000, env: { a: d * 0.4, h: d * 0.1, d: d * 0.2, r: 0.3 } }));
    });
    reverb(N, sr, { room: 0.9, wet: 0.6, damp: 0.45 });
  });
}
function basaltDeltas(sr, r) {
  return loopBed(sr, BED_L, BED_XF, (T, N, tot) => {
    drones(T, sr, BED_L, [[36.7, 0.06, 1], [73.1, 0.06, 2, 1], [110, 0.06, 3, 2], [146.8, 0.04, 1, 1]]);
    burst(N, sr, r, { dur: tot, mode: 'lp', f: 180, q: 0.9, stages: 2, color: 'brown', env: steady, amp: 0.12, am: { rate: 1.2, depth: 0.6 } });
    burst(N, sr, r, { dur: tot, mode: 'lp', f: 700, env: steady, amp: 0.06, am: { rate: 3, depth: 0.5 } });
    crackles(N, sr, r, randInt(r, 40, 60), 0, tot - 0.05, [700, 5000], 0.8);
    grains(N, sr, r, { dur: tot - 0.05, count: 45, f: [150, 700], q: [2, 5], len: [0.004, 0.015], amp: [0.15, 0.5] });
    events(randInt(r, 3, 5), tot, () => { const d = rand(r, 0.5, 1.2); burst(N, sr, r, { t0: rand(r, 0, tot - d), dur: d, mode: 'bp', f: [5000, 3500], q: 0.7, a: 0.05, d: d * 0.4, amp: 0.15, am: { rate: 30, depth: 0.5 } }); });
    events(randInt(r, 2, 3), tot, () => thud(N, sr, r, rand(r, 0, tot - 1.2), 80, rand(r, 0.12, 0.25), rand(r, 0.15, 0.3)));
    reverb(N, sr, { room: 0.8, wet: 0.35, damp: 0.5 });
  });
}
function netherAddition(sr, r, v) {
  const kind = v % 8;
  const b = alloc(sr, 6);
  switch (kind) {
    case 0: { // distant moan
      const d = rand(r, 1.6, 2.4), f = randLog(r, 150, 300);
      layer(b, sr, 0.3, (L) => voice(L, sr, r, { t0: 0.1, dur: d, f0: [f, f * 1.3, f * 0.8], vib: { rate: 5, depth: 0.03 }, jitter: 0.02, breath: 0.4, formants: vowelPath([[0, 'u'], [0.5, 'o'], [1, 'u']], 1.1), tilt: 2000, env: { a: d * 0.4, h: d * 0.1, d: d * 0.2, r: 0.3 } }));
      lowpass(b, sr, 1500);
      reverb(b, sr, { room: 0.9, wet: 0.6, damp: 0.4 });
      break;
    }
    case 1: // deep rumble
      burst(b, sr, r, { dur: 3.2, mode: 'lp', f: [130, 60], q: 1, stages: 2, color: 'brown', env: (t) => smooth(t / 1.2) * Math.exp(-Math.max(0, t - 1.2) / 0.7), amp: 1, am: { rate: 4, depth: 0.5 } });
      reverb(b, sr, { room: 0.88, wet: 0.45, damp: 0.6 });
      break;
    case 2: // sizzle
      burst(b, sr, r, { dur: 1.4, mode: 'bp', f: [5200, 4200], q: 0.7, a: 0.05, d: 0.4, amp: 0.4, am: { rate: 40, depth: 0.6 } });
      crackles(b, sr, r, 10, 0.02, 1, [1000, 5000], 0.6);
      reverb(b, sr, { room: 0.6, wet: 0.2 });
      break;
    case 3: // distant boom
      thud(b, sr, r, 0.05, 70, 0.4, 1);
      burst(b, sr, r, { t0: 0.05, dur: 2.5, mode: 'lp', f: [400, 80], color: 'brown', a: 0.02, d: 0.7, amp: 0.8 });
      lowpass(b, sr, 800);
      reverb(b, sr, { room: 0.92, wet: 0.6, damp: 0.5, pre: 0.05 });
      break;
    case 4: { // eerie chord swell
      const f = randLog(r, 110, 180);
      for (const [m, a] of [[1, 0.3], [1.059, 0.22], [1.414, 0.18], [2.01, 0.08]]) tone(b, sr, { t0: 0.1, dur: 3, f: [f * m, f * m * 0.97], wave: 'tri', env: { a: 1.4, d: 0.8, r: 0.5 }, amp: a });
      lowpass(b, sr, 1200);
      reverb(b, sr, { room: 0.9, wet: 0.55, damp: 0.4 });
      break;
    }
    case 5: { // chittering warble
      const f = randLog(r, 500, 900);
      tone(b, sr, { t0: 0.05, dur: 0.9, f: [f, f * 1.3, f * 0.9], fm: { ratio: 1.01, index: 1.5 }, vib: { rate: 14, depth: 0.05 }, env: { a: 0.1, d: 0.3, r: 0.15 }, amp: 0.4 });
      reverb(b, sr, { room: 0.85, wet: 0.5, damp: 0.3 });
      break;
    }
    case 6: // whoosh
      burst(b, sr, r, { t0: 0.05, dur: 1.6, mode: 'bp', f: [300, 2000, 400], q: 2, color: 'pink', env: bellCurve(1.6), amp: 0.5 });
      reverb(b, sr, { room: 0.85, wet: 0.45 });
      break;
    default: // crackle burst
      crackles(b, sr, r, 22, 0.02, 0.8, [600, 4000], 0.8);
      thud(b, sr, r, 0.02, 120, 0.08, 0.4);
      reverb(b, sr, { room: 0.8, wet: 0.35 });
  }
  return b;
}

// ---- nether mobs
function ghastCall(sr, r, o) {
  const b = alloc(sr, o.dur + 1.4);
  vocal(b, sr, r, 0.3, { jitter: 0.02, breath: 0.2, creak: 0.1, fg: [1, 0.85, 0.55], direct: 0.18, bw: [110, 150, 220], tilt: 4500, drive: 1.3, ...o });
  reverb(b, sr, { room: 0.87, wet: o.wet ?? 0.45, damp: 0.35, pre: 0.02 });
  return b;
}
function ghastMoan(sr, r) {
  const dur = rand(r, 1.2, 1.8);
  const pts = []; for (let i = 0, k = randInt(r, 3, 4); i < k; i++) pts.push(randLog(r, 280, 520));
  return ghastCall(sr, r, { dur, f0: pts, vib: { rate: rand(r, 4.5, 6), depth: 0.03, delay: 0.2 }, formants: vowelPath([[0, 'u'], [0.35, 'o'], [0.65, 'a'], [1, 'u']], 1.25), env: { a: dur * 0.35, h: dur * 0.2, d: dur * 0.2, r: 0.2 } });
}
function ghastScream(sr, r) {
  const dur = rand(r, 0.6, 0.8), f = rand(r, 650, 800);
  return ghastCall(sr, r, { dur, f0: [f, f * 1.2, f * 0.7], vib: { rate: 8, depth: 0.03 }, drive: 2.2, creak: 0.3, breath: 0.3, formants: vowelPath([[0, 'a'], [0.5, 'ae'], [1, 'a']], 1.3), env: { a: 0.02, h: dur * 0.35, d: dur * 0.25, r: 0.1 }, wet: 0.35 });
}
function ghastCharge(sr, r) {
  const dur = rand(r, 0.8, 1.0);
  return ghastCall(sr, r, { dur, f0: [420, 520, 900], vib: { rate: 7, depth: 0.04 }, drive: 1.8, formants: vowelPath([[0, 'i'], [1, 'a']], 1.3), env: { a: 0.1, h: dur * 0.5, d: dur * 0.2, r: 0.1 }, wet: 0.35 });
}
function ghastDeath(sr, r) {
  return ghastCall(sr, r, { dur: 2.3, f0: [650, 720, 380, 160], vib: { rate: 7, depth: 0.05 }, drive: 1.8, formants: vowelPath([[0, 'a'], [0.5, 'o'], [1, 'u']], 1.25), env: { a: 0.05, h: 0.8, d: 0.6, r: 0.3 }, wet: 0.5 });
}
function ghastFireball(sr, r) {
  const b = alloc(sr, 1.8);
  burst(b, sr, r, { dur: 1.2, mode: 'lp', f: [2500, 180], q: 0.7, a: 0.03, d: 0.3, amp: 0.6 });
  burst(b, sr, r, { dur: 1.2, mode: 'lp', f: 150, color: 'brown', a: 0.02, d: 0.4, amp: 0.8 });
  burst(b, sr, r, { dur: 0.5, mode: 'bp', f: [400, 1600, 300], q: 1.2, env: bellCurve(0.5), amp: 0.2 });
  crackles(b, sr, r, 12, 0.05, 0.75, [800, 4000], 0.5);
  reverb(b, sr, { room: 0.8, wet: 0.3 });
  return b;
}
function metalBreath(sr, r, dur, f0, f1) {
  const b = alloc(sr, dur + 0.5);
  burst(b, sr, r, { dur, mode: 'bp', f: [f0, f1], q: 0.9, env: { a: dur * 0.35, h: dur * 0.15, d: dur * 0.2, r: 0.1 }, amp: 0.4, am: { rate: 18, depth: 0.5 } });
  comb(b, sr, 1 / rand(r, 170, 260), 0.82, 0.7);
  grains(b, sr, r, { t0: dur * 0.2, dur: dur * 0.6, count: 25, f: [2500, 6000], q: [8, 15], len: [0.002, 0.005], amp: [0.1, 0.4] });
  return b;
}
function blazeBreathe(sr, r) {
  const b = metalBreath(sr, r, rand(r, 1.2, 1.6), rand(r, 700, 900), rand(r, 1200, 1600));
  reverb(b, sr, { room: 0.6, wet: 0.2 });
  return b;
}
function blazeHit(sr, r) {
  const b = metalBreath(sr, r, 0.45, 1400, 900);
  layer(b, sr, 0.25, (L) => { modes(L, sr, 0, randLog(r, 700, 1100), METAL_RATIOS, [0.25, 0.2, 0.15, 0.1, 0.08, 0.06], [1, 0.8, 0.6, 0.45, 0.3, 0.2], r, 0.02); burst(L, sr, r, { dur: 0.02, mode: 'hp', f: 2000, a: 0.0002, d: 0.003, amp: 1.5 }); });
  return b;
}
function blazeDeath(sr, r) {
  const b = metalBreath(sr, r, 1.8, 1500, 400);
  const out = alloc(sr, 3); out.set(b.subarray(0, Math.min(b.length, out.length)));
  layer(out, sr, 0.2, (L) => { for (let i = 0, n = randInt(r, 3, 5); i < n; i++) modes(L, sr, 0.1 + i * rand(r, 0.2, 0.35), randLog(r, 500, 900) * (1 - i * 0.1), METAL_RATIOS, [0.3, 0.22, 0.16, 0.12, 0.09, 0.07], [1, 0.8, 0.6, 0.45, 0.3, 0.2], r, 0.02); });
  reverb(out, sr, { room: 0.75, wet: 0.3 });
  return out;
}
function blazeShoot(sr, r) {
  const b = alloc(sr, 0.7);
  burst(b, sr, r, { dur: 0.5, mode: 'bp', f: [500, 2600, 700], q: 1, env: { a: 0.03, d: 0.12, r: 0.05 }, amp: 0.5 });
  crackles(b, sr, r, 8, 0.02, 0.4, [800, 4000], 0.5);
  thud(b, sr, r, 0, 200, 0.03, 0.3);
  return b;
}
function cubeSquish(sr, r, size, magma = true) {
  const dur = 0.25 + 0.25 * size;
  const b = alloc(sr, dur + 0.15);
  const f = 1300 * Math.pow(0.35, size);
  squish(b, sr, r, 0, dur, f, 0.4);
  thud(b, sr, r, 0, 350 - 200 * size, 0.02 + 0.03 * size, 0.3 + 0.3 * size);
  burst(b, sr, r, { dur: 0.05, mode: 'bp', f: f * 1.5, q: 1, a: 0.0005, d: 0.008, amp: 0.25 });
  if (magma) burst(b, sr, r, { dur, mode: 'hp', f: 3500, a: 0.01, d: dur * 0.3, amp: 0.04 });
  return b;
}
function zpigGrunt(sr, r, v) {
  const b = alloc(sr, 0.9);
  const n = v % 2 === 0 ? 1 : 2;
  let t = 0;
  for (let g = 0; g < n; g++) {
    const dur = rand(r, 0.25, 0.4), f = rand(r, 105, 140);
    vocal(b, sr, r, 0.3, { t0: t, dur, f0: [f * 0.9, f * 1.12, f * 0.75], jitter: 0.07, creak: 0.6, breath: 0.35, trem: { rate: rand(r, 26, 34), depth: 0.5 }, formants: vowelPath([[0, 'o'], [0.4, 'uh'], [1, 'u']], 0.88), fg: [1, 0.75, 0.4], bw: [120, 150, 220], tilt: 1800, drive: 2.4, env: { a: 0.02, h: dur * 0.35, d: dur * 0.25, r: 0.05 } });
    burst(b, sr, r, { t0: t, dur: dur * 0.6, mode: 'bp', f: 900, q: 1.2, env: { a: 0.01, d: 0.05 }, amp: 0.1 });
    t += dur + rand(r, 0.05, 0.1);
  }
  return b;
}
function zpigHurt(sr, r) {
  const dur = rand(r, 0.3, 0.4);
  const b = alloc(sr, dur + 0.05);
  vocal(b, sr, r, 0.3, { dur, f0: [220, 300, 180], jitter: 0.06, creak: 0.5, breath: 0.35, formants: vowelPath([[0, 'a'], [1, 'uh']], 0.95), fg: [1, 0.8, 0.45], tilt: 2500, drive: 2.5, env: { a: 0.01, h: dur * 0.3, d: dur * 0.25, r: 0.04 } });
  return b;
}
function zpigDeath(sr, r) {
  const b = alloc(sr, 1.3);
  vocal(b, sr, r, 0.3, { dur: 1.2, f0: [200, 220, 120, 70], jitter: 0.07, creak: 0.65, breath: 0.35, trem: { rate: 12, depth: 0.4 }, formants: vowelPath([[0, 'a'], [0.5, 'o'], [1, 'u']], 0.92), tilt: 1800, drive: 2.2, env: { a: 0.02, h: 0.4, d: 0.3, r: 0.2 } });
  return b;
}
function zpigAngry(sr, r) {
  const dur = rand(r, 0.8, 1.0);
  const b = alloc(sr, dur + 0.1);
  burst(b, sr, r, { dur: 0.15, mode: 'bp', f: 1000, q: 1, a: 0.005, d: 0.04, amp: 0.3 });
  vocal(b, sr, r, 0.32, { t0: 0.08, dur, f0: [120, 180, 150], jitter: 0.08, creak: 0.7, breath: 0.5, trem: { rate: 24, depth: 0.35 }, formants: vowelPath([[0, 'ae'], [0.5, 'a'], [1, 'uh']], 0.92), fg: [1, 0.85, 0.5], tilt: 2500, drive: 3, env: { a: 0.04, h: dur * 0.45, d: dur * 0.2, r: 0.08 } });
  return b;
}

// ---- misc
function enchantUse(sr, r) {
  const b = alloc(sr, 2.8);
  const pent = [0, 2, 4, 7, 9], base = randLog(r, 1000, 1300);
  layer(b, sr, 0.25, (L) => {
    const n = randInt(r, 14, 20);
    for (let i = 0; i < n; i++) {
      const semis = Math.min(26, pent[i % 5] + 12 * Math.floor(i / 5));
      const t = 0.05 + (i / n) * 1.1 + rand(r, -0.03, 0.03);
      bell(L, sr, Math.max(0, t), base * Math.pow(2, semis / 12) * rand(r, 0.998, 1.002), rand(r, 0.4, 1), rand(r, 0.3, 0.7), CRYSTAL.slice(0, 3));
    }
  });
  grains(b, sr, r, { dur: 1.4, count: 40, f: [3000, 9000], q: [12, 25], len: [0.004, 0.012], amp: [0.05, 0.2] });
  burst(b, sr, r, { dur: 1.4, mode: 'hp', f: [2000, 6000], env: bellCurve(1.4), amp: 0.05 });
  reverb(b, sr, { room: 0.85, wet: 0.4, damp: 0.3 });
  return b;
}
const ANVIL = [1, 1.47, 2.09, 2.56, 3.39, 4.2, 5.4];
function anvilUse(sr, r) {
  const b = alloc(sr, 1.5);
  const f = rand(r, 850, 1050);
  const strike = (t, a) => {
    burst(b, sr, r, { t0: t, dur: 0.03, mode: 'hp', f: 2000, a: 0.0002, d: 0.004, amp: 0.5 * a });
    modes(b, sr, t, f, ANVIL, [0.7, 0.5, 0.4, 0.3, 0.22, 0.16, 0.12], [1, 0.8, 0.7, 0.5, 0.4, 0.3, 0.2].map((x) => x * a * 0.3), r, 0.01);
  };
  strike(0, 1); strike(rand(r, 0.1, 0.14), 0.25);
  return b;
}
function anvilBreak(sr, r) {
  const b = alloc(sr, 1.6);
  layer(b, sr, 0.3, (L) => modes(L, sr, 0, rand(r, 380, 460), ANVIL, [0.9, 0.7, 0.5, 0.4, 0.3, 0.22, 0.16], [1, 0.7, 0.8, 0.5, 0.4, 0.3, 0.2], r, 0.02));
  burst(b, sr, r, { dur: 0.06, mode: 'hp', f: 1200, a: 0.0002, d: 0.01, amp: 0.6 });
  thud(b, sr, r, 0, 220, 0.05, 0.5);
  grains(b, sr, r, { dur: 0.6, count: 120, dist: 1.6, f: [500, 5000], q: [2, 8], len: [0.002, 0.01], amp: [0.2, 1], ampEnv: (u) => 1 - 0.7 * u });
  layer(b, sr, 0.12, (L) => { for (let i = 0; i < 4; i++) modes(L, sr, rand(r, 0.08, 0.5), randLog(r, 1200, 2500), [1, 1.51, 2.24], [0.05, 0.035, 0.025], [1, 0.6, 0.4], r, 0.02); });
  return b;
}
function fireChargeUse(sr, r) {
  const b = alloc(sr, 0.9);
  burst(b, sr, r, { dur: 0.7, mode: 'lp', f: [300, 1600, 500], q: 0.8, env: { a: 0.08, d: 0.18, r: 0.08 }, amp: 0.5 });
  burst(b, sr, r, { dur: 0.6, mode: 'lp', f: 150, color: 'brown', env: { a: 0.05, d: 0.2, r: 0.05 }, amp: 0.8 });
  crackles(b, sr, r, 8, 0.05, 0.5, [800, 4000], 0.5);
  return b;
}

// ======================================================= REGISTRATION ====
const BLOCK = [
  // group, dig, step, variants dig/step
  ['stone', stoneBreak, stoneStep],
  ['wood', woodBreak, woodStep],
  ['gravel', gravelBreak, gravelStep],
  ['grass', grassBreak, grassStep],
  ['sand', sandBreak, sandStep],
  ['wool', woolBreak, woolStep],
  ['snow', snowBreak, snowStep],
  ['metal', metalBreak, metalStep],
  ['deepslate', deepslateBreak, deepslateStep],
  ['amethyst', amethystBreak, amethystStep],
];
for (const [g, dig, step] of BLOCK) {
  def('dig.' + g, 'blocks', 4, (sr, r) => dig(sr, r), { vol: 0.8 });
  def('step.' + g, 'blocks', 5, (sr, r) => step(sr, r), { vol: 0.3, pv: 0.04 });
}
def('dig.glass', 'blocks', 3, glassBreak, { vol: 0.8, pv: 0.05 });
def('dig.crop', 'blocks', 4, cropBreak, { vol: 0.75 });
def('step.ladder', 'blocks', 5, ladderStep, { vol: 0.3, pv: 0.04 });
alias('dig.ladder', 'dig.wood');
alias('step.glass', 'step.stone');
alias('step.crop', 'step.grass');
for (const g of ['stone', 'wood', 'gravel', 'grass', 'sand', 'wool', 'snow', 'metal', 'deepslate', 'amethyst', 'ladder']) {
  alias('hit.' + g, 'step.' + g, { pitch: 0.5, vol: 0.32, pv: 0 });
}
alias('hit.glass', 'step.stone', { pitch: 0.5, vol: 0.32, pv: 0 });
alias('hit.crop', 'step.grass', { pitch: 0.5, vol: 0.32, pv: 0 });

// misc / items / ui
def('random.pop', 'players', 2, pop, { vol: 0.45 });
def('random.click', 'master', 1, click, { vol: 0.5 });
def('random.bow', 'players', 2, bowShoot, { vol: 0.6, pv: 0.08 });
def('random.bowhit', 'neutral', 4, bowHit, { vol: 0.6, pv: 0.08 });
def('random.successful_hit', 'players', 1, successfulHit, { vol: 0.4 });
def('random.orb', 'players', 1, orb, { vol: 0.35 });
def('random.levelup', 'players', 1, levelup, { vol: 0.6, low: true });
def('random.eat', 'players', 3, eat, { vol: 0.5, pv: 0.1 });
def('random.burp', 'players', 2, burp, { vol: 0.5, pv: 0.05 });
def('random.drink', 'players', 3, drink, { vol: 0.5, pv: 0.05 });
def('random.explode', 'blocks', 4, explode, { vol: 1, low: true, pv: 0.1, target: 0.3 });
def('random.fizz', 'blocks', 2, fizz, { vol: 0.45, pv: 0.1 });
def('random.door_open', 'blocks', 2, doorOpen, { vol: 0.7, pv: 0.05 });
def('random.door_close', 'blocks', 2, doorClose, { vol: 0.7, pv: 0.05 });
def('random.chest_open', 'blocks', 1, chestOpen, { vol: 0.6, pv: 0.05 });
def('random.chest_close', 'blocks', 2, chestClose, { vol: 0.6, pv: 0.05 });
def('random.break', 'players', 2, toolBreak, { vol: 0.7, pv: 0.05 });
def('random.splash', 'players', 2, splash, { vol: 0.6, pv: 0.08 });
def('random.swim', 'players', 4, swim, { vol: 0.35, pv: 0.1 });
def('random.anvil_land', 'blocks', 1, anvilLand, { vol: 0.6, pv: 0.05 });
def('fire.ignite', 'blocks', 2, ignite, { vol: 0.7, pv: 0.08 });
def('fire.fire', 'blocks', 2, fireLoop, { vol: 0.5, low: true, target: 0.15 });
def('liquid.water', 'blocks', 2, water, { vol: 0.4, low: true, target: 0.15 });
def('liquid.lava', 'blocks', 2, lava, { vol: 0.45, low: true, target: 0.15 });
def('liquid.lavapop', 'blocks', 2, lavaPop, { vol: 0.4, pv: 0.15 });
def('damage.hit', 'players', 3, hurtGrunt, { vol: 0.75, pv: 0.08 });
def('damage.fallsmall', 'players', 2, fallSmall, { vol: 0.7 });
def('damage.fallbig', 'players', 2, fallBig, { vol: 0.8 });
def('player.attack.sweep', 'players', 2, attackSweep, { vol: 0.55, pv: 0.06 });
def('player.attack.crit', 'players', 2, attackCrit, { vol: 0.6, pv: 0.06 });
def('player.attack.strong', 'players', 2, attackStrong, { vol: 0.6, pv: 0.06 });
def('player.attack.weak', 'players', 2, attackWeak, { vol: 0.5, pv: 0.06 });
def('player.attack.knockback', 'players', 2, attackKnockback, { vol: 0.6, pv: 0.06 });
def('player.attack.nodamage', 'players', 2, attackNoDamage, { vol: 0.4, pv: 0.06 });
def('item.shield.block', 'players', 2, shieldBlock, { vol: 0.7, pv: 0.08 });
def('item.armor.equip_generic', 'players', 2, equipGeneric, { vol: 0.55 });
def('item.armor.equip_iron', 'players', 2, equipIron, { vol: 0.55 });
def('item.armor.equip_diamond', 'players', 2, equipDiamond, { vol: 0.55 });
def('item.armor.equip_leather', 'players', 2, equipLeather, { vol: 0.55 });
def('item.armor.equip_gold', 'players', 2, equipGold, { vol: 0.55 });
def('item.hoe.till', 'blocks', 3, till, { vol: 0.6, pv: 0.05 });
def('item.bucket.fill', 'players', 2, bucketFill, { vol: 0.55, pv: 0.05 });
def('item.bucket.empty', 'players', 2, bucketEmpty, { vol: 0.55, pv: 0.05 });
def('entity.tnt.primed', 'blocks', 1, (sr, r) => fuse(sr, r, false), { vol: 0.6 });
def('block.furnace.fire_crackle', 'blocks', 2, furnaceCrackle, { vol: 0.45, pv: 0.1 });
def('ambient.cave', 'ambient', 8, caveAmbience, { vol: 0.7, low: true, target: 0.18 });
def('weather.rain', 'weather', 2, rain, { vol: 0.3, low: true, loop: true, target: 0.15 });
def('ambient.weather.thunder', 'weather', 3, thunder, { vol: 1, low: true, target: 0.3, pv: 0.1 });
alias('weather.thunder', 'ambient.weather.thunder');
alias('item.flintandsteel.use', 'fire.ignite', { cat: 'players' });
alias('entity.generic.splash', 'random.splash', { cat: 'neutral' });
alias('entity.item.break', 'random.break');
alias('entity.player.death', 'damage.hit');
def('entity.player.hurt_drown', 'players', 2, hurtDrown, { vol: 0.75, pv: 0.08 });
def('entity.player.hurt_on_fire', 'players', 2, hurtFire, { vol: 0.75, pv: 0.08 });

// mobs
const MOB_PV = 0.1;
def('mob.zombie.say', 'hostile', 3, zombieSay, { vol: 0.8, pv: MOB_PV });
def('mob.zombie.hurt', 'hostile', 2, zombieHurt, { vol: 0.8, pv: MOB_PV });
def('mob.zombie.death', 'hostile', 1, zombieDeath, { vol: 0.8, pv: MOB_PV });
def('mob.zombie.step', 'hostile', 4, (sr, r) => heavyStep(sr, r, 200), { vol: 0.4, pv: 0.05 });
def('mob.skeleton.say', 'hostile', 3, skeletonSay, { vol: 0.7, pv: MOB_PV });
def('mob.skeleton.hurt', 'hostile', 3, skeletonHurt, { vol: 0.7, pv: MOB_PV });
def('mob.skeleton.death', 'hostile', 1, skeletonDeath, { vol: 0.7, pv: MOB_PV });
def('mob.skeleton.step', 'hostile', 4, skeletonStep, { vol: 0.4, pv: 0.05 });
def('mob.creeper.primed', 'hostile', 1, (sr, r) => fuse(sr, r, true), { vol: 0.8 });
def('mob.creeper.hurt', 'hostile', 4, (sr, r) => creeperRustle(sr, r), { vol: 0.7, pv: MOB_PV });
def('mob.creeper.death', 'hostile', 1, creeperDeath, { vol: 0.7, pv: MOB_PV });
def('mob.spider.say', 'hostile', 4, spiderSay, { vol: 0.7, pv: MOB_PV });
def('mob.spider.step', 'hostile', 4, spiderStep, { vol: 0.4, pv: 0.05 });
def('mob.spider.death', 'hostile', 1, spiderDeath, { vol: 0.7, pv: MOB_PV });
def('mob.pig.say', 'neutral', 3, pigSay, { vol: 0.7, pv: MOB_PV });
def('mob.pig.hurt', 'neutral', 2, (sr, r) => pigSqueal(sr, r, false), { vol: 0.7, pv: MOB_PV });
def('mob.pig.death', 'neutral', 1, (sr, r) => pigSqueal(sr, r, true), { vol: 0.7, pv: MOB_PV });
def('mob.pig.step', 'neutral', 4, (sr, r) => hoofStep(sr, r, 0.3), { vol: 0.35, pv: 0.05 });
def('mob.cow.say', 'neutral', 4, (sr, r) => moo(sr, r, false), { vol: 0.7, pv: MOB_PV });
def('mob.cow.hurt', 'neutral', 3, (sr, r) => moo(sr, r, true), { vol: 0.7, pv: MOB_PV });
def('mob.cow.step', 'neutral', 4, (sr, r) => hoofStep(sr, r, 1), { vol: 0.4, pv: 0.05 });
def('mob.sheep.say', 'neutral', 3, baa, { vol: 0.7, pv: MOB_PV });
def('mob.sheep.shear', 'players', 1, shear, { vol: 0.6, pv: 0.05 });
def('mob.sheep.step', 'neutral', 4, sheepStep, { vol: 0.35, pv: 0.05 });
def('mob.chicken.say', 'neutral', 3, cluck, { vol: 0.6, pv: MOB_PV });
def('mob.chicken.hurt', 'neutral', 2, squawk, { vol: 0.6, pv: MOB_PV });
def('mob.chicken.plop', 'neutral', 1, plop, { vol: 0.6, pv: 0.15 });
def('mob.chicken.step', 'neutral', 2, chickenStep, { vol: 0.3, pv: 0.05 });
def('mob.enderman.idle', 'hostile', 4, endermanIdle, { vol: 0.7, low: true, pv: MOB_PV });
def('mob.enderman.scream', 'hostile', 2, endermanScream, { vol: 0.7, low: true, pv: 0.05 });
def('mob.enderman.hit', 'hostile', 3, endermanHit, { vol: 0.7, low: true, pv: MOB_PV });
def('mob.enderman.death', 'hostile', 1, endermanDeath, { vol: 0.7, low: true, pv: 0.05 });
def('mob.enderman.portal', 'hostile', 2, portal, { vol: 0.6, low: true, pv: 0.05 });

// nether blocks
const NETHER_BLOCKS = [
  ['netherrack', netherrackBreak, netherrackStep], ['nether_bricks', netherBricksBreak, netherBricksStep],
  ['soul_sand', soulSandBreak, soulSandStep], ['soul_soil', soulSoilBreak, soulSoilStep],
  ['nylium', nyliumBreak, nyliumStep], ['stem', stemBreak, stemStep], ['wart_block', wartBlockBreak, wartBlockStep],
  ['shroomlight', shroomlightBreak, shroomlightStep], ['fungus', fungusBreak, fungusStep], ['roots', rootsBreak, rootsStep],
  ['basalt', basaltBreak, basaltStep], ['ancient_debris', ancientDebrisBreak, ancientDebrisStep],
];
for (const [g, dig, step] of NETHER_BLOCKS) {
  def('dig.' + g, 'blocks', 4, (sr, r) => dig(sr, r), { vol: 0.8 });
  def('step.' + g, 'blocks', 5, (sr, r) => step(sr, r), { vol: 0.3, pv: 0.04 });
  alias('hit.' + g, 'step.' + g, { pitch: 0.5, vol: 0.32, pv: 0 });
}
def('dig.nether_wart', 'blocks', 4, netherWartBreak, { vol: 0.75 });
alias('step.nether_wart', 'step.stem');
alias('hit.nether_wart', 'step.stem', { pitch: 0.5, vol: 0.32, pv: 0 });

// portal
def('block.portal.ambient', 'blocks', 3, portalAmbient, { vol: 0.5, low: true, pv: 0.2, target: 0.18 });
def('block.portal.trigger', 'blocks', 2, portalTrigger, { vol: 0.7, low: true, pv: 0.1, target: 0.2 });
def('block.portal.travel', 'blocks', 2, portalTravel, { vol: 0.7, low: true, pv: 0.1, target: 0.22 });

// nether ambience (loops: play(name, { loop: true }))
def('ambient.nether.nether_wastes', 'ambient', 1, netherWastes, { vol: 0.6, low: true, loop: true, target: 0.15 });
def('ambient.nether.crimson_forest', 'ambient', 1, crimsonForest, { vol: 0.6, low: true, loop: true, target: 0.15 });
def('ambient.nether.warped_forest', 'ambient', 1, warpedForest, { vol: 0.6, low: true, loop: true, target: 0.15 });
def('ambient.nether.soul_sand_valley', 'ambient', 1, soulSandValley, { vol: 0.6, low: true, loop: true, target: 0.15 });
def('ambient.nether.basalt_deltas', 'ambient', 1, basaltDeltas, { vol: 0.6, low: true, loop: true, target: 0.15 });
def('ambient.nether.additions', 'ambient', 8, netherAddition, { vol: 0.6, low: true, target: 0.18, pv: 0.1 });

// nether mobs
def('mob.ghast.moan', 'hostile', 4, ghastMoan, { vol: 0.8, low: true, pv: 0.1 });
def('mob.ghast.scream', 'hostile', 3, ghastScream, { vol: 0.8, low: true, pv: 0.1 });
def('mob.ghast.charge', 'hostile', 2, ghastCharge, { vol: 0.8, low: true, pv: 0.05 });
def('mob.ghast.fireball', 'hostile', 2, ghastFireball, { vol: 0.8, low: true, pv: 0.1, target: 0.26 });
def('mob.ghast.death', 'hostile', 1, ghastDeath, { vol: 0.8, low: true, pv: 0.05 });
def('mob.blaze.breathe', 'hostile', 4, blazeBreathe, { vol: 0.6, low: true, pv: 0.1 });
def('mob.blaze.hit', 'hostile', 3, blazeHit, { vol: 0.7, low: true, pv: 0.1 });
def('mob.blaze.death', 'hostile', 1, blazeDeath, { vol: 0.7, low: true, pv: 0.05 });
def('mob.blaze.shoot', 'hostile', 2, blazeShoot, { vol: 0.7, pv: 0.1 });
def('mob.magmacube.jump', 'hostile', 4, (sr, r) => cubeSquish(sr, r, 0.5), { vol: 0.6, pv: 0.1 });
def('mob.magmacube.big', 'hostile', 2, (sr, r) => cubeSquish(sr, r, 1), { vol: 0.7, pv: 0.08 });
def('mob.magmacube.small', 'hostile', 3, (sr, r) => cubeSquish(sr, r, 0.1), { vol: 0.5, pv: 0.1 });
def('mob.slime.attack', 'hostile', 2, (sr, r) => cubeSquish(sr, r, 0.35, false), { vol: 0.6, pv: 0.1 });
def('mob.zombiepig.zpig', 'hostile', 4, zpigGrunt, { vol: 0.7, pv: 0.1 });
def('mob.zombiepig.zpighurt', 'hostile', 2, zpigHurt, { vol: 0.7, pv: 0.1 });
def('mob.zombiepig.zpigdeath', 'hostile', 1, zpigDeath, { vol: 0.7, pv: 0.05 });
def('mob.zombiepig.zpigangry', 'hostile', 2, zpigAngry, { vol: 0.8, pv: 0.08 });

// misc
def('block.enchantment_table.use', 'blocks', 2, enchantUse, { vol: 0.6, low: true, pv: 0.1 });
def('random.anvil_use', 'blocks', 2, anvilUse, { vol: 0.6, pv: 0.05 });
def('random.anvil_break', 'blocks', 1, anvilBreak, { vol: 0.7, pv: 0.05 });
def('item.firecharge.use', 'blocks', 2, fireChargeUse, { vol: 0.7, pv: 0.1 });

// Modern (1.13+) resource-location style aliases, for callers that use those names.
const MODERN = {
  'entity.item.pickup': 'random.pop', 'ui.button.click': 'random.click', 'entity.arrow.shoot': 'random.bow',
  'entity.arrow.hit': 'random.bowhit', 'entity.arrow.hit_player': 'random.successful_hit',
  'entity.experience_orb.pickup': 'random.orb', 'entity.player.levelup': 'random.levelup',
  'entity.generic.eat': 'random.eat', 'entity.player.burp': 'random.burp', 'entity.generic.drink': 'random.drink',
  'entity.generic.explode': 'random.explode', 'block.fire.extinguish': 'random.fizz',
  'block.wooden_door.open': 'random.door_open', 'block.wooden_door.close': 'random.door_close',
  'block.chest.open': 'random.chest_open', 'block.chest.close': 'random.chest_close',
  'entity.player.swim': 'random.swim', 'entity.player.splash': 'random.splash', 'block.anvil.land': 'random.anvil_land',
  'block.fire.ambient': 'fire.fire', 'block.water.ambient': 'liquid.water', 'block.lava.ambient': 'liquid.lava',
  'block.lava.pop': 'liquid.lavapop', 'entity.player.hurt': 'damage.hit', 'entity.generic.small_fall': 'damage.fallsmall',
  'entity.generic.big_fall': 'damage.fallbig', 'entity.player.attack.sweep': 'player.attack.sweep',
  'entity.player.attack.crit': 'player.attack.crit', 'entity.player.attack.strong': 'player.attack.strong',
  'entity.player.attack.weak': 'player.attack.weak', 'entity.player.attack.knockback': 'player.attack.knockback',
  'entity.player.attack.nodamage': 'player.attack.nodamage', 'entity.tnt.primed_fuse': 'entity.tnt.primed',
  'entity.creeper.primed': 'mob.creeper.primed', 'ambient.cave.mood': 'ambient.cave', 'weather.rain.above': 'weather.rain',
  'entity.lightning_bolt.thunder': 'ambient.weather.thunder',
  'entity.ghast.ambient': 'mob.ghast.moan', 'entity.ghast.hurt': 'mob.ghast.scream', 'entity.ghast.warn': 'mob.ghast.charge',
  'entity.ghast.shoot': 'mob.ghast.fireball', 'entity.ghast.death': 'mob.ghast.death', 'entity.blaze.ambient': 'mob.blaze.breathe',
  'entity.blaze.hurt': 'mob.blaze.hit', 'entity.blaze.death': 'mob.blaze.death', 'entity.blaze.shoot': 'mob.blaze.shoot',
  'entity.magma_cube.jump': 'mob.magmacube.jump', 'entity.magma_cube.squish': 'mob.magmacube.big',
  'entity.magma_cube.squish_small': 'mob.magmacube.small', 'entity.slime.attack': 'mob.slime.attack',
  'entity.zombified_piglin.ambient': 'mob.zombiepig.zpig', 'entity.zombified_piglin.hurt': 'mob.zombiepig.zpighurt',
  'entity.zombified_piglin.death': 'mob.zombiepig.zpigdeath', 'entity.zombified_piglin.angry': 'mob.zombiepig.zpigangry',
  'block.anvil.use': 'random.anvil_use', 'block.anvil.destroy': 'random.anvil_break',
};
for (const [n, t] of Object.entries(MODERN)) alias(n, t);
