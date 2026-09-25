// Low-level DSP helpers for procedural sound synthesis.
// Everything here works on plain Float32Arrays (no WebAudio), so buffers can be
// generated synchronously, deterministically and at any sample rate.
// All times are in seconds, all frequencies in Hz.

export const TAU = Math.PI * 2;

// ---------------------------------------------------------------- random ----
export function makeRng(seed) {
  let a = (seed >>> 0) || 0x9e3779b9;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

export const rand = (r, a, b) => a + (b - a) * r();
export const randLog = (r, a, b) => a * Math.pow(b / a, r());
export const randInt = (r, a, b) => a + Math.floor(r() * (b - a + 1));
export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const chance = (r, p) => r() < p;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function alloc(sr, seconds) {
  return new Float32Array(Math.max(1, Math.ceil(sr * seconds)));
}

// A "curve" is a number, a function u(0..1) -> value, or an array of evenly spaced
// breakpoints ([a, b] is a sweep from a to b). Positive breakpoints interpolate
// exponentially (musical for frequencies), otherwise linearly.
export function curve(v, expo = true) {
  if (typeof v === 'function') return v;
  if (Array.isArray(v)) {
    if (v.length === 1) return () => v[0];
    const last = v.length - 1;
    return (u) => {
      const x = clamp(u, 0, 1) * last;
      const i = Math.min(last - 1, Math.floor(x));
      const f = x - i, a = v[i], b = v[i + 1];
      return expo && a > 0 && b > 0 ? a * Math.pow(b / a, f) : a + (b - a) * f;
    };
  }
  return () => v;
}

// Breakpoint envelope from [[t, v], ...] pairs (t in seconds), linear segments.
export function breakpoints(points) {
  const n = points.length;
  return (t) => {
    if (t <= points[0][0]) return points[0][1];
    for (let i = 1; i < n; i++) {
      if (t < points[i][0]) {
        const [t0, v0] = points[i - 1], [t1, v1] = points[i];
        return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
      }
    }
    return points[n - 1][1];
  };
}

// Envelope spec: function (t, u) -> gain, or { a: attack, h: hold, d: exp decay tau, r: end fade, s: sustain }
export function envFn(e, dur) {
  if (typeof e === 'function') return e;
  const a = e.a ?? 0.002, h = e.h ?? 0, tau = e.d ?? dur / 4, r = e.r ?? 0, s = e.s ?? 0;
  const ap = e.ap ?? 1; // attack curve power
  return (t) => {
    let g;
    if (t < a) g = Math.pow(t / a, ap);
    else if (t < a + h) g = 1;
    else g = s + (1 - s) * Math.exp(-(t - a - h) / tau);
    if (r > 0 && t > dur - r) g *= Math.max(0, (dur - t) / r);
    return g;
  };
}

// ----------------------------------------------------------------- filters ----
// Zero-delay-feedback state variable filter (Zavalishin/TPT). Stable under fast
// modulation. After tick(): .lp, .bp (unity peak gain), .hp, .notch
export class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; this.k = 1; this.lp = 0; this.bp = 0; this.hp = 0; }
  reset() { this.ic1 = 0; this.ic2 = 0; return this; }
  set(f, q, sr) {
    const fc = f < 5 ? 5 : f > sr * 0.49 ? sr * 0.49 : f;
    const g = Math.tan(Math.PI * fc / sr);
    this.k = 1 / (q < 0.05 ? 0.05 : q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
    return this;
  }
  tick(v0) {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1 * this.k; this.hp = v0 - this.k * v1 - v2;
    return v2;
  }
}

// Gain that makes white noise (RMS 1) come out of a filter with roughly RMS 1 in its passband,
// so layer amplitudes mean the same thing at any sample rate / bandwidth.
export function noiseNorm(mode, f, q, sr) {
  const ny = sr * 0.5;
  let frac;
  if (mode === 'bp') frac = (1.57 * f / Math.max(q, 0.05)) / ny;
  else if (mode === 'lp') frac = Math.min(f, ny) / ny;
  else if (mode === 'hp') frac = Math.max(0.02, 1 - f / ny);
  else return 1;
  return Math.min(14, 1 / Math.sqrt(Math.min(1, Math.max(frac, 1e-4))));
}

// ------------------------------------------------------------ noise bursts ----
// Filtered noise layer.
//  t0, dur, amp (≈RMS), mode 'lp'|'hp'|'bp'|'notch'|'none', f (curve), q (curve), stages,
//  color 'white'|'pink'|'brown', env (spec/function) or a/h/d/r shorthands,
//  am { rate, depth } random amplitude flutter.
export function burst(out, sr, r, o) {
  const t0 = o.t0 || 0, dur = o.dur ?? 0.2;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.round(dur * sr));
  if (n <= 0) return;
  const env = envFn(o.env ?? { a: o.a ?? 0.002, h: o.h ?? 0, d: o.d ?? dur / 4, r: o.r ?? Math.min(0.01, dur * 0.25), s: o.s ?? 0 }, dur);
  const mode = o.mode || 'bp';
  const fF = curve(o.f ?? 1000), qF = curve(o.q ?? 0.707, false);
  const stages = o.stages || 1;
  const F1 = new SVF(), F2 = new SVF();
  const color = o.color || 'white';
  const amp = o.amp ?? 1;
  const norm = o.norm ?? (color === 'white');
  const am = o.am;
  let comp = 1;
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  let fl = 1, flT = 1, flCount = 0;
  const flPeriod = am ? Math.max(1, Math.round(sr / am.rate)) : 0;
  const flCoef = am ? 1 - Math.exp(-2.5 / flPeriod) : 0;
  const fixed = typeof (o.f ?? 1000) === 'number' && typeof (o.q ?? 0.707) === 'number';
  for (let i = 0; i < n; i++) {
    if ((i & 15) === 0 && (i === 0 || !fixed)) {
      const u = i / n, f = fF(u), q = qF(u);
      F1.set(f, q, sr); if (stages > 1) F2.set(f, q, sr);
      if (norm) comp = noiseNorm(mode, f, q, sr);
    }
    const w = (r() * 2 - 1) * 1.732;
    let x;
    if (color === 'white') x = w;
    else if (color === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      x = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.2; b6 = w * 0.115926;
    } else { br = (br + 0.02 * w) / 1.02; x = br * 3.5; }
    if (mode !== 'none') {
      F1.tick(x);
      x = mode === 'lp' ? F1.lp : mode === 'hp' ? F1.hp : mode === 'bp' ? F1.bp : F1.lp + F1.hp;
      if (stages > 1) { F2.tick(x); x = mode === 'lp' ? F2.lp : mode === 'hp' ? F2.hp : mode === 'bp' ? F2.bp : F2.lp + F2.hp; }
    }
    if (am) {
      if (--flCount <= 0) { flCount = flPeriod * (0.5 + r()); flT = 1 - am.depth * r(); }
      fl += (flT - fl) * flCoef;
    }
    out[i0 + i] += x * comp * amp * env(i / sr, i / n) * fl;
  }
}

// Cloud of short filtered-noise grains (crunch, crackle, rustle, clicks).
//  t0, dur, count, dist (>1 front-loads grains), f [min,max] (log), q [min,max],
//  len [min,max] grain decay tau (s), amp [min,max], ampEnv u -> gain, fEnv u -> multiplier
export function grains(out, sr, r, o) {
  const t0 = o.t0 || 0, dur = o.dur ?? 0.3, count = o.count ?? 40, dist = o.dist ?? 1;
  const fR = o.f ?? [800, 4000], qR = o.q ?? [1, 4], lenR = o.len ?? [0.002, 0.01], ampR = o.amp ?? [0.3, 1];
  const ampEnv = o.ampEnv, fEnv = o.fEnv;
  const svf = new SVF();
  const att = Math.max(1, Math.round(0.0003 * sr));
  for (let g = 0; g < count; g++) {
    const u = Math.pow(r(), dist);
    const i0 = Math.round((t0 + u * dur) * sr);
    if (i0 >= out.length) continue;
    const f = randLog(r, fR[0], fR[1]) * (fEnv ? fEnv(u) : 1);
    const q = rand(r, qR[0], qR[1]);
    const tau = randLog(r, lenR[0], lenR[1]);
    const a = rand(r, ampR[0], ampR[1]) * (ampEnv ? ampEnv(u) : 1) * noiseNorm('bp', f, q, sr);
    const ring = q / (Math.PI * f);
    const n = Math.min(out.length - i0, Math.ceil((tau * 6 + ring * 4) * sr));
    svf.reset(); svf.set(f, q, sr);
    const k = Math.exp(-1 / (tau * sr));
    let e = 1;
    for (let i = 0; i < n; i++) {
      const x = (r() * 2 - 1) * 1.732 * e * (i < att ? i / att : 1);
      svf.tick(x);
      out[i0 + i] += svf.bp * a;
      e *= k;
    }
  }
}

// ------------------------------------------------------- tonal primitives ----
// Exponentially decaying sine (modal resonance) via a two-pole recurrence.
export function mode(out, sr, t0, f, tau, amp, phase = 0) {
  if (f <= 0 || f >= sr * 0.48) return;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.ceil(tau * 7 * sr));
  if (n <= 2) return;
  const w = TAU * f / sr, rr = Math.exp(-1 / (tau * sr));
  const c = 2 * rr * Math.cos(w), r2 = rr * rr;
  let y2 = amp * Math.sin(phase), y1 = amp * rr * Math.sin(w + phase);
  out[i0] += y2; out[i0 + 1] += y1;
  for (let i = 2; i < n; i++) {
    const y = c * y1 - r2 * y2;
    out[i0 + i] += y;
    y2 = y1; y1 = y;
  }
}

// Bank of modes: ratios/taus/amps arrays (taus/amps may be shorter -> last value repeats)
export function modes(out, sr, t0, f0, ratios, taus, amps, r = null, detune = 0) {
  for (let k = 0; k < ratios.length; k++) {
    const tau = taus[Math.min(k, taus.length - 1)], a = amps[Math.min(k, amps.length - 1)];
    const d = r ? 1 + (r() * 2 - 1) * detune : 1;
    mode(out, sr, t0, f0 * ratios[k] * d, tau, a);
  }
}

function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// Oscillator layer. f is a curve over u (or function(t,u)), wave: sine|saw|square|pulse|tri
//  vib { rate, depth (fraction) }, fm { ratio, index (curve) }, env spec, amp, width (pulse)
export function tone(out, sr, o) {
  const t0 = o.t0 || 0, dur = o.dur ?? 0.3;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.round(dur * sr));
  if (n <= 0) return;
  const fF = curve(o.f ?? 440);
  const env = envFn(o.env ?? { a: o.a ?? 0.003, h: o.h ?? 0, d: o.d ?? dur / 4, r: o.r ?? Math.min(0.02, dur * 0.2), s: o.s ?? 0 }, dur);
  const wave = o.wave || 'sine', amp = o.amp ?? 1, width = o.width ?? 0.5;
  const vib = o.vib, fm = o.fm, fmI = fm ? curve(fm.index ?? 1, false) : null;
  let ph = o.phase || 0, mph = 0, f = fF(0), idx = fmI ? fmI(0) : 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = i / n;
    if ((i & 7) === 0) {
      f = fF(u);
      if (vib) f *= 1 + vib.depth * Math.sin(TAU * vib.rate * t);
      if (fmI) idx = fmI(u);
    }
    let dt = f / sr;
    let s;
    if (wave === 'sine') {
      let p = ph;
      if (fm) { mph += dt * fm.ratio; if (mph >= 1) mph -= 1; p += idx * Math.sin(TAU * mph) / TAU; }
      s = Math.sin(TAU * p);
    } else if (wave === 'saw') {
      s = 2 * ph - 1 - polyblep(ph, dt);
    } else if (wave === 'square' || wave === 'pulse') {
      const w = wave === 'square' ? 0.5 : width;
      s = (ph < w ? 1 : -1) + polyblep(ph, dt) - polyblep((ph + 1 - w) % 1, dt);
    } else { // tri (naive, fine for low f)
      s = 4 * Math.abs(ph - 0.5) - 1;
    }
    ph += dt; if (ph >= 1) ph -= 1;
    out[i0 + i] += s * amp * env(t, u);
  }
}

// Bell/chime: a set of inharmonic modes.
export function bell(out, sr, t0, f, amp, tau = 0.5, partials = [[1, 1, 1], [2.76, 0.4, 0.45], [5.4, 0.2, 0.25], [8.93, 0.08, 0.15]]) {
  for (const [ratio, a, tm] of partials) mode(out, sr, t0, f * ratio, tau * tm, amp * a);
}

// Rising water bubble (Minnaert-like chirp).
export function bubble(out, sr, t0, f0, rise, tau, amp) {
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.ceil(tau * 6 * sr));
  const att = Math.max(1, Math.round(0.0008 * sr));
  const kA = Math.exp(-1 / (tau * sr)), kF = Math.exp(-1 / (tau * 1.5 * sr));
  let ph = 0, e = amp, g = 1; // g = exp(-t / (1.5 tau))
  for (let i = 0; i < n; i++) {
    ph += f0 * (1 + rise * (1 - g)) / sr;
    out[i0 + i] += Math.sin(TAU * ph) * e * (i < att ? i / att : 1);
    e *= kA; g *= kF;
  }
}

// Tabulate an expensive envelope function of t (seconds) at `step` resolution; returns a
// fast linearly-interpolated lookup (t, u) -> value.
export function sampled(fn, dur, step = 0.001) {
  const n = Math.ceil(dur / step) + 2;
  const tab = new Float32Array(n);
  for (let i = 0; i < n; i++) tab[i] = fn(i * step);
  return (t) => {
    const x = t / step, i = x | 0;
    if (i >= n - 1) return tab[n - 1];
    return tab[i] + (tab[i + 1] - tab[i]) * (x - i);
  };
}

// Karplus-Strong plucked string.
//  f, dur, amp, decay (per period), damp (0 bright .. 0.5 dull), bright (excitation brightness 0..1)
export function pluck(out, sr, r, o) {
  const t0 = o.t0 || 0, f = o.f ?? 110, dur = o.dur ?? 1, amp = o.amp ?? 1;
  const decay = o.decay ?? 0.99, damp = o.damp ?? 0.5, bright = o.bright ?? 0.6;
  const L = Math.max(2, Math.round(sr / f));
  const line = new Float32Array(L);
  let lp = 0;
  for (let i = 0; i < L; i++) { lp += ((r() * 2 - 1) - lp) * bright; line[i] = lp; }
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.round(dur * sr));
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const cur = line[idx];
    const nxt = line[idx + 1 < L ? idx + 1 : 0];
    line[idx] = decay * (cur * (1 - damp) + nxt * damp);
    if (++idx >= L) idx = 0;
    out[i0 + i] += cur * amp;
  }
}

// Stick-slip creak (doors, chests, ropes): an irregular impulse train through resonators.
//  rate curve (impulses/s), jitter fraction, res: [[f, q, gain], ...], env spec
export function creak(out, sr, r, o) {
  const t0 = o.t0 || 0, dur = o.dur ?? 0.4, amp = o.amp ?? 1;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.round(dur * sr));
  if (n <= 0) return;
  const rate = curve(o.rate ?? [60, 120]);
  const jitter = o.jitter ?? 0.2;
  const env = envFn(o.env ?? { a: 0.02, h: dur * 0.5, d: dur * 0.2, r: 0.03 }, dur);
  const res = (o.res ?? [[450, 12, 1], [980, 10, 0.6], [1850, 9, 0.35]]).map(([f, q, g]) => ({ s: new SVF().set(f, q, sr), g, n: q * sr / (Math.PI * f) }));
  let next = 0;
  for (let i = 0; i < n; i++) {
    let x = 0;
    if (i >= next) {
      x = (0.5 + 0.5 * r()) * (r() < 0.5 ? 1 : -1);
      const p = sr / rate(i / n);
      next = i + Math.max(1, p * (1 + (r() * 2 - 1) * jitter));
    }
    let y = 0;
    // bp * q recovers the raw band-pass; * sr/(pi f) makes each impulse ring at ~unit amplitude
    for (let k = 0; k < res.length; k++) { const R = res[k]; R.s.tick(x); y += R.s.bp * R.g * R.n; }
    out[i0 + i] += y * amp * env(i / sr, i / n);
  }
}

// --------------------------------------------------------------- voices ----
export const VOWELS = {
  a: [730, 1090, 2440], o: [570, 840, 2410], u: [300, 870, 2240], e: [530, 1840, 2480],
  i: [270, 2290, 3010], uh: [640, 1190, 2390], er: [490, 1350, 1690], m: [250, 900, 2200],
  ae: [660, 1720, 2410], aw: [600, 950, 2500],
};

// Path through vowels: seq = [[u, 'vowel'], ...]; returns u -> [F1, F2, F3] (scaled)
export function vowelPath(seq, scale = 1) {
  const pts = seq.map(([u, v]) => [u, typeof v === 'string' ? VOWELS[v] : v]);
  return (u) => {
    if (u <= pts[0][0]) return pts[0][1].map((f) => f * scale);
    for (let i = 1; i < pts.length; i++) {
      if (u < pts[i][0]) {
        const [ua, fa] = pts[i - 1], [ub, fb] = pts[i];
        const t = smooth((u - ua) / (ub - ua));
        return fa.map((f, k) => f * Math.pow(fb[k] / f, t) * scale);
      }
    }
    return pts[pts.length - 1][1].map((f) => f * scale);
  };
}

// Source-filter voice: band-limited glottal-ish source through parallel formant resonators.
//  f0 (curve over u), vib {rate, depth, delay}, jitter (fraction), trem {rate, depth},
//  creak (0..1 period-doubling roughness), breath (0..1 noise), formants: u -> [F1,F2,F3,...]
//  bw [..] bandwidths (Hz, widened to >= bwScale*f0 so sparse harmonics still excite each formant),
//  fg [..] formant gains (or function u -> gains), direct (dry source mix), tilt (source LP Hz),
//  wave 'saw'|'pulse', width, drive (tanh), ring {f (curve), mix}, env spec, amp
export function voice(out, sr, r, o) {
  const t0 = o.t0 || 0, dur = o.dur ?? 0.5;
  const i0 = Math.max(0, Math.round(t0 * sr));
  const n = Math.min(out.length - i0, Math.round(dur * sr));
  if (n <= 0) return;
  const f0F = curve(o.f0 ?? 150);
  const env = envFn(o.env ?? { a: 0.03, h: dur * 0.5, d: dur * 0.2, r: 0.05 }, dur);
  const vib = o.vib, trem = o.trem, jitter = o.jitter ?? 0.01, creakAmt = o.creak ?? 0;
  const breath = o.breath ?? 0.05, wave = o.wave || 'saw', width = o.width ?? 0.35;
  const formF = typeof o.formants === 'function' ? o.formants : () => o.formants;
  const bw = o.bw ?? [90, 110, 170, 250];
  const fgF = typeof o.fg === 'function' ? o.fg : () => (o.fg ?? [1, 0.7, 0.45, 0.25]);
  const bwScale = o.bwScale ?? 0.7, direct = o.direct ?? 0.12;
  const tiltC = 1 - Math.exp(-TAU * (o.tilt ?? 2500) / sr);
  const drive = o.drive || 0, dn = drive ? Math.tanh(drive) : 1;
  const ring = o.ring, ringF = ring ? curve(ring.f) : null;
  const amp = o.amp ?? 1;
  const nf = formF(0).length;
  const svfs = []; for (let k = 0; k < nf; k++) svfs.push(new SVF());
  let fg = fgF(0);
  let ph = 0, rph = 0, jit = 0, jitT = 0, lp = 0, odd = false, shimmer = 1, f0 = f0F(0);
  let nlp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = i / n;
    if ((i & 31) === 0) {
      const fs = formF(u);
      f0 = f0F(u);
      for (let k = 0; k < nf; k++) svfs[k].set(fs[k], fs[k] / Math.max(bw[Math.min(k, bw.length - 1)], f0 * bwScale), sr);
      fg = fgF(u);
      jit += (jitT - jit) * 0.15;
    }
    let f = f0 * (1 + jit);
    if (vib) { const vd = vib.delay ? smooth(t / vib.delay) : 1; f *= 1 + vib.depth * vd * Math.sin(TAU * vib.rate * t); }
    const dt = f / sr;
    ph += dt;
    if (ph >= 1) {
      ph -= 1; odd = !odd;
      jitT = (r() * 2 - 1) * jitter;
      shimmer = 1 - r() * jitter * 3;
    }
    let s = wave === 'saw' ? (2 * ph - 1 - polyblep(ph, dt))
      : ((ph < width ? 1 : -1) + polyblep(ph, dt) - polyblep((ph + 1 - width) % 1, dt));
    s *= shimmer * (odd ? 1 - creakAmt : 1);
    if (breath) { nlp += ((r() * 2 - 1) - nlp) * 0.5; s = s * (1 - breath) + nlp * breath * 2.2; }
    lp += (s - lp) * tiltC;
    let y = lp * direct;
    for (let k = 0; k < nf; k++) { svfs[k].tick(lp); y += svfs[k].bp * fg[k]; }
    let g = env(t, u);
    if (trem) g *= 1 - trem.depth * (0.5 + 0.5 * Math.sin(TAU * trem.rate * t + (trem.phase || 0)));
    y *= g;
    if (drive) y = Math.tanh(y * drive * 3) / (dn * 3);
    if (ring) { rph += ringF(u) / sr; if (rph >= 1) rph -= 1; y = y * (1 - ring.mix) + y * Math.sin(TAU * rph) * ring.mix * 1.4; }
    out[i0 + i] += y * amp;
  }
}

// ---------------------------------------------------------- whole buffers ----
// Freeverb-style mono reverb, in place. The buffer must already contain room for the tail.
export function reverb(buf, sr, o = {}) {
  const room = o.room ?? 0.8, damp = o.damp ?? 0.3, wet = o.wet ?? 0.3, dry = o.dry ?? 1, size = o.size ?? 1;
  const sc = sr / 44100 * size;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((l) => ({ b: new Float32Array(Math.max(1, Math.round(l * sc))), i: 0, s: 0 }));
  const aps = [556, 441, 341, 225].map((l) => ({ b: new Float32Array(Math.max(1, Math.round(l * sr / 44100))), i: 0 }));
  const fb = room * 0.28 + 0.7, d1 = damp * 0.4, d2 = 1 - d1;
  const preN = Math.round((o.pre ?? 0) * sr);
  const pre = preN > 0 ? new Float32Array(preN) : null;
  let pi = 0;
  for (let n = 0; n < buf.length; n++) {
    let x = buf[n];
    if (pre) { const d = pre[pi]; pre[pi] = x; pi = (pi + 1) % preN; x = d; }
    x *= 0.06;
    let y = 0;
    for (let c = 0; c < 6; c++) {
      const C = combs[c];
      const o2 = C.b[C.i];
      C.s = o2 * d2 + C.s * d1;
      C.b[C.i] = x + C.s * fb;
      if (++C.i >= C.b.length) C.i = 0;
      y += o2;
    }
    for (let a = 0; a < 4; a++) {
      const A = aps[a];
      const bo = A.b[A.i];
      A.b[A.i] = y + bo * 0.5;
      if (++A.i >= A.b.length) A.i = 0;
      y = bo - y;
    }
    buf[n] = buf[n] * dry + y * wet;
  }
  return buf;
}

// Simple one-pole filters over a whole buffer (in place).
export function lowpass(buf, sr, f) {
  const c = 1 - Math.exp(-TAU * f / sr); let s = 0;
  for (let i = 0; i < buf.length; i++) { s += (buf[i] - s) * c; buf[i] = s; }
  return buf;
}
export function highpass(buf, sr, f) {
  const c = 1 - Math.exp(-TAU * f / sr); let s = 0;
  for (let i = 0; i < buf.length; i++) { s += (buf[i] - s) * c; buf[i] -= s; }
  return buf;
}

export function softClip(buf, drive = 1.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh(buf[i] * drive) / k;
  return buf;
}

export function peakOf(buf) {
  let p = 0;
  for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > p) p = a; }
  return p;
}

// Loudest short-term RMS (window in seconds).
export function shortTermRms(buf, sr, win = 0.05) {
  const w = Math.max(1, Math.round(win * sr)), hop = Math.max(1, w >> 1);
  let best = 0;
  if (buf.length <= w) {
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  for (let st = 0; st + w <= buf.length; st += hop) {
    let s = 0;
    for (let i = st; i < st + w; i++) s += buf[i] * buf[i];
    if (s > best) best = s;
  }
  return Math.sqrt(best / w);
}

// Render a sub-layer and mix it in at a given short-term RMS level, so layers
// built from different primitives can be balanced predictably.
export function layer(out, sr, level, fn) {
  const tmp = new Float32Array(out.length);
  fn(tmp);
  const rms = shortTermRms(tmp, sr, 0.05);
  if (rms < 1e-9) return out;
  const g = level / rms;
  for (let i = 0; i < out.length; i++) out[i] += tmp[i] * g;
  return out;
}

// Seamless loop: crossfade the last xf seconds into the start; returns a shorter buffer.
export function loopify(buf, sr, xf) {
  const n = Math.round(xf * sr);
  const len = buf.length - n;
  const res = buf.slice(0, len);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    res[i] = buf[len + i] * Math.cos(t * Math.PI / 2) + buf[i] * Math.sin(t * Math.PI / 2);
  }
  return res;
}

// Feedback comb filter (metallic / tube resonance at 1/delay Hz), in place.
export function comb(buf, sr, delay, fb = 0.8, mix = 1) {
  const d = Math.max(1, Math.round(delay * sr));
  const line = new Float32Array(d);
  let idx = 0;
  for (let i = 0; i < buf.length; i++) {
    const y = buf[i] + line[idx] * fb;
    line[idx] = y;
    if (++idx >= d) idx = 0;
    buf[i] = buf[i] * (1 - mix) + y * mix * (1 - fb);
  }
  return buf;
}

// Frequency rounded so that it completes a whole number of cycles in `L` seconds
// (keeps tonal layers phase-continuous across a loop point).
export const periodic = (f, L) => Math.max(1, Math.round(f * L)) / L;

// Sum of steady sines with slow sinusoidal swells, computed with rotating phasors (no per-sample
// trig). parts: [[freq, amp, swellFreq, swellPhase]]; swell gain = 0.65 + 0.35 sin(...).
export function droneSines(out, sr, parts) {
  for (const [f, amp, lf = 0, lph = 0] of parts) {
    const w = TAU * f / sr, lw = TAU * lf / sr;
    const cw = Math.cos(w), sw = Math.sin(w), cl = Math.cos(lw), sl = Math.sin(lw);
    let c = 1, s = 0, lc = Math.cos(lph), ls = Math.sin(lph);
    for (let i = 0; i < out.length; i++) {
      out[i] += s * amp * (0.65 + 0.35 * ls);
      const c2 = c * cw - s * sw; s = s * cw + c * sw; c = c2;
      const l2 = lc * cl - ls * sl; ls = ls * cl + lc * sl; lc = l2;
      if ((i & 1023) === 1023) { const k = 1 / Math.hypot(c, s), q = 1 / Math.hypot(lc, ls); c *= k; s *= k; lc *= q; ls *= q; }
    }
  }
  return out;
}

// Seamless loop builder. build(tonal, noisy, total):
//   tonal: L seconds, for layers that are exactly periodic in L (use periodic() frequencies);
//   noisy: L + xf seconds, for noise / events; its tail is crossfaded into its head.
export function loopBed(sr, L, xf, build) {
  const tonal = alloc(sr, L), noisy = alloc(sr, L + xf);
  build(tonal, noisy, L + xf);
  const out = loopify(noisy, sr, xf);
  const n = Math.min(out.length, tonal.length);
  const res = out.length === n ? out : out.slice(0, n);
  for (let i = 0; i < n; i++) res[i] += tonal[i];
  return res;
}

// Final cleanup: DC block, edge fades, trim silent tail, loudness normalise (capped by peak).
// dc: true (18 Hz high-pass) | 'mean' (subtract the mean; keeps loops seamless) | false
export function finalize(buf, sr, o = {}) {
  const target = o.target ?? 0.22, peak = o.peak ?? 0.89;
  if (o.dc === 'mean') {
    let m = 0; for (let i = 0; i < buf.length; i++) m += buf[i];
    m /= buf.length || 1;
    for (let i = 0; i < buf.length; i++) buf[i] -= m;
  } else if (o.dc !== false) highpass(buf, sr, o.hp ?? 18);
  let end = buf.length;
  if (o.trim !== false) {
    let p = peakOf(buf);
    const thr = Math.max(1e-6, p * 0.0015);
    while (end > 1 && Math.abs(buf[end - 1]) < thr) end--;
    end = Math.min(buf.length, end + Math.round(0.01 * sr));
  }
  let b = end < buf.length ? buf.slice(0, end) : buf;
  const fi = Math.min(b.length, Math.round((o.fadeIn ?? 0.0005) * sr));
  for (let i = 0; i < fi; i++) b[i] *= i / fi;
  const fo = Math.min(b.length, Math.round((o.fadeOut ?? 0.012) * sr));
  for (let i = 0; i < fo; i++) b[b.length - 1 - i] *= i / fo;
  const pk = peakOf(b), st = shortTermRms(b, sr, 0.05);
  if (pk > 1e-9) {
    const g = Math.min(peak / pk, st > 1e-9 ? target / st : Infinity);
    for (let i = 0; i < b.length; i++) b[i] *= g;
  }
  return b;
}
