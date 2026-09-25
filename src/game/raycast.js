// Voxel ray casting against block selection shapes, and ray/AABB tests for entities.
import { ID_MASK } from '../constants.js';
import { BlockById } from '../registry/blocks.js';
import { getSelectionBoxes } from '../registry/shapes.js';

// Returns { x, y, z, face, hitX, hitY, hitZ, dist } or null. face: 0 W,1 E,2 D,3 U,4 N,5 S
export function raycastBlocks(world, ox, oy, oz, dx, dy, dz, maxDist, { fluids = false } = {}) {
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1, stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tDeltaZ = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tMaxX = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX : Infinity;
  let tMaxY = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY : Infinity;
  let tMaxZ = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ : Infinity;
  let t = 0;
  for (let i = 0; i < 256 && t <= maxDist; i++) {
    const v = world.getBlock(x, y, z);
    if (v !== 0) {
      const def = BlockById[v & ID_MASK];
      let boxes;
      if (fluids && def.liquid && (v >>> 12) === 0) boxes = [[0, 0, 0, 1, 0.9, 1]];
      else boxes = getSelectionBoxes(def, v >>> 12, (a, b, c) => world.getBlock(x + a, y + b, z + c));
      let best = null;
      for (const b of boxes) {
        const hit = rayBox(ox, oy, oz, dx, dy, dz, x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        if (hit && hit.t <= maxDist && (!best || hit.t < best.t)) best = hit;
      }
      if (best) {
        return { x, y, z, face: best.face, dist: best.t, hitX: ox + dx * best.t, hitY: oy + dy * best.t, hitZ: oz + dz * best.t, value: v };
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) { x += stepX; t = tMaxX; tMaxX += tDeltaX; }
    else if (tMaxY < tMaxZ) { y += stepY; t = tMaxY; tMaxY += tDeltaY; }
    else { z += stepZ; t = tMaxZ; tMaxZ += tDeltaZ; }
  }
  return null;
}

// Slab method; returns { t, face } of entry or null
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, face = -1;
  const axes = [[ox, dx, x0, x1, 0], [oy, dy, y0, y1, 2], [oz, dz, z0, z1, 4]];
  for (const [o, d, lo, hi, f] of axes) {
    if (Math.abs(d) < 1e-12) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t1 = (lo - o) / d, t2 = (hi - o) / d;
    let f1 = f, f2 = f + 1; // entering through min face (W/D/N) or max face (E/U/S)
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; const ff = f1; f1 = f2; f2 = ff; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  if (tmin < 0) return { t: 0, face: face < 0 ? 0 : face, inside: true };
  return { t: tmin, face };
}

export const FACE_OFFSETS = [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]];
