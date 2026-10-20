// Procedural sound design (WebAudio): effects, generative music and ship ambience.
// No audio files. Browsers only allow sound after a user gesture; call unlock() from a click handler.
//
// Graph: sound -> sfx / music level -> master -> compressor -> soft limiter -> speakers,
// with a shared convolution reverb fed by per-channel send levels.

const VOL_KEY = 'sus-volume';
const MUTE_KEY = 'sus-muted';
const vol = { master: 0.8, music: 0.5, sfx: 0.8 };
let muted = false;
try {
  const saved = JSON.parse(localStorage.getItem(VOL_KEY) || 'null');
  if (saved) for (const k of Object.keys(vol)) if (Number.isFinite(saved[k])) vol[k] = Math.max(0, Math.min(1, saved[k]));
  muted = localStorage.getItem(MUTE_KEY) === '1';
} catch {
  /* storage unavailable */
}

let ac = null; // live AudioContext
let bus = null;
const wanted = { track: null, ambience: false };
const live = { track: null, ambience: null, alarm: null };

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// ---------- shared resources (one set per context) ----------
const cache = new WeakMap();

function res(ctx) {
  let r = cache.get(ctx);
  if (r) return r;
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * 3);
  const white = ctx.createBuffer(1, len, sr);
  const pink = ctx.createBuffer(1, len, sr);
  const w = white.getChannelData(0);
  const p = pink.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const x = Math.random() * 2 - 1;
    w[i] = x;
    b0 = 0.99765 * b0 + x * 0.099046;
    b1 = 0.963 * b1 + x * 0.2965164;
    b2 = 0.57 * b2 + x * 1.0526913;
    p[i] = (b0 + b1 + b2 + x * 0.1848) * 0.2;
  }
  // Reverb impulse: decaying, gently darkening noise with a few early reflections.
  const ir = ctx.createBuffer(2, Math.floor(sr * 1.8), sr);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < d.length; i++) {
      const t = i / sr;
      const k = 0.35 + 0.6 * Math.exp(-t * 2);
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * Math.exp(-t * 3.6);
    }
    for (const [ms, g] of [
      [11, 0.5],
      [23, 0.35],
      [37, 0.25],
    ])
      d[Math.floor(((ms + c * 3) / 1000) * sr)] += g;
  }
  // Footsteps: a few baked variants, so each step is one buffer source.
  const steps = [0, 1, 2].map((v) => {
    const n = Math.floor(sr * 0.11);
    const b = ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    let lp = 0;
    const cut = 0.05 + v * 0.015;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const env = Math.min(1, t / 0.003) * Math.exp(-t / (0.018 + v * 0.004));
      lp += cut * (Math.random() * 2 - 1 - lp);
      d[i] = (lp * 3 + Math.sin(2 * Math.PI * (95 + v * 12) * t) * 0.6) * env;
      peak = Math.max(peak, Math.abs(d[i]));
    }
    for (let i = 0; i < n; i++) d[i] /= peak;
    return b;
  });
  r = { white, pink, ir, steps };
  cache.set(ctx, r);
  return r;
}

function softClipCurve() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = Math.sign(x) * (a < 0.6 ? a : 0.6 + 0.3 * Math.tanh((a - 0.6) / 0.3));
  }
  return c;
}

function makeBus(ctx, { raw = false } = {}) {
  const master = ctx.createGain();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;
  const post = ctx.createGain();
  post.gain.value = 1;
  master.connect(comp).connect(post);
  if (raw) post.connect(ctx.destination);
  else {
    const clip = ctx.createWaveShaper();
    clip.curve = softClipCurve();
    clip.oversample = '2x';
    post.connect(clip).connect(ctx.destination);
  }
  const reverb = ctx.createConvolver();
  reverb.buffer = res(ctx).ir;
  const verbOut = ctx.createGain();
  verbOut.gain.value = 0.32;
  reverb.connect(verbOut).connect(master);
  const level = (to) => {
    const g = ctx.createGain();
    g.connect(to);
    return g;
  };
  const b = {
    ctx,
    master,
    sfx: level(master),
    sfxVerb: level(reverb),
    music: level(master),
    musicVerb: level(reverb),
  };
  applyVolumes(b, true);
  return b;
}

function applyVolumes(b, now = false) {
  const set = (param, v) => (now ? (param.value = v) : param.setTargetAtTime(v, b.ctx.currentTime, 0.05));
  set(b.master.gain, muted && b.ctx === ac ? 0 : vol.master);
  set(b.sfx.gain, vol.sfx);
  set(b.sfxVerb.gain, vol.sfx);
  set(b.music.gain, vol.music);
  set(b.musicVerb.gain, vol.music);
}

// ---------- voices ----------
// A "stage" S = { ctx, t, out, verb } says where and when a sound plays.

/** Click-free envelope: linear attack from 0, optional hold, exponential-style release. */
function envGain(S, t, a, hold, d, v) {
  const g = S.ctx.createGain();
  // The value before the first event is the default 1; without this the first sample can leak through.
  g.gain.value = 0;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  if (hold) g.gain.setValueAtTime(v, t + a + hold);
  g.gain.setTargetAtTime(0, t + a + hold, d / 4);
  return g;
}

function route(S, node, verb = 0, pan = 0) {
  let out = node;
  if (pan) {
    const p = S.ctx.createStereoPanner();
    p.pan.value = pan;
    out = out.connect(p);
  }
  out.connect(S.out);
  if (verb) {
    const s = S.ctx.createGain();
    s.gain.value = verb;
    out.connect(s).connect(S.verb);
  }
}

function filter(ctx, type, f, q = 0.7) {
  const n = ctx.createBiquadFilter();
  n.type = type;
  n.frequency.value = f;
  n.Q.value = q;
  return n;
}

function tone(S, { f, f2, glide, type = 'sine', at = 0, a = 0.004, hold = 0, d = 0.2, v = 0.2, detune = 0, lp, hp, q = 0.7, verb, pan }) {
  const t = S.t + at;
  const o = S.ctx.createOscillator();
  o.type = type;
  o.detune.value = detune;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + (glide ?? a + hold + d));
  let node = o;
  if (lp) node = node.connect(filter(S.ctx, 'lowpass', lp, q));
  if (hp) node = node.connect(filter(S.ctx, 'highpass', hp, q));
  const g = envGain(S, t, a, hold, d, v);
  node.connect(g);
  route(S, g, verb, pan);
  o.start(t);
  o.stop(t + a + hold + d * 2.2 + 0.02);
}

function noise(
  S,
  { color = 'white', type = 'lowpass', f = 1000, fMid, f2, q = 0.7, at = 0, a = 0.004, hold = 0, d = 0.2, v = 0.2, verb, pan },
) {
  const t = S.t + at;
  const dur = a + hold + d * 2.2;
  const src = S.ctx.createBufferSource();
  src.buffer = res(S.ctx)[color];
  src.loop = true;
  const flt = filter(S.ctx, type, f, q);
  const end = t + a + hold + d;
  flt.frequency.setValueAtTime(f, t);
  if (fMid) flt.frequency.exponentialRampToValueAtTime(fMid, t + (end - t) * 0.45);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, end);
  const g = envGain(S, t, a, hold, d, v);
  src.connect(flt).connect(g);
  route(S, g, verb, pan);
  src.start(t, Math.random() * 2);
  src.stop(t + dur + 0.02);
}

/** Two-operator FM: bells, metal, plucks. Brightness decays faster than volume. */
function fm(S, { f, ratio = 3.5, index = 2, at = 0, a = 0.003, hold = 0, d = 0.8, v = 0.1, bright, verb, pan }) {
  const t = S.t + at;
  const car = S.ctx.createOscillator();
  const mod = S.ctx.createOscillator();
  car.frequency.value = f;
  mod.frequency.value = f * ratio;
  const depth = S.ctx.createGain();
  depth.gain.setValueAtTime(index * f, t);
  depth.gain.setTargetAtTime(index * f * 0.04, t, bright ?? d / 4);
  mod.connect(depth).connect(car.frequency);
  const g = envGain(S, t, a, hold, d, v);
  car.connect(g);
  route(S, g, verb, pan);
  const stop = t + a + hold + d * 2.2 + 0.02;
  car.start(t);
  mod.start(t);
  car.stop(stop);
  mod.stop(stop);
}

/** Detuned saw chord through one lowpass with a cutoff path [start, peak, end]. */
function chord(
  S,
  notes,
  { at = 0, type = 'sawtooth', detune = 8, a = 0.02, hold = 0, d = 0.6, v = 0.04, cut = [600, 2400, 900], cutAt, q = 0.8, verb, pan },
) {
  const t = S.t + at;
  const flt = filter(S.ctx, 'lowpass', cut[0], q);
  const [t1, t2] = cutAt || [a + 0.02, a + hold + d];
  flt.frequency.setValueAtTime(cut[0], t);
  flt.frequency.exponentialRampToValueAtTime(cut[1], t + t1);
  flt.frequency.exponentialRampToValueAtTime(cut[2], t + t2);
  const g = envGain(S, t, a, hold, d, v);
  flt.connect(g);
  route(S, g, verb, pan);
  const stop = t + a + hold + d * 2.2 + 0.02;
  for (const m of notes) {
    for (const dt of [-detune, detune]) {
      const o = S.ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(m);
      o.detune.value = dt;
      o.connect(flt);
      o.start(t);
      o.stop(stop);
    }
  }
}

// ---------- sound effects ----------
const SOUNDS = {
  click: (S) => {
    tone(S, { f: 880, f2: 520, glide: 0.05, a: 0.002, d: 0.07, v: 0.26 });
    tone(S, { f: 1760, f2: 1040, glide: 0.03, type: 'triangle', a: 0.002, d: 0.03, v: 0.05 });
  },
  hover: (S) => tone(S, { f: 2600, f2: 2200, glide: 0.02, a: 0.002, d: 0.025, v: 0.035 }),
  open: (S) => {
    noise(S, { color: 'pink', type: 'bandpass', f: 500, f2: 2400, q: 1.2, a: 0.05, d: 0.15, v: 0.16 });
    tone(S, { f: 523.3, type: 'triangle', a: 0.004, d: 0.1, v: 0.08 });
    tone(S, { f: 784, type: 'triangle', at: 0.06, a: 0.004, d: 0.16, v: 0.08, verb: 0.2 });
  },
  close: (S) => {
    noise(S, { color: 'pink', type: 'bandpass', f: 2400, f2: 500, q: 1.2, a: 0.03, d: 0.14, v: 0.14 });
    tone(S, { f: 784, type: 'triangle', a: 0.004, d: 0.08, v: 0.07 });
    tone(S, { f: 523.3, type: 'triangle', at: 0.05, a: 0.004, d: 0.12, v: 0.07 });
  },
  good: (S) => {
    tone(S, { f: 880, type: 'triangle', a: 0.003, d: 0.12, v: 0.19 });
    tone(S, { f: 1318.5, type: 'triangle', at: 0.07, a: 0.003, d: 0.2, v: 0.18, verb: 0.2 });
    tone(S, { f: 2637, at: 0.07, a: 0.003, d: 0.1, v: 0.025 });
  },
  bad: (S) => {
    for (let i = 0; i < 2; i++) {
      tone(S, { type: 'square', f: 156, f2: 140, at: i * 0.15, a: 0.006, hold: 0.06, d: 0.05, v: 0.1, lp: 900 });
      tone(S, { type: 'sawtooth', f: 78, at: i * 0.15, a: 0.006, hold: 0.06, d: 0.05, v: 0.08, lp: 500 });
    }
  },
  beep: (S) => {
    tone(S, { f: 1320, a: 0.003, hold: 0.03, d: 0.04, v: 0.12 });
    tone(S, { f: 2640, a: 0.003, hold: 0.02, d: 0.03, v: 0.02 });
  },
  drag: (S) => noise(S, { type: 'bandpass', f: 1800, q: 3, a: 0.002, d: 0.025, v: 0.07 }),
  done: (S) => {
    fm(S, { f: 1046.5, ratio: 3.5, index: 1.6, a: 0.003, d: 0.7, v: 0.17, verb: 0.35 });
    tone(S, { f: 1046.5, type: 'triangle', a: 0.003, d: 0.25, v: 0.08 });
    fm(S, { f: 1568, ratio: 3.5, index: 1.6, at: 0.11, a: 0.003, d: 1, v: 0.17, verb: 0.45 });
    tone(S, { f: 1568, type: 'triangle', at: 0.11, a: 0.003, d: 0.3, v: 0.08 });
    [3136, 4186, 3520, 5274, 4699].forEach((f, i) =>
      tone(S, { f, at: 0.14 + i * 0.045, a: 0.003, d: 0.25, v: 0.014, verb: 0.7, pan: i % 2 ? 0.4 : -0.4 }),
    );
    noise(S, { type: 'highpass', f: 7000, at: 0.1, a: 0.06, d: 0.4, v: 0.025, verb: 0.5 });
  },
  whoosh: (S) => noise(S, { color: 'pink', type: 'bandpass', f: 300, fMid: 2200, f2: 500, q: 0.9, a: 0.18, d: 0.4, v: 0.3, verb: 0.2 }),
  kill: (S) => {
    noise(S, { type: 'highpass', f: 6000, f2: 2500, a: 0.002, d: 0.06, v: 0.26 });
    noise(S, { color: 'pink', type: 'bandpass', f: 1400, f2: 260, q: 4, at: 0.03, a: 0.004, d: 0.16, v: 0.5, verb: 0.15 });
    noise(S, { type: 'lowpass', f: 700, at: 0.03, a: 0.003, d: 0.09, v: 0.3 });
    tone(S, { f: 110, f2: 38, glide: 0.25, at: 0.025, a: 0.003, d: 0.3, v: 0.55 });
    tone(S, { f: 220, f2: 60, glide: 0.08, type: 'triangle', at: 0.025, a: 0.002, d: 0.08, v: 0.15 });
  },
  report: (S) => {
    noise(S, { type: 'lowpass', f: 1200, a: 0.003, d: 0.2, v: 0.22 });
    tone(S, { f: 82, f2: 41, glide: 0.4, a: 0.003, d: 0.4, v: 0.35 });
    chord(S, [50, 57, 62, 65, 69], { a: 0.015, hold: 0.18, d: 0.5, v: 0.11, cut: [300, 2800, 900], cutAt: [0.05, 0.6], verb: 0.3 });
    for (const at of [0.42, 0.88]) {
      tone(S, { type: 'sawtooth', f: 440, f2: 880, glide: 0.38, at, a: 0.02, hold: 0.25, d: 0.1, v: 0.06, lp: 2400, verb: 0.2 });
      tone(S, { type: 'square', f: 220, f2: 440, glide: 0.38, at, a: 0.02, hold: 0.25, d: 0.1, v: 0.03, lp: 1500 });
    }
  },
  emergency: (S) => {
    for (let i = 0; i < 3; i++) {
      const at = i * 0.55;
      for (const detune of [-10, 10]) {
        tone(S, {
          type: 'sawtooth',
          f: 300,
          f2: 420,
          glide: 0.12,
          at,
          a: 0.012,
          hold: 0.32,
          d: 0.06,
          v: 0.075,
          detune,
          lp: 2200,
          q: 2,
          verb: 0.15,
        });
      }
      tone(S, { type: 'square', f: 150, f2: 210, glide: 0.12, at, a: 0.012, hold: 0.32, d: 0.06, v: 0.04, lp: 900 });
    }
  },
  vote: (S) => {
    tone(S, { f: 160, f2: 58, glide: 0.06, a: 0.002, d: 0.09, v: 0.35 });
    noise(S, { type: 'lowpass', f: 900, a: 0.002, d: 0.05, v: 0.28 });
    noise(S, { type: 'bandpass', f: 2400, q: 1.5, a: 0.003, d: 0.02, v: 0.06 });
  },
  eject: (S) => {
    noise(S, { type: 'highpass', f: 3000, a: 0.01, d: 0.35, v: 0.09 });
    noise(S, { color: 'pink', type: 'lowpass', f: 200, fMid: 3000, f2: 300, at: 0.15, a: 0.6, hold: 0.6, d: 1, v: 0.45, verb: 0.4 });
    tone(S, { f: 42, at: 0.1, a: 0.4, hold: 1.2, d: 1, v: 0.3 });
    noise(S, { color: 'pink', type: 'lowpass', f: 140, at: 0.1, a: 0.3, hold: 1.2, d: 1, v: 0.5 });
  },
  roleCrew: (S) => {
    tone(S, { f: 75, f2: 32, glide: 1.2, a: 0.004, d: 1.2, v: 0.6 });
    noise(S, { color: 'pink', type: 'lowpass', f: 900, f2: 120, a: 0.003, d: 0.45, v: 0.35, verb: 0.3 });
    chord(S, [48, 55, 60, 64, 67, 72], { a: 0.2, hold: 0.6, d: 1.6, v: 0.09, cut: [250, 2200, 1100], cutAt: [1.2, 2.6], verb: 0.5 });
    [84, 88, 91].forEach((m, i) =>
      fm(S, { f: mtof(m), ratio: 3.5, index: 1.2, at: 0.3 + i * 0.12, d: 1.4, v: 0.035, verb: 0.6, pan: (i - 1) * 0.5 }),
    );
  },
  roleImp: (S) => {
    tone(S, { f: 65, f2: 28, glide: 1.4, a: 0.004, d: 1.4, v: 0.65 });
    noise(S, { color: 'pink', type: 'lowpass', f: 700, f2: 90, a: 0.003, d: 0.5, v: 0.38, verb: 0.3 });
    chord(S, [36, 43, 48, 51, 54, 59], { a: 0.25, hold: 0.7, d: 1.7, v: 0.1, cut: [180, 1300, 500], cutAt: [1.3, 2.8], verb: 0.5 });
    tone(S, { type: 'sawtooth', f: 55, a: 0.3, hold: 0.8, d: 1.4, v: 0.07, lp: 320 });
    tone(S, { type: 'sawtooth', f: 56.6, a: 0.3, hold: 0.8, d: 1.4, v: 0.07, lp: 320 });
    fm(S, { f: mtof(73), ratio: 1.41, index: 3, at: 0.35, d: 1.6, v: 0.03, verb: 0.7 });
  },
  shh: (S) => {
    noise(S, { type: 'bandpass', f: 3800, f2: 3000, q: 1.5, a: 0.2, hold: 0.35, d: 0.45, v: 0.32, verb: 0.2 });
    noise(S, { type: 'highpass', f: 6000, a: 0.25, hold: 0.3, d: 0.4, v: 0.06 });
  },
  door: (S) => {
    noise(S, { type: 'lowpass', f: 2500, f2: 700, a: 0.002, d: 0.07, v: 0.35 });
    tone(S, { f: 92, f2: 42, glide: 0.2, a: 0.002, d: 0.3, v: 0.5 });
    [
      [412, 0.045, 0.9],
      [951, 0.032, 0.7],
      [1467, 0.022, 0.55],
      [2213, 0.015, 0.4],
    ].forEach(([f, v, d]) => tone(S, { f, a: 0.003, d, v, verb: 0.3 }));
  },
  vent: (S) => {
    fm(S, { f: 280, ratio: 1.41, index: 4, a: 0.002, d: 0.18, v: 0.2, bright: 0.04 });
    fm(S, { f: 200, ratio: 1.73, index: 5, at: 0.09, a: 0.002, d: 0.22, v: 0.17, bright: 0.05, verb: 0.15 });
    tone(S, { f: 120, f2: 60, glide: 0.1, a: 0.002, d: 0.12, v: 0.18 });
    for (let i = 0; i < 7; i++)
      noise(S, { type: 'bandpass', f: 1500 + (i % 3) * 300, q: 6, at: 0.03 + i * 0.032, a: 0.002, d: 0.02, v: 0.12 * (1 - i / 8) });
  },
  sabotage: (S) => {
    for (let i = 0; i < 2; i++) {
      tone(S, { type: 'square', f: 784, at: i * 0.34, a: 0.008, hold: 0.12, d: 0.04, v: 0.06, lp: 2000 });
      tone(S, { type: 'square', f: 587, at: i * 0.34 + 0.17, a: 0.008, hold: 0.12, d: 0.04, v: 0.06, lp: 2000 });
    }
    tone(S, { type: 'sawtooth', f: 98, a: 0.03, hold: 0.5, d: 0.3, v: 0.07, lp: 400 });
  },
  fixed: (S) => {
    [79, 83, 86, 91].forEach((m, i) => tone(S, { f: mtof(m), type: 'triangle', at: i * 0.07, a: 0.004, d: 0.5, v: 0.09, verb: 0.4 }));
    chord(S, [67, 71, 74], { a: 0.15, hold: 0.1, d: 0.6, v: 0.045, cut: [800, 1600, 900], verb: 0.4 });
  },
  victory: (S) => {
    [60, 64, 67, 72].forEach((m, i) => {
      tone(S, { f: mtof(m), type: 'triangle', at: i * 0.12, a: 0.004, d: 0.4, v: 0.1, verb: 0.3 });
      fm(S, { f: mtof(m + 12), ratio: 3.5, index: 1, at: i * 0.12, d: 0.6, v: 0.03, verb: 0.4 });
    });
    chord(S, [60, 64, 67, 72, 76], { at: 0.5, a: 0.1, hold: 0.5, d: 1.2, v: 0.08, cut: [400, 2600, 1200], cutAt: [0.4, 1.6], verb: 0.5 });
    tone(S, { f: mtof(36), at: 0.5, a: 0.05, hold: 0.4, d: 1.2, v: 0.2 });
  },
  defeat: (S) => {
    [69, 65, 62, 57].forEach((m, i) =>
      tone(S, { f: mtof(m), f2: mtof(m) * 0.97, type: 'triangle', at: i * 0.18, a: 0.006, d: 0.5, v: 0.1, verb: 0.3 }),
    );
    chord(S, [45, 52, 57, 58, 60], { at: 0.7, a: 0.08, hold: 0.4, d: 1.2, v: 0.08, cut: [1200, 900, 300], cutAt: [0.3, 1.6], verb: 0.5 });
    tone(S, { f: mtof(33), at: 0.7, a: 0.05, hold: 0.4, d: 1.2, v: 0.22 });
  },
  type: (S) => {
    noise(S, { type: 'bandpass', f: 4200, q: 2, a: 0.002, d: 0.012, v: 0.08 });
    tone(S, { type: 'square', f: 1900, a: 0.002, d: 0.01, v: 0.012, lp: 3000 });
  },
  chat: (S) => {
    tone(S, { f: 620, f2: 930, glide: 0.06, a: 0.004, d: 0.1, v: 0.16 });
    tone(S, { f: 1240, f2: 1860, glide: 0.06, a: 0.004, d: 0.06, v: 0.02 });
  },
  join: (S) => {
    tone(S, { f: 660, type: 'triangle', a: 0.003, d: 0.07, v: 0.1 });
    tone(S, { f: 990, type: 'triangle', at: 0.07, a: 0.003, d: 0.12, v: 0.1, verb: 0.15 });
  },
  leave: (S) => {
    tone(S, { f: 990, type: 'triangle', a: 0.003, d: 0.07, v: 0.1 });
    tone(S, { f: 660, type: 'triangle', at: 0.07, a: 0.003, d: 0.12, v: 0.1, verb: 0.15 });
  },
  countdown: (S) => {
    tone(S, { f: 1050, a: 0.002, d: 0.05, v: 0.16 });
    noise(S, { type: 'bandpass', f: 2500, q: 3, a: 0.002, d: 0.01, v: 0.06 });
  },
};
SOUNDS.reveal = SOUNDS.roleCrew;

export const SOUND_NAMES = Object.keys(SOUNDS);

function play(b, name, t) {
  const f = SOUNDS[name];
  if (f) f({ ctx: b.ctx, t, out: b.sfx, verb: b.sfxVerb });
}

function step(b, t) {
  const src = b.ctx.createBufferSource();
  const steps = res(b.ctx).steps;
  src.buffer = steps[Math.floor(Math.random() * steps.length)];
  src.playbackRate.value = 0.85 + Math.random() * 0.3;
  const g = b.ctx.createGain();
  g.gain.value = 0.045 + Math.random() * 0.025;
  src.connect(g).connect(b.sfx);
  src.start(t);
}

// ---------- continuous layers ----------
function startAlarm(b, t) {
  const { ctx } = b;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(0.085, t + 0.3);
  const trem = ctx.createGain();
  trem.gain.value = 0.75;
  const flt = filter(ctx, 'lowpass', 1800, 1);
  const lfo = ctx.createOscillator();
  lfo.type = 'triangle';
  lfo.frequency.value = 0.85;
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 1.7;
  const trDepth = ctx.createGain();
  trDepth.gain.value = 0.25;
  lfo2.connect(trDepth).connect(trem.gain);
  const oscs = [
    ['sawtooth', 620, 140, 1],
    ['square', 310, 70, 0.35],
  ].map(([type, f, depth, level]) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const dg = ctx.createGain();
    dg.gain.value = depth;
    lfo.connect(dg).connect(o.frequency);
    const lg = ctx.createGain();
    lg.gain.value = level;
    o.connect(lg).connect(flt);
    o.start(t);
    return o;
  });
  flt.connect(trem).connect(out).connect(b.sfx);
  const send = ctx.createGain();
  send.gain.value = 0.15;
  out.connect(send).connect(b.sfxVerb);
  lfo.start(t);
  lfo2.start(t);
  return {
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.linearRampToValueAtTime(0, at + 0.4);
      [...oscs, lfo, lfo2].forEach((o) => o.stop(at + 0.45));
    },
  };
}

function startAmbience(b, t) {
  const { ctx } = b;
  const out = ctx.createGain();
  out.gain.value = 0;
  out.gain.setValueAtTime(0, t);
  out.gain.linearRampToValueAtTime(1, t + 2);
  const mix = ctx.createGain();
  mix.gain.value = 0.05;
  const nodes = [];
  for (const [f, v] of [
    [55, 0.5],
    [55.35, 0.5],
    [110.6, 0.18],
    [165.2, 0.06],
  ]) {
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.value = v;
    o.connect(g).connect(mix);
    o.start(t);
    nodes.push(o);
  }
  const src = ctx.createBufferSource();
  src.buffer = res(ctx).pink;
  src.loop = true;
  const flt = filter(ctx, 'lowpass', 240, 0.8);
  const ng = ctx.createGain();
  ng.gain.value = 0.9;
  src.connect(flt).connect(ng).connect(mix);
  src.start(t, Math.random() * 2);
  nodes.push(src);
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.06;
  const ld = ctx.createGain();
  ld.gain.value = 90;
  lfo.connect(ld).connect(flt.frequency);
  const lfo2 = ctx.createOscillator();
  lfo2.frequency.value = 0.11;
  const ad = ctx.createGain();
  ad.gain.value = 0.008;
  lfo2.connect(ad).connect(mix.gain);
  lfo.start(t);
  lfo2.start(t);
  nodes.push(lfo, lfo2);
  mix.connect(out).connect(b.sfx);
  return {
    stop(at) {
      out.gain.cancelScheduledValues(at);
      out.gain.setValueAtTime(out.gain.value, at);
      out.gain.linearRampToValueAtTime(0, at + 1);
      nodes.forEach((n) => n.stop(at + 1.05));
    },
  };
}

// ---------- generative music ----------
const TRACKS = {
  // Slow, wide and modal: drifting pads, sparse bells, long sub notes.
  menu: {
    bpm: 56,
    beatsPerChord: 8,
    seed: 11,
    pad: { attack: 2.4, release: 2.2, v: 0.055, cut: 1100, type: 'triangle' },
    verb: 0.55,
    chords: [
      { root: 38, pad: [50, 53, 57, 64], tones: [69, 72, 74, 76, 81] },
      { root: 34, pad: [46, 53, 57, 62], tones: [69, 72, 74, 77, 81] },
      { root: 41, pad: [53, 57, 60, 67], tones: [69, 72, 76, 79, 81] },
      { root: 40, pad: [52, 55, 60, 62], tones: [67, 72, 74, 76, 79] },
    ],
  },
  // A little brighter and moving: plucked arpeggio, pulsing bass, soft ticks.
  lobby: {
    bpm: 92,
    beatsPerChord: 4,
    seed: 5,
    pad: { attack: 0.8, release: 1.2, v: 0.06, cut: 1100 },
    verb: 0.4,
    chords: [
      { root: 41, pad: [53, 57, 60, 64], tones: [65, 69, 72, 76] },
      { root: 38, pad: [50, 57, 60, 65], tones: [62, 65, 69, 72] },
      { root: 34, pad: [46, 50, 53, 57], tones: [62, 65, 69, 70] },
      { root: 36, pad: [48, 53, 55, 58], tones: [60, 65, 67, 70] },
    ],
  },
};
const ARP = [0, 1, 2, 3, 2, 1, 0, 2];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Track {
  constructor(b, name, t0) {
    const { ctx } = b;
    this.b = b;
    this.def = TRACKS[name];
    this.name = name;
    this.spb = 60 / this.def.bpm;
    this.next = t0 + 0.05;
    this.beat = 0;
    this.rng = prng(this.def.seed);
    this.fade = [ctx.createGain(), ctx.createGain()];
    this.fade[0].connect(b.music);
    this.fade[1].connect(b.musicVerb);
    for (const g of this.fade) {
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(1, t0 + 1.5);
    }
  }

  stage(t) {
    return { ctx: this.b.ctx, t, out: this.fade[0], verb: this.fade[1] };
  }

  schedule(until) {
    const now = this.b.ctx.currentTime;
    // After a stall (background tab), skip ahead instead of firing a backlog of notes.
    while (this.next < now - 0.1) {
      this.next += this.spb;
      this.beat++;
    }
    while (this.next < until) {
      this.playBeat(this.beat, this.next);
      this.beat++;
      this.next += this.spb;
    }
  }

  playBeat(i, t) {
    const d = this.def;
    const spb = this.spb;
    const c = d.chords[Math.floor(i / d.beatsPerChord) % d.chords.length];
    const k = i % d.beatsPerChord;
    const S = this.stage(t);
    const rng = this.rng;
    if (k === 0) {
      const len = d.beatsPerChord * spb;
      const p = d.pad;
      chord(S, c.pad, {
        a: p.attack,
        hold: Math.max(0, len - p.attack),
        d: p.release,
        v: p.v,
        detune: 7,
        type: p.type || 'sawtooth',
        cut: [p.cut * 0.6, p.cut * 1.3, p.cut * 0.8],
        cutAt: [len * 0.5, len + p.release],
        verb: d.verb,
      });
      if (this.name === 'menu') tone(S, { f: mtof(c.root), a: 1.5, hold: Math.max(0, len - 1.5), d: 1.5, v: 0.08 });
    }
    if (this.name === 'menu') {
      for (const half of [0, 0.5]) {
        if (rng() < 0.3) {
          const m = c.tones[Math.floor(rng() * c.tones.length)];
          fm({ ...S, t: t + half * spb }, { f: mtof(m), ratio: 3.5, index: 1.4, d: 2.2, v: 0.045, verb: 0.75, pan: (rng() - 0.5) * 1.2 });
        }
      }
      return;
    }
    // Lobby: pulsing bass, soft kick, ticks, plucked arpeggio.
    if (k % 2 === 0) {
      tone(S, { f: mtof(c.root), a: 0.01, hold: 0.15, d: 0.35, v: 0.16 });
      tone(S, { f: 70, f2: 42, glide: 0.12, a: 0.003, d: 0.16, v: 0.12 });
    }
    noise({ ...S, t: t + spb / 2 }, { type: 'highpass', f: 7000, a: 0.002, d: 0.03, v: 0.018 });
    for (const sub of [0, 1]) {
      if (rng() < 0.15) continue;
      const m = c.tones[ARP[(k * 2 + sub) % ARP.length]];
      tone(
        { ...S, t: t + (sub * spb) / 2 },
        { f: mtof(m), type: 'triangle', a: 0.004, d: 0.28, v: 0.065, lp: 2400, verb: 0.3, pan: sub ? 0.25 : -0.25 },
      );
    }
    if (rng() < 0.12) fm(S, { f: mtof(c.tones[3] + 12), ratio: 3.5, index: 1.2, d: 1.4, v: 0.03, verb: 0.7 });
  }

  stop(at) {
    for (const g of this.fade) {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0, at + 1.5);
    }
    clearInterval(this.timer);
    setTimeout(() => this.fade.forEach((g) => g.disconnect()), 4000);
  }
}

function applyWanted() {
  if (!ac) return;
  const now = ac.currentTime;
  if ((live.track?.name || null) !== wanted.track) {
    live.track?.stop(now);
    live.track = null;
    if (wanted.track && TRACKS[wanted.track]) {
      const tr = new Track(bus, wanted.track, now);
      tr.schedule(now + 0.6);
      tr.timer = setInterval(() => tr.schedule(ac.currentTime + 0.6), 150);
      live.track = tr;
    }
  }
  if (!!live.ambience !== wanted.ambience) {
    if (wanted.ambience) live.ambience = startAmbience(bus, now);
    else {
      live.ambience.stop(now);
      live.ambience = null;
    }
  }
}

// ---------- public API ----------
export function unlock() {
  if (ac) {
    if (ac.state === 'suspended') ac.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    ac = new AC({ latencyHint: 'interactive' });
  } catch {
    return;
  }
  bus = makeBus(ac);
  applyWanted();
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = !!m;
  if (bus) applyVolumes(bus);
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export function getVolume(channel) {
  return vol[channel];
}

export function setVolume(channel, value) {
  if (!(channel in vol)) return;
  vol[channel] = Math.max(0, Math.min(1, Number(value) || 0));
  if (bus) applyVolumes(bus);
  try {
    localStorage.setItem(VOL_KEY, JSON.stringify(vol));
  } catch {
    /* storage unavailable */
  }
}

export function sfx(name) {
  if (!ac || muted) return;
  play(bus, name, ac.currentTime + 0.005);
}

export function footstep() {
  if (!ac || muted) return;
  step(bus, ac.currentTime + 0.005);
}

/** Looping siren while Reactor/O2 is active. */
export function setAlarm(on) {
  if (!ac) return;
  if (on && !live.alarm) live.alarm = startAlarm(bus, ac.currentTime + 0.01);
  else if (!on && live.alarm) {
    live.alarm.stop(ac.currentTime);
    live.alarm = null;
  }
}

/** 'menu' | 'lobby' | null. Crossfades; remembered until unlock(). */
export function music(track) {
  wanted.track = track || null;
  applyWanted();
}

/** Low ship hum for in-game. Remembered until unlock(). */
export function ambience(on) {
  wanted.ambience = !!on;
  applyWanted();
}

/**
 * Render a sound offline for tests and analysis (no speakers involved).
 * kind: 'sfx' | 'music' | 'ambience' | 'alarm' | 'footstep'. raw: skip the safety limiter.
 */
export function renderOffline({ kind = 'sfx', name, seconds = 3, sampleRate = 44100, raw = false }) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(seconds * sampleRate), sampleRate);
  const b = makeBus(ctx, { raw });
  const t = 0.05;
  if (kind === 'sfx') play(b, name, t);
  else if (kind === 'music') new Track(b, name, t).schedule(seconds);
  else if (kind === 'ambience') startAmbience(b, t);
  else if (kind === 'alarm') startAlarm(b, t);
  else if (kind === 'footstep') for (let i = 0; i < 6; i++) step(b, t + i * 0.17);
  return ctx.startRendering();
}
