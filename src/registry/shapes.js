// Block shapes for 'model' render type blocks, plus collision and selection boxes.
// Render boxes use pixel units (0..16). Collision/selection boxes use block units (0..1).
import { ID_MASK } from '../constants.js';
import { BlockById, IS_OPAQUE } from './blocks.js';

const px = (v) => v / 16;
const FULL = [0, 0, 0, 1, 1, 1];

// neighbour accessor signature: nb(dx, dy, dz) -> packed block value
const nbId = (nb, dx, dy, dz) => nb(dx, dy, dz) & ID_MASK;
const nbMeta = (nb, dx, dy, dz) => nb(dx, dy, dz) >>> 12;

function isFenceLike(id) {
  const b = BlockById[id];
  return b && (b.shape === 'fence');
}
function isPaneLike(id) {
  const b = BlockById[id];
  return b && (b.shape === 'pane');
}

// ---- stairs ----
function stairBoxes(meta) {
  const facing = meta & 3, up = (meta & 4) !== 0;
  const base = up ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16];
  const y0 = up ? 0 : 8, y1 = up ? 8 : 16;
  let step;
  switch (facing) {
    case 0: step = [0, y0, 0, 16, y1, 8]; break;   // north
    case 1: step = [0, y0, 8, 16, y1, 16]; break;  // south
    case 2: step = [0, y0, 0, 8, y1, 16]; break;   // west
    default: step = [8, y0, 0, 16, y1, 16]; break; // east
  }
  return [base, step];
}

// ---- doors ----
// lower meta: facing | open<<2 ; upper meta: 8 | hinge (1 = right)
export function doorState(meta, nb) {
  const upper = (meta & 8) !== 0;
  let lower = meta, top = meta;
  if (upper) lower = nbMeta(nb, 0, -1, 0); else top = nbMeta(nb, 0, 1, 0);
  return { upper, facing: lower & 3, open: (lower & 4) !== 0, hinge: top & 1 };
}
function doorBox(facing, open, hinge) {
  // closed plate lies on the side opposite to the facing direction (the side the player stood on)
  const T = 3;
  const side = (s) => {
    switch (s) {
      case 0: return [0, 0, 0, 16, 16, T];        // north side
      case 1: return [0, 0, 16 - T, 16, 16, 16];  // south side
      case 2: return [0, 0, 0, T, 16, 16];        // west side
      default: return [16 - T, 0, 0, 16, 16, 16]; // east side
    }
  };
  const closedSide = [1, 0, 3, 2][facing];
  if (!open) return side(closedSide);
  // left of the player when facing: N->W, S->E, W->S, E->N
  const left = [2, 3, 1, 0][facing], right = [3, 2, 0, 1][facing];
  return side(hinge ? right : left);
}

// ---- trapdoor: facing | open<<2 | top<<3 ----
function trapdoorBox(meta) {
  const facing = meta & 3, open = (meta & 4) !== 0, top = (meta & 8) !== 0;
  if (!open) return top ? [0, 13, 0, 16, 16, 16] : [0, 0, 0, 16, 3, 16];
  switch (facing) {
    case 0: return [0, 0, 13, 16, 16, 16];
    case 1: return [0, 0, 0, 16, 16, 3];
    case 2: return [13, 0, 0, 16, 16, 16];
    default: return [0, 0, 0, 3, 16, 16];
  }
}

// ---- ladder: meta = direction of the supporting wall (0 -Z, 1 +Z, 2 -X, 3 +X) ----
function ladderBox(meta, thick = 1) {
  switch (meta & 3) {
    case 0: return [0, 0, 0, 16, 16, thick];
    case 1: return [0, 0, 16 - thick, 16, 16, 16];
    case 2: return [0, 0, 0, thick, 16, 16];
    default: return [16 - thick, 0, 0, 16, 16, 16];
  }
}

function fenceConnections(nb) {
  const out = [];
  const dirs = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  for (let i = 0; i < 4; i++) {
    const [dx, , dz] = dirs[i];
    const id = nbId(nb, dx, 0, dz);
    if (isFenceLike(id) || IS_OPAQUE[id]) out.push(i);
  }
  return out;
}
function paneConnections(nb) {
  const out = [];
  const dirs = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
  for (let i = 0; i < 4; i++) {
    const [dx, , dz] = dirs[i];
    const id = nbId(nb, dx, 0, dz);
    if (isPaneLike(id) || IS_OPAQUE[id] || BlockById[id].name === 'glass') out.push(i);
  }
  return out;
}

// Render boxes: [{ f:[x0,y0,z0,x1,y1,z1] (px), faces?: bitmask, uv?: {faceIndex:[u0,v0,u1,v1]}, uvRot?: {faceIndex:deg}, tex?: string[6]|string, rot? }]
export function getRenderBoxes(def, meta, nb) {
  switch (def.shape) {
    case 'slab':
      if (meta === 2) return [{ f: [0, 0, 0, 16, 16, 16] }];
      return [{ f: meta === 1 ? [0, 8, 0, 16, 16, 16] : [0, 0, 0, 16, 8, 16] }];
    case 'stairs': return stairBoxes(meta).map((f) => ({ f }));
    case 'torch': {
      const tex = def.faces[0];
      const uv = { 0: [7, 6, 9, 16], 1: [7, 6, 9, 16], 4: [7, 6, 9, 16], 5: [7, 6, 9, 16], 3: [7, 6, 9, 8], 2: [7, 14, 9, 16] };
      if (meta === 0) return [{ f: [7, 0, 7, 9, 10, 9], uv, tex }];
      // wall torch: tilted 22.5 degrees away from the wall
      const f = [7, 3.5, 7, 9, 13.5, 9];
      const offs = [[0, 0, -8], [0, 0, 8], [-8, 0, 0], [8, 0, 0]][meta - 1] ?? [0, 0, 0];
      const off = [offs[0] * 0.55, 0, offs[2] * 0.55];
      const box = { f: [f[0] + off[0], f[1], f[2] + off[2], f[3] + off[0], f[4], f[5] + off[2]], uv, tex };
      const axis = meta <= 2 ? 'x' : 'z';
      const sign = meta === 1 || meta === 4 ? 1 : -1;
      box.rot = { axis, angle: 22.5 * sign * (axis === 'x' ? 1 : -1), origin: [8 + off[0], 3.5, 8 + off[2]] };
      return [box];
    }
    case 'chest': {
      const full = [0, 0, 16, 16];
      return [{ f: [1, 0, 1, 15, 14, 15], uv: { 0: full, 1: full, 2: full, 3: full, 4: full, 5: full }, facing: meta & 3 }];
    }
    case 'farmland':
    case 'path':
      return [{ f: [0, 0, 0, 16, 15, 16] }];
    case 'layer': return [{ f: [0, 0, 0, 16, ((meta & 7) + 1) * 2, 16] }];
    case 'carpet': return [{ f: [0, 0, 0, 16, 1, 16] }];
    case 'cactus':
      return [
        { f: [0, 0, 0, 16, 16, 16], faces: 0b001100 },
        { f: [1, 0, 0, 15, 16, 16], faces: 0b000011, noCull: true },
        { f: [0, 0, 1, 16, 16, 15], faces: 0b110000, noCull: true },
      ];
    case 'fence': {
      const boxes = [{ f: [6, 0, 6, 10, 16, 10] }];
      for (const d of fenceConnections(nb)) {
        for (const [y0, y1] of [[6, 9], [12, 15]]) {
          if (d === 0) boxes.push({ f: [7, y0, 0, 9, y1, 6] });
          if (d === 1) boxes.push({ f: [7, y0, 10, 9, y1, 16] });
          if (d === 2) boxes.push({ f: [0, y0, 7, 6, y1, 9] });
          if (d === 3) boxes.push({ f: [10, y0, 7, 16, y1, 9] });
        }
      }
      return boxes;
    }
    case 'pane': {
      const conns = paneConnections(nb);
      const boxes = [{ f: [7, 0, 7, 9, 16, 9] }];
      for (const d of conns) {
        if (d === 0) boxes.push({ f: [7, 0, 0, 9, 16, 7] });
        if (d === 1) boxes.push({ f: [7, 0, 9, 9, 16, 16] });
        if (d === 2) boxes.push({ f: [0, 0, 7, 7, 16, 9] });
        if (d === 3) boxes.push({ f: [9, 0, 7, 16, 16, 9] });
      }
      return boxes;
    }
    case 'door': {
      const s = doorState(meta, nb);
      const tex = s.upper ? 'oak_door_top' : 'oak_door_bottom';
      return [{ f: doorBox(s.facing, s.open, s.hinge), tex }];
    }
    case 'trapdoor': return [{ f: trapdoorBox(meta) }];
    case 'ladder': return [{ f: ladderBox(meta, 0.8), tex: def.faces[0] }];
    case 'bed': {
      const facing = meta & 3, head = (meta & 4) !== 0;
      const part = head ? 'head' : 'foot';
      const tex = [`bed_${part}_side`, `bed_${part}_side`, 'oak_planks', `bed_${part}_top`, `bed_${part}_side`, `bed_${part}_side`];
      // end faces: the face pointing away from the other half shows the end board
      const endFace = head ? [4, 5, 0, 1][facing] : [5, 4, 1, 0][facing];
      const otherFace = head ? [5, 4, 1, 0][facing] : [4, 5, 0, 1][facing];
      tex[endFace] = `bed_${part}_end`;
      const faces = 0b111111 & ~(1 << otherFace);
      const uvRot = { 3: [0, 180, 270, 90][facing] };
      return [{ f: [0, 0, 0, 16, 9, 16], tex, faces, uvRot }];
    }
    case 'lily_pad': return [{ f: [0, 0.25, 0, 16, 0.25, 16], faces: 0b001100, tint: true }];
    case 'crop': return [];
    default: return [{ f: [0, 0, 0, 16, 16, 16] }];
  }
}

function boxPx(f) { return [px(f[0]), px(f[1]), px(f[2]), px(f[3]), px(f[4]), px(f[5])]; }

// Collision boxes in block units. Empty array = no collision.
export function getCollisionBoxes(def, meta, nb) {
  if (!def.solid) return [];
  if (def.render === 'cube' || def.render === 'liquid') return [FULL];
  switch (def.shape) {
    case 'slab': return meta === 2 ? [FULL] : [meta === 1 ? [0, 0.5, 0, 1, 1, 1] : [0, 0, 0, 1, 0.5, 1]];
    case 'stairs': return stairBoxes(meta).map(boxPx);
    case 'chest': return [boxPx([1, 0, 1, 15, 14, 15])];
    case 'farmland': case 'path': return [boxPx([0, 0, 0, 16, 15, 16])];
    case 'layer': { const h = (meta & 7) * 2; return h === 0 ? [] : [boxPx([0, 0, 0, 16, h, 16])]; }
    case 'carpet': return [boxPx([0, 0, 0, 16, 1, 16])];
    case 'cactus': return [boxPx([1, 0, 1, 15, 15, 15])];
    case 'fence': {
      const boxes = [[6 / 16, 0, 6 / 16, 10 / 16, 1.5, 10 / 16]];
      for (const d of fenceConnections(nb)) {
        if (d === 0) boxes.push([6 / 16, 0, 0, 10 / 16, 1.5, 6 / 16]);
        if (d === 1) boxes.push([6 / 16, 0, 10 / 16, 10 / 16, 1.5, 1]);
        if (d === 2) boxes.push([0, 0, 6 / 16, 6 / 16, 1.5, 10 / 16]);
        if (d === 3) boxes.push([10 / 16, 0, 6 / 16, 1, 1.5, 10 / 16]);
      }
      return boxes;
    }
    case 'pane': return getRenderBoxes(def, meta, nb).map((b) => boxPx(b.f));
    case 'door': { const s = doorState(meta, nb); return [boxPx(doorBox(s.facing, s.open, s.hinge))]; }
    case 'trapdoor': return [boxPx(trapdoorBox(meta))];
    case 'ladder': return [boxPx(ladderBox(meta, 3))];
    case 'bed': return [boxPx([0, 0, 0, 16, 9, 16])];
    case 'lily_pad': return [boxPx([1, 0, 1, 15, 1.5, 15])];
    case 'torch': case 'crop': return [];
    default: return [FULL];
  }
}

// Selection (outline / ray-hit) boxes in block units.
export function getSelectionBoxes(def, meta, nb) {
  if (def.render === 'air' || def.liquid) return [];
  if (def.render === 'cube') return [FULL];
  if (def.render === 'cross') {
    if (def.flower) return [boxPx([5, 0, 5, 11, 10, 11])];
    if (def.name.endsWith('_sapling')) return [boxPx([2, 0, 2, 14, 12, 14])];
    if (def.name.endsWith('mushroom')) return [boxPx([5, 0, 5, 11, 6, 11])];
    if (def.name === 'cobweb') return [FULL];
    if (def.name === 'fire') return [];
    if (def.name === 'sweet_berry_bush') return [boxPx([3, 0, 3, 13, 8 + meta * 2, 13])];
    return [boxPx([2, 0, 2, 14, 13, 14])];
  }
  switch (def.shape) {
    case 'torch': {
      if (meta === 0) return [boxPx([6, 0, 6, 10, 10, 10])];
      const b = [[5.5, 3, 11, 10.5, 13, 16], [5.5, 3, 0, 10.5, 13, 5], [11, 3, 5.5, 16, 13, 10.5], [0, 3, 5.5, 5, 13, 10.5]][meta - 1];
      // wall torch sits near the wall it is attached to
      const map = [[5.5, 3, 0, 10.5, 13, 5], [5.5, 3, 11, 10.5, 13, 16], [0, 3, 5.5, 5, 13, 10.5], [11, 3, 5.5, 16, 13, 10.5]];
      return [boxPx(map[meta - 1] ?? b)];
    }
    case 'crop': return [boxPx([0, 0, 0, 16, 2 + (def.crop ? Math.round(((meta & 7) + 1) * 14 / 8) : 16), 16])];
    case 'fence': return getCollisionBoxes(def, meta, nb).map((b) => [b[0], b[1], b[2], b[3], Math.min(1, b[4]), b[5]]);
    case 'layer': return [boxPx([0, 0, 0, 16, ((meta & 7) + 1) * 2, 16])];
    case 'ladder': return [boxPx(ladderBox(meta, 3))];
    default: {
      const boxes = getCollisionBoxes({ ...def, solid: true }, meta, nb);
      return boxes.length ? boxes : [FULL];
    }
  }
}
