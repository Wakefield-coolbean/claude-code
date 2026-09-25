// Generative ambient piano music in the spirit of the classic Minecraft soundtrack:
// slow, sparse, soft felt/electric-piano tones, extended chords, wandering pentatonic
// melodies with lots of space, a warm pad now and then, and a big generated reverb.
//
// composePiece(seed, kind) -> a deterministic note list (2–4 minutes)
// MusicPlayer               -> schedules a piece on any BaseAudioContext, a little ahead of time
import { TAU, makeRng, rand, randInt, pick, clamp, mtof, mode } from './dsp.js';

export const PIANO_RATE = 22050;
export const MUSIC_WET = 0.5; // reverb return level

// ------------------------------------------------------------ piano voice ----
// Additive piano: slightly inharmonic partials, each with a fast + slow decay, a detuned
// "second string" for gentle beating, a soft felt hammer thump and a faint EP tine.
export function renderPianoNote(midi, sr = PIANO_RATE) {
  const r = makeRng(0x51a7 + midi * 7919);
  const f = mtof(midi);
  const dur = clamp(6.0 - (midi - 36) * 0.06, 2.6, 6.0);
  const n = Math.ceil(dur * sr);
  const out = new Float32Array(n);
  const nyq = sr * 0.45;
  const B = 0.00018 * Math.pow(2, (midi - 60) / 18);
  const slow = clamp(4.4 - (midi - 48) * 0.05, 1.3, 5.2);
  const soft = 0.34 + clamp((midi - 60) / 60, -0.15, 0.25);
  const maxK = midi < 50 ? 12 : midi < 66 ? 10 : 7;
  for (let k = 1; k <= maxK; k++) {
    const fk = f * k * Math.sqrt(1 + B * k * k);
    if (fk > nyq) break;
    let a = Math.pow(k, -1.1) * Math.exp(-(k - 1) * soft);
    a *= 0.35 + 0.65 * Math.abs(Math.sin(Math.PI * k / 7.3)); // hammer strike position
    const tS = slow / (1 + 0.22 * (k - 1) + fk / 5000);
    const det = 1 + (0.0006 + 0.0006 * r()) * (k <= 3 ? 1 : 0.5);
    if (k <= 5) mode(out, sr, 0, fk, Math.min(tS * 0.5, 0.45 / (1 + 0.3 * (k - 1))), a * 0.45);
    mode(out, sr, 0, fk, tS, a * 0.3);
    mode(out, sr, 0, fk * det, tS * 1.15, a * 0.25);
  }
  const ft = f * 7.02;
  if (ft < nyq) mode(out, sr, 0, ft, 0.05, 0.02);
  // felt hammer thump
  let lp = 0, lp2 = 0;
  const c = 1 - Math.exp(-TAU * Math.min(1800, f * 4) / sr);
  const hn = Math.min(n, Math.round(0.015 * sr)), ht = 0.003 * sr;
  for (let i = 0; i < hn; i++) { lp += ((r() * 2 - 1) - lp) * c; lp2 += (lp - lp2) * c; out[i] += lp2 * 0.08 * Math.exp(-i / ht); }
  // soft attack + end fade
  const at = Math.round(0.004 * sr);
  for (let i = 0; i < at; i++) out[i] *= Math.sin((i / at) * Math.PI / 2);
  const fo = Math.round(0.35 * sr);
  for (let i = 0; i < fo; i++) out[n - 1 - i] *= i / fo;
  let pk = 0;
  for (let i = 0; i < n; i++) { const v = Math.abs(out[i]); if (v > pk) pk = v; }
  const g = (0.32 / (pk || 1)) * clamp(1.08 - (midi - 60) * 0.008, 0.75, 1.2);
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

const pianoData = new Map();
export function pianoSamples(midi) {
  let d = pianoData.get(midi);
  if (!d) { d = renderPianoNote(midi); pianoData.set(midi, d); }
  return d;
}
export function hasPianoSamples(midi) { return pianoData.has(midi); }
export function storePianoSamples(midi, data) { pianoData.set(midi, data); }

// Default synchronous source of piano AudioBuffers for a context.
const ctxPiano = new WeakMap();
export function syncPianoSource(ctx) {
  let m = ctxPiano.get(ctx);
  if (!m) { m = new Map(); ctxPiano.set(ctx, m); }
  return {
    get(midi) {
      let b = m.get(midi);
      if (!b) {
        const d = pianoSamples(midi);
        b = ctx.createBuffer(1, d.length, PIANO_RATE);
        b.copyToChannel(d, 0);
        m.set(midi, b);
      }
      return b;
    },
    has() { return true; },
    ready(midi) { return m.has(midi) || pianoData.has(midi); },
    request(midi) { this.get(midi); },
  };
}

// ------------------------------------------------------------ reverb IR ----
// Stereo decaying noise that darkens over time (RT60 ≈ 3.8 s, 3.2 s long ≈ -50 dB at the end).
// Pure data, so it can be rendered in the worker; getReverbIR() falls back to rendering it here.
export function renderReverbIR(sr) {
  const len = Math.round(3.2 * sr);
  const r = makeRng(0xbeef);
  const kEnv = Math.exp(-1 / (0.55 * sr)), kc = Math.exp(-1 / (0.8 * sr));
  const pre = Math.round(0.012 * sr), fin = 0.02 * sr;
  const chans = [];
  for (let ch = 0; ch < 2; ch++) {
    const d = new Float32Array(len);
    let lp = 0, env = 1, cf = 0.75;
    for (let i = pre; i < len; i++) {
      lp += ((r() * 2 - 1) - lp) * (0.06 + cf);
      cf *= kc; env *= kEnv;
      d[i] = lp * env * (i < pre + fin ? (i - pre) / fin : 1);
    }
    chans.push(d);
  }
  return chans;
}
const irCache = new WeakMap();
export function provideReverbIR(ctx, left, right) {
  if (irCache.has(ctx) || !left || left.length < 16) return;
  const ir = ctx.createBuffer(2, left.length, ctx.sampleRate);
  ir.copyToChannel(left, 0); ir.copyToChannel(right, 1);
  irCache.set(ctx, ir);
}
export function hasReverbIR(ctx) { return irCache.has(ctx); }
export function getReverbIR(ctx) {
  if (!irCache.has(ctx)) { const [L, R] = renderReverbIR(ctx.sampleRate); provideReverbIR(ctx, L, R); }
  return irCache.get(ctx);
}

// ------------------------------------------------------------ composition ----
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], harmonic: [0, 2, 3, 5, 7, 8, 11],
};
// pentatonic subsets (scale-degree indices)
const PENTA = { major: [0, 1, 2, 4, 5], lydian: [0, 1, 2, 4, 5], mixolydian: [0, 1, 2, 4, 5], dorian: [0, 2, 3, 4, 6], aeolian: [0, 2, 3, 4, 6] };
// darker five-note sets for the Nether (in-scale 1 b2 4 5 b6, hirajoshi 1 2 b3 5 b6, ...)
const NETHER_PENTA = { phrygian: [0, 1, 3, 4, 5], aeolian: [0, 1, 2, 4, 5], harmonic: [0, 2, 3, 4, 6], dorian: [0, 2, 3, 4, 6] };
// progressions (scale-degree indices; diminished degrees avoided)
const PROGS = {
  major: [[0, 3], [0, 3, 5, 3], [0, 5, 3, 4], [3, 0, 5, 4], [0, 2, 3, 0], [5, 3, 0, 4], [0, 4, 5, 3], [3, 4, 2, 5], [0, 5, 1, 3]],
  lydian: [[0, 1], [0, 1, 0, 4], [0, 1, 5, 4], [0, 4, 1, 0], [5, 1, 0, 1]],
  mixolydian: [[0, 6, 3, 0], [0, 6], [0, 3, 6, 0], [0, 4, 6, 3]],
  dorian: [[0, 3], [0, 6, 3, 0], [0, 2, 3, 0], [0, 1, 6, 3], [0, 3, 4, 6]],
  aeolian: [[0, 5, 2, 6], [0, 3, 5, 6], [0, 5, 3, 4], [0, 6, 5, 6]],
  phrygian: [[0, 1], [0, 1, 0, 6], [0, 5, 1, 0], [0, 3, 1, 0], [0, 6, 5, 1]],
  harmonic: [[0, 5], [0, 3, 4, 0], [0, 5, 3, 4], [0, 4], [0, 3, 5, 4]],
};
const SHAPES = { seventh: [0, 2, 4, 6], add9: [0, 2, 4, 8], open: [0, 4, 8], nine: [0, 2, 4, 6, 8], sus2: [0, 1, 4], sus4: [0, 3, 4], triad: [0, 2, 4], fifth: [0, 4, 7] };

function weighted(r, items) {
  let tot = 0; for (const [, w] of items) tot += w;
  let x = r() * tot;
  for (const [v, w] of items) { x -= w; if (x <= 0) return v; }
  return items[items.length - 1][0];
}

export function composePiece(seed, kind = 'game', opts = {}) {
  const r = makeRng((seed >>> 0) ^ 0x2545f491);
  const menu = kind === 'menu';
  const nether = kind === 'nether';
  const night = !!opts.night;
  const modeName = weighted(r, nether ? [['phrygian', 4], ['aeolian', 3], ['harmonic', 2], ['dorian', 1]]
    : menu ? [['major', 4], ['lydian', 3], ['mixolydian', 1], ['dorian', 1]]
      : night ? [['dorian', 3], ['aeolian', 3], ['major', 1], ['lydian', 1]]
        : [['major', 4], ['lydian', 3], ['dorian', 2], ['mixolydian', 1], ['aeolian', 1]]);
  const scale = SCALES[modeName];
  const tonic = pick(r, nether ? [0, 1, 2, 3, 4, 5, 6] : [0, 2, 3, 4, 5, 7, 8, 9, 10]);
  const bpm = nether ? rand(r, 50, 64) : menu ? rand(r, 66, 80) : rand(r, 58, 74);
  const beat = 60 / bpm;
  const meter = r() < (menu ? 0.3 : 0.4) ? 3 : 4;
  const bar = meter * beat;
  const target = opts.length ?? (menu ? rand(r, 110, 190) : rand(r, 125, 220));
  const barsPerChord = meter === 3 ? pick(r, [2, 2, 4]) : pick(r, [1, 2, 2]);
  const bassBase = nether ? 31 : 36;

  const stepMidi = (step) => tonic + 12 * Math.floor(step / 7) + scale[((step % 7) + 7) % 7];
  const semis = (deg, s) => stepMidi(deg + s) - stepMidi(deg);
  function makeChord(deg, force) {
    const weights = nether ? [['fifth', 3], ['triad', 2.5], ['seventh', 1.5], ['add9', 1], ['sus4', 1]]
      : [['seventh', 3], ['add9', 3], ['open', 2], ['nine', 1.5], ['sus2', 1], ['sus4', 1.5]];
    const opts2 = force ? [[force, 1]] : weights.filter(([s]) => {
      if (s === 'add9' || s === 'nine') return semis(deg, 8) === 14;
      if (s === 'open') return semis(deg, 4) === 7 && semis(deg, 8) === 14;
      if (s === 'sus2') return semis(deg, 1) === 2 && semis(deg, 4) === 7;
      if (s === 'sus4') return deg === 4 && semis(deg, 3) === 5 && semis(deg, 4) === 7;
      return true;
    });
    const shape = SHAPES[weighted(r, opts2)];
    const pcs = shape.map((s) => ((stepMidi(deg + s) % 12) + 12) % 12);
    const rootPc = pcs[0];
    const bass = bassBase + ((rootPc - (bassBase % 12) + 12) % 12);
    return { deg, pcs, rootPc, bass };
  }
  let prevVoicing = null;
  function voice(ch, lo = nether ? 46 : 52, hi = nether ? 67 : 74) {
    const upper = ch.pcs.length >= 4 ? ch.pcs.slice(1) : ch.pcs.slice();
    let best = null, bestCost = Infinity;
    for (let rot = 0; rot < upper.length; rot++) {
      const arr = upper.slice(rot).concat(upper.slice(0, rot));
      for (let base = lo; base < lo + 12; base++) {
        if (((base % 12) + 12) % 12 !== arr[0]) continue;
        const v = [base];
        for (let i = 1; i < arr.length; i++) { let m = v[i - 1] + 1; while (((m % 12) + 12) % 12 !== arr[i]) m++; v.push(m); }
        if (v[v.length - 1] > hi) continue;
        let cost = 0;
        for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] === 1) cost += 8;
        if (prevVoicing) { const n = Math.min(v.length, prevVoicing.length); for (let i = 0; i < n; i++) cost += Math.abs(v[i] - prevVoicing[i]); }
        else cost += Math.abs((v[0] + v[v.length - 1]) / 2 - 62);
        if (cost < bestCost) { bestCost = cost; best = v; }
      }
    }
    if (!best) { best = []; let m = lo + 2; for (const pc of upper) { while (((m % 12) + 12) % 12 !== pc) m++; best.push(m); m++; } }
    prevVoicing = best;
    return best;
  }

  // two progressions (A / B)
  const progs = PROGS[modeName];
  const pa = pick(r, progs);
  let pb = pick(r, progs); if (progs.length > 1) for (let k = 0; k < 4 && pb === pa; k++) pb = pick(r, progs);
  const chordsA = pa.map((d) => makeChord(d)), chordsB = pb.map((d) => makeChord(d));

  // melody pitch ladder (pentatonic)
  const pent = (nether ? NETHER_PENTA : PENTA)[modeName].map((d) => (tonic + scale[d]) % 12);
  const mlo = nether ? 55 : menu ? 64 : 62, mhi = nether ? 80 : menu ? 88 : 86;
  const mcenter = nether ? 65 : menu ? 74 : 72;
  const ladder = [];
  for (let m = mlo; m <= mhi; m++) if (pent.includes(m % 12)) ladder.push(m);
  const center = ladder.reduce((bi, m, i) => (Math.abs(m - mcenter) < Math.abs(ladder[bi] - mcenter) ? i : bi), 0);

  function genMotif() {
    const len = randInt(r, 3, menu ? 7 : 5);
    const durs = [], moves = [];
    const arch = r() < 0.6;
    for (let i = 0; i < len; i++) {
      durs.push(weighted(r, menu ? [[0.5, 2], [1, 4], [1.5, 1.5], [2, 2], [3, 1]] : [[0.5, 1], [1, 3], [1.5, 1.5], [2, 3], [3, 1.5], [4, 1]]));
      let mv = i === 0 ? 0 : weighted(r, [[-2, 1], [-1, 3], [0, 0.6], [1, 3], [2, 1.2], [3, 0.5], [-3, 0.4]]);
      if (arch && i > 0) mv = (i < len / 2 ? 1 : -1) * Math.abs(mv) * (r() < 0.8 ? 1 : -1);
      moves.push(mv);
    }
    return { durs, moves };
  }
  function vary(m) {
    const c = { durs: m.durs.slice(), moves: m.moves.slice(), shift: 0 };
    const x = r();
    if (x < 0.35) { /* literal repeat */ }
    else if (x < 0.6) c.shift = pick(r, [-2, -1, 1, 2]);
    else if (x < 0.85) { const k = Math.max(1, c.moves.length - randInt(r, 1, 2)); for (let i = k; i < c.moves.length; i++) c.moves[i] = pick(r, [-2, -1, 1, 2]); }
    else { const i = randInt(r, 0, c.durs.length - 1); c.durs[i] = pick(r, [0.5, 1, 1.5, 2, 3]); }
    return c;
  }
  const motifs = [genMotif(), genMotif()];

  // section plan
  const secBarsA = chordsA.length * barsPerChord, secBarsB = chordsB.length * barsPerChord;
  const totalBars = Math.max(secBarsA * 3, Math.round(target / bar));
  const plan = [{ kind: 'intro', B: false }];
  let bars = secBarsA;
  let toggle = 0;
  while (bars + secBarsA < totalBars) {
    const useB = toggle % 3 === 2;
    plan.push({ kind: useB ? 'B' : 'A', B: useB });
    bars += useB ? secBarsB : secBarsA; toggle++;
  }
  plan.push({ kind: 'outro', B: false });
  // keep the piece within 2–4 minutes (sections can be long at slow tempos)
  const estimate = () => plan.reduce((a, sec) => a + (sec.B ? secBarsB : secBarsA), 0) * bar + 8;
  while (estimate() > 236 && plan.length > 3) plan.splice(plan.length - 2, 1);
  while (estimate() < 124) plan.splice(plan.length - 1, 0, { kind: 'A', B: false });

  const patA = weighted(r, nether ? [['sparse', 4], ['roll', 3], ['pulse', 2]] : menu ? [['arp', 4], ['pulse', 2], ['roll', 2]] : [['roll', 4], ['sparse', 3], ['arp', 2], ['pulse', 1]]);
  const patB = weighted(r, nether ? [['roll', 3], ['pulse', 2], ['arp', 1]] : menu ? [['roll', 2], ['arp', 2], ['pulse', 2]] : [['arp', 3], ['roll', 2], ['pulse', 2], ['sparse', 1]]);
  const densA = nether ? rand(r, 0.2, 0.45) : menu ? rand(r, 0.6, 0.85) : rand(r, 0.3, 0.55);
  const densB = nether ? rand(r, 0.3, 0.55) : menu ? rand(r, 0.65, 0.9) : rand(r, 0.4, 0.7);

  const notes = [], pads = [];
  const hum = () => (r() * 2 - 1) * 0.012;
  const add = (t, midi, vel, dur) => { if (midi >= 24 && midi <= 100) notes.push({ t: Math.max(0, t + hum()), midi, vel: clamp(vel + (r() * 2 - 1) * 0.03, 0.05, 0.8), dur }); };
  const chordAt = []; // [{t0, t1, pcs}]
  let T = 0.3;
  let melIdx = center, motifSel = 0;

  plan.forEach((sec, si) => {
    const chords = sec.B ? chordsB : chordsA;
    const pattern = sec.kind === 'intro' || sec.kind === 'outro' ? pick(r, ['roll', 'sparse']) : sec.B ? patB : patA;
    const density = sec.kind === 'intro' ? (menu ? 0.3 : 0) : sec.kind === 'outro' ? 0.25 : sec.B ? densB : densA;
    const padOn = nether || r() < (menu ? 0.5 : 0.4) + (sec.B ? 0.2 : 0);
    // nether: a low tonic drone under every section
    if (nether) pads.push({ t: T, dur: (sec.B ? secBarsB : secBarsA) * bar + 0.5, midis: [bassBase + tonic % 12 + 12, bassBase + tonic % 12 + 19], vel: 1.3, cutoff: 320 });
    const secStart = T;
    const Lc = barsPerChord * bar;
    for (const ch of chords) {
      const v = voice(ch);
      chordAt.push({ t0: T, t1: T + Lc, pcs: [ch.rootPc, ...v.map((m) => m % 12)] });
      const bassVel = 0.4;
      if (pattern === 'roll') {
        add(T, ch.bass, bassVel, Lc + 0.4);
        if (r() < 0.4) add(T + beat * rand(r, 0.4, 0.6), ch.bass + 12, 0.24, Lc);
        const roll = rand(r, 0.05, 0.11);
        v.forEach((m, i) => add(T + 0.06 + i * roll, m, 0.27, Lc));
        if (barsPerChord >= 2 && r() < 0.55) {
          for (let b2 = 1; b2 < barsPerChord; b2++) {
            const sub = v.filter(() => r() < 0.6);
            sub.forEach((m, i) => add(T + b2 * bar + 0.04 + i * roll, m, 0.2, bar * 1.2));
          }
        }
      } else if (pattern === 'arp') {
        add(T, ch.bass, bassVel, Lc + 0.3);
        const tones = [ch.bass + 12, ...v];
        const seqs = [[0, 1, 2, 3, 2, 1], [0, 2, 1, 3, 2, 1], [0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 3, 1, 3, 2]];
        const seq = seqs[(si + ch.deg) % seqs.length];
        const step = beat / 2, count = Math.round(Lc / step);
        for (let k = 0; k < count; k++) {
          const idx = seq[k % seq.length] % tones.length;
          add(T + k * step, tones[idx], (k % (meter * 2) === 0 ? 0.28 : 0.21), beat * 2.5);
        }
      } else if (pattern === 'pulse') {
        const every = meter === 3 ? 3 : 2;
        for (let b = 0; b < barsPerChord * meter; b += every) {
          if (b % meter === 0) add(T + b * beat, ch.bass, bassVel * 0.9, bar + 0.3);
          v.forEach((m) => add(T + b * beat + 0.02, m, 0.19, every * beat * 1.1));
        }
      } else { // sparse
        add(T, ch.bass, bassVel, Lc + 0.5);
        const k = randInt(r, 1, 2);
        for (let i = 0; i < k; i++) add(T + beat * randInt(r, 1, barsPerChord * meter - 1), pick(r, v), 0.23, Lc * 0.7);
      }
      if (padOn) pads.push({ t: T, dur: Lc, midis: v.slice(0, 3).map((m) => (m > 64 ? m - 12 : m)), vel: nether ? 0.8 : 1, cutoff: nether ? 480 : 850 });
      T += Lc;
    }
    const secEnd = T;

    // melody
    if (density > 0) {
      let t = secStart + beat * pick(r, [1, 2, 2, 3, 4]);
      while (t < secEnd - beat * 2) {
        if (r() < density) {
          const m = vary(motifs[sec.B ? 1 : motifSel]);
          if (!sec.B && r() < 0.25) motifSel = 1 - motifSel;
          melIdx = clamp(melIdx + (m.shift || 0) + randInt(r, -1, 1), 2, ladder.length - 3);
          let idx = melIdx;
          const nN = m.durs.length;
          for (let i = 0; i < nN && t < secEnd - beat; i++) {
            idx += m.moves[i];
            if (idx < 0) idx = -idx; if (idx > ladder.length - 1) idx = 2 * (ladder.length - 1) - idx;
            idx = clamp(idx, 0, ladder.length - 1);
            let midi = ladder[idx];
            const chord = chordAt.find((c) => t >= c.t0 && t < c.t1);
            const strong = Math.abs((t - secStart) / beat - Math.round((t - secStart) / beat)) < 0.01 || m.durs[i] >= 1.5;
            if (chord && strong) {
              const clash = (mm) => chord.pcs.some((pc) => { const d = ((mm - pc) % 12 + 12) % 12; return d === 1 || d === 11; });
              if (clash(midi) && !(nether && r() < 0.4)) {
                for (const dd of [1, -1, 2, -2]) { const j = idx + dd; if (j >= 0 && j < ladder.length && !clash(ladder[j])) { idx = j; midi = ladder[j]; break; } }
              }
            }
            const shape = nN > 1 ? Math.sin(Math.PI * i / (nN - 1)) : 1;
            const vel = 0.42 + 0.12 * shape - (i === nN - 1 ? 0.05 : 0);
            add(t, midi, vel, beat * m.durs[i] + rand(r, 0.6, 1.6));
            t += beat * m.durs[i];
          }
          melIdx = idx;
          t += beat * (menu ? rand(r, 1, 4) : rand(r, 2, 6));
          t = Math.round((t - secStart) / (beat / 2)) * (beat / 2) + secStart;
        } else t += bar;
      }
      // high "sparkle" notes
      if (r() < 0.35) {
        const k = randInt(r, 1, 3);
        for (let i = 0; i < k; i++) {
          const tt = secStart + Math.round(rand(r, 0.1, 0.9) * (secEnd - secStart) / (beat / 2)) * (beat / 2);
          const m = ladder[clamp(randInt(r, ladder.length - 5, ladder.length - 1), 0, ladder.length - 1)];
          add(tt, m, 0.17, beat * 3);
        }
      }
    }
  });

  // final tonic chord, slowly rolled
  const fin = makeChord(0, nether ? 'fifth' : undefined);
  const fv = voice(fin);
  add(T, fin.bass, 0.38, 6);
  fv.forEach((m, i) => add(T + 0.12 + i * 0.16, m, 0.24, 6));
  if (r() < 0.6) add(T + 0.9, ladder[clamp(center + randInt(r, -2, 2), 0, ladder.length - 1)], 0.3, 5);
  notes.sort((a, b) => a.t - b.t);
  pads.sort((a, b) => a.t - b.t);
  const duration = T + 7.5;
  return {
    seed, kind, mode: modeName, tonic, bpm: Math.round(bpm), meter, barsPerChord, duration, notes, pads,
    summary: `${['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][tonic]} ${modeName}, ${Math.round(bpm)} bpm ${meter}/4, ${notes.length} notes, ${Math.round(duration)}s`,
  };
}

// ------------------------------------------------------------ playback ----
// Plays one composed piece into `destination`, scheduling notes shortly ahead of the clock.
// pianoSource (optional): { get(midi) -> AudioBuffer (renders synchronously if needed),
//   has(midi) -> buffer available now, ready(midi) -> available or on its way, request(midi) }
export class MusicPlayer {
  // reverbInput: optional shared reverb (a ConvolverNode whose wet output is already routed);
  // without it the player builds its own (setting a convolver buffer costs several ms).
  constructor(ctx, destination, piece, startTime, pianoSource = null, reverbInput = null) {
    this.ctx = ctx;
    this.piece = piece;
    this.t0 = startTime;
    this.src = pianoSource || syncPianoSource(ctx);
    this.bus = ctx.createGain();      // piano notes
    this.padBus = ctx.createGain();   // pads
    this.out = ctx.createGain();      // piano fade
    this.padOut = ctx.createGain();   // pad fade
    for (const g of [this.out, this.padOut]) {
      g.gain.setValueAtTime(0, Math.max(0, startTime - 0.05));
      g.gain.linearRampToValueAtTime(1, Math.max(0.01, startTime + 1.0));
    }
    this._nodes = [this.bus, this.padBus, this.out, this.padOut];
    let rev = reverbInput;
    if (!rev) {
      rev = ctx.createConvolver();
      rev.buffer = getReverbIR(ctx);
      const wet = ctx.createGain(); wet.gain.value = MUSIC_WET;
      rev.connect(wet); wet.connect(destination);
      this._nodes.push(rev, wet);
    }
    const dry = ctx.createGain(); dry.gain.value = 0.8;
    const padDry = ctx.createGain(); padDry.gain.value = 0.35;
    this.bus.connect(this.out); this.out.connect(dry); dry.connect(destination); this.out.connect(rev);
    this.padBus.connect(this.padOut); this.padOut.connect(padDry); padDry.connect(destination); this.padOut.connect(rev);
    this._nodes.push(dry, padDry);
    this.ni = 0; this.pi = 0;
    this.live = [];
    this.stopped = false;
    this.stopAt = Infinity;
    this.endTime = startTime + piece.duration;
  }

  // Schedule everything that starts before `until`; also asks the piano source to
  // prepare upcoming notes (so async sources have them in time).
  pump(until) {
    if (this.stopped) return;
    const ctx = this.ctx, now = ctx.currentTime, notes = this.piece.notes, pads = this.piece.pads;
    // prefetch the next ~8 seconds of piano notes
    const look = until + 8;
    for (let k = this.ni; k < notes.length && this.t0 + notes[k].t < look; k++) {
      if (!this.src.ready(notes[k].midi)) this.src.request(notes[k].midi);
    }
    while (this.ni < notes.length && this.t0 + notes[this.ni].t < until) {
      const e = notes[this.ni];
      const t = this.t0 + e.t;
      if (t < now - 0.05) { this.ni++; continue; } // too late (e.g. tab was hidden)
      // wait for an asynchronously rendered buffer unless the note is about to be due
      if (t - now > 0.3 && !this.src.has(e.midi)) break;
      this.ni++;
      this._note(e, Math.max(t, now));
    }
    while (this.pi < pads.length && this.t0 + pads[this.pi].t < until) {
      const p = pads[this.pi++];
      const t = this.t0 + p.t;
      if (t + p.dur < now) continue;
      this._pad(p, Math.max(t, now));
    }
    if (this.live.length > 64) this.live = this.live.filter((l) => l.end > now);
  }

  _note(e, t) {
    const ctx = this.ctx;
    const buf = this.src.get(e.midi);
    if (!buf) return;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(e.vel, t);
    const off = t + e.dur;
    const end = Math.min(t + buf.duration, off + 2.2);
    if (off < t + buf.duration) { g.gain.setValueAtTime(e.vel, off); g.gain.setTargetAtTime(0, off, 0.45); }
    let tail = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp((e.midi - 62) / 40, -0.45, 0.45);
      g.connect(p); tail = p;
    }
    s.connect(g); tail.connect(this.bus);
    s.start(t); s.stop(end);
    s.onended = () => { try { s.disconnect(); g.disconnect(); if (tail !== g) tail.disconnect(); } catch (_) { /* ignore */ } };
    this.live.push({ node: s, end });
  }

  _pad(p, t) {
    const ctx = this.ctx;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = p.cutoff ?? 850; f.Q.value = 0.4;
    const g = ctx.createGain();
    const lvl = 0.035 * p.vel;
    const att = Math.min(2.5, p.dur * 0.4), end = t + p.dur;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(lvl, t + att);
    g.gain.setValueAtTime(lvl, end);
    g.gain.setTargetAtTime(0, end, 0.9);
    const stopAt = end + 4.5;
    f.connect(g); g.connect(this.padBus);
    const oscs = [];
    for (const m of p.midis) {
      for (const [type, det] of [['sawtooth', -7], ['triangle', 6]]) {
        const o = ctx.createOscillator();
        o.type = type; o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(f); o.start(t); o.stop(stopAt);
        oscs.push(o);
        this.live.push({ node: o, end: stopAt });
      }
    }
    oscs[0].onended = () => { try { for (const o of oscs) o.disconnect(); f.disconnect(); g.disconnect(); } catch (_) { /* ignore */ } };
  }

  // Fade out and stop everything (including already scheduled notes).
  stop(fade = 2) {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    for (const g of [this.out, this.padOut]) {
      const gp = g.gain, cur = gp.value;
      if (gp.cancelAndHoldAtTime) gp.cancelAndHoldAtTime(now); else { gp.cancelScheduledValues(now); gp.setValueAtTime(cur, now); }
      gp.linearRampToValueAtTime(0, now + fade);
    }
    this.stopAt = now + fade + 0.05;
    for (const l of this.live) { try { l.node.stop(this.stopAt); } catch (_) { /* already stopped */ } }
    this.endTime = Math.min(this.endTime, this.stopAt + 0.1);
  }

  isDone(now = this.ctx.currentTime) { return now > this.endTime; }

  dispose() {
    for (const l of this.live) { try { l.node.stop(); } catch (_) { /* ignore */ } }
    this.live = [];
    for (const n of this._nodes) { try { n.disconnect(); } catch (_) { /* ignore */ } }
  }
}
