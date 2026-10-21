// Procedural character art: crewmates, ghosts and bodies, cached as bitmaps per scale.
// Units are map cells with the feet at (0, 0) and the character facing right.

import { DIST } from './config.js';
import { drawHat, drawSkinTorso, drawSkinLeg, drawVisorAcc, drawPet } from './cosmetics.js';

const INK = '#07090c';
const K = DIST.char;
const VISOR = '#93c8db';
const VISOR_DARK = '#4f8aa2';
const BONE = '#f3efe2';

// Bitmap boxes in cells, with the feet's position inside: characters, and hats (which reach higher).
const BOX = { W: 1.7, H: 1.85, OX: 0.85, OY: 1.65 };
const BIG = { W: 2.4, H: 2.9, OX: 1.2, OY: 2.45 };

// The walk: 12 frames per two steps. Legs swing from the hips like pendulums; the planted foot
// stays on the floor, the swinging one lifts, and the body bounces up as the legs pass and
// leans into the walk.
export const WALK_FRAMES = 12;
export const WALK_FPS = 24;
const HIP_Y = -0.3;
const LEG_LEN = 0.3;
const HIPS = [-0.16, 0.2]; // back (far) leg, front (near) leg
const SWING = 0.5; // radians either way

/**
 * Pose for a walk frame (-1 = standing): body bob (cells, + = down), lean (radians), and per leg
 * its swing `a` (foot forward when > 0) and length `len`.
 */
export function walkPose(frame) {
  if (frame < 0)
    return {
      bob: 0,
      tilt: 0,
      legs: [
        { a: 0, len: LEG_LEN },
        { a: 0, len: LEG_LEN },
      ],
    };
  const ph = (frame / WALK_FRAMES) * Math.PI * 2;
  const s = Math.sin(ph);
  const c = Math.cos(ph);
  // The body rises as the legs pass under it and dips as they spread.
  const bob = -0.035 * Math.abs(c) + 0.02 * Math.abs(s);
  const reach = -(HIP_Y + bob); // hip height above the floor
  // The planted leg stretches to keep its foot on the floor; the other one lifts and kicks back.
  // Each leg keeps a little to its own side (back leg behind, front leg ahead) so they don't scissor.
  const legs = [-1, 1].map((dir) => {
    const lift = Math.max(0, dir * c) * 0.09;
    const swing = dir * SWING * s + dir * 0.1;
    return { a: swing - lift * 2.6, len: reach / Math.cos(swing) - lift };
  });
  const tilt = 0.075 + 0.03 * Math.sin(ph * 2 + 0.6);
  return { bob, tilt, legs };
}

/** Move ctx into the body's frame for a pose (lean pivots at the hips). */
export function poseBody(ctx, pose) {
  ctx.translate(0, pose.bob + HIP_Y);
  ctx.rotate(pose.tilt);
  ctx.translate(0, -HIP_Y);
}

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

/** One leg hanging from its hip, swung by `a` (foot forward when > 0), `len` long. */
function leg(ctx, hx, a, len, color, shadow, front, skin, y0 = HIP_Y) {
  ctx.save();
  ctx.translate(hx, y0);
  ctx.rotate(-a);
  const path = () => {
    ctx.beginPath();
    ctx.roundRect(-0.14, -0.08, 0.28, len + 0.08, [0.04, 0.04, 0.13, 0.13]);
  };
  path();
  ctx.fillStyle = front ? color : shadow;
  ctx.fill();
  if (skin && skin !== 'none') {
    ctx.save();
    path();
    ctx.clip();
    drawSkinLeg(ctx, skin, color, shadow, front, len);
    ctx.restore();
  }
  path();
  ctx.stroke();
  ctx.restore();
}

function shade(ctx, color, shadow, skin) {
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
  if (skin && skin !== 'none') drawSkinTorso(ctx, skin, color, shadow);
  ctx.restore();
  bodyPath(ctx);
  ctx.stroke();
}

/**
 * The glass visor. fwd (0..1) is how far it has turned toward the facing side (1 = profile,
 * the classic look; 0 = turned toward the camera); up (-1..1) tilts it, negative = up.
 * It slides around the helmet like a band on a sphere and foreshortens as it tilts.
 */
export function drawVisor(ctx, fwd = 1, up = 0) {
  const w = 0.5 + 0.02 * fwd;
  const h = 0.31 * (1 - 0.2 * Math.abs(up));
  const cx = -0.03 + 0.29 * fwd;
  const cy = -0.865 + up * 0.13;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const shape = () => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
  };
  shape();
  ctx.fillStyle = VISOR;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // Darker lower glass; more of it shows when looking down.
  ctx.fillStyle = VISOR_DARK;
  ctx.fillRect(x - 0.05, cy + h * (0.08 - up * 0.18), w + 0.1, h);
  // The reflection drifts a little against the turn, like light on curved glass.
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.roundRect(cx + w * 0.02 + (1 - fwd) * 0.05, y + h * 0.16 - up * 0.02, 0.18, 0.07, 0.035);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.beginPath();
  ctx.arc(cx + w * 0.36 + (1 - fwd) * 0.04, y + h * 0.3, 0.025, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  shape();
  ctx.stroke();
}

function visor(ctx) {
  drawVisor(ctx, 1, 0);
}

function ink(ctx) {
  ctx.lineWidth = 0.075;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
}

/**
 * Draw a living crewmate. frame: walk frame index or -1 for idle. withVisor=false leaves the
 * visor (and anything worn over it or on the head) to the caller.
 */
export function drawCrewmate(ctx, color, shadow, frame = -1, withVisor = true, skin = 'none') {
  ink(ctx);
  const pose = walkPose(frame);
  ctx.save();
  poseBody(ctx, pose);
  backpack(ctx, color, shadow);
  ctx.restore();
  ctx.save();
  ctx.translate(0, pose.bob);
  leg(ctx, HIPS[0], pose.legs[0].a, pose.legs[0].len, color, shadow, false, skin);
  leg(ctx, HIPS[1], pose.legs[1].a, pose.legs[1].len, color, shadow, true, skin);
  ctx.restore();
  ctx.save();
  poseBody(ctx, pose);
  shade(ctx, color, shadow, skin);
  if (withVisor) visor(ctx);
  ctx.restore();
}

/**
 * A whole character with its outfit, drawn in one go (menus, meetings, cutscenes).
 * look: { color, shadow, outfit?: { hat, visor, skin } }; kind: 'alive' | 'ghost' | 'body'.
 */
export function drawCharacter(ctx, look, { kind = 'alive', frame = -1, fwd = 1, up = 0, t = 0 } = {}) {
  const o = look.outfit || {};
  const hat = o.hat && o.hat !== 'none' ? o.hat : null;
  if (kind === 'body') return drawBody(ctx, look.color, look.shadow, o.skin);
  const pose = walkPose(kind === 'alive' ? frame : -1);
  if (hat) {
    ctx.save();
    poseBody(ctx, pose);
    ink(ctx);
    drawHat(ctx, hat, 'back');
    ctx.restore();
  }
  if (kind === 'ghost') drawGhost(ctx, look.color, look.shadow, t);
  else drawCrewmate(ctx, look.color, look.shadow, frame, false, o.skin);
  ctx.save();
  poseBody(ctx, pose);
  ink(ctx);
  if (kind !== 'ghost') {
    drawVisor(ctx, fwd, up);
    if (o.visor && o.visor !== 'none') drawVisorAcc(ctx, o.visor, fwd, up);
  }
  if (hat) {
    ink(ctx);
    drawHat(ctx, hat, 'front');
  }
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

export function drawBody(ctx, color, shadow, skin = 'none') {
  ink(ctx);
  leg(ctx, HIPS[0], 0, LEG_LEN, color, shadow, false, skin);
  leg(ctx, HIPS[1], 0, LEG_LEN, color, shadow, true, skin);
  // Lower half of the bean.
  const half = () => {
    ctx.beginPath();
    ctx.moveTo(-0.37, -0.62);
    ctx.lineTo(-0.37, -0.36);
    ctx.quadraticCurveTo(-0.37, -0.24, -0.24, -0.24);
    ctx.lineTo(0.26, -0.24);
    ctx.quadraticCurveTo(0.39, -0.24, 0.39, -0.36);
    ctx.lineTo(0.39, -0.62);
    ctx.closePath();
  };
  half();
  ctx.fillStyle = color;
  ctx.fill();
  if (skin && skin !== 'none') {
    ctx.save();
    half();
    ctx.clip();
    drawSkinTorso(ctx, skin, color, shadow);
    ctx.restore();
  }
  half();
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

/** Bitmap cache keyed by look; rebuilt when the zoom changes. Characters are drawn K times map scale. */
export class SpriteCache {
  constructor() {
    this.scale = 0;
    this.map = new Map();
  }

  setScale(ppc) {
    const s = Math.round(ppc * K * 4) / 4;
    if (s !== this.scale) {
      this.scale = s;
      this.map.clear();
    }
  }

  /** A cached bitmap; box: BOX for characters, BIG for hats. */
  get(key, color, shadow, draw, box = BOX) {
    let c = this.map.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = Math.ceil(box.W * this.scale);
      c.height = Math.ceil(box.H * this.scale);
      c.box = box;
      const ctx = c.getContext('2d');
      ctx.scale(this.scale, this.scale);
      ctx.translate(box.OX, box.OY);
      draw(ctx, color, shadow);
      this.map.set(key, c);
    }
    return c;
  }

  /** Blit at screen position of the feet. facing: 1 right, -1 left. pose: lean and bob like a body. */
  blit(ctx, bmp, sx, sy, facing, ppc, alpha = 1, pose = null) {
    const k = (ppc * K) / this.scale;
    const box = bmp.box || BOX;
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.translate(sx, sy);
    ctx.scale(facing * k, k);
    if (pose) {
      ctx.scale(this.scale, this.scale);
      poseBody(ctx, pose);
      ctx.scale(1 / this.scale, 1 / this.scale);
    }
    ctx.drawImage(bmp, -box.OX * this.scale, -box.OY * this.scale);
    ctx.restore();
  }

  crewmate(p, frame, withVisor = true) {
    const skin = p.outfit?.skin || 'none';
    const key = `c${p.colorIndex}:${frame}:${skin}${withVisor ? '' : ':nv'}`;
    return this.get(key, p.color, p.shadow, (c, a, b) => drawCrewmate(c, a, b, frame, withVisor, skin));
  }

  /** A hat layer ('back' or 'front'), or null for no hat. */
  hat(id, layer) {
    if (!id || id === 'none') return null;
    return this.get(
      `h${id}:${layer}`,
      null,
      null,
      (c) => {
        ink(c);
        drawHat(c, id, layer);
      },
      BIG,
    );
  }

  pet(id, frame) {
    return this.get(`p${id}:${frame}`, null, null, (c) => {
      ink(c);
      drawPet(c, id, frame);
    });
  }

  /** Draw the visor (and any accessory over it) live at a character's feet (screen px), matching blit. */
  visor(ctx, sx, sy, facing, ppc, fwd, up, frame, acc = 'none') {
    const k = ppc * K;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(facing * k, k);
    poseBody(ctx, walkPose(frame));
    ink(ctx);
    drawVisor(ctx, fwd, up);
    if (acc && acc !== 'none') {
      ink(ctx);
      drawVisorAcc(ctx, acc, fwd, up);
    }
    ctx.restore();
  }

  body(b, colorIndex, skin = 'none') {
    return this.get(`b${colorIndex}:${skin}`, b.color, b.shadow, (c, a, s) => drawBody(c, a, s, skin));
  }
}
