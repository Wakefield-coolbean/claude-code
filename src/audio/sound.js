// BlockCraft audio: procedurally synthesised sound effects + generative ambient music.
// Pure WebAudio, no audio files. Sound buffers are generated lazily (in a module worker when
// available, so the main thread never stalls) and cached per name/variant.
//
//   const sound = new SoundManager();
//   window.addEventListener('pointerdown', () => sound.unlock());   // needs a user gesture
//   sound.setListener(x, y, z, yaw, pitch);                         // every frame
//   sound.play('random.pop', { x, y, z, pitch: 1.5 });
//   sound.playBlock('break', 'stone', x, y, z);
//   sound.startMusic('game'); sound.update(dt, { underground });    // every frame
//   const rain = sound.play('weather.rain', { loop: true });        // loops: weather.rain, ambient.nether.*
//   rain.setVolume(exposure); rain.stop();
//   sound.update(dt, { dimension: 'nether' }); sound.startMusic('nether');
import { getSoundDef, listSounds, synthesize, CATEGORIES } from './sfx.js';
import { composePiece, MusicPlayer, PIANO_RATE, MUSIC_WET, pianoSamples, renderReverbIR, provideReverbIR, hasReverbIR, getReverbIR } from './music.js';

export { listSounds, synthesize, CATEGORIES, composePiece };

const MAX_VOICES = 32;
const MUSIC_LEVEL = 1.6;          // internal music trim relative to SFX
const QUEUE_MAX_AGE = 0.35;       // s: drop a queued play if its buffer took longer than this
const BASE_RANGE = 16;            // blocks

// block sound group -> sound names per action
const G = (dig, step, hit, place = dig) => ({ dig, step, hit, place });
export const BLOCK_SOUND_GROUPS = {
  stone: G('dig.stone', 'step.stone', 'hit.stone'),
  wood: G('dig.wood', 'step.wood', 'hit.wood'),
  gravel: G('dig.gravel', 'step.gravel', 'hit.gravel'),
  grass: G('dig.grass', 'step.grass', 'hit.grass'),
  sand: G('dig.sand', 'step.sand', 'hit.sand'),
  wool: G('dig.wool', 'step.wool', 'hit.wool'),
  snow: G('dig.snow', 'step.snow', 'hit.snow'),
  metal: G('dig.metal', 'step.metal', 'hit.metal'),
  deepslate: G('dig.deepslate', 'step.deepslate', 'hit.deepslate'),
  amethyst: G('dig.amethyst', 'step.amethyst', 'hit.amethyst'),
  glass: G('dig.glass', 'step.stone', 'hit.stone', 'dig.stone'),
  ladder: G('dig.wood', 'step.ladder', 'hit.ladder'),
  crop: G('dig.crop', 'step.grass', 'hit.grass'),
  netherrack: G('dig.netherrack', 'step.netherrack', 'hit.netherrack'),
  nether_bricks: G('dig.nether_bricks', 'step.nether_bricks', 'hit.nether_bricks'),
  soul_sand: G('dig.soul_sand', 'step.soul_sand', 'hit.soul_sand'),
  soul_soil: G('dig.soul_soil', 'step.soul_soil', 'hit.soul_soil'),
  nylium: G('dig.nylium', 'step.nylium', 'hit.nylium'),
  stem: G('dig.stem', 'step.stem', 'hit.stem'),
  wart_block: G('dig.wart_block', 'step.wart_block', 'hit.wart_block'),
  shroomlight: G('dig.shroomlight', 'step.shroomlight', 'hit.shroomlight'),
  fungus: G('dig.fungus', 'step.fungus', 'hit.fungus'),
  roots: G('dig.roots', 'step.roots', 'hit.roots'),
  nether_wart: G('dig.nether_wart', 'step.nether_wart', 'hit.nether_wart'),
  basalt: G('dig.basalt', 'step.basalt', 'hit.basalt'),
  ancient_debris: G('dig.ancient_debris', 'step.ancient_debris', 'hit.ancient_debris'),
};
export const MUSIC_KINDS = ['game', 'menu', 'nether'];

const OVERWORLD_GROUPS = ['stone', 'wood', 'gravel', 'grass', 'sand', 'wool', 'snow', 'metal', 'deepslate', 'glass', 'ladder', 'crop'];
const PREWARM = [
  ...OVERWORLD_GROUPS.flatMap((g) => [BLOCK_SOUND_GROUPS[g].step, BLOCK_SOUND_GROUPS[g].dig]),
  'random.pop', 'random.click', 'random.orb', 'damage.hit', 'random.eat', 'player.attack.weak', 'player.attack.strong',
];

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function audioContextClass() {
  if (typeof window !== 'undefined') return window.AudioContext || window.webkitAudioContext || null;
  if (typeof globalThis !== 'undefined' && globalThis.AudioContext) return globalThis.AudioContext;
  return null;
}

function toBuffer(ctx, data, rate) {
  const b = ctx.createBuffer(1, data.length, rate);
  if (b.copyToChannel) b.copyToChannel(data, 0); else b.getChannelData(0).set(data);
  return b;
}

// Generates sample data in a module worker, or on the main thread (budgeted) as a fallback.
// Urgent jobs (a sound someone is waiting to hear) go straight to the worker; background jobs
// (prewarming, upcoming music notes) are fed a couple at a time so they never delay urgent ones.
class SynthBackend {
  constructor() {
    this.worker = null; this.failed = false; this.pending = new Map(); this.nextId = 1;
    this.queue = [];   // main-thread fallback queue
    this.low = [];     // background jobs waiting for the worker
    this.inflightLow = 0;
  }
  start() {
    if (this.worker || this.failed || typeof Worker === 'undefined' || typeof URL === 'undefined') return;
    try {
      // single-file builds inline the worker source; dev builds load the module file
      if (typeof __SYNTH_WORKER_SRC__ !== 'undefined') {
        this.worker = new Worker(URL.createObjectURL(new Blob([__SYNTH_WORKER_SRC__], { type: 'text/javascript' })));
      } else {
        this.worker = new Worker(new URL('./synth-worker.js', import.meta.url), { type: 'module' });
      }
      this.worker.onmessage = (e) => this._onMessage(e.data);
      this.worker.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); this._fail(); };
      this.worker.onmessageerror = () => this._fail();
    } catch (_) { this._fail(); }
  }
  _fail() {
    this.failed = true;
    if (this.worker) { try { this.worker.terminate(); } catch (_) { /* ignore */ } }
    this.worker = null;
    const jobs = [...this.pending.values(), ...this.low];
    this.pending.clear(); this.low = []; this.inflightLow = 0;
    for (const j of jobs) this.queue.push(j);  // finish on the main thread
  }
  // job: { msg, sync: () => {data, rate}, done: ({data, rate} | null) => void }
  request(job, urgent = false) {
    if (this.worker) {
      if (urgent) this._post(job, false);
      else { this.low.push(job); this._feed(); }
    } else if (urgent) this._runSync(job);
    else this.queue.push(job);
  }
  _post(job, low) {
    const id = this.nextId++;
    job.sent = now(); job.low = low;
    if (low) this.inflightLow++;
    this.pending.set(id, job);
    this.worker.postMessage({ id, ...job.msg });
  }
  _feed() { while (this.worker && this.inflightLow < 2 && this.low.length) this._post(this.low.shift(), true); }
  _runSync(job) {
    try { job.done(job.sync()); } catch (e) { console.warn('[audio] synthesis failed', e); job.done(null); }
  }
  _onMessage(m) {
    const job = this.pending.get(m.id);
    if (!job) return;
    this.pending.delete(m.id);
    if (job.low) this.inflightLow--;
    if (m.ok) job.done({ data: m.data, data2: m.data2, rate: m.rate });
    else { console.warn('[audio] worker synthesis failed:', m.error); this.queue.push(job); }
    this._feed();
  }
  tick(budgetMs) {
    // watchdog: a worker that never answers (e.g. module workers unsupported) -> fall back
    if (this.worker && this.pending.size) {
      const t = now();
      for (const j of this.pending.values()) if (t - j.sent > 4000) { this._fail(); break; }
    }
    if (!this.queue.length) return;
    const t0 = now();
    do { this._runSync(this.queue.shift()); } while (this.queue.length && now() - t0 < budgetMs);
  }
  dispose() { if (this.worker) this.worker.terminate(); this.worker = null; this.pending.clear(); this.queue = []; this.low = []; }
}

export class SoundManager {
  // opts (optional, mainly for tests/tools): { context: an existing (Offline)AudioContext,
  //   worker: false to synthesise on the main thread }
  constructor(opts = {}) {
    this._AC = audioContextClass();
    this._ctxGiven = opts.context || null;
    this._offline = typeof OfflineAudioContext !== 'undefined' && this._ctxGiven instanceof OfflineAudioContext;
    this._useWorker = opts.worker !== false;
    this.enabled = !!(this._AC || this._ctxGiven);
    this.ctx = null;
    this.volumes = Object.fromEntries(CATEGORIES.map((c) => [c, 1]));
    this._bus = {};
    this._buffers = new Map();     // 'base#variant' -> AudioBuffer
    this._waiting = new Map();     // 'base#variant' -> [queued plays]
    this._lastVariant = new Map();
    this._warned = new Set();
    this._voices = [];
    this._recent = new Map();      // dedupe identical plays in the same instant
    this._listener = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this._backend = new SynthBackend();
    this._pianoBufs = new Map();
    this._pianoPending = new Set();
    this._music = { want: null, kind: null, state: 'off', player: null, nextAt: 0, fading: [], next: null, opts: null };
    this._mood = 0;
    this._moodPeriod = 60 + Math.random() * 80;
    this._netherTimer = 4 + Math.random() * 8;
    this._prewarmed = false;
  }

  // ---------------------------------------------------------------- setup ----
  unlock() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        this.ctx = this._ctxGiven || new this._AC({ latencyHint: 'interactive' });
        this._buildGraph();
        this._applyListener();
        if (this._useWorker) this._backend.start();
      }
      if (this._offline) return;
      if ((this.ctx.state === 'suspended' || this.ctx.state === 'interrupted') && this.ctx.resume) this.ctx.resume().catch(() => {});
      if (!this._prewarmed) { this._prewarmed = true; this._requestReverb(); this._prewarm(); }
    } catch (e) {
      console.warn('[audio] WebAudio unavailable:', e);
      this.enabled = false; this.ctx = null;
    }
  }

  get ready() { return !!this.ctx && (this.ctx.state === 'running' || this._offline); }

  _buildGraph() {
    const ctx = this.ctx;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 4; limiter.ratio.value = 12;
    limiter.attack.value = 0.003; limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = this.volumes.master;
    master.connect(limiter);
    this._bus.master = master;
    for (const c of CATEGORIES) {
      if (c === 'master') continue;
      const g = ctx.createGain();
      g.gain.value = this.volumes[c];
      g.connect(master);
      this._bus[c] = g;
    }
    this._musicLevel = ctx.createGain();
    this._musicLevel.gain.value = MUSIC_LEVEL;
    this._musicLevel.connect(this._bus.music);
  }

  setVolume(category, value) {
    if (!(category in this.volumes)) return;
    const v = clamp(Number(value) || 0, 0, 1);
    this.volumes[category] = v;
    const g = this._bus[category];
    if (g && this.ctx) {
      const t = this.ctx.currentTime;
      g.gain.cancelScheduledValues(t);
      g.gain.setTargetAtTime(v, t, 0.05);
    }
  }

  // ------------------------------------------------------------ listener ----
  setListener(x, y, z, yaw = 0, pitch = 0) {
    const L = this._listener;
    L.x = x; L.y = y; L.z = z; L.yaw = yaw; L.pitch = pitch;
    if (this.ctx) this._applyListener();
  }

  _applyListener() {
    const { x, y, z, yaw, pitch } = this._listener;
    const cp = Math.cos(pitch), sp = Math.sin(pitch), sy = Math.sin(yaw), cy = Math.cos(yaw);
    const fx = -sy * cp, fy = sp, fz = -cy * cp;
    const ux = sy * sp, uy = cp, uz = cy * sp; // perpendicular to forward; (0,1,0) when level
    const l = this.ctx.listener;
    try {
      if (l.positionX) {
        l.positionX.value = x; l.positionY.value = y; l.positionZ.value = z;
        l.forwardX.value = fx; l.forwardY.value = fy; l.forwardZ.value = fz;
        l.upX.value = ux; l.upY.value = uy; l.upZ.value = uz;
      } else {
        l.setPosition(x, y, z);
        l.setOrientation(fx, fy, fz, ux, uy, uz);
      }
    } catch (_) { /* non-finite input: ignore */ }
  }

  // ------------------------------------------------------------ buffers ----
  _requestBuffer(base, variant, urgent) {
    const key = base + '#' + variant;
    if (this._buffers.has(key) || this._waiting.has(key)) return;
    this._waiting.set(key, []);
    const sr = this.ctx.sampleRate;
    this._backend.request({
      msg: { type: 'sfx', name: base, variant, sr },
      sync: () => synthesize(base, variant, sr),
      done: (res) => {
        const queued = this._waiting.get(key) || [];
        this._waiting.delete(key);
        if (!res || !this.ctx) return;
        const buf = toBuffer(this.ctx, res.data, res.rate);
        this._buffers.set(key, buf);
        const t = this.ctx.currentTime;
        for (const q of queued) {
          if (q.handle.cancelled) continue;
          if (q.opts.loop || t - q.t < QUEUE_MAX_AGE) this._start(buf, q.def, q.opts, q.handle);
        }
      },
    }, urgent);
  }

  _requestReverb() {
    const ctx = this.ctx, sr = ctx.sampleRate;
    this._backend.request({
      msg: { type: 'ir', sr },
      sync: () => { const [data, data2] = renderReverbIR(sr); return { data, data2, rate: sr }; },
      done: (res) => {
        if (!res || this.ctx !== ctx) return;
        if (!hasReverbIR(ctx)) provideReverbIR(ctx, res.data, res.data2);
        // in a worker message task: build the convolver now; on the main-thread fallback
        // path this ran inside update(), so defer the (expensive) convolver setup a frame
        if (this._backend.worker) this._ensureReverb(); else this._wantReverb = true;
      },
    }, false);
  }

  // One shared music reverb for the lifetime of the context (assigning a convolver
  // buffer is expensive, so it is done once, as soon as the IR is available).
  _ensureReverb() {
    if (this._reverb || !this.ctx) return this._reverb;
    const conv = this.ctx.createConvolver();
    conv.buffer = getReverbIR(this.ctx);
    const wet = this.ctx.createGain();
    wet.gain.value = MUSIC_WET;
    conv.connect(wet); wet.connect(this._musicLevel);
    this._reverb = conv;
    return conv;
  }

  _prewarm() {
    for (const name of PREWARM) {
      const d = getSoundDef(name);
      if (!d) continue;
      const base = d.alias || name;
      for (let v = 0; v < d.variants; v++) this._requestBuffer(base, v, false);
    }
  }

  _pickVariant(base, n) {
    if (n <= 1) return 0;
    const last = this._lastVariant.get(base);
    let v = Math.floor(Math.random() * n);
    if (v === last) v = (v + 1 + Math.floor(Math.random() * (n - 1))) % n;
    // prefer a variant that is already rendered so the sound starts immediately
    if (!this._buffers.has(base + '#' + v)) {
      for (let k = 1; k < n; k++) {
        const w = (v + k) % n;
        if (w !== last && this._buffers.has(base + '#' + w)) { this._requestBuffer(base, v, false); v = w; break; }
      }
    }
    this._lastVariant.set(base, v);
    return v;
  }

  // ----------------------------------------------------------------- play ----
  play(name, opts = {}) {
    try {
      const def = getSoundDef(name);
      if (!def) {
        if (!this._warned.has(name)) { this._warned.add(name); console.warn(`[audio] unknown sound "${name}"`); }
        return null;
      }
      if (!this.ctx || !this.enabled || !this.ready) return null;
      const t = this.ctx.currentTime;
      // collapse identical requests in the same instant (e.g. many items popping at once)
      const dk = name + (opts.x !== undefined ? `@${Math.round(opts.x)},${Math.round(opts.y)},${Math.round(opts.z)}` : '');
      const lastT = this._recent.get(dk);
      if (lastT !== undefined && t - lastT < 0.012) return null;
      this._recent.set(dk, t);
      if (this._recent.size > 256) this._recent.clear();

      const base = def.alias || name;
      const variant = this._pickVariant(base, def.variants);
      const buf = this._buffers.get(base + '#' + variant);
      const handle = {
        cancelled: false, voice: null, volume: Math.max(0, opts.volume ?? 1),
        stop() { this.cancelled = true; if (this.voice) this.voice.kill(0.02); },
        // change loudness while playing (0..1, same meaning as play()'s volume; smoothed)
        setVolume(v) { this.volume = Math.max(0, Number(v) || 0); if (this.voice) this.voice.setVolume(this.volume); },
      };
      if (buf) { this._start(buf, def, opts, handle); return handle; }
      if (this._isOutOfRange(opts)) return null;
      const key = base + '#' + variant;
      if (!this._waiting.has(key)) this._requestBuffer(base, variant, true);
      const ready = this._buffers.get(key); // synchronous fallback finishes immediately
      if (ready) { this._start(ready, def, opts, handle); return handle; }
      const q = this._waiting.get(key);
      if (q) q.push({ def, opts, t, handle });
      return handle;
    } catch (e) {
      console.warn('[audio] play failed:', name, e);
      return null;
    }
  }

  _isOutOfRange(opts) {
    if (opts.x === undefined || opts.y === undefined || opts.z === undefined) return false;
    const L = this._listener, dx = opts.x - L.x, dy = opts.y - L.y, dz = opts.z - L.z;
    const range = BASE_RANGE * Math.max(1, opts.volume ?? 1);
    return dx * dx + dy * dy + dz * dz > (range + 1) * (range + 1);
  }

  _start(buf, def, opts, handle) {
    const ctx = this.ctx, t = ctx.currentTime;
    if (this._isOutOfRange(opts)) return;
    const vol = Math.max(0, opts.volume ?? 1);
    const hv = handle ? handle.volume : vol;
    let rate = (opts.pitch ?? 1) * (def.pitch || 1);
    if (def.pitchVar) rate *= 1 + (Math.random() * 2 - 1) * def.pitchVar;
    // voice limit: steal the oldest one-shot (looping beds are only stolen as a last resort)
    this._voices = this._voices.filter((v) => !v.done);
    while (this._voices.length >= MAX_VOICES) {
      let k = this._voices.findIndex((v) => !v.loop);
      if (k < 0) k = 0;
      this._voices.splice(k, 1)[0].kill(0.015);
    }
    const looping = !!(opts.loop && def.loop);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clamp(rate, 0.1, 4);
    if (looping) src.loop = true;
    const g = ctx.createGain();
    const baseGain = def.vol * (opts.gain ?? 1);
    g.gain.value = Math.min(1, hv) * baseGain;
    src.connect(g);
    let tail = g, panner = null;
    if (opts.x !== undefined && opts.y !== undefined && opts.z !== undefined) {
      panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.refDistance = 1;
      panner.maxDistance = BASE_RANGE * Math.max(1, vol);
      panner.rolloffFactor = 1;
      if (panner.positionX) { panner.positionX.value = opts.x; panner.positionY.value = opts.y; panner.positionZ.value = opts.z; }
      else panner.setPosition(opts.x, opts.y, opts.z);
      g.connect(panner); tail = panner;
    }
    tail.connect(this._bus[def.cat] || this._bus.master);
    const voice = {
      src, g, panner, done: false, loop: looping,
      setVolume(v) {
        if (this.done) return;
        try { g.gain.setTargetAtTime(Math.min(1, v) * baseGain, ctx.currentTime, 0.05); } catch (_) { /* ignore */ }
      },
      kill(fade) {
        if (this.done) return;
        this.done = true;
        const n = ctx.currentTime;
        try { g.gain.cancelScheduledValues(n); g.gain.setTargetAtTime(0, n, fade / 3); src.stop(n + fade + 0.01); } catch (_) { /* ignore */ }
      },
    };
    src.onended = () => {
      voice.done = true;
      try { src.disconnect(); g.disconnect(); if (panner) panner.disconnect(); } catch (_) { /* ignore */ }
    };
    src.start(t);
    this._voices.push(voice);
    if (handle) handle.voice = voice;
  }

  // kind: 'break' | 'place' | 'step' | 'hit' | 'fall'
  playBlock(kind, group, x, y, z) {
    if (!group || group === 'none') return null;
    const G = BLOCK_SOUND_GROUPS[group] || BLOCK_SOUND_GROUPS.stone;
    switch (kind) {
      case 'break': return this.play(G.dig, { x, y, z, volume: 1, pitch: 1 });
      case 'place': return this.play(G.place, { x, y, z, volume: 1, pitch: 0.8 });
      case 'step': return this.play(G.step, { x, y, z, volume: 1 });
      case 'hit': return this.play(G.hit, { x, y, z, volume: 1 });
      case 'fall': return this.play(G.step, { x, y, z, volume: 1, pitch: 0.75, gain: 1.8 });
      default: return null;
    }
  }

  get activeVoices() { this._voices = this._voices.filter((v) => !v.done); return this._voices.length; }

  // ---------------------------------------------------------------- music ----
  // opts.delay (s) overrides the initial wait (handy for testing).
  startMusic(kind = 'game', opts = {}) {
    if (!MUSIC_KINDS.includes(kind)) kind = 'game';
    this._music.want = kind;
    this._music.opts = opts;
    if (this.ready) this._beginMusic(kind, opts);
  }

  stopMusic() {
    const M = this._music;
    M.want = null;
    M.kind = null;
    M.state = 'off';
    M.next = null;
    if (M.player) { M.player.stop(2); M.fading.push(M.player); M.player = null; }
  }

  _beginMusic(kind, opts = {}) {
    const M = this._music;
    if (M.kind === kind && M.state !== 'off') return;
    const hadPlayer = !!M.player;
    if (M.player) { M.player.stop(2); M.fading.push(M.player); M.player = null; }
    M.kind = kind;
    M.state = 'waiting';
    const t = this.ctx.currentTime;
    const delay = opts.delay ?? (kind === 'menu' ? (hadPlayer ? 2.2 : 1.0) : kind === 'nether' ? 10 + Math.random() * 20 : 20 + Math.random() * 40);
    M.nextAt = t + delay;
    M.next = null;
  }

  _pianoSource() {
    if (this._pianoSrc) return this._pianoSrc;
    const self = this;
    this._pianoSrc = {
      get(midi) {
        let b = self._pianoBufs.get(midi);
        if (!b) { b = toBuffer(self.ctx, pianoSamples(midi), PIANO_RATE); self._pianoBufs.set(midi, b); }
        return b;
      },
      has(midi) { return self._pianoBufs.has(midi); },
      ready(midi) { return self._pianoBufs.has(midi) || self._pianoPending.has(midi); },
      request(midi) {
        if (this.ready(midi)) return;
        self._pianoPending.add(midi);
        self._backend.request({
          msg: { type: 'piano', midi },
          sync: () => ({ data: pianoSamples(midi), rate: PIANO_RATE }),
          done: (res) => {
            self._pianoPending.delete(midi);
            if (res && self.ctx && !self._pianoBufs.has(midi)) self._pianoBufs.set(midi, toBuffer(self.ctx, res.data, res.rate));
          },
        }, false);
      },
    };
    return this._pianoSrc;
  }

  _updateMusic(t, context) {
    const M = this._music;
    if (M.want && M.state === 'off') this._beginMusic(M.want, M.opts || {});
    M.fading = M.fading.filter((p) => { if (p.isDone(t)) { p.dispose(); return false; } return true; });
    if (M.state === 'waiting' && this.volumes.music * this.volumes.master <= 0) M.nextAt = Math.max(M.nextAt, t + 1); // muted: hold
    if (M.state === 'waiting') {
      // compose ahead of time so piano notes can be rendered before they are needed
      if (!M.next && t > M.nextAt - 12) {
        const night = context && typeof context.time === 'number' ? ((context.time % 24000) + 24000) % 24000 > 13000 && ((context.time % 24000) + 24000) % 24000 < 23000 : false;
        M.next = composePiece((Math.random() * 2 ** 32) >>> 0, M.kind, { night });
        const src = this._pianoSource();
        for (const n of M.next.notes) { if (n.t > 10) break; src.request(n.midi); }
      }
      if (M.next && t >= M.nextAt && (hasReverbIR(this.ctx) || t >= M.nextAt + 1)) {
        M.player = new MusicPlayer(this.ctx, this._musicLevel, M.next, t + 0.3, this._pianoSource(), this._ensureReverb());
        M.next = null;
        M.state = 'playing';
      }
    }
    if (M.state === 'playing' && M.player) {
      M.player.pump(t + 1.5);
      if (M.player.isDone(t)) {
        M.player.dispose();
        M.player = null;
        M.state = 'waiting';
        M.nextAt = t + (M.kind === 'menu' ? 4 + Math.random() * 8 : M.kind === 'nether' ? 120 + Math.random() * 180 : 180 + Math.random() * 300);
      }
    }
  }

  get musicState() {
    const M = this._music;
    return { kind: M.kind, state: M.state, nextIn: M.state === 'waiting' && this.ctx ? Math.max(0, M.nextAt - this.ctx.currentTime) : 0, piece: M.player ? M.player.piece.summary : null };
  }

  // --------------------------------------------------------------- update ----
  update(dt = 0, context = {}) {
    if (!this.ctx || !this.enabled) return;
    try {
      if (this._wantReverb && !this._backend.queue.length) { this._wantReverb = false; this._ensureReverb(); }
      else this._backend.tick(4);
      if (!this.ready) return;
      const t = this.ctx.currentTime;
      this._updateMusic(t, context);
      this._updateAmbience(dt, context);
    } catch (e) {
      if (!this._updateWarned) { this._updateWarned = true; console.warn('[audio] update failed:', e); }
    }
  }

  // context.dimension: 'overworld' (default) | 'nether' | 'end'. Cave mood only runs in the
  // overworld; in the nether, ambient.nether.additions one-shots play every ~6-20 s
  // (disable with context.netherAdditions === false). Biome loops are played by the caller.
  _updateAmbience(dt, c) {
    const dim = (c && c.dimension) || 'overworld';
    if (dim === 'nether') {
      this._mood = 0;
      if (c.netherAdditions === false) return;
      this._netherTimer -= Math.min(dt, 0.25);
      if (this._netherTimer <= 0) {
        this._netherTimer = 6 + Math.random() * 14;
        const L = this._listener, a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 8;
        this.play('ambient.nether.additions', { x: L.x + Math.cos(a) * d, y: L.y + (Math.random() * 6 - 3), z: L.z + Math.sin(a) * d, volume: 0.7, pitch: 0.8 + Math.random() * 0.4 });
      }
      return;
    }
    if (dim === 'overworld' && c && c.underground) {
      this._mood += Math.min(dt, 0.25) / this._moodPeriod;
      if (this._mood >= 1) {
        this._mood = 0;
        this._moodPeriod = 45 + Math.random() * 100;
        const L = this._listener, a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 7;
        this.play('ambient.cave', { x: L.x + Math.cos(a) * d, y: L.y + (Math.random() * 6 - 3), z: L.z + Math.sin(a) * d, volume: 0.9, pitch: 0.8 + Math.random() * 0.4 });
      }
    } else this._mood = Math.max(0, this._mood - dt / 60);
  }

  dispose() {
    this.stopMusic();
    this._backend.dispose();
    if (this.ctx && this.ctx.close) this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}

// ======================================================= offline helpers ====
// Render one sound (as it would be heard at volume 1, non-positional) through an
// OfflineAudioContext. Returns a Promise<AudioBuffer>. Used by tools/sound-check.mjs.
export async function renderToBuffer(name, { variant = 0, sampleRate = 48000, pitch = 1, volume = 1 } = {}) {
  const def = getSoundDef(name);
  if (!def) throw new Error('unknown sound ' + name);
  const res = synthesize(name, variant, sampleRate);
  const rate = (def.pitch || 1) * pitch;
  const len = Math.ceil((res.data.length / res.rate) / rate * sampleRate) + 256;
  const ctx = new OfflineAudioContext(1, len, sampleRate);
  const src = ctx.createBufferSource();
  src.buffer = toBuffer(ctx, res.data, res.rate);
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = def.vol * Math.min(1, volume);
  src.connect(g); g.connect(ctx.destination);
  src.start(0);
  return ctx.startRendering();
}

// Render `seconds` of a generated piece offline (stereo). Resolves { buffer, piece }.
export async function renderMusic(seconds = 20, { kind = 'game', seed = 1, sampleRate = 44100, offset = 0 } = {}) {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const lvl = ctx.createGain();
  lvl.gain.value = MUSIC_LEVEL;
  lvl.connect(ctx.destination);
  const piece = composePiece(seed, kind);
  const player = new MusicPlayer(ctx, lvl, piece, 0.05 - offset);
  player.pump(seconds + 0.5);
  const buffer = await ctx.startRendering();
  return { buffer, piece };
}
