// Procedural mob / player / armor / shield textures (original pixel art in the style of
// Minecraft Java 1.14+ entity skins). Every texture uses Minecraft's cuboid ("box UV")
// unwrapping: a box W x H x D at texture offset (u, v) occupies a (2D+2W) x (D+H) region:
//   top    [u+D,     u+D+W)    x [v, v+D)        (row v+D-1 touches the front face)
//   bottom [u+D+W,   u+D+2W)   x [v, v+D)        (row v touches the front face)
//   right  [u,       u+D)      x [v+D, v+D+H)    (creature's own right side)
//   front  [u+D,     u+D+W)    x [v+D, v+D+H)
//   left   [u+D+W,   u+2D+W)   x [v+D, v+D+H)
//   back   [u+2D+W,  u+2D+2W)  x [v+D, v+D+H)
// Pure JS, deterministic, no DOM.
import { drawOriginalSkin } from './originalSkins.js';
import { PixelCanvas, mix, toRGBA } from './pixel.js';
import { hashFloat } from '../util/rng.js';
import { Noise } from '../util/noise.js';

// ---------------------------------------------------------------------------------------------
// Box helpers
// ---------------------------------------------------------------------------------------------

const FACES = ['top', 'bottom', 'right', 'front', 'left', 'back'];
// Gentle baked shading (the engine adds its own directional light on top).
const FACE_LIGHT = { top: 1.06, bottom: 0.82, front: 1.0, right: 0.95, left: 0.95, back: 0.91 };

/** Texture rectangles of the six faces of a box. */
export function boxRegions(u, v, W, H, D) {
  return {
    top: { x: u + D, y: v, w: W, h: D },
    bottom: { x: u + D + W, y: v, w: W, h: D },
    right: { x: u, y: v + D, w: D, h: H },
    front: { x: u + D, y: v + D, w: W, h: H },
    left: { x: u + D + W, y: v + D, w: D, h: H },
    back: { x: u + 2 * D + W, y: v + D, w: W, h: H },
  };
}

// Face texel (i, j) -> integer voxel (x, y, z) of the box it lies on.
// x: 0 = creature's right .. W-1 = left, y: 0 = bottom .. H-1 = top, z: 0 = back .. D-1 = front.
// Corner voxels are shared by adjacent faces, so a voxel "shader" wraps seamlessly around edges.
function voxelOf(face, i, j, W, H, D) {
  switch (face) {
    case 'front': return [i, H - 1 - j, D - 1];
    case 'back': return [W - 1 - i, H - 1 - j, 0];
    case 'right': return [0, H - 1 - j, i];
    case 'left': return [W - 1, H - 1 - j, D - 1 - i];
    case 'top': return [i, H - 1, j];
    default: return [i, 0, D - 1 - j]; // bottom
  }
}

/**
 * Paint every texel of a box. fn(p) returns a colour (or null to leave the texel untouched).
 * p = { face, i, j, fw, fh, x, y, z, jt, W, H, D } where (i, j) are face-local texel coords,
 * (x, y, z) the voxel and jt = rows from the top of the box (H-1-y).
 */
function paintBox(c, u, v, W, H, D, fn, { light = true, faces = FACES } = {}) {
  const R = boxRegions(u, v, W, H, D);
  for (const face of faces) {
    const r = R[face];
    const f = light ? FACE_LIGHT[face] : 1;
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        const [x, y, z] = voxelOf(face, i, j, W, H, D);
        const col = fn({ face, i, j, fw: r.w, fh: r.h, x, y, z, jt: H - 1 - y, W, H, D });
        if (col == null) continue;
        const k = toRGBA(col);
        if (k[3] === 0) continue;
        c.set(r.x + i, r.y + j, [k[0] * f, k[1] * f, k[2] * f, k[3]]);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------------------------

const P = (...hex) => hex.map((h) => toRGBA(h));
const C = (hex) => toRGBA(hex);
/** Pick from a dark->light palette with t in [0, 1] (0.5 ~ middle entry). */
function tone(pal, t) {
  let k = Math.floor(t * pal.length);
  if (k < 0) k = 0; else if (k >= pal.length) k = pal.length - 1;
  return pal[k];
}
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}
const rnd = (seed, x, y, z) => hashFloat(x | 0, y | 0, z | 0, seed | 0);
const tint = (c, t, amt) => mix(c, t, amt);

// ---------------------------------------------------------------------------------------------
// Player (original "adventurer" default skin) — 64x64 humanoid layout
// ---------------------------------------------------------------------------------------------

function drawPlayer(c) {
  const seed = seedOf('player');
  const nz = new Noise(seed);
  const SKIN = P('#A1674A', '#C0825F', '#D79C77', '#E8B18B', '#F4C6A1');
  const HAIR = P('#1B1008', '#2B1A0D', '#3C2614', '#50331D', '#664428');
  const TUNIC = P('#2E3B17', '#3E4F20', '#50662A', '#637C34', '#789341');
  const TROUS = P('#1B1816', '#25211E', '#312B27', '#3D3631', '#4B423A');
  const BOOT = P('#2E2721', '#443A32', '#5A4F45', '#706459', '#86796B');
  const BELT = P('#331E0E', '#4B2E18', '#654023', '#80532D', '#9A6A3E');
  const BRASS = P('#8A6A1E', '#C29A36', '#EAC65E');
  const EYE_W = C('#F3F3F3'), IRIS = C('#3A69B2'), MOUTH = C('#8E4F3B');

  const skin = (x, y, z, b = 0) => tone(SKIN, 0.68 + b + nz.noise3(x * 0.5, y * 0.5, z * 0.5) * 0.07
    + (rnd(seed, x, y, z) - 0.5) * 0.1);
  // strands: noise stretched along the hair flow (down the sides, front-to-back on top)
  const hair = (x, y, z, b = 0) => tone(HAIR, 0.5 + b + nz.noise3(x * 0.9 + 40, y * 0.22, z * (y === 7 ? 0.25 : 0.9)) * 0.34
    + (rnd(seed + 1, x, y, z) - 0.5) * 0.2);

  // ---- head (0,0) 8x8x8 ----
  const FACE = [
    'HHHHHHHH',
    'HHHHHHHH',
    'HHHsHHsH',
    'HBBssBBH',
    'sWEssEWs',
    'srsnnsrs',
    'sssmmsss',
    'ssssssss',
  ];
  // hair on the side faces reaches down to row SIDE[z] (z: 0 back .. 7 front)
  const SIDE = [7, 6, 6, 5, 3, 4, 3, 3];
  paintBox(c, 0, 0, 8, 8, 8, ({ x, y, z }) => {
    const jt = 7 - y;
    if (z === 7) { // face
      const ch = FACE[jt][x];
      if (ch === 'H') return hair(x, y, z, jt === 2 ? 0.12 : 0.04);
      if (ch === 'B') return HAIR[1];
      if (ch === 'W') return EYE_W;
      if (ch === 'E') return IRIS;
      if (ch === 'n') return skin(x, y, z, -0.22);
      if (ch === 'r') return tint(skin(x, y, z), '#E0806E', 0.22);
      if (ch === 'm') return MOUTH;
      return skin(x, y, z, jt === 7 ? -0.06 : 0);
    }
    if (y === 7) return hair(x, y, z, 0.08);
    if (z === 0) return (jt <= 6 || x % 3 !== 1) ? hair(x, y, z, -0.04) : skin(x, y, z, -0.2);
    if (x === 0 || x === 7) {
      if (jt <= SIDE[z]) return hair(x, y, z);
      if (z === 4 && (jt === 4 || jt === 5)) return skin(x, y, z, jt === 5 ? -0.34 : -0.18); // ear
      return skin(x, y, z, -0.06);
    }
    // underside
    return z <= 2 ? hair(x, y, z, -0.15) : skin(x, y, z, -0.2);
  });

  // ---- hat / hair overlay (32,0): sparse tufts ----
  paintBox(c, 32, 0, 8, 8, 8, ({ face, x, y, z, i, jt }) => {
    const r = rnd(seed + 7, x, y, z);
    if (face === 'bottom') return null;
    if (face === 'top') return (r > 0.7 || (z >= 5 && x >= 2 && x <= 4 && r > 0.35)) ? hair(x, y, z, 0.18) : null;
    if (face === 'front') {
      if (jt === 0 && r > 0.35) return hair(x, y, z, 0.12);
      if (jt === 1 && (i === 0 || i === 4 || i === 5)) return hair(x, y, z, 0.05);
      if (jt === 2 && i === 5) return hair(x, y, z, 0.1);
      return null;
    }
    if (face === 'back') return ((jt === 7 && r > 0.45) || (jt <= 1 && r > 0.55)) ? hair(x, y, z) : null;
    // sides: tufts over the ears
    if (jt <= 1 && r > 0.55) return hair(x, y, z, 0.08);
    if (jt === 2 && z <= 3 && r > 0.6) return hair(x, y, z);
    return null;
  });

  const clothNoise = (x, y, z, s) => nz.noise3(x * 0.6 + s, y * 0.6, z * 0.6) * 0.12 + (rnd(seed + s, x, y, z) - 0.5) * 0.18;

  // ---- body (16,16) 8x12x4: tunic, belt with buckle, hip pouch ----
  paintBox(c, 16, 16, 8, 12, 4, ({ face, x, y, z }) => {
    const jt = 11 - y;
    const n = clothNoise(x, y, z, 3);
    const front = z === 3 && face !== 'top' && face !== 'bottom';
    if (face === 'top' && x >= 2 && x <= 5 && z >= 1 && z <= 2) return TUNIC[0]; // collar inside
    if (front && jt === 0 && (x === 3 || x === 4)) return skin(x, y, z, -0.04);
    if (front && ((jt === 0 && (x === 2 || x === 5)) || (jt === 1 && (x === 3 || x === 4)))) return TUNIC[0];
    if (front && jt === 2 && (x === 3 || x === 4)) return TUNIC[1]; // lacing
    if (jt === 9) {
      if (front && x === 3) return BRASS[2];
      if (front && x === 4) return BRASS[1];
      return tone(BELT, 0.5 + n + (face === 'top' ? 0.2 : 0));
    }
    if (x === 7 && z >= 1 && z <= 2 && jt >= 10) return tone(BELT, jt === 10 ? 0.85 : 0.62 + n); // pouch
    let t = 0.56 + n - jt * 0.012;
    if (front && jt >= 3 && jt <= 8 && (x === 1 || x === 6)) t -= 0.13; // folds
    if (face === 'back' && jt >= 2 && jt <= 7 && (x === 2 || x === 5)) t -= 0.1;
    if (jt >= 10) t -= 0.07;
    if (jt === 11) t -= 0.12;
    if (face === 'bottom') t -= 0.1;
    return tone(TUNIC, t);
  });

  // ---- arms: rolled sleeves, forearm, leather bracer, hand ----
  const arm = (u, v, isLeft) => paintBox(c, u, v, 4, 12, 4, ({ face, x, y, z }) => {
    const jt = 11 - y;
    const inner = (isLeft ? x === 0 : x === 3) && face !== 'top' && face !== 'bottom' ? -0.1 : 0;
    const n = clothNoise(x, y, z, isLeft ? 11 : 12);
    if (jt <= 3) return tone(TUNIC, 0.58 + n + inner + (jt === 0 ? 0.06 : 0));
    if (jt === 4) return tone(TUNIC, 0.84 + n * 0.5 + inner);
    if (jt <= 7) return skin(x, y, z, inner + (jt === 5 ? -0.08 : 0));
    if (jt <= 9) {
      if (z === 3 && jt === 8 && (x === 1 || x === 2)) return BELT[4];
      return tone(BELT, 0.5 + n + inner + (jt === 9 ? -0.1 : 0));
    }
    return skin(x, y, z, inner + (jt === 11 ? -0.1 : -0.02));
  });
  arm(40, 16, false);
  arm(32, 48, true);

  // ---- legs: trousers + boots ----
  const leg = (u, v, isLeft) => paintBox(c, u, v, 4, 12, 4, ({ face, x, y, z }) => {
    const jt = 11 - y;
    const inner = (isLeft ? x === 0 : x === 3) && face !== 'top' && face !== 'bottom' ? -0.12 : 0;
    const n = clothNoise(x, y, z, isLeft ? 21 : 22);
    if (jt <= 6) {
      if (isLeft && z === 3 && jt >= 3 && jt <= 4 && x >= 1 && x <= 2) return (x + jt) % 2 ? TROUS[4] : TROUS[3]; // knee patch
      const seam = (isLeft ? x === 3 : x === 0) && (z === 1 || z === 2) ? -0.1 : 0;
      return tone(TROUS, 0.56 + n + inner + seam - (jt === 6 ? 0.08 : 0));
    }
    if (jt === 7) return tone(BOOT, 0.86 + n * 0.5 + inner);
    if (jt <= 10) {
      if (z === 3 && jt === 8 && (x === 1 || x === 2)) return BOOT[4]; // laces
      return tone(BOOT, 0.5 + n + inner + (jt === 10 ? -0.08 : 0));
    }
    return tone(BOOT, 0.02);
  });
  leg(0, 16, false);
  leg(16, 48, true);
}

// ---------------------------------------------------------------------------------------------
// Zombie — 64x64 humanoid layout
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Skeleton — 64x32
// ---------------------------------------------------------------------------------------------

function drawSkeleton(c) {
  const seed = seedOf('skeleton');
  const nz = new Noise(seed);
  const BONE = P('#6A6A6A', '#8F8F8F', '#ABABAB', '#C3C3C3', '#D6D6D6', '#E6E6E6', '#F4F4F4');
  const HOLE1 = C('#141414'), HOLE2 = C('#2B2B2B'), HOLE3 = C('#444444');
  const bone = (x, y, z, b = 0, s = 0) => tone(BONE, 0.64 + b + nz.noise3(x * 0.45 + s, y * 0.45, z * 0.45) * 0.14
    + (rnd(seed + s, x, y, z) - 0.5) * 0.14);

  const FACE = [
    'bbbbbbbb',
    'bbbbbbbb',
    'bllbblll',
    'bOObbOOb',
    'bOoboOOb',
    'bbbNNbbb',
    'bTdTTdTb',
    'bbbbbbbb',
  ];
  paintBox(c, 0, 0, 8, 8, 8, ({ face, x, y, z }) => {
    const jt = 7 - y;
    if (z === 7) {
      const ch = FACE[jt][x];
      if (ch === 'O') return jt === 3 ? HOLE2 : HOLE1;
      if (ch === 'o') return HOLE3;
      if (ch === 'N') return x === 3 ? HOLE2 : HOLE3;
      if (ch === 'd') return HOLE2;
      if (ch === 'T') return BONE[5];
      if (ch === 'l') return bone(x, y, z, 0.1);
      return bone(x, y, z, jt === 7 ? -0.14 : 0);
    }
    if (face !== 'top' && (x === 0 || x === 7) && z === 6 && (jt === 3 || jt === 4)) return BONE[1]; // temple
    if ((x === 0 || x === 7) && z === 3 && jt === 6) return BONE[1]; // jaw hinge
    if (face === 'top' && ((x === 5 && z === 2) || (x === 5 && z === 3) || (x === 4 && z === 4))) return BONE[2]; // crack
    return bone(x, y, z, y === 0 ? -0.18 : 0);
  });

  // ---- ribcage (16,16) 8x12x4 with see-through gaps ----
  paintBox(c, 16, 16, 8, 12, 4, ({ face, x, y, z }) => {
    const jt = 11 - y;
    const spine = (x === 3 || x === 4) && (face === 'front' || face === 'back' || face === 'top' || face === 'bottom');
    if (face === 'top') return bone(x, y, z, 0.06);
    if (face === 'bottom') return (x === 0 || x === 7 || spine || z === 0 || z === 3) ? bone(x, y, z, -0.12) : HOLE2;
    if (jt === 0) return bone(x, y, z, 0.04); // collar bones
    if (jt >= 10) { // pelvis
      if (face === 'front' && jt === 11 && (x === 2 || x === 5)) return HOLE2;
      return bone(x, y, z, jt === 11 ? -0.12 : -0.04);
    }
    if (spine) return bone(x, y, z, (jt % 2 ? -0.1 : 0.04) + (face === 'back' ? -0.04 : 0), 5);
    if (jt === 2 || jt === 4 || jt === 6) {
      const edge = face === 'front' && (x === 2 || x === 5) ? -0.08 : 0;
      return bone(x, y, z, edge - (jt - 2) * 0.03);
    }
    return null; // gap between ribs
  });

  // ---- arm (40,16) & leg (0,16): 2x12x2 bones with joints ----
  const limb = (u, v, isArm) => paintBox(c, u, v, 2, 12, 2, ({ face, x, y, z, i }) => {
    const jt = 11 - y;
    let b = 0;
    if (jt === 0) b += 0.06;
    if (jt === 5 || jt === 6) b += 0.08; // elbow / knee knob
    if (jt === 4 || jt === 7) b -= 0.08;
    if (isArm && jt >= 10) {
      if (face !== 'top' && face !== 'bottom' && jt === 11 && i === 1) return HOLE3;
      b -= 0.05;
    }
    if (!isArm && jt === 10) b -= 0.12;
    if (face === 'bottom') b -= 0.15;
    if (face === 'right' || face === 'back') b -= 0.05;
    return bone(x, y, z, b, isArm ? 30 : 40);
  });
  limb(40, 16, true);
  limb(0, 16, false);
}

// ---------------------------------------------------------------------------------------------
// Creeper — 64x32
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Spider — 64x32
// ---------------------------------------------------------------------------------------------

function drawSpider(c) {
  const seed = seedOf('spider');
  const nz = new Noise(seed);
  const FUR = P('#120F0C', '#1B1713', '#241E19', '#2E2620', '#382F27', '#453A30', '#54473B');
  const MARK = P('#4A3B2E', '#5C4A39', '#6E5946');
  const EYE = P('#760A0F', '#B8141C', '#E2262B', '#FF7766');
  const fur = (x, y, z, b = 0, s = 0) => {
    const r = rnd(seed + s, x, y, z);
    const t = 0.45 + b + nz.noise3(x * 0.6 + s * 7, y * 0.6, z * 0.6) * 0.2 + (r - 0.5) * 0.36;
    return tone(FUR, r > 0.955 ? t + 0.2 : t); // occasional light bristle
  };

  // ---- head (32,4) 8x8x8 ----
  const FACE = [
    'hhhhhhhh',
    'hhehhehh',
    'hhhhhhhh',
    'eRRhhRRe',
    'hRRhhRRh',
    'hhhhhhhh',
    'hhhhhhhh',
    'hhhmmhhh',
  ];
  paintBox(c, 32, 4, 8, 8, 8, ({ face, x, y, z }) => {
    const jt = 7 - y;
    if (face === 'front') {
      const ch = FACE[jt][x];
      if (ch === 'R') {
        const tl = (x === 1 || x === 5) && jt === 3;
        const br = (x === 2 || x === 6) && jt === 4;
        return tl ? EYE[3] : br ? EYE[0] : EYE[2];
      }
      if (ch === 'e') return EYE[1];
      if (ch === 'm') return FUR[0];
    }
    return fur(x, y, z, face === 'top' ? 0.06 : face === 'bottom' ? -0.12 : 0, 1);
  });
  // ---- neck (0,0) 6x6x6 ----
  paintBox(c, 0, 0, 6, 6, 6, ({ face, x, y, z }) => fur(x, y, z, face === 'bottom' ? -0.1 : -0.02, 2));
  // ---- abdomen (0,12) 10x8x12: markings along the back ----
  paintBox(c, 0, 12, 10, 8, 12, ({ face, x, y, z }) => {
    const dx = Math.abs(x - 4.5);
    if (face === 'top') {
      // chevron markings pointing to the front (z = 11) plus a spine stripe
      const zz = z - 1;
      const chev = zz >= 0 && zz <= 9 && dx < 4 && ((zz + Math.floor(dx)) % 4 === 0);
      if (chev && dx >= 1) return tone(MARK, 0.3 + rnd(seed + 5, x, y, z) * 0.7);
      if (dx < 1 && z >= 2 && z <= 10 && z % 2 === 0) return MARK[0];
    }
    if ((face === 'right' || face === 'left') && y === 5 && z % 3 === 1) return MARK[0];
    const b = face === 'top' ? 0.05 : face === 'bottom' ? -0.14 : -(7 - y) * 0.015;
    return fur(x, y, z, b, 3);
  });
  // ---- leg (18,0) 16x2x2: long hairy leg with joints ----
  paintBox(c, 18, 0, 16, 2, 2, ({ face, x, y, z }) => {
    let b = 0;
    if (x === 5 || x === 10) b -= 0.18; // joints
    if (x === 0 || x === 15) b -= 0.22;
    if (face === 'top') b += 0.05;
    if (face === 'bottom') b -= 0.08;
    return fur(x, y, z, b, 4);
  });
}

// ---------------------------------------------------------------------------------------------
// Pig — 64x64
// ---------------------------------------------------------------------------------------------

function drawPig(c) {
  const seed = seedOf('pig');
  const nz = new Noise(seed);
  const PINK = P('#B45C5A', '#CF7874', '#E28C87', '#ED9E99', '#F4B0AB', '#F9C4C0');
  const HOOF = P('#6E4543', '#86544F', '#9A625D');
  const pink = (x, y, z, b = 0, s = 0) => tone(PINK, 0.6 + b + nz.noise3(x * 0.4 + s * 9, y * 0.4, z * 0.4) * 0.08
    + (rnd(seed + s, x, y, z) - 0.5) * 0.14);

  const FACE = [
    'pppppppp',
    'pppppppp',
    'pppppppp',
    'pWKppKWp',
    'pppppppp',
    'pppppppp',
    'pppppppp',
    'ppmmmmpp',
  ];
  paintBox(c, 0, 0, 8, 8, 8, ({ face, x, y, z }) => {
    const jt = 7 - y;
    if (z === 7 && face !== 'top' && face !== 'bottom') {
      const ch = FACE[jt][x];
      if (ch === 'W') return C('#F4F4F4');
      if (ch === 'K') return C('#1A1414');
      if (ch === 'm') return PINK[2];
      if (jt === 2 && (x === 1 || x === 2 || x === 5 || x === 6)) return pink(x, y, z, 0.14); // brow
    }
    return pink(x, y, z, face === 'top' ? 0.06 : face === 'bottom' ? -0.18 : 0, 1);
  });
  // snout (16,16) 4x3x1
  paintBox(c, 16, 16, 4, 3, 1, ({ face, x, y }) => {
    const jt = 2 - y;
    if (face === 'front') {
      if (jt === 1 && (x === 0 || x === 3)) return C('#6E3432');
      if (jt === 0) return C('#FBD2CE');
      if (jt === 2) return PINK[4];
      return PINK[5];
    }
    return face === 'bottom' ? PINK[1] : face === 'top' ? PINK[4] : PINK[2];
  });
  // legs (0,16) 4x6x4 with darker hooves
  paintBox(c, 0, 16, 4, 6, 4, ({ face, x, y, z }) => {
    const jt = 5 - y;
    if (face === 'bottom') return (x === 1 || x === 2) && z >= 2 ? HOOF[0] : HOOF[1];
    if (jt === 5) return HOOF[(x + z) % 2 ? 1 : 2];
    return pink(x, y, z, jt === 4 ? -0.1 : -0.02, 2);
  });
  // body (0,32) 10x8x16
  paintBox(c, 0, 32, 10, 8, 16, ({ face, x, y, z }) => {
    const jt = 7 - y;
    if (face === 'back') { // curly tail on the rump
      if ((x === 5 && (jt === 1 || jt === 3)) || (x === 4 && jt === 2) || (x === 6 && jt === 2)) return PINK[1];
      if (x === 5 && jt === 2) return PINK[4];
    }
    let b = -jt * 0.018;
    if (face === 'top' && (x === 4 || x === 5)) b += 0.08;
    if (face === 'bottom') b -= 0.12;
    return pink(x, y, z, b, 3);
  });
}

// ---------------------------------------------------------------------------------------------
// Cow — 64x64
// ---------------------------------------------------------------------------------------------

function drawCow(c) {
  const seed = seedOf('cow');
  const nz = new Noise(seed);
  const BROWN = P('#1D140D', '#291D13', '#36271A', '#433122', '#533D2A', '#654B34');
  const WHITE = P('#9E9E9E', '#BEBEBE', '#D4D4D4', '#E5E5E5', '#F3F3F3');
  const MUZZLE = P('#8C736B', '#AE948B', '#C4ABA1', '#D6C0B7');
  const brown = (x, y, z, b = 0, s = 0) => tone(BROWN, 0.55 + b + nz.noise3(x * 0.5 + s * 5, y * 0.5, z * 0.5) * 0.18
    + (rnd(seed + s, x, y, z) - 0.5) * 0.3);
  const white = (x, y, z, b = 0, s = 0) => tone(WHITE, 0.62 + b + nz.noise3(x * 0.5 + s * 5 + 40, y * 0.5, z * 0.5) * 0.14
    + (rnd(seed + s + 1, x, y, z) - 0.5) * 0.22);
  const patch = (x, y, z, s, th = 0.18) => nz.noise3(x * 0.19 + s * 31, y * 0.19, z * 0.19)
    + nz.noise3(x * 0.5 + s * 17 + 7, y * 0.5, z * 0.5) * 0.22 > th;

  // head (0,0) 8x8x6
  const FACE = [
    'bbbbbbbb',
    'bbbwwbbb',
    'bbbwwwbb',
    'bWKwwKWb',
    'bbbwwbbb',
    'bMMMMMMb',
    'bMNMMNMb',
    'bMMMMMMb',
  ];
  paintBox(c, 0, 0, 8, 8, 6, ({ face, x, y, z }) => {
    const jt = 7 - y;
    if (z === 5 && face !== 'top' && face !== 'bottom') {
      const ch = FACE[jt][x];
      if (ch === 'w') return white(x, y, z, 0.05, 1);
      if (ch === 'W') return WHITE[3];
      if (ch === 'K') return C('#0A0806');
      if (ch === 'M') return tone(MUZZLE, jt === 5 ? 0.9 : 0.55 + (rnd(seed + 2, x, y, z) - 0.5) * 0.3);
      if (ch === 'N') return C('#3E2C27');
      return brown(x, y, z, 0, 1);
    }
    if (face === 'bottom') return z >= 3 ? tone(MUZZLE, 0.3) : brown(x, y, z, -0.1, 1);
    if (face !== 'top' && z >= 4 && jt >= 5) return tone(MUZZLE, 0.35); // muzzle wraps around
    if (face === 'top' && x >= 3 && x <= 4 && z >= 4) return white(x, y, z, 0.05, 1);
    if ((x === 7 && z <= 2 && jt >= 2 && jt <= 5) || (face === 'back' && x >= 4 && jt <= 3)) return white(x, y, z, -0.05, 1);
    return brown(x, y, z, face === 'top' ? 0.06 : 0, 1);
  });
  // horn (22,0) 1x3x1
  paintBox(c, 22, 0, 1, 3, 1, ({ face, y }) => {
    const jt = 2 - y;
    if (face === 'top') return C('#EDE8DC');
    return jt === 0 ? C('#E3DDD0') : jt === 1 ? C('#CFC8B8') : C('#A9A293');
  });
  // udder (40,0) 4x1x6
  paintBox(c, 40, 0, 4, 1, 6, ({ face, x, z }) => {
    if (face === 'bottom' && (x === 0 || x === 3) && (z === 1 || z === 4)) return C('#C97C7C');
    return face === 'bottom' ? C('#E7A6A3') : C('#DC9592');
  });
  // legs (0,16) 4x12x4: brown thighs, white socks, dark hooves
  paintBox(c, 0, 16, 4, 12, 4, ({ face, x, y, z }) => {
    const jt = 11 - y;
    if (face === 'bottom' || jt === 11) return (x + z) % 3 === 0 ? C('#26221F') : C('#35302B');
    if (jt === 10) return C('#4A433C');
    if (jt >= 6 || (jt === 5 && rnd(seed + 8, x, y, z) > 0.5)) return white(x, y, z, -0.04 - (jt - 6) * 0.02, 8);
    return patch(x, y + 20, z, 2, 0.3) ? white(x, y, z, 0, 8) : brown(x, y, z, 0, 8);
  });
  // body (0,32) 12x10x18: brown hide with big white patches
  paintBox(c, 0, 32, 12, 10, 18, ({ face, x, y, z }) => {
    const jt = 9 - y;
    const b = face === 'top' ? 0.05 : face === 'bottom' ? -0.12 : -jt * 0.012;
    if (face === 'bottom' && x >= 4 && x <= 7 && z >= 3 && z <= 8) return brown(x, y, z, -0.2, 3);
    return patch(x, y, z, 3) ? white(x, y, z, b, 3) : brown(x, y, z, b, 3);
  });
}

// ---------------------------------------------------------------------------------------------
// Sheep (sheared skin) & sheep fur — 64x64
// ---------------------------------------------------------------------------------------------

function drawSheep(c) {
  const seed = seedOf('sheep');
  const nz = new Noise(seed);
  const FACE_SK = P('#9E7D66', '#B69580', '#CAAA94', '#D9BCA7', '#E6CDBA');
  const BODY = P('#958077', '#AC968C', '#BFAAA0', '#CFBBB1', '#DDCBC2');
  const face = (x, y, z, b = 0) => tone(FACE_SK, 0.62 + b + nz.noise3(x * 0.5, y * 0.5, z * 0.5) * 0.1
    + (rnd(seed, x, y, z) - 0.5) * 0.16);
  const FACE = [
    'ssssss',
    'ssssss',
    'WKssKW',
    'ssssss',
    'ssnnss',
    'sssmss',
  ];
  // head (0,0) 6x6x8
  paintBox(c, 0, 0, 6, 6, 8, ({ face: f, x, y, z }) => {
    const jt = 5 - y;
    if (z === 7 && f !== 'top' && f !== 'bottom') {
      const ch = FACE[jt][x];
      if (ch === 'W') return C('#EFEFEF');
      if (ch === 'K') return C('#141414');
      if (ch === 'n') return C('#D69088');
      if (ch === 'm') return FACE_SK[1];
      return face(x, y, z, jt === 1 ? 0.08 : 0);
    }
    return face(x, y, z, f === 'bottom' ? -0.2 : -0.06);
  });
  // legs (0,16) 4x12x4
  paintBox(c, 0, 16, 4, 12, 4, ({ face: f, x, y, z }) => {
    const jt = 11 - y;
    if (f === 'bottom' || jt === 11) return C('#4D4038');
    if (jt === 10) return C('#6B5A4E');
    return face(x, y, z, -0.06 - jt * 0.01);
  });
  // body (0,32) 8x6x16: sheared pinkish-grey skin with wool stubble
  paintBox(c, 0, 32, 8, 6, 16, ({ face: f, x, y, z }) => {
    const r = rnd(seed + 3, x, y, z);
    const b = (f === 'top' ? 0.05 : f === 'bottom' ? -0.14 : -(5 - y) * 0.02) + (r > 0.9 ? 0.18 : r < 0.08 ? -0.15 : 0);
    return tone(BODY, 0.6 + b + nz.noise3(x * 0.4 + 20, y * 0.4, z * 0.4) * 0.12 + (r - 0.5) * 0.12);
  });
}

function drawSheepFur(c) {
  const seed = seedOf('sheep_fur');
  const nz = new Noise(seed);
  const WOOL = P('#9C9C9C', '#B8B8B8', '#CDCDCD', '#DDDDDD', '#EAEAEA', '#F4F4F4', '#FFFFFF');
  // Fluffy tufts: 3D cellular (Worley) noise; each tuft is lit on its upper-front side and the
  // crevices between tufts are shaded, so the wool wraps seamlessly around every box edge.
  const CELL = 2.3;
  const feature = (cx, cy, cz, s) => [
    (cx + 0.15 + rnd(seed + s, cx, cy, cz) * 0.7) * CELL,
    (cy + 0.15 + rnd(seed + s + 1, cx, cy, cz) * 0.7) * CELL,
    (cz + 0.15 + rnd(seed + s + 2, cx, cy, cz) * 0.7) * CELL,
  ];
  const wool = (x, y, z, b = 0, s = 0) => {
    const px = x + 0.5, py = y + 0.5, pz = z + 0.5;
    const bx = Math.floor(px / CELL), by = Math.floor(py / CELL), bz = Math.floor(pz / CELL);
    let d1 = Infinity, d2 = Infinity, q = null;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const f = feature(bx + dx, by + dy, bz + dz, s * 7);
      const d = Math.hypot(px - f[0], py - f[1], pz - f[2]);
      if (d < d1) { d2 = d1; d1 = d; q = f; } else if (d < d2) d2 = d;
    }
    const nx = (px - q[0]) / CELL, ny = (py - q[1]) / CELL, nzz = (pz - q[2]) / CELL;
    const lit = ny * 0.8 + nzz * 0.35 - nx * 0.25; // light from above / front / creature's right
    const crease = Math.min(1, (d2 - d1) / (CELL * 0.35));
    const t = 0.46 + b + lit * 0.5 + crease * 0.34 + (rnd(seed + 99, x, y, z) - 0.5) * 0.1;
    return tone(WOOL, t);
  };
  // head fur (0,0) 6x6x6: front face open except a rim
  paintBox(c, 0, 0, 6, 6, 6, ({ face, x, y, z, jt }) => {
    if (face === 'front') return (jt === 0 || ((x === 0 || x === 5) && jt <= 2)) ? wool(x, y, z, 0.02, 1) : null;
    if (face === 'bottom') return z <= 2 ? wool(x, y, z, -0.2, 1) : null;
    return wool(x, y, z, face === 'top' ? 0.05 : 0, 1);
  });
  // leg fur (0,16) 4x6x4: ragged bottom edge
  paintBox(c, 0, 16, 4, 6, 4, ({ face, x, y, z, jt }) => {
    if (face === 'bottom') return null;
    if (jt === 5 && rnd(seed + 9, x, y, z) > 0.55) return null;
    return wool(x, y, z, -jt * 0.025, 2);
  });
  // body fur (0,32) 8x6x16
  paintBox(c, 0, 32, 8, 6, 16, ({ face, x, y, z, jt }) =>
    wool(x, y, z, face === 'top' ? 0.05 : face === 'bottom' ? -0.18 : -jt * 0.02, 3));
}

// ---------------------------------------------------------------------------------------------
// Chicken — 64x32
// ---------------------------------------------------------------------------------------------

function drawChicken(c) {
  const seed = seedOf('chicken');
  const nz = new Noise(seed);
  const WHITE = P('#A9A9A9', '#C8C8C8', '#DCDCDC', '#EBEBEB', '#F7F7F7', '#FFFFFF');
  const LEG = P('#B06A12', '#D98C24', '#F0A73A');
  const feather = (x, y, z, b = 0, s = 0) => tone(WHITE, 0.72 + b + nz.noise3(x * 0.6 + s * 3, y * 0.6, z * 0.6) * 0.1
    + (rnd(seed + s, x, y, z) - 0.5) * 0.16);

  // head (0,0) 4x6x3: black eyes on the front corners (wrap onto the sides)
  paintBox(c, 0, 0, 4, 6, 3, ({ face, x, y, z }) => {
    const jt = 5 - y;
    if (z === 2 && jt === 1 && (x === 0 || x === 3) && face !== 'top') return C('#0E0E0E');
    return feather(x, y, z, face === 'bottom' ? -0.15 : face === 'top' ? 0.05 : 0, 1);
  });
  // bill (14,0) 4x2x2
  paintBox(c, 14, 0, 4, 2, 2, ({ face, y, x }) => {
    const jt = 1 - y;
    if (face === 'top') return C('#FFC54A');
    if (face === 'bottom') return C('#C9800F');
    if (face === 'front' && jt === 1 && (x === 0 || x === 3)) return C('#D98A12');
    return jt === 0 ? C('#F9B032') : C('#E3961C');
  });
  // wattle (14,4) 2x2x2
  paintBox(c, 14, 4, 2, 2, 2, ({ face, y, x }) => {
    const jt = 1 - y;
    if (face === 'bottom') return C('#8E1410');
    return jt === 0 ? (x === 0 ? C('#E0342A') : C('#CC2620')) : C('#A81A15');
  });
  // body (0,9) 6x6x8: feathers, greyer tail end
  paintBox(c, 0, 9, 6, 6, 8, ({ face, x, y, z }) => {
    const jt = 5 - y;
    let b = face === 'top' ? 0.04 : face === 'bottom' ? -0.2 : -jt * 0.025;
    if (z === 0) b -= 0.12; // tail
    if ((face === 'right' || face === 'left') && jt >= 2 && (z + jt) % 3 === 0) b -= 0.1; // feather scallops
    return feather(x, y, z, b, 2);
  });
  // leg (26,0) 3x5x3: 1px shank in the middle column, toes at the bottom
  paintBox(c, 26, 0, 3, 5, 3, ({ face, i, j }) => {
    if (face === 'top') return i === 1 && j === 1 ? LEG[1] : null;
    if (face === 'bottom') return (i === 1 || j === 0) ? LEG[1] : null;
    if (j === 4) return LEG[i === 1 ? 2 : 1];
    return i === 1 ? LEG[j === 0 ? 0 : 1 + (j % 2)] : null;
  });
  // wing (38,0) 1x4x6
  paintBox(c, 38, 0, 1, 4, 6, ({ face, x, y, z }) => {
    const jt = 3 - y;
    let b = face === 'top' ? 0.05 : 0;
    if (jt === 3) b -= (z % 2 ? 0.1 : 0.2); // feather tips
    if (z === 0) b -= 0.12;
    if (face === 'left' || face === 'bottom') b -= 0.06;
    return feather(x, y, z, b, 3);
  });
}

// ---------------------------------------------------------------------------------------------
// Enderman — 64x32
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Armor layers — 64x32
// ---------------------------------------------------------------------------------------------

const ARMOR = {
  //         outline    dark       mid        light      bright     shine
  leather: { pal: P('#3A2213', '#5B371F', '#7B4D2C', '#96633A', '#AE7A4B', '#C39161') },
  chainmail: { pal: P('#262626', '#434343', '#6A6A6A', '#8E8E8E', '#B2B2B2', '#D2D2D2'), mesh: true },
  iron: { pal: P('#3F3F3F', '#7E7E7E', '#AFAFAF', '#CBCBCB', '#E2E2E2', '#FAFAFA') },
  golden: { pal: P('#5E3F08', '#A26E0E', '#D69E1C', '#EFC237', '#FADF5C', '#FFF6B0') },
  diamond: { pal: P('#0A3D3A', '#137B74', '#22AFA3', '#3FD6C8', '#83F0E3', '#D6FFF9') },
  netherite: { pal: P('#141112', '#221E1F', '#312B2C', '#3F3839', '#51494A', '#6E6466') },
};

const MESH = [[4, 3, 1, -1], [1, -1, 4, 3]];

function drawArmor(c, mat, layer) {
  const M = ARMOR[mat];
  const pal = M.pal;
  const seed = seedOf(`armor_${mat}_${layer}`);
  const nz = new Noise(seed);
  const pieces = layer === 1 ? [
    { box: [0, 0, 8, 8, 8], kind: 'helmet' },
    { box: [16, 16, 8, 12, 4], kind: 'chest' },
    { box: [40, 16, 4, 12, 4], kind: 'shoulder' },
    { box: [0, 16, 4, 12, 4], kind: 'boot' },
  ] : [
    { box: [16, 16, 8, 12, 4], kind: 'waist' },
    { box: [0, 16, 4, 12, 4], kind: 'legs' },
  ];

  const covers = {
    helmet: ({ face, i, jt, z }) => {
      if (face === 'bottom') return false;
      if (face === 'top') return true;
      if (face === 'front') return jt <= 1 || (mat !== 'leather' && (i === 0 || i === 7) && jt <= 4);
      if (face === 'back') return jt <= 6;
      return jt <= 5 || (z <= 3 && jt <= 6);
    },
    chest: ({ face, i, j, jt }) => {
      if (face === 'bottom') return false;
      if (face === 'top') return !(i >= 2 && i <= 5 && j >= 1 && j <= 2);
      if (face === 'front' && jt === 0 && (i === 3 || i === 4)) return false;
      return jt <= 10;
    },
    shoulder: ({ face, jt }) => face === 'top' || (face !== 'bottom' && jt <= 5),
    boot: ({ face, jt }) => face === 'bottom' || (face !== 'top' && jt >= 7),
    waist: ({ face, jt }) => face !== 'top' && face !== 'bottom' && jt >= 8,
    legs: ({ face, jt }) => face === 'top' || (face !== 'bottom' && jt <= 8),
  };

  for (const { box: [u, v, W, H, D], kind } of pieces) {
    const R = boxRegions(u, v, W, H, D);
    const cover = covers[kind];
    for (const face of FACES) {
      const r = R[face];
      const mask = [];
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        const [x, y, z] = voxelOf(face, i, j, W, H, D);
        mask[j * r.w + i] = cover({ face, i, j, x, y, z, jt: H - 1 - y });
      }
      const covered = (i, j) => (i < 0 || j < 0 || i >= r.w || j >= r.h) ? null : mask[j * r.w + i];
      const light = FACE_LIGHT[face];
      for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
        if (!mask[j * r.w + i]) continue;
        const [x, y, z] = voxelOf(face, i, j, W, H, D);
        const jt = H - 1 - y;
        const side = face !== 'top' && face !== 'bottom';
        const edgeBelow = covered(i, j + 1) === false;
        const edgeAbove = covered(i, j - 1) === false;
        const edgeSide = covered(i - 1, j) === false || covered(i + 1, j) === false;
        const r0 = rnd(seed, x, y, z);
        // work in palette-index units: 0 outline, 1 dark, 2 mid, 3 light, 4 bright, 5 shine
        let L = 2.75 + nz.noise3(x * 0.35, y * 0.35, z * 0.35) * 0.3 + (r0 > 0.93 ? 0.7 : r0 < 0.05 ? -0.7 : 0);
        if (face === 'top') L += 0.8;
        if (face === 'bottom') L -= 1;
        if (side && (i === 0 || i === r.w - 1)) L += 0.45; // highlight on box corners
        if (side) L -= jt * 0.05;
        let col;
        const trim = edgeBelow || edgeAbove || edgeSide;
        if (trim) {
          col = mat === 'netherite' ? pal[3] : (edgeAbove && !edgeBelow ? pal[1] : pal[0]);
          if (mat === 'iron' && edgeBelow && i % 3 === 1) col = pal[4]; // rivets
          if (mat === 'golden' && edgeBelow && i % 3 === 1) col = pal[3];
        } else {
          // bevel: highlight just under an upper edge, shadow just above a lower edge
          if (covered(i, j - 1) === false || covered(i, j - 2) === false) L += 0.9;
          if (covered(i, j + 2) === false) L -= 0.9;
          if (face === 'front') {
            if (kind === 'chest') {
              if (mat !== 'leather' && (i === 3 || i === 4)) L += i === 3 ? 1 : 0.5; // centre ridge
              if (jt === 5 && i !== 3 && i !== 4) L -= 1.2; // pectoral line
              if (jt === 6 && i !== 3 && i !== 4) L += 0.5;
              if (jt === 9) L -= 0.8;
              if (mat === 'leather' && (i === 3 || i === 4) && jt >= 1 && jt <= 4) col = (jt + i) % 2 ? pal[0] : pal[4]; // laces
            }
            if (kind === 'legs' && (jt === 5 || jt === 6)) L += jt === 5 ? 1 : -0.6; // knee plate
            if (kind === 'boot' && jt >= 10) L += 0.8; // toe cap
            if (kind === 'waist' && jt === 9 && (i === 3 || i === 4)) col = mat === 'golden' ? pal[5] : pal[4]; // buckle
            if (kind === 'helmet' && jt === 0 && (i === 3 || i === 4) && mat !== 'leather') L += 1;
          }
          if (face === 'top' && kind === 'helmet' && (x === 3 || x === 4) && mat !== 'leather') L += x === 3 ? 1 : 0.5; // crest
          if (face === 'bottom' && kind === 'boot') L = 0.6 + r0 * 0.8; // sole
          if (mat === 'golden' && (i + j * 2) % 9 === 0) L += 1;
          if (mat === 'diamond') {
            if ((i + j) % 5 === 0) L += 0.9; // facets
            if (r0 > 0.955) col = pal[5]; // sparkle
          }
          if (mat === 'netherite' && r0 > 0.86) L += 0.8;
          if (mat === 'leather' && covered(i, j + 2) === false && i % 2 === 0) col = pal[4]; // stitching
          if (M.mesh) {
            // interlocking rings: a 4x2 tile staggered diagonally (bright, mid, dark, hole)
            const lvl = MESH[j & 1][i & 3];
            if (lvl < 0) { if (face === 'top') col = pal[1]; else continue; }
            else L = lvl + (face === 'top' ? 0.5 : 0) - jt * 0.03;
          }
        }
        const k = col ?? pal[Math.max(1, Math.min(5, Math.round(L)))];
        c.set(r.x + i, r.y + j, [k[0] * light, k[1] * light, k[2] * light, 255]);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Shield — 64x64
// ---------------------------------------------------------------------------------------------

function drawShield(c) {
  const seed = seedOf('shield');
  const nz = new Noise(seed);
  const OAK = P('#6B5230', '#806239', '#977444', '#AA8651', '#BC9862', '#CCA872');
  const IRON = P('#3E3E3E', '#666666', '#8A8A8A', '#A9A9A9', '#CFCFCF');
  const HANDLE = P('#3A2616', '#4F341F', '#644329');
  // plate 12x22x1 @ (0,0): front = planks + iron rim + boss, back = plain wood
  paintBox(c, 0, 0, 12, 22, 1, ({ face, i, j, x, y }) => {
    if (face === 'front') {
      const rim = i === 0 || i === 11 || j === 0 || j === 21;
      if (rim) {
        const corner = (i === 0 || i === 11) && (j === 0 || j === 21);
        if (corner) return IRON[3];
        if ((j === 0 || j === 21) && i % 4 === 2) return IRON[4]; // rivets
        if ((i === 0 || i === 11) && j % 5 === 3) return IRON[4];
        return j === 21 || i === 11 ? IRON[1] : IRON[2];
      }
      // centre boss 4x4 at (4..7, 9..12)
      if (i >= 4 && i <= 7 && j >= 9 && j <= 12) {
        const e = i === 4 || j === 9 ? 3 : i === 7 || j === 12 ? 1 : 2;
        return (i === 5 && j === 10) ? IRON[4] : IRON[e];
      }
      if (i >= 3 && i <= 8 && j >= 8 && j <= 13) return OAK[0]; // shadow round the boss
      // vertical planks, 3px wide (seams darker)
      const plank = Math.floor((i - 1) / 3.5);
      const seam = i === 4 || i === 8;
      const grain = nz.noise3(i * 0.3 + plank * 10, j * 1.3, 0) * 0.2;
      const knot = rnd(seed + plank, plank, (j / 5) | 0, 0) > 0.85 && (i % 3 === 1) && j % 5 === 2;
      let t = 0.58 + grain + (rnd(seed, i, j, 0) - 0.5) * 0.12 + ((plank % 2) ? -0.05 : 0.03);
      if (seam) t = 0.12;
      if (knot) t = 0.08;
      if (j === 1) t += 0.1;
      if (j === 20) t -= 0.1;
      return tone(OAK, t);
    }
    if (face === 'back') {
      const seam = j % 7 === 6;
      const t = seam ? 0.1 : 0.42 + nz.noise3(i * 1.2, j * 0.3, 5) * 0.2 + (rnd(seed + 1, i, j, 0) - 0.5) * 0.12;
      return tone(OAK, t);
    }
    return IRON[(x + y) % 3 === 0 ? 3 : 2]; // rim around the edges
  }, { light: false });
  // handle 2x6x6 @ (26,0)
  paintBox(c, 26, 0, 2, 6, 6, ({ face, x, y, z }) => {
    const r = rnd(seed + 5, x, y, z);
    if (face === 'front' || face === 'top') return HANDLE[r > 0.5 ? 2 : 1];
    return HANDLE[r > 0.7 ? 1 : 0];
  });
}

// ---------------------------------------------------------------------------------------------
// Zombified piglin — 64x64 (humanoid body, 10x8x8 head, snout, floppy ears)
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Ghast — 64x64 (16x16x16 body + 2x9x2 tentacle); calm and shooting faces
// ---------------------------------------------------------------------------------------------

const GHAST_CALM = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...ee......ee...',
  '..EEEE....EEEE..',
  '...Tt......tT...',
  '...T.......tT...',
  '...Tt.......T...',
  '...T........T...',
  '......MMMM..T...',
  '...t...mm...t...',
  '................',
  '................',
  '................',
];
const GHAST_SHOOT = [
  '................',
  '................',
  '..DD........DD..',
  '....DD....DD....',
  '..RRRR....RRRR..',
  '..RhrR....RrhR..',
  '..RrrR....RrrR..',
  '..RRRR....RRRR..',
  '...T........T...',
  '...T..MMMM..T...',
  '...tMMmmmmMMT...',
  '....MmmmmmmMt...',
  '....MmmmmmmM....',
  '.....MMMMMM.....',
  '................',
  '................',
];


// ---------------------------------------------------------------------------------------------
// Blaze — 64x32 (8x8x8 head, 2x8x2 rod)
// ---------------------------------------------------------------------------------------------


// ---------------------------------------------------------------------------------------------
// Magma cube — 64x32 (8x8x8 layered crust + 4x4x4 glowing core)
// ---------------------------------------------------------------------------------------------

function drawMagmaCube(c) {
  const seed = seedOf('magma_cube');
  const nz = new Noise(seed);
  const CRUST = P('#140403', '#220705', '#330B06', '#471108', '#5E180B');
  const GLOW = P('#A8280A', '#E2560E', '#FF8A18', '#FFBC34', '#FFE474');
  paintBox(c, 0, 0, 8, 8, 8, ({ face, x, y, z }) => {
    const jt = 7 - y;
    const r = rnd(seed, x, y, z);
    if (face === 'front' && jt >= 3 && jt <= 4 && (x === 1 || x === 2 || x === 5 || x === 6)) {
      return jt === 3 ? GLOW[(x === 1 || x === 6) ? 4 : 3] : GLOW[2]; // eyes
    }
    if (face === 'front' && jt === 5 && (x === 1 || x === 2 || x === 5 || x === 6)) return GLOW[0]; // eye glow
    // horizontal layered bands with glowing seams between them
    const band = jt % 2;
    const crack = nz.noise3(x * 0.55, y * 2.2, z * 0.55);
    if (face !== 'top' && face !== 'bottom' && band === 1 && crack > 0.12) {
      return GLOW[Math.min(4, Math.floor((crack - 0.12) * 7))];
    }
    if (face !== 'top' && face !== 'bottom' && band === 0 && crack > 0.62 && r > 0.4) return GLOW[1]; // vertical fissure
    if (face === 'top') {
      const cr = nz.noise3(x * 0.8 + 30, 0, z * 0.8);
      if (Math.abs(cr) < 0.07) return GLOW[2]; // cracks across the top
    }
    let t = (band ? 0.28 : 0.58) + (r - 0.5) * 0.36;
    if (face === 'bottom') t -= 0.2;
    return tone(CRUST, t);
  });
  paintBox(c, 32, 0, 4, 4, 4, ({ face, x, y, z }) => {
    const r = rnd(seed + 1, x, y, z);
    const edge = (x === 0 || x === 3) + (y === 0 || y === 3) + (z === 0 || z === 3);
    let t = 0.78 - edge * 0.12 + (r - 0.5) * 0.3 + nz.noise3(x * 0.9 + 50, y * 0.9, z * 0.9) * 0.15;
    if (face === 'bottom') t -= 0.1;
    return tone(GLOW, t);
  }, { light: false });
}

// ---------------------------------------------------------------------------------------------
// Enchanting table book — 64x32 (zero-thickness covers, spine and flipping page)
// ---------------------------------------------------------------------------------------------

function drawEnchantingBook(c) {
  const seed = seedOf('enchanting_table_book');
  const LEATHER = P('#27130A', '#381D0E', '#492814', '#5A331B', '#6C4024');
  const INNER = P('#6A4629', '#7E5634', '#936743', '#A67A53');
  const PAPER = P('#CDBF9C', '#DDD1B3', '#EBE2CA', '#F5EEDC', '#FCF8EE');
  const LINE = C('#D8CDB0');
  const GOLD = P('#9A6C12', '#D6A42A', '#F6D56A');
  const leatherAt = (i, j, w, h) => {
    const border = i === 0 || j === 0 || i === w - 1 || j === h - 1;
    const inset = (i === 1 || i === w - 2) && j >= 1 && j <= h - 2 || (j === 1 || j === h - 2) && i >= 1 && i <= w - 2;
    const r = rnd(seed, i, j, w * 31 + h);
    if (border) return LEATHER[0];
    if (inset) return LEATHER[3]; // embossed frame
    return tone(LEATHER, 0.45 + (r - 0.5) * 0.4);
  };
  const innerAt = (i, j, w, h) => {
    const r = rnd(seed + 1, i, j, w * 17 + h);
    if (i === 0 || j === 0 || i === w - 1 || j === h - 1) return INNER[0];
    return tone(INNER, 0.55 + (r - 0.5) * 0.35);
  };
  const cover = (u, w) => paintBox(c, u, 0, w, 10, 0, ({ face, i, j }) => {
    if (face === 'front') {
      if (w === 2) { // spine: leather with gilded bands
        if (j === 1 || j === 8) return GOLD[i === 0 ? 2 : 1];
        return j === 0 || j === 9 ? LEATHER[0] : LEATHER[2 + ((i + j) % 2)];
      }
      if (i === w - 2 && j === 5) return GOLD[1]; // clasp stud
      return leatherAt(i, j, w, 10);
    }
    return innerAt(i, j, w, 10);
  }, { light: false });
  cover(0, 6);
  cover(12, 2);
  cover(16, 6);
  // text-like faint lines on a page face (deterministic per page)
  const pageFace = (i, j, s, white) => {
    const r = rnd(seed + s, i, j, 3);
    if (i >= 1 && i <= 3 && (j === 1 || j === 3 || j === 5 || j === 6 && s % 2)) {
      const len = 1 + Math.floor(rnd(seed + s, 0, j, 9) * 3);
      if (i <= len) return LINE;
    }
    return PAPER[white ? 4 : (r > 0.8 ? 2 : 3)];
  };
  const pages = (u, v, s) => paintBox(c, u, v, 5, 8, 1, ({ face, i, j }) => {
    if (face === 'front' || face === 'back') return pageFace(i, j, s + (face === 'back' ? 1 : 0), false);
    // page edges: stacked sheets
    if (face === 'top' || face === 'bottom') return PAPER[(i % 2) ? 1 : 3];
    return PAPER[(j % 2) ? 1 : 2];
  }, { light: false });
  pages(0, 10, 10);
  pages(12, 10, 20);
  paintBox(c, 24, 10, 5, 8, 0, ({ face, i, j }) => pageFace(i, j, face === 'front' ? 30 : 31, true), { light: false });
}

// ---------------------------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------------------------

export const ENTITY_TEXTURE_SIZES = {
  player: [64, 64], villager: [64, 64], zombie: [64, 64], skeleton: [64, 32], creeper: [64, 32], spider: [64, 32],
  pig: [64, 64], cow: [64, 64], sheep: [64, 64], sheep_fur: [64, 64], chicken: [64, 32],
  enderman: [64, 32], shield: [64, 64],
  zombified_piglin: [64, 64], ghast: [64, 64], ghast_shooting: [64, 64], blaze: [64, 32],
  magma_cube: [64, 32], enchanting_table_book: [64, 32],
};
export const ARMOR_MATERIALS = ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite'];
for (const m of ARMOR_MATERIALS) {
  ENTITY_TEXTURE_SIZES[`armor_${m}_1`] = [64, 32];
  ENTITY_TEXTURE_SIZES[`armor_${m}_2`] = [64, 32];
}

const DRAWERS = {
  player: drawPlayer, villager: (c) => drawOriginalSkin('villager', c), zombie: (c) => drawOriginalSkin('zombie', c), skeleton: drawSkeleton, creeper: (c) => drawOriginalSkin('creeper', c),
  spider: drawSpider, pig: drawPig, cow: drawCow, sheep: drawSheep, sheep_fur: drawSheepFur,
  chicken: drawChicken, enderman: (c) => drawOriginalSkin('enderman', c), shield: drawShield,
  zombified_piglin: (c) => drawOriginalSkin('zombified_piglin', c), ghast: (c) => drawOriginalSkin('ghast', c), ghast_shooting: (c) => drawOriginalSkin('ghast', c, true),
  blaze: (c) => drawOriginalSkin('blaze', c), magma_cube: drawMagmaCube, enchanting_table_book: drawEnchantingBook,
};

/** @returns {Map<string, {w:number, h:number, data:Uint8ClampedArray}>} */
export function generateEntityTextures() {
  const out = new Map();
  for (const [name, [w, h]] of Object.entries(ENTITY_TEXTURE_SIZES)) {
    const c = new PixelCanvas(w, h);
    const armor = /^armor_(\w+)_([12])$/.exec(name);
    if (armor) drawArmor(c, armor[1], Number(armor[2]));
    else DRAWERS[name](c);
    out.set(name, { w, h, data: c.data });
  }
  return out;
}
