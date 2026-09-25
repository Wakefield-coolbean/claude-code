#!/usr/bin/env node
// Automated audio verification (headless Chromium via Playwright).
//
//   node tools/sound-check.mjs [--export=DIR] [--music-seconds=20] [--quiet]
//
// Renders every sound name (every variant) through an OfflineAudioContext and checks that it
// is non-silent, finite, not clipping and of reasonable length; runs spectral sanity checks on
// signature sounds (e.g. the cow moo has a low gliding fundamental, glass shatter is bright);
// renders generated music offline; exercises the live SoundManager (worker synthesis, voice
// limit, unknown-name warning, music state machine). Exits non-zero on any failure.
// --export=DIR also writes a selection of sounds + music as 16-bit WAV files for inspection.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
const EXPORT_DIR = typeof args.export === 'string' ? path.resolve(args.export) : null;
const MUSIC_SECONDS = Number(args['music-seconds'] || 20);
const QUIET = !!args.quiet;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, url);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const EXPORTS = [
  ['dig.stone', 0], ['step.stone', 0], ['dig.wood', 0], ['step.wood', 0], ['dig.gravel', 0], ['step.grass', 0], ['dig.sand', 0],
  ['dig.glass', 0], ['dig.wool', 0], ['dig.amethyst', 0], ['random.pop', 0], ['random.click', 0], ['random.orb', 0],
  ['random.levelup', 0], ['random.bow', 0], ['random.explode', 0], ['random.eat', 0], ['damage.hit', 0],
  ['mob.cow.say', 0], ['mob.sheep.say', 0], ['mob.pig.say', 0], ['mob.chicken.say', 0], ['mob.zombie.say', 0],
  ['mob.skeleton.say', 0], ['mob.creeper.primed', 0], ['mob.spider.say', 0], ['mob.enderman.idle', 0],
  ['mob.enderman.portal', 0], ['ambient.cave', 3], ['ambient.cave', 1], ['random.door_open', 0], ['random.chest_open', 0],
  ['ambient.nether.nether_wastes', 0], ['ambient.nether.warped_forest', 0], ['ambient.nether.soul_sand_valley', 0], ['ambient.nether.basalt_deltas', 0],
  ['ambient.nether.crimson_forest', 0], ['mob.ghast.moan', 0], ['mob.blaze.breathe', 0], ['block.portal.trigger', 0], ['block.portal.ambient', 0],
  ['block.enchantment_table.use', 0], ['mob.zombiepig.zpigangry', 0], ['dig.netherrack', 0], ['mob.magmacube.big', 0],
];

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(m.text()); });
await page.goto(`${base}/tools/sound-test.html?nocontrols`);

// ------------------------------------------------------------------ in-page analysis ----
const result = await page.evaluate(async ({ MUSIC_SECONDS, EXPORTS, wantExport }) => {
  const A = await import('/src/audio/sound.js');

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let j = 0; j < len / 2; j++) {
          const ur = re[i + j], ui = im[i + j];
          const vr = re[i + j + len / 2] * cr - im[i + j + len / 2] * ci;
          const vi = re[i + j + len / 2] * ci + im[i + j + len / 2] * cr;
          re[i + j] = ur + vr; im[i + j] = ui + vi;
          re[i + j + len / 2] = ur - vr; im[i + j + len / 2] = ui - vi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  function spectrum(x, sr, N = 2048) {
    const P = new Float64Array(N / 2);
    const hop = N / 2;
    let frames = 0;
    const win = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
    for (let s = 0; s + N <= Math.max(x.length, N); s += hop) {
      const re = new Float64Array(N), im = new Float64Array(N);
      for (let i = 0; i < N; i++) re[i] = (x[s + i] || 0) * win[i];
      fft(re, im);
      for (let k = 0; k < N / 2; k++) P[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    const df = sr / N;
    let tot = 0, cen = 0, maxK = 1, lg = 0, cnt = 0;
    const bands = { lt250: 0, b250_1k: 0, b1k_4k: 0, b4k_8k: 0, gt8k: 0 };
    for (let k = 1; k < N / 2; k++) {
      const f = k * df, p = P[k];
      tot += p; cen += f * p;
      if (p > P[maxK]) maxK = k;
      if (f < 250) bands.lt250 += p; else if (f < 1000) bands.b250_1k += p; else if (f < 4000) bands.b1k_4k += p; else if (f < 8000) bands.b4k_8k += p; else bands.gt8k += p;
      if (f > 50 && f < 12000) { lg += Math.log(p + 1e-20); cnt++; }
    }
    let am = 0, cntA = 0;
    for (let k = 1; k < N / 2; k++) { const f = k * df; if (f > 50 && f < 12000) { am += P[k]; cntA++; } }
    for (const b in bands) bands[b] = tot > 0 ? bands[b] / tot : 0;
    return { centroid: tot > 0 ? cen / tot : 0, peakHz: maxK * df, bands, flatness: Math.exp(lg / cnt) / (am / cntA + 1e-20) };
  }
  // f0 by normalized autocorrelation on frames across the loud part of the sound.
  // The signal is first low-passed near the expected pitch range so strong formants
  // don't produce octave errors.
  function f0Track(x0, sr, fmin = 60, fmax = 1000, lpHz = 1000) {
    const x = new Float32Array(x0.length), c = 1 - Math.exp(-2 * Math.PI * lpHz / sr);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < x0.length; i++) { s1 += (x0[i] - s1) * c; s2 += (s1 - s2) * c; x[i] = s2; }
    const W = Math.round(0.04 * sr), hop = Math.round(0.02 * sr);
    const out = [];
    let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v));
    for (let s = 0; s + W * 2 < x.length; s += hop) {
      let e = 0; for (let i = 0; i < W; i++) e += x[s + i] * x[s + i];
      if (Math.sqrt(e / W) < pk * 0.08) continue;
      let best = 0, bestL = 0;
      const lmin = Math.floor(sr / fmax), lmax = Math.ceil(sr / fmin);
      const ac = new Float64Array(lmax + 2);
      for (let L = lmin; L <= lmax; L++) {
        let c = 0, e1 = 0, e2 = 0;
        for (let i = 0; i < W; i++) { const a = x[s + i], b = x[s + i + L]; c += a * b; e1 += a * a; e2 += b * b; }
        ac[L] = c / Math.sqrt(e1 * e2 + 1e-20);
      }
      // first strong peak (avoids octave errors)
      let gmax = 0; for (let L = lmin; L <= lmax; L++) gmax = Math.max(gmax, ac[L]);
      for (let L = lmin + 1; L < lmax; L++) if (ac[L] > ac[L - 1] && ac[L] >= ac[L + 1] && ac[L] > 0.85 * gmax) { best = ac[L]; bestL = L; break; }
      if (best > 0.45) out.push({ t: s / sr, f0: sr / bestL, clarity: best });
    }
    return out;
  }
  // dominant amplitude-modulation rate (3..60 Hz)
  function amRate(x, sr) {
    const hop = Math.round(0.004 * sr), env = [];
    for (let s = 0; s + hop <= x.length; s += hop) { let e = 0; for (let i = 0; i < hop; i++) e += x[s + i] * x[s + i]; env.push(Math.sqrt(e / hop)); }
    const m = env.reduce((a, b) => a + b, 0) / env.length;
    const d = env.map((v) => v - m);
    const er = 1 / (hop / sr);
    let best = 0, bestL = 0;
    for (let L = Math.floor(er / 60); L <= Math.ceil(er / 3) && L < d.length / 2; L++) {
      let c = 0, e1 = 0; for (let i = 0; i + L < d.length; i++) { c += d[i] * d[i + L]; e1 += d[i] * d[i]; }
      const v = c / (e1 + 1e-20);
      if (v > best) { best = v; bestL = L; }
    }
    return bestL ? { rate: er / bestL, strength: best } : { rate: 0, strength: 0 };
  }
  function basic(ch, sr) {
    let pk = 0, ss = 0, bad = 0;
    for (let i = 0; i < ch.length; i++) { const v = ch[i]; if (!Number.isFinite(v)) { bad++; continue; } const a = Math.abs(v); if (a > pk) pk = a; ss += v * v; }
    const w = Math.round(0.05 * sr); let st = 0;
    for (let s = 0; s + w <= ch.length; s += w >> 1) { let e = 0; for (let i = s; i < s + w; i++) e += ch[i] * ch[i]; st = Math.max(st, e); }
    // audible length: until the last sample above -50 dB of peak
    let end = ch.length - 1; while (end > 0 && Math.abs(ch[end]) < pk * 0.00316) end--;
    return { peak: pk, rms: Math.sqrt(ss / ch.length), st: Math.sqrt(st / Math.max(1, w)), bad, dur: ch.length / sr, audible: end / sr };
  }
  function b64(f32) {
    const i16 = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) i16[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
    const u8 = new Uint8Array(i16.buffer); let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }

  const SR = 48000;
  const sounds = A.listSounds();
  const rows = [];
  const detail = {};
  let worstGen = { ms: 0, name: '' };
  for (const s of sounds) {
    const agg = { name: s.name, cat: s.cat, alias: s.alias, loop: s.loop, variants: s.variants, peak: 0, st: Infinity, rmsMin: Infinity, bad: 0, durMin: Infinity, durMax: 0, genMs: 0, centroid: 0 };
    for (let v = 0; v < s.variants; v++) {
      if (!s.alias) {
        const t0 = performance.now(); A.synthesize(s.name, v, SR); const ms = performance.now() - t0;
        agg.genMs = Math.max(agg.genMs, ms);
        if (ms > worstGen.ms) worstGen = { ms, name: s.name + '#' + v };
      }
      const buf = await A.renderToBuffer(s.name, { variant: v, sampleRate: SR });
      const ch = buf.getChannelData(0);
      const b = basic(ch, SR);
      agg.peak = Math.max(agg.peak, b.peak); agg.st = Math.min(agg.st, b.st); agg.rmsMin = Math.min(agg.rmsMin, b.rms);
      agg.bad += b.bad; agg.durMin = Math.min(agg.durMin, b.audible); agg.durMax = Math.max(agg.durMax, b.audible);
      if (v === 0) {
        const sp = spectrum(ch, SR);
        agg.centroid = sp.centroid;
        detail[s.name] = { ...sp, am: amRate(ch, SR) };
      }
    }
    rows.push(agg);
  }
  // loop seams: the wrap point must be no bigger a step than ordinary sample-to-sample motion
  const loops = {};
  for (const s of sounds.filter((x) => x.loop && !x.alias)) {
    for (let v = 0; v < s.variants; v++) {
      const { data: d, rate } = A.synthesize(s.name, v, SR);
      const diffs = []; for (let i = 1; i < d.length; i += 3) diffs.push(Math.abs(d[i] - d[i - 1]));
      diffs.sort((a, b) => a - b);
      const p99 = diffs[Math.floor(diffs.length * 0.99)], jump = Math.abs(d[0] - d[d.length - 1]);
      const w = Math.round(0.3 * rate); let a = 0, b = 0;
      for (let i = 0; i < w; i++) { a += d[i] * d[i]; b += d[d.length - 1 - i] * d[d.length - 1 - i]; }
      loops[s.name + '#' + v] = { jump, p99, levelRatio: Math.sqrt(a / (b + 1e-20)), seconds: d.length / rate };
    }
  }

  // voice analysis for vocal sounds (variant 0)
  const f0 = {};
  const F0 = { 'mob.cow.say': [50, 300, 300], 'mob.cow.hurt': [50, 400, 400], 'mob.sheep.say': [150, 600, 500], 'mob.pig.say': [60, 500, 400],
    'mob.zombie.say': [45, 300, 220], 'mob.chicken.say': [200, 1200, 900], 'damage.hit': [80, 500, 400], 'random.burp': [50, 300, 250], 'mob.ghast.moan': [200, 800, 700] };
  for (const [n, [fmin, fmax, lp]] of Object.entries(F0)) {
    const buf = await A.renderToBuffer(n, { variant: 0, sampleRate: SR });
    const tr = f0Track(buf.getChannelData(0), SR, fmin, fmax, lp);
    const fs = tr.map((p) => p.f0).sort((a, b) => a - b);
    f0[n] = fs.length ? { median: fs[fs.length >> 1], min: fs[0], max: fs[fs.length - 1], frames: fs.length, track: tr.filter((_, i) => i % 4 === 0).map((p) => Math.round(p.f0)) } : null;
  }

  // music
  const music = {};
  for (const kind of ['game', 'menu', 'nether']) {
    const t0 = performance.now();
    const { buffer, piece } = await A.renderMusic(MUSIC_SECONDS, { kind, seed: kind === 'game' ? 12345 : kind === 'menu' ? 777 : 4242 });
    const ms = performance.now() - t0;
    const L = buffer.getChannelData(0), R = buffer.getChannelData(1);
    const bl = basic(L, buffer.sampleRate), br = basic(R, buffer.sampleRate);
    const mono = new Float32Array(L.length); for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    const sp = spectrum(mono, buffer.sampleRate, 4096);
    // loudness over time in 2 s windows (shows sparseness / dynamics)
    const win = buffer.sampleRate * 2, prof = [];
    for (let s = 0; s + win <= mono.length; s += win) { let e = 0; for (let i = s; i < s + win; i++) e += mono[i] * mono[i]; prof.push(+Math.sqrt(e / win).toFixed(3)); }
    const notesIn = piece.notes.filter((n) => n.t < MUSIC_SECONDS).length;
    // average note pitch over whole pieces (8 seeds) — nether should sit clearly lower
    let ms2 = 0, mc = 0;
    for (let sd = 1; sd <= 8; sd++) for (const n of A.composePiece(sd * 7919, kind).notes) { ms2 += n.midi; mc++; }
    music[kind] = { meanMidi: ms2 / mc, mode: piece.mode, summary: piece.summary, duration: piece.duration, peak: Math.max(bl.peak, br.peak), rms: (bl.rms + br.rms) / 2, bad: bl.bad + br.bad, centroid: sp.centroid, peakHz: sp.peakHz, notesIn, profile: prof, renderMs: Math.round(ms), data: wantExport ? [b64(L), b64(R), buffer.sampleRate] : null };
  }

  // exports
  const exported = [];
  if (wantExport) {
    for (const [n, v] of EXPORTS) {
      const buf = await A.renderToBuffer(n, { variant: v, sampleRate: 44100 });
      exported.push({ name: `${n}.${v}`, rate: 44100, data: b64(buf.getChannelData(0)) });
    }
  }

  // ------------------------------------------------ spatialisation (offline) ----
  // listener at the origin; energy balance L/R for a sound placed around it
  async function spatial(yaw, pitch, pos, name = 'random.orb') {
    const off = new OfflineAudioContext(2, 48000, 48000);
    const sm = new A.SoundManager({ context: off, worker: false });
    sm.unlock();
    sm.setListener(0, 0, 0, yaw, pitch);
    const h = sm.play(name, { x: pos[0], y: pos[1], z: pos[2] });
    const buf = await off.startRendering();
    let l = 0, r = 0;
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    for (let i = 0; i < L.length; i++) { l += L[i] * L[i]; r += R[i] * R[i]; }
    return { played: !!h, l: Math.sqrt(l / L.length), r: Math.sqrt(r / L.length) };
  }
  const spatialRes = {
    rightOfFacingNegZ: await spatial(0, 0, [4, 0, 0]),
    leftOfFacingNegZ: await spatial(0, 0, [-4, 0, 0]),
    ahead: await spatial(0, 0, [0, 0, -4]),
    rightOfFacingNegX: await spatial(Math.PI / 2, 0, [0, 0, -4]),   // yaw +90° faces -X, so -Z is on the right
    near: await spatial(0, 0, [0, 0, -2]),
    far: await spatial(0, 0, [0, 0, -12]),
    outOfRange: await spatial(0, 0, [0, 0, -30]),
    lookingUp: await spatial(0, Math.PI / 2 - 1e-3, [4, 0, 0]),
  };

  // ------------------------------------------------ live SoundManager checks ----
  const live = { errors: [] };
  const warns = [];
  const ow = console.warn;
  console.warn = (...a) => { warns.push(a.join(' ')); ow.apply(console, a); };
  try {
    const sm = new A.SoundManager();
    sm.unlock(); sm.unlock();
    for (let i = 0; i < 50 && !sm.ready; i++) await new Promise((r) => setTimeout(r, 20));
    live.ready = sm.ready;
    live.state = sm.ctx && sm.ctx.state;
    sm.setListener(0.5, 65.6, 0.5, 0.3, -0.2);
    let tick = null;
    let last = performance.now();
    const frameTimes = [];
    tick = setInterval(() => { const t = performance.now(); const t0 = t; sm.update((t - last) / 1000, { underground: false, time: 1000 }); frameTimes.push(performance.now() - t0); last = t; }, 16);
    await new Promise((r) => setTimeout(r, 1200)); // let the worker prewarm
    live.worker = !!sm._backend.worker && !sm._backend.failed;
    live.prewarmed = sm._buffers.size;
    sm.play('no.such.sound'); sm.play('no.such.sound');
    live.unknownWarnings = warns.filter((w) => w.includes('no.such.sound')).length;
    for (let i = 0; i < 60; i++) sm.play(i % 2 ? 'step.stone' : 'dig.gravel', { x: i % 7, y: 64, z: (i * 3) % 11, pitch: 0.8 + (i % 5) * 0.1 });
    for (const g of ['stone', 'wood', 'gravel', 'grass', 'sand', 'glass', 'wool', 'snow', 'metal', 'ladder', 'deepslate', 'amethyst', 'crop', 'none', 'bogus']) {
      for (const k of ['break', 'place', 'step', 'hit', 'fall']) sm.playBlock(k, g, 1, 64, 2);
    }
    await new Promise((r) => setTimeout(r, 150));
    live.voicesAfterBurst = sm.activeVoices;
    live.farSoundSkipped = sm.play('random.explode', { x: 500, y: 64, z: 0 }) === null;
    sm.play('random.levelup'); sm.play('mob.enderman.scream', { x: 3, y: 65, z: -2 });
    for (const c of ['master', 'music', 'records', 'weather', 'blocks', 'hostile', 'neutral', 'players', 'ambient']) sm.setVolume(c, 0.8);
    // looping sound + handle.setVolume
    const rh = sm.play('weather.rain', { loop: true, volume: 0.8 });
    const nb = sm.play('ambient.nether.crimson_forest', { loop: true });
    await new Promise((r) => setTimeout(r, 600));
    rh.setVolume(0.2); nb.setVolume(0.5);
    live.loopVoice = !!(rh.voice && rh.voice.loop && nb.voice && nb.voice.loop);
    for (let i = 0; i < 40; i++) sm.play('step.stone', { x: 1, y: 64, z: i % 9 }); // voice pressure must not steal the loops
    await new Promise((r) => setTimeout(r, 50));
    live.loopsSurvivePressure = !rh.voice.done && !nb.voice.done;
    rh.stop(); nb.stop();
    await new Promise((r) => setTimeout(r, 200));
    live.loopsStopped = rh.voice.done && nb.voice.done;
    // dimension: nether => no cave mood, additions play
    sm._moodPeriod = 0.2; sm._mood = 0.5; sm._netherTimer = 0.05;
    const beforeBuf = sm._waiting.size + sm._buffers.size;
    let played = 0; const op = sm.play.bind(sm);
    sm.play = (n, o) => { if (n === 'ambient.nether.additions' || n === 'ambient.cave') played += n === 'ambient.cave' ? 100 : 1; return op(n, o); };
    for (let i = 0; i < 20; i++) sm.update(0.016, { underground: true, dimension: 'nether' });
    sm.play = op;
    live.netherAdditions = played >= 1 && played < 100;
    live.netherCaveMood = sm._mood;
    sm.startMusic('nether', { delay: 0.2 });
    await new Promise((r) => setTimeout(r, 1500));
    live.netherMusic = sm.musicState;
    sm.startMusic('menu', { delay: 0.2 });
    await new Promise((r) => setTimeout(r, 2500));
    live.musicAfterStart = sm.musicState;
    sm.startMusic('game');
    await new Promise((r) => setTimeout(r, 300));
    live.musicAfterSwitch = sm.musicState;
    sm.stopMusic();
    await new Promise((r) => setTimeout(r, 2600));
    live.musicAfterStop = sm.musicState;
    live.fadingLeft = sm._music.fading.length;
    // cave ambience mood: force a quick trigger
    sm._moodPeriod = 0.2;
    for (let i = 0; i < 30; i++) sm.update(0.016, { underground: true });
    live.moodReset = sm._mood < 0.5;
    clearInterval(tick);
    frameTimes.sort((a, b) => a - b);
    live.updateMaxMs = +frameTimes[frameTimes.length - 1].toFixed(2);
    live.updateP95Ms = +frameTimes[Math.floor(frameTimes.length * 0.95)].toFixed(2);
    sm.dispose();
  } catch (e) { live.errors.push(String(e && e.stack || e)); }
  console.warn = ow;

  return { rows, detail, f0, music, exported, worstGen, live, spatialRes, loops };
}, { MUSIC_SECONDS, EXPORTS, wantExport: !!EXPORT_DIR });

// ------------------------------------------------------------ manual test page smoke test ----
const ui = {};
{
  const p2 = await browser.newPage();
  p2.on('pageerror', (e) => pageErrors.push('[sound-test.html] ' + e));
  await p2.goto(`${base}/tools/sound-test.html`);
  await p2.click('#unlock');
  const buttons = await p2.$$('#sounds button');
  ui.soundButtons = buttons.length;
  for (const b of buttons.slice(0, 12)) await b.click();
  await p2.click('#blocks button:nth-of-type(1)');
  await p2.click('[data-music="menu"]');
  await p2.waitForTimeout(2500);
  ui.music = await p2.textContent('#music');
  ui.status = await p2.textContent('#status');
  await p2.close();
}

await browser.close();
server.close();

// ------------------------------------------------------------------ checks ----
const failures = [];
const warnings = [];
const fail = (m) => failures.push(m);
const { rows, detail, f0, music, live } = result;
const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

for (const r of rows) {
  if (r.bad) fail(`${r.name}: ${r.bad} non-finite samples`);
  if (r.peak > 1.0) fail(`${r.name}: clipping (peak ${r.peak.toFixed(3)})`);
  if (r.st < 0.005 || r.rmsMin < 1e-4) fail(`${r.name}: (nearly) silent (short-term rms ${r.st.toFixed(4)})`);
  if (r.durMin < 0.02 || r.durMax > (r.loop ? 12 : 8)) fail(`${r.name}: unreasonable duration ${r.durMin.toFixed(2)}..${r.durMax.toFixed(2)}s`);
  if (r.genMs > 100) fail(`${r.name}: synthesis took ${r.genMs.toFixed(0)}ms`);
}
const cen = (n) => detail[n].centroid;
const band = (n, b) => detail[n].bands[b];
const expect = (cond, msg) => { if (!cond) fail('expectation: ' + msg); };
// signature checks
expect(f0['mob.cow.say'] && f0['mob.cow.say'].median > 70 && f0['mob.cow.say'].median < 200, `cow moo fundamental 70-200 Hz (got ${f0['mob.cow.say'] && f0['mob.cow.say'].median.toFixed(0)})`);
expect(f0['mob.cow.say'] && f0['mob.cow.say'].max / f0['mob.cow.say'].min > 1.12, 'cow moo has a pitch glide (>12%)');
expect(f0['mob.sheep.say'] && f0['mob.sheep.say'].median > 200 && f0['mob.sheep.say'].median < 450, 'sheep baa fundamental 200-450 Hz');
expect(detail['mob.sheep.say'].am.rate > 7 && detail['mob.sheep.say'].am.rate < 16, `sheep bleat trill 7-16 Hz (got ${detail['mob.sheep.say'].am.rate.toFixed(1)})`);
expect(f0['mob.zombie.say'] && f0['mob.zombie.say'].median > 55 && f0['mob.zombie.say'].median < 150, 'zombie groan is low (55-150 Hz)');
expect(f0['mob.pig.say'] && f0['mob.pig.say'].median > 90 && f0['mob.pig.say'].median < 320, 'pig oink fundamental 90-320 Hz');
expect(cen('mob.chicken.say') > cen('mob.cow.say') * 1.5, 'chicken is brighter than cow');
expect(band('dig.glass', 'b4k_8k') + band('dig.glass', 'gt8k') > 0.35 && cen('dig.glass') > 3000, `glass shatter is bright (centroid ${cen('dig.glass').toFixed(0)})`);
expect(band('random.explode', 'lt250') > 0.35, `explosion is boomy (<250Hz share ${band('random.explode', 'lt250').toFixed(2)})`);
expect(detail['random.orb'].peakHz > 1500 && detail['random.orb'].peakHz < 2000 && detail['random.orb'].flatness < 0.05, 'xp orb is a tonal ding ~1.76 kHz');
expect(detail['random.levelup'].flatness < 0.05 && detail['random.levelup'].peakHz > 600 && detail['random.levelup'].peakHz < 2500, 'levelup is a tonal chime');
expect(cen('step.wool') < cen('step.stone') * 0.6 && cen('dig.wool') < 1200, 'wool is muffled');
expect(band('dig.wood', 'lt250') + band('dig.wood', 'b250_1k') > band('dig.stone', 'lt250') + band('dig.stone', 'b250_1k'), 'wood is thunkier (more low/mid) than stone');
expect(cen('dig.deepslate') < cen('dig.stone'), 'deepslate is darker than stone');
expect(cen('entity.tnt.primed') > 3000 && detail['entity.tnt.primed'].flatness > 0.1, 'fuse is a noisy hiss');
expect(cen('random.fizz') > 3000, 'fizz is a hiss');
expect(cen('mob.creeper.primed') > 2500, 'creeper primed hisses');
expect(band('random.bow', 'lt250') + band('random.bow', 'b250_1k') > 0.2, 'bow has a low string twang');
expect(byName['random.pop'].durMax < 0.2 && detail['random.pop'].peakHz > 250 && detail['random.pop'].peakHz < 1200, 'pickup pop is short and mid-pitched');
expect(byName['random.click'].durMax < 0.1, 'ui click is short');
expect(cen('mob.enderman.scream') > cen('mob.zombie.say'), 'enderman scream is higher than zombie groan');
for (const [k, L] of Object.entries(result.loops)) {
  if (L.jump > L.p99 * 1.5 + 1e-4) fail(`${k}: loop seam jump ${L.jump.toFixed(4)} > typical step ${L.p99.toFixed(4)}`);
  if (L.levelRatio < 0.6 || L.levelRatio > 1.6) fail(`${k}: loop level jumps at the seam (head/tail ${L.levelRatio.toFixed(2)})`);
}
expect(f0['mob.ghast.moan'] && f0['mob.ghast.moan'].median > 250 && f0['mob.ghast.moan'].median < 600, 'ghast moan is a high wail (250-600 Hz)');
expect(cen('ambient.nether.warped_forest') > cen('ambient.nether.nether_wastes') * 1.2, 'warped forest bed is brighter than nether wastes');
expect(cen('ambient.nether.soul_sand_valley') > cen('ambient.nether.nether_wastes'), 'soul sand valley (wind) brighter than nether wastes (drone)');
for (const bed of ['nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas']) {
  const d = detail['ambient.nether.' + bed];
  expect(d.bands.lt250 < 0.85, `${bed} bed is audible on small speakers (<250 Hz share ${d.bands.lt250.toFixed(2)})`);
}
expect(cen('mob.magmacube.small') > cen('mob.magmacube.big') * 1.3, 'small magma cube is higher than big');
expect(detail['block.enchantment_table.use'].flatness < 0.1 && cen('block.enchantment_table.use') > 1500, 'enchanting is a bright shimmer');
expect(cen('dig.basalt') < cen('dig.nether_bricks') && cen('dig.ancient_debris') < cen('dig.nether_bricks'), 'basalt / ancient debris are darker than nether bricks');
expect(cen('dig.roots') > cen('dig.wart_block') * 1.5, 'roots rustle is brighter than squishy wart block');
expect(music.nether.meanMidi < music.game.meanMidi - 3, `nether music sits lower (mean midi ${music.nether.meanMidi.toFixed(1)} vs ${music.game.meanMidi.toFixed(1)})`);
expect(['phrygian', 'aeolian', 'harmonic', 'dorian'].includes(music.nether.mode), 'nether music uses a dark mode');
for (const kind of ['game', 'menu', 'nether']) {
  const m = music[kind];
  if (m.bad) fail(`music ${kind}: non-finite samples`);
  if (m.rms < 0.005) fail(`music ${kind}: silent (rms ${m.rms.toFixed(4)})`);
  if (m.peak > 1.0) fail(`music ${kind}: clipping (peak ${m.peak.toFixed(3)})`);
  if (m.duration < 110 || m.duration > 260) fail(`music ${kind}: piece length ${m.duration.toFixed(0)}s outside 2-4 min`);
  if (m.notesIn < 5) fail(`music ${kind}: only ${m.notesIn} notes in the first ${MUSIC_SECONDS}s`);
}
if (!live.ready) warnings.push(`live AudioContext not running (state ${live.state}); live checks may be incomplete`);
if (live.errors.length) fail('live SoundManager threw: ' + live.errors.join('\n'));
if (live.unknownWarnings !== 1) fail(`unknown sound should warn exactly once (got ${live.unknownWarnings})`);
if (live.ready) {
  if (!live.worker) warnings.push('synthesis worker not active (main-thread fallback in use)');
  if (live.voicesAfterBurst > 32) fail(`voice limit exceeded: ${live.voicesAfterBurst}`);
  if (!live.farSoundSkipped) fail('far-away positional sound was not culled');
  if (!live.musicAfterStart || live.musicAfterStart.state !== 'playing') fail(`menu music did not start (${JSON.stringify(live.musicAfterStart)})`);
  if (!live.musicAfterSwitch || live.musicAfterSwitch.kind !== 'game' || live.musicAfterSwitch.state !== 'waiting') fail(`switch to game music: ${JSON.stringify(live.musicAfterSwitch)}`);
  if (!live.musicAfterStop || live.musicAfterStop.state !== 'off' || live.fadingLeft !== 0) fail(`stopMusic did not fade out cleanly (${JSON.stringify(live.musicAfterStop)}, fading ${live.fadingLeft})`);
  if (!live.moodReset) fail('cave ambience mood did not trigger');
  if (!live.loopVoice) fail('looping sounds did not start as loops');
  if (!live.loopsSurvivePressure) fail('voice stealing killed a looping bed');
  if (!live.loopsStopped) fail('handle.stop() did not stop looping sounds');
  if (!live.netherAdditions || live.netherCaveMood !== 0) fail(`nether dimension ambience wrong (additions ${live.netherAdditions}, cave mood ${live.netherCaveMood})`);
  if (!live.netherMusic || live.netherMusic.kind !== 'nether' || live.netherMusic.state !== 'playing') fail(`nether music did not start (${JSON.stringify(live.netherMusic)})`);
  if (live.updateMaxMs > 15) fail(`update() blocked the main thread for ${live.updateMaxMs}ms`);
}
if (result.worstGen.ms > 15) warnings.push(`slowest main-thread synthesis (fallback path): ${result.worstGen.name} ${result.worstGen.ms.toFixed(1)}ms — normally runs in the worker`);
const S = result.spatialRes;
const bal = (x) => (x.r - x.l) / (x.r + x.l + 1e-12);
expect(bal(S.rightOfFacingNegZ) > 0.5, `+X is on the right when facing -Z (balance ${bal(S.rightOfFacingNegZ).toFixed(2)})`);
expect(bal(S.leftOfFacingNegZ) < -0.5, `-X is on the left when facing -Z (balance ${bal(S.leftOfFacingNegZ).toFixed(2)})`);
expect(Math.abs(bal(S.ahead)) < 0.05, 'a sound straight ahead is centred');
expect(bal(S.rightOfFacingNegX) > 0.5, `yaw +90° turns toward -X (balance ${bal(S.rightOfFacingNegX).toFixed(2)})`);
expect(S.far.l + S.far.r < (S.near.l + S.near.r) * 0.5 && S.far.l > 0, 'linear distance attenuation (12 blocks much quieter than 2)');
expect(!S.outOfRange.played && S.outOfRange.l === 0, 'sounds beyond 16 blocks are culled');
expect(Number.isFinite(S.lookingUp.l) && S.lookingUp.l + S.lookingUp.r > 0, 'listener orientation looking straight up is valid');
for (const e of pageErrors) fail('page error: ' + e);
if (ui.soundButtons < rows.length) fail(`sound-test.html shows ${ui.soundButtons} buttons for ${rows.length} sounds`);
if (!/running/.test(ui.status || '')) fail(`sound-test.html audio not running: ${ui.status}`);
if (!/menu: playing/.test(ui.music || '')) fail(`sound-test.html menu music not playing: ${ui.music}`);

// ------------------------------------------------------------------ report ----
const pad = (s, n) => String(s).padEnd(n);
const lp = (s, n) => String(s).padStart(n);
if (!QUIET) {
  console.log(pad('sound', 34) + pad('cat', 9) + lp('var', 4) + lp('dur(s)', 12) + lp('peak', 7) + lp('rms50', 7) + lp('centroid', 9) + lp('gen ms', 8) + '  alias');
  console.log('-'.repeat(100));
  for (const r of rows) {
    const d = r.durMin === r.durMax ? r.durMax.toFixed(2) : `${r.durMin.toFixed(2)}-${r.durMax.toFixed(2)}`;
    console.log(pad(r.name, 34) + pad(r.cat, 9) + lp(r.variants, 4) + lp(d, 12) + lp(r.peak.toFixed(2), 7) + lp(r.st.toFixed(3), 7) + lp(r.centroid.toFixed(0), 9) + lp(r.alias ? '' : r.genMs.toFixed(1), 8) + '  ' + (r.alias || ''));
  }
  console.log('\nVoice fundamentals (autocorrelation, Hz):');
  for (const [n, v] of Object.entries(f0)) console.log('  ' + pad(n, 18) + (v ? `median ${v.median.toFixed(0)}  range ${v.min.toFixed(0)}-${v.max.toFixed(0)}  track [${v.track.join(' ')}]` : 'unvoiced'));
  console.log('\nSpectral notes:');
  for (const n of ['dig.glass', 'dig.stone', 'dig.wood', 'dig.wool', 'step.grass', 'random.explode', 'random.orb', 'random.levelup', 'entity.tnt.primed', 'mob.sheep.say',
    'ambient.nether.nether_wastes', 'ambient.nether.crimson_forest', 'ambient.nether.warped_forest', 'ambient.nether.soul_sand_valley', 'ambient.nether.basalt_deltas']) {
    const d = detail[n], b = d.bands;
    console.log('  ' + pad(n, 18) + `centroid ${d.centroid.toFixed(0).padStart(5)}Hz  peak ${d.peakHz.toFixed(0).padStart(5)}Hz  flat ${d.flatness.toFixed(3)}  AM ${d.am.rate.toFixed(1)}Hz  bands <250:${b.lt250.toFixed(2)} <1k:${b.b250_1k.toFixed(2)} <4k:${b.b1k_4k.toFixed(2)} <8k:${b.b4k_8k.toFixed(2)} >8k:${b.gt8k.toFixed(2)}`);
  }
  console.log('\nLoop seams:', Object.entries(result.loops).map(([k, L]) => `${k} jump ${L.jump.toFixed(4)} (typ ${L.p99.toFixed(4)}) lvl ${L.levelRatio.toFixed(2)} ${L.seconds.toFixed(1)}s`).join('; '));
  console.log('\nMusic (offline render):');
  for (const [k, m] of Object.entries(music)) {
    console.log(`  ${k}: [mean pitch midi ${m.meanMidi.toFixed(1)}] ${m.summary}; first ${MUSIC_SECONDS}s: ${m.notesIn} notes, rms ${m.rms.toFixed(3)}, peak ${m.peak.toFixed(2)}, centroid ${m.centroid.toFixed(0)}Hz, render ${m.renderMs}ms`);
    console.log(`     loudness per 2s: [${m.profile.join(' ')}]`);
  }
  console.log('\nLive SoundManager:', JSON.stringify({ ...live, errors: live.errors.length }));
  console.log('Test page:', JSON.stringify(ui));
  console.log('Spatial (rms L/R):', Object.entries(S).map(([k, v]) => `${k} ${v.l.toFixed(3)}/${v.r.toFixed(3)}`).join(', '));
}

if (EXPORT_DIR) {
  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const wav = (file, channels, rate) => {
    const pcm = channels.map((c) => Buffer.from(c, 'base64'));
    const n = pcm[0].length / 2, ch = pcm.length;
    const out = Buffer.alloc(44 + n * 2 * ch);
    out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2 * ch, 4); out.write('WAVE', 8); out.write('fmt ', 12);
    out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(ch, 22); out.writeUInt32LE(rate, 24);
    out.writeUInt32LE(rate * 2 * ch, 28); out.writeUInt16LE(2 * ch, 32); out.writeUInt16LE(16, 34); out.write('data', 36); out.writeUInt32LE(n * 2 * ch, 40);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) pcm[c].copy(out, 44 + (i * ch + c) * 2, i * 2, i * 2 + 2);
    fs.writeFileSync(path.join(EXPORT_DIR, file), out);
  };
  for (const e of result.exported) wav(e.name + '.wav', [e.data], e.rate);
  for (const [k, m] of Object.entries(music)) wav(`music.${k}.wav`, [m.data[0], m.data[1]], m.data[2]);
  console.log(`\nExported ${result.exported.length + 2} WAV files to ${EXPORT_DIR}`);
}

for (const w of warnings) console.log('WARN  ' + w);
if (failures.length) {
  console.log(`\nFAILED (${failures.length}):`);
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
console.log(`\nOK: ${rows.length} sound names (${rows.filter((r) => !r.alias).reduce((a, r) => a + r.variants, 0)} synthesized variants) + music passed all checks.`);
