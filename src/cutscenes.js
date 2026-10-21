// Kill cutscenes the victim sees: the killer, the kill, and the body left behind, animated on
// a canvas over a dark red stage. Each kill picks one of several stagings at random.
// Stage units are character cells (a crewmate is about 1.3 tall); feet stand on FLOOR.

import { drawCharacter, drawCharacterPart, drawTopHalf, CUT_Y, WALK_FRAMES, WALK_FPS } from './sprites.js';
import { sfx } from './audio.js';

export const KILL_SCENE = 2.2; // seconds the cutscene runs
export const KILL_VARIANTS = ['knife', 'tongue', 'shot', 'snap'];

const SW = 4.8; // stage size in cells (16:9)
const SH = 2.7;
const FLOOR = 2.3;
const INK = '#07090c';
const BLOOD = '#c3141d';
const BONE = '#f3efe2';
const TAU = Math.PI * 2;

const clamp01 = (u) => Math.max(0, Math.min(1, u));
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const lerp = (a, b, u) => a + (b - a) * u;
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeIn = (u) => u * u * u;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const walkFrame = (t) => Math.floor(t * WALK_FPS) % WALK_FRAMES;

function rnd(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ---------- drawing helpers (stage units) ----------

/** A character with its feet at (x, y). o: frame, sx, sy (squash), rot (about the feet), kind, fwd, up. */
function char(ctx, look, x, y, facing, o = {}) {
  ctx.save();
  ctx.translate(x, y);
  if (o.rot) ctx.rotate(o.rot);
  ctx.scale(facing * (o.sx ?? 1), o.sy ?? 1);
  drawCharacter(ctx, look, { kind: o.kind || 'alive', frame: o.frame ?? -1, fwd: o.fwd ?? 1, up: o.up ?? 0 });
  ctx.restore();
}

/** The flying top half, centred at (cx, cy). spin: scaleX for a spin about the vertical axis. */
function topHalf(ctx, look, cx, cy, facing, rot = 0, spin = 1) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.scale(facing * spin, 1);
  ctx.translate(0, 0.92);
  drawTopHalf(ctx, look);
  ctx.restore();
}

/**
 * The top half knocked off at time t0: it arcs from the body to land at xL lying on its side,
 * after `spins` full turns (dir +1 clockwise), and settles with a wobble.
 */
function flyTop(ctx, look, t, t0, dur, x0, xL, peak, spins, dir, facing) {
  const f = seg(t, t0, t0 + dur);
  const y0 = FLOOR - 0.92;
  const yL = FLOOR - 0.37;
  const x = lerp(x0, xL, f);
  const y = lerp(y0, yL, f) - peak * 4 * f * (1 - f);
  const settle = seg(t, t0 + dur, t0 + dur + 0.35);
  const wobble = f >= 1 ? Math.sin(settle * Math.PI * 3) * 0.12 * (1 - settle) : 0;
  topHalf(ctx, look, x, y, facing, dir * ((spins * TAU + Math.PI / 2) * f + wobble));
}

function floorShadow(ctx, x, w = 0.5, a = 0.35) {
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, FLOOR, w, w * 0.3, 0, 0, TAU);
  ctx.fill();
}

/** Droplets sprayed from (x, y) over u in 0..1, falling to the floor. */
function splash(ctx, x, y, u, seed, dir = 1) {
  if (u <= 0 || u >= 1) return;
  const r = rnd(seed);
  ctx.save();
  ctx.globalAlpha = 1 - u * u;
  ctx.lineWidth = 0.02;
  ctx.strokeStyle = INK;
  for (let i = 0; i < 11; i++) {
    const vx = (r() - 0.35) * 1.6 * dir;
    const vy = -0.6 - r() * 1.4;
    const px = x + vx * u;
    const py = Math.min(FLOOR, y + vy * u + 3.2 * u * u);
    const s = 0.025 + r() * 0.04;
    ctx.fillStyle = BLOOD;
    ctx.beginPath();
    if (py >= FLOOR) ctx.ellipse(px, FLOOR, s * 1.8, s * 0.5, 0, 0, TAU);
    else ctx.arc(px, py, s, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** A comic impact star at (x, y). */
function impact(ctx, x, y, u, size = 0.55, color = '#ffffff') {
  if (u <= 0 || u >= 1) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 1 - u;
  const r = size * (0.5 + easeOut(u) * 0.8);
  ctx.beginPath();
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 0.04;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.restore();
}

/** A knife with the grip at the origin, blade along +x. */
function knife(ctx) {
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#5a3b26';
  ctx.beginPath();
  ctx.roundRect(-0.2, -0.05, 0.22, 0.1, 0.03);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#8b96a3';
  ctx.fillRect(0.02, -0.08, 0.04, 0.16);
  ctx.strokeRect(0.02, -0.08, 0.04, 0.16);
  ctx.fillStyle = '#dfe6ec';
  ctx.beginPath();
  ctx.moveTo(0.06, -0.06);
  ctx.lineTo(0.5, -0.04);
  ctx.lineTo(0.62, 0.02);
  ctx.lineTo(0.06, 0.05);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.beginPath();
  ctx.moveTo(0.1, -0.03);
  ctx.lineTo(0.48, -0.02);
  ctx.stroke();
}

/** A stubby sci-fi pistol with the grip at the origin, barrel along +x. Returns the muzzle point. */
function gun(ctx) {
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = INK;
  ctx.fillStyle = '#3d4652';
  ctx.beginPath();
  ctx.roundRect(-0.06, -0.02, 0.12, 0.2, 0.03);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5c6875';
  ctx.beginPath();
  ctx.roundRect(-0.1, -0.12, 0.5, 0.13, 0.04);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7fd3ff';
  ctx.fillRect(0.08, -0.09, 0.14, 0.04);
  ctx.fillStyle = '#2a3038';
  ctx.beginPath();
  ctx.roundRect(0.38, -0.1, 0.08, 0.09, 0.02);
  ctx.fill();
  ctx.stroke();
  return [0.46, -0.055];
}

function smoke(ctx, x, y, u) {
  if (u <= 0 || u >= 1) return;
  ctx.save();
  for (let i = 0; i < 3; i++) {
    const k = clamp01(u * 1.3 - i * 0.15);
    if (k <= 0) continue;
    ctx.globalAlpha = (1 - k) * 0.6;
    ctx.fillStyle = '#c9ced4';
    ctx.beginPath();
    ctx.arc(x + Math.sin(k * 5 + i) * 0.06, y - k * 0.7 - i * 0.05, 0.05 + k * 0.12, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

// ---------- the stagings ----------
// Each draws one frame at time t (seconds) and names the moment of the hit.
// k = killer, v = victim (players with color, shadow and outfit).

const VARIANTS = {
  // The killer walks up, draws a knife and drives it through the visor; the top half flies off.
  knife: {
    hit: 0.72,
    draw(ctx, t, k, v) {
      const vx = 3.25;
      const kx = lerp(0.9, 2.1, easeOut(seg(t, 0, 0.5)));
      const walking = t < 0.48;
      const lean = t < 0.62 ? 0 : t < 0.72 ? easeOut(seg(t, 0.62, 0.72)) * 0.22 : 0.22 * (1 - easeInOut(seg(t, 1.1, 1.5)));
      const startle = Math.sin(Math.PI * seg(t, 0.32, 0.5)) * 0.12;
      floorShadow(ctx, kx);
      floorShadow(ctx, vx);
      // Victim: whole until the hit, then the body stays and the top half flies.
      if (t < this.hit) {
        char(ctx, v, vx, FLOOR - startle, -1);
      } else {
        const u = seg(t, this.hit, this.hit + 0.18);
        char(ctx, v, vx, FLOOR, -1, { kind: 'body', sx: 1 + Math.sin(u * Math.PI) * 0.15, sy: 1 - Math.sin(u * Math.PI) * 0.15 });
        flyTop(ctx, v, t, this.hit, 0.7, vx, vx + 1.05, 0.9, 1, 1, -1);
        splash(ctx, vx, FLOOR + CUT_Y, seg(t, this.hit, this.hit + 0.8), 7, 1);
      }
      // Killer and knife.
      char(ctx, k, kx, FLOOR, 1, { frame: walking ? walkFrame(t) : -1, rot: lean });
      const draw = seg(t, 0.45, 0.62);
      const sheathe = seg(t, 1.25, 1.55);
      if (draw > 0 && sheathe < 1) {
        ctx.save();
        ctx.translate(kx, FLOOR);
        ctx.rotate(lean);
        const reach = t < 0.62 ? 0 : t < 0.72 ? easeIn(seg(t, 0.62, 0.72)) : 1 - easeInOut(seg(t, 0.95, 1.25));
        ctx.translate(lerp(0.15, 0.35 + reach * 0.22, draw), -0.92 - (1 - draw) * 0.15 + sheathe * 0.3);
        ctx.rotate(lerp(-1.7, 0, easeOut(draw)) - sheathe * 1.7);
        ctx.globalAlpha = 1 - sheathe;
        knife(ctx);
        ctx.restore();
      }
      impact(ctx, vx - 0.15, FLOOR - 0.88, seg(t, this.hit, this.hit + 0.3), 0.6);
    },
  },

  // The killer's head splits open like a jaw and a tongue spears the victim.
  tongue: {
    hit: 0.7,
    draw(ctx, t, k, v) {
      const kx = 1.55;
      const vx = 3.3;
      const open = t < 0.55 ? easeOut(seg(t, 0.3, 0.55)) : 1 - easeInOut(seg(t, 1.0, 1.3));
      const shudder = t < 0.3 ? Math.sin(t * 90) * 0.025 * seg(t, 0.05, 0.3) : 0;
      floorShadow(ctx, kx);
      floorShadow(ctx, vx);
      // Victim.
      if (t < this.hit + 0.12) {
        const jolt = t > this.hit ? Math.sin(seg(t, this.hit, this.hit + 0.12) * Math.PI) * 0.08 : 0;
        char(ctx, v, vx + jolt, FLOOR, -1, { up: t > 0.5 ? -0.3 : 0 });
      } else {
        char(ctx, v, vx, FLOOR, -1, { kind: 'body' });
        // The top half slumps backwards off the body and lands behind it.
        flyTop(ctx, v, t, this.hit + 0.12, 0.45, vx, vx + 0.95, 0.25, 0, 1, -1);
        splash(ctx, vx, FLOOR + CUT_Y, seg(t, this.hit + 0.1, this.hit + 0.9), 11, 1);
      }
      // Killer: jaw hinges at the back of the head.
      const hingeY = -0.78;
      ctx.save();
      ctx.translate(kx + shudder, FLOOR);
      // Mouth inside, behind both halves.
      if (open > 0) {
        ctx.fillStyle = '#3a0508';
        ctx.beginPath();
        ctx.ellipse(0.02, hingeY, 0.36, 0.06 + open * 0.24, 0, 0, TAU);
        ctx.fill();
        ctx.lineWidth = 0.05;
        ctx.strokeStyle = INK;
        ctx.stroke();
      }
      drawCharacterPart(ctx, k, hingeY, 'below');
      // Lower teeth.
      if (open > 0.1) {
        ctx.fillStyle = BONE;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.025;
        for (let i = 0; i < 5; i++) {
          const x = -0.24 + i * 0.13;
          ctx.beginPath();
          ctx.moveTo(x - 0.05, hingeY);
          ctx.lineTo(x, hingeY - 0.1 * open);
          ctx.lineTo(x + 0.05, hingeY);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.save();
      ctx.translate(-0.36, hingeY);
      ctx.rotate(-open * 0.95);
      ctx.translate(0.36, -hingeY);
      drawCharacterPart(ctx, k, hingeY, 'above');
      if (open > 0.1) {
        ctx.fillStyle = BONE;
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.025;
        for (let i = 0; i < 5; i++) {
          const x = -0.24 + i * 0.13;
          ctx.beginPath();
          ctx.moveTo(x - 0.05, hingeY);
          ctx.lineTo(x, hingeY + 0.1 * open);
          ctx.lineTo(x + 0.05, hingeY);
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.restore();
      // Tongue: out to the visor, holds, then snaps back.
      const out = t < this.hit ? easeIn(seg(t, 0.55, this.hit)) : 1 - easeInOut(seg(t, this.hit + 0.15, this.hit + 0.35));
      if (out > 0 && open > 0.5) {
        const x0 = kx + 0.1;
        const y0 = FLOOR + hingeY - 0.05;
        const x1 = lerp(x0, vx + 0.15, out);
        const y1 = lerp(y0, FLOOR - 0.88, out);
        const mid = (x0 + x1) / 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = INK;
        ctx.lineWidth = 0.17;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(mid, y0 - 0.12 * out, x1, y1);
        ctx.stroke();
        ctx.strokeStyle = '#e8708f';
        ctx.lineWidth = 0.11;
        ctx.stroke();
        ctx.save();
        ctx.translate(x1, y1);
        ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
        ctx.fillStyle = BONE;
        ctx.lineWidth = 0.03;
        ctx.beginPath();
        ctx.moveTo(-0.05, -0.09);
        ctx.lineTo(0.2, 0);
        ctx.lineTo(-0.05, 0.09);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      impact(ctx, vx - 0.1, FLOOR - 0.88, seg(t, this.hit, this.hit + 0.3), 0.5);
    },
  },

  // A pistol, one shot through the visor; the victim's top half is knocked spinning away.
  shot: {
    hit: 0.6,
    draw(ctx, t, k, v) {
      const kx = 1.35;
      const vx = 3.4;
      const recoil = t > this.hit ? Math.sin(seg(t, this.hit, this.hit + 0.2) * Math.PI) * 0.25 : 0;
      floorShadow(ctx, kx);
      floorShadow(ctx, vx);
      if (t < this.hit) {
        const startle = Math.sin(Math.PI * seg(t, 0.3, 0.45)) * 0.1;
        char(ctx, v, vx, FLOOR - startle, -1, { up: -0.2 });
      } else {
        const u = seg(t, this.hit, this.hit + 0.16);
        char(ctx, v, vx, FLOOR, -1, { kind: 'body', sx: 1 + Math.sin(u * Math.PI) * 0.18, sy: 1 - Math.sin(u * Math.PI) * 0.18 });
        flyTop(ctx, v, t, this.hit, 0.6, vx, vx + 0.95, 0.6, 1, 1, -1);
        splash(ctx, vx, FLOOR + CUT_Y, seg(t, this.hit, this.hit + 0.8), 23, 1);
      }
      char(ctx, k, kx - recoil * 0.3, FLOOR, 1, { rot: -recoil * 0.3 });
      // Gun comes out, aims, fires, smokes, goes away.
      const out = easeOut(seg(t, 0.05, 0.3));
      const away = seg(t, 1.5, 1.8);
      if (out > 0 && away < 1) {
        ctx.save();
        ctx.translate(kx - recoil * 0.3 + lerp(0.1, 0.42, out), FLOOR - 0.8 + away * 0.3);
        ctx.rotate(-recoil * 1.2 + Math.sin(t * 9) * 0.02 * (t < this.hit ? 1 : 0) - away * 1.2);
        ctx.globalAlpha = 1 - away;
        const [mx, my] = gun(ctx);
        ctx.restore();
        const gx = kx - recoil * 0.3 + lerp(0.1, 0.42, out) + mx;
        const gy = FLOOR - 0.8 + my;
        const fl = seg(t, this.hit, this.hit + 0.12);
        if (fl > 0 && fl < 1) {
          impact(ctx, gx + 0.08, gy, fl, 0.35, '#ffd84a');
          ctx.save();
          ctx.globalAlpha = 1 - fl;
          ctx.strokeStyle = '#fff4b0';
          ctx.lineWidth = 0.05;
          ctx.beginPath();
          ctx.moveTo(gx + 0.1, gy);
          ctx.lineTo(vx - 0.2, FLOOR - 0.88);
          ctx.stroke();
          ctx.restore();
        }
        smoke(ctx, gx + 0.04, gy - 0.05, seg(t, this.hit + 0.15, this.hit + 1.1));
      }
      impact(ctx, vx - 0.15, FLOOR - 0.88, seg(t, this.hit, this.hit + 0.3), 0.55);
    },
  },

  // The killer leaps over the victim, lands behind, and spins its head clean off.
  snap: {
    hit: 0.68,
    draw(ctx, t, k, v) {
      const vx = 2.9;
      const jump = seg(t, 0.05, 0.5);
      const kx = lerp(0.7, 3.75, easeInOut(jump));
      const ky = FLOOR - Math.sin(jump * Math.PI) * 1.1;
      const land = Math.sin(Math.PI * seg(t, 0.5, 0.66));
      floorShadow(ctx, kx, 0.5 * (1 - Math.sin(jump * Math.PI) * 0.4), 0.35);
      floorShadow(ctx, vx);
      // Victim faces away from the killer's landing spot, then looks back.
      const turn = seg(t, 0.45, 0.6);
      if (t < this.hit) {
        char(ctx, v, vx, FLOOR, -1, { fwd: 1 - turn * 0.8 });
      } else {
        char(ctx, v, vx, FLOOR, -1, { kind: 'body' });
        const s = seg(t, this.hit, this.hit + 0.35);
        if (s < 1) topHalf(ctx, v, vx, FLOOR - 0.92 - s * 0.08, -1, 0, Math.cos(easeIn(s) * Math.PI * 5));
        else flyTop(ctx, v, t, this.hit + 0.35, 0.55, vx, vx - 1.0, 0.8, 1, -1, -1);
        if (s < 1) {
          // Twist lines.
          ctx.save();
          ctx.globalAlpha = 1 - s;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 0.04;
          for (const d of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(vx, FLOOR - 0.95, 0.55, d > 0 ? -0.6 : Math.PI - 0.6, d > 0 ? 0.2 : Math.PI + 0.2);
            ctx.stroke();
          }
          ctx.restore();
        }
        splash(ctx, vx, FLOOR + CUT_Y, seg(t, this.hit + 0.3, this.hit + 1.1), 31, -1);
      }
      // A forward flip over the victim's head; lands facing its back.
      const flip = jump > 0 && jump < 1 ? easeInOut(jump) * TAU : 0;
      ctx.save();
      ctx.translate(kx, ky - 0.6);
      ctx.rotate(flip);
      ctx.translate(-kx, -(ky - 0.6));
      char(ctx, k, kx, ky, jump < 1 ? 1 : -1, { sx: 1 + land * 0.15, sy: 1 - land * 0.18 });
      ctx.restore();
      impact(ctx, vx, FLOOR - 0.95, seg(t, this.hit, this.hit + 0.25), 0.45);
    },
  },
};

function background(ctx) {
  const g = ctx.createRadialGradient(SW / 2, SH * 0.55, 0.2, SW / 2, SH * 0.55, SW * 0.62);
  g.addColorStop(0, '#9d1219');
  g.addColorStop(0.55, '#5c070b');
  g.addColorStop(1, '#1c0103');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SW, SH);
  // Floor plate.
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(0, FLOOR - 0.05, SW, SH - FLOOR + 0.05);
  ctx.strokeStyle = 'rgba(255,120,120,0.18)';
  ctx.lineWidth = 0.02;
  ctx.beginPath();
  ctx.moveTo(0, FLOOR - 0.05);
  ctx.lineTo(SW, FLOOR - 0.05);
  ctx.stroke();
}

/**
 * Play a kill cutscene on `canvas`. variant: one of KILL_VARIANTS (random if omitted).
 * Returns stop(). loop: replay forever; at: hold one moment (seconds), both for the dev page.
 */
export function playKillScene(canvas, killer, victim, { variant, mirror, loop = false, at = null, onHit } = {}) {
  const name = VARIANTS[variant] ? variant : KILL_VARIANTS[Math.floor(Math.random() * KILL_VARIANTS.length)];
  const scene = VARIANTS[name];
  const flip = mirror ?? Math.random() < 0.5;
  let start = performance.now();
  let hitDone = false;
  let raf = 0;
  const frame = (now) => {
    let t = at ?? (now - start) / 1000;
    if (loop && t > KILL_SCENE + 0.6) {
      start = now;
      t = 0;
      hitDone = false;
    }
    if (!hitDone && t >= scene.hit) {
      hitDone = true;
      onHit?.();
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const s = Math.min(canvas.width / SW, canvas.height / SH);
    ctx.translate((canvas.width - SW * s) / 2, (canvas.height - SH * s) / 2);
    ctx.scale(s, s);
    // A short shake at the hit.
    const sh = t > scene.hit ? 1 - seg(t, scene.hit, scene.hit + 0.25) : 0;
    if (sh > 0 && at == null) ctx.translate((Math.random() - 0.5) * 0.08 * sh, (Math.random() - 0.5) * 0.08 * sh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SW, SH);
    ctx.clip();
    background(ctx);
    if (flip) {
      ctx.translate(SW, 0);
      ctx.scale(-1, 1);
    }
    ctx.lineJoin = 'round';
    scene.draw(ctx, Math.min(t, KILL_SCENE), killer, victim);
    ctx.restore();
    // Flash at the hit.
    const fl = seg(t, scene.hit, scene.hit + 0.16);
    if (fl > 0 && fl < 1) {
      ctx.fillStyle = `rgba(255,235,235,${(1 - fl) * 0.32})`;
      ctx.fillRect(0, 0, SW, SH);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => window.cancelAnimationFrame(raf), variant: name };
}

/** The kill sound plays at the hit. */
export function killSceneSound() {
  sfx('kill');
}
