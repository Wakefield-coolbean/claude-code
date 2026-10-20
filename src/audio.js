// Synthesized sound effects (WebAudio), so the game ships with no audio files.
// Browsers only allow sound after a user gesture; call unlock() from a click handler.

let ctx = null;
let master = null;
let muted = false;
let alarmTimer = null;

try {
  muted = localStorage.getItem('sus-muted') === '1';
} catch {
  /* storage unavailable */
}

export function unlock() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);
}

export function isMuted() {
  return muted;
}

export function setMuted(m) {
  muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
  try {
    localStorage.setItem('sus-muted', m ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

function tone(freq, dur, { type = 'square', vol = 0.2, at = 0, slide = 0, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, { vol = 0.3, at = 0, filter = 1200, q = 1, type = 'lowpass' } = {}) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = filter;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

const SOUNDS = {
  click: () => tone(900, 0.05, { type: 'square', vol: 0.08 }),
  good: () => {
    tone(660, 0.08, { type: 'triangle', vol: 0.15 });
    tone(990, 0.12, { type: 'triangle', vol: 0.15, at: 0.07 });
  },
  bad: () => tone(160, 0.25, { type: 'sawtooth', vol: 0.12, slide: -60 }),
  beep: () => tone(1200, 0.07, { type: 'sine', vol: 0.12 }),
  drag: () => tone(420, 0.04, { type: 'triangle', vol: 0.06 }),
  done: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, { type: 'triangle', vol: 0.16, at: i * 0.07 }));
  },
  whoosh: () => noise(0.5, { vol: 0.25, filter: 900, type: 'bandpass', q: 0.7 }),
  kill: () => {
    noise(0.12, { vol: 0.5, filter: 3000, type: 'highpass' });
    tone(110, 0.35, { type: 'sawtooth', vol: 0.3, slide: -70, at: 0.05 });
    noise(0.3, { vol: 0.4, filter: 400, at: 0.08 });
  },
  report: () => {
    for (let i = 0; i < 3; i++) {
      tone(880, 0.12, { type: 'square', vol: 0.15, at: i * 0.25 });
      tone(660, 0.12, { type: 'square', vol: 0.15, at: i * 0.25 + 0.12 });
    }
  },
  emergency: () => {
    for (let i = 0; i < 4; i++) tone(520, 0.22, { type: 'sawtooth', vol: 0.14, at: i * 0.3, slide: 320 });
  },
  vent: () => {
    noise(0.18, { vol: 0.35, filter: 600 });
    tone(140, 0.15, { type: 'square', vol: 0.12, slide: -60 });
  },
  vote: () => tone(700, 0.08, { type: 'square', vol: 0.12, slide: 200 }),
  eject: () => noise(1.6, { vol: 0.3, filter: 500, type: 'bandpass', q: 0.5 }),
  reveal: () => {
    tone(98, 1.6, { type: 'sawtooth', vol: 0.18, attack: 0.2 });
    tone(147, 1.6, { type: 'sawtooth', vol: 0.12, attack: 0.2 });
    tone(196, 1.6, { type: 'triangle', vol: 0.12, attack: 0.3 });
  },
  shh: () => noise(0.9, { vol: 0.18, filter: 4000, type: 'highpass' }),
  door: () => {
    tone(90, 0.2, { type: 'square', vol: 0.2, slide: -30 });
    noise(0.15, { vol: 0.2, filter: 800, at: 0.02 });
  },
  sabotage: () => tone(300, 0.4, { type: 'sawtooth', vol: 0.12, slide: -150 }),
  victory: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, { type: 'triangle', vol: 0.15, at: i * 0.12 })),
  defeat: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, { type: 'sawtooth', vol: 0.1, at: i * 0.15 })),
  type: () => tone(1500 + Math.random() * 300, 0.02, { type: 'square', vol: 0.04 }),
  chat: () => tone(1046, 0.06, { type: 'sine', vol: 0.1 }),
};

export function sfx(name) {
  if (!ctx || muted) return;
  const f = SOUNDS[name];
  if (f) f();
}

/** Repeating alarm while Reactor/O2 is active. */
export function setAlarm(on) {
  if (on && !alarmTimer) {
    const beep = () => {
      tone(760, 0.18, { type: 'square', vol: 0.09 });
      tone(560, 0.18, { type: 'square', vol: 0.09, at: 0.2 });
    };
    beep();
    alarmTimer = setInterval(beep, 1000);
  } else if (!on && alarmTimer) {
    clearInterval(alarmTimer);
    alarmTimer = null;
  }
}
