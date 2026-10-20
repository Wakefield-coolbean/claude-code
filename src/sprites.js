// Procedural character art: crewmates, ghosts and bodies, cached as bitmaps per scale.
// Units are map cells with the feet at (0, 0) and the character facing right.

const INK = '#07090c';
const VISOR = '#93c8db';
const VISOR_DARK = '#4f8aa2';
const BONE = '#f3efe2';

const W = 1.5; // bitmap size in cells
const H = 1.7;
const OX = 0.75; // feet position inside the bitmap
const OY = 1.55;
export const WALK_FRAMES = 8;

function bodyPath(ctx) {
  ctx.beginPath();
  ctx.roundRect(-0.37, -1.22, 0.76, 0.98, [0.38, 0.38, 0.13, 0.13]);
}

function backpack(ctx, color, shadow) {
  ctx.beginPath();
  ctx.roundRect(-0.53, -0.98, 0.26, 0.56, 0.1);
  ctx.fillStyle = shadow;
  ctx.fill();
  ctx.stroke();
}

function leg(ctx, x, lift, color) {
  ctx.beginPath();
  ctx.roundRect(x, -0.34 - lift, 0.28, 0.34, [0.04, 0.04, 0.12, 0.12]);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
}

function shade(ctx, color, shadow) {
  bodyPath(ctx);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.save();
  bodyPath(ctx);
  ctx.clip();
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.ellipse(-0.3, -0.28, 0.48, 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(-0.48, -0.75, 0.2, 0.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.beginPath();
  ctx.ellipse(-0.12, -1.08, 0.16, 0.06, -0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  bodyPath(ctx);
  ctx.stroke();
}

function visor(ctx) {
  ctx.beginPath();
  ctx.roundRect(0.0, -1.02, 0.52, 0.31, 0.15);
  ctx.fillStyle = VISOR;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = VISOR_DARK;
  ctx.fillRect(0, -0.84, 0.6, 0.2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.roundRect(0.24, -0.97, 0.18, 0.07, 0.035);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.roundRect(0.0, -1.02, 0.52, 0.31, 0.15);
  ctx.stroke();
}

/** Draw a living crewmate. frame: walk frame index or -1 for idle. */
export function drawCrewmate(ctx, color, shadow, frame = -1) {
  ctx.lineWidth = 0.075;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  const ph = frame < 0 ? 0 : (frame / WALK_FRAMES) * Math.PI * 2;
  const swing = frame < 0 ? 0 : Math.sin(ph);
  const bob = frame < 0 ? 0 : -Math.abs(Math.sin(ph)) * 0.04;
  backpack(ctx, color, shadow);
  ctx.save();
  ctx.translate(0, 0);
  leg(ctx, -0.3 - swing * 0.09, Math.max(0, swing) * 0.07, shadow);
  leg(ctx, 0.06 + swing * 0.09, Math.max(0, -swing) * 0.07, color);
  ctx.restore();
  ctx.save();
  ctx.translate(0, bob);
  shade(ctx, color, shadow);
  visor(ctx);
  ctx.restore();
}

export function drawGhost(ctx, color, shadow, t = 0) {
  ctx.lineWidth = 0.07;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  backpack(ctx, color, shadow);
  ctx.beginPath();
  ctx.moveTo(-0.37, -0.75);
  ctx.quadraticCurveTo(-0.37, -1.22, 0.01, -1.22);
  ctx.quadraticCurveTo(0.39, -1.22, 0.39, -0.75);
  ctx.lineTo(0.39, -0.35);
  for (let i = 0; i <= 4; i++) {
    const x = 0.39 - (i / 4) * 0.76;
    const y = -0.32 + Math.sin(t * 6 + i * 1.7) * 0.05 + (i % 2 ? 0.08 : -0.02);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  visor(ctx);
}

export function drawBody(ctx, color, shadow) {
  ctx.lineWidth = 0.075;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  leg(ctx, -0.3, 0, shadow);
  leg(ctx, 0.06, 0, color);
  // Lower half of the bean.
  ctx.beginPath();
  ctx.moveTo(-0.37, -0.62);
  ctx.lineTo(-0.37, -0.36);
  ctx.quadraticCurveTo(-0.37, -0.24, -0.24, -0.24);
  ctx.lineTo(0.26, -0.24);
  ctx.quadraticCurveTo(0.39, -0.24, 0.39, -0.36);
  ctx.lineTo(0.39, -0.62);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.stroke();
  // Cut, bone.
  ctx.beginPath();
  ctx.ellipse(0.01, -0.62, 0.38, 0.1, 0, 0, Math.PI * 2);
  ctx.fillStyle = shadow;
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BONE;
  ctx.beginPath();
  ctx.roundRect(-0.04, -0.98, 0.1, 0.38, 0.03);
  ctx.fill();
  ctx.stroke();
  for (const dx of [-0.05, 0.07]) {
    ctx.beginPath();
    ctx.arc(dx, -0.98, 0.07, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** Bitmap cache keyed by look; rebuilt when the zoom changes. */
export class SpriteCache {
  constructor() {
    this.scale = 0;
    this.map = new Map();
  }

  setScale(s) {
    s = Math.round(s * 4) / 4;
    if (s !== this.scale) {
      this.scale = s;
      this.map.clear();
    }
  }

  get(key, color, shadow, draw) {
    let c = this.map.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.ceil(W * this.scale);
      c.height = Math.ceil(H * this.scale);
      const ctx = c.getContext('2d');
      ctx.scale(this.scale, this.scale);
      ctx.translate(OX, OY);
      draw(ctx, color, shadow);
      this.map.set(key, c);
    }
    return c;
  }

  /** Blit at screen position of the feet. facing: 1 right, -1 left. */
  blit(ctx, bmp, sx, sy, facing, ppc, alpha = 1) {
    const k = ppc / this.scale;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.scale(facing * k, k);
    ctx.drawImage(bmp, -OX * this.scale, -OY * this.scale);
    ctx.restore();
  }

  crewmate(p, frame) {
    return this.get(`c${p.colorIndex}:${frame}`, p.color, p.shadow, (c, a, b) => drawCrewmate(c, a, b, frame));
  }

  body(b, colorIndex) {
    return this.get(`b${colorIndex}`, b.color, b.shadow, drawBody);
  }
}
