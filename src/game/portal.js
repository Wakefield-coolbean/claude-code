// Nether portals: frame detection (vanilla PortalShape), lighting, validation and destination portal search/creation.
import { ID_MASK, packBlock, MIN_Y } from '../constants.js';
import { BlockById, B } from '../registry/blocks.js';

const isFrame = (w, x, y, z) => (w.getBlock(x, y, z) & ID_MASK) === B.obsidian;
const isInner = (w, x, y, z) => {
  const id = w.getBlock(x, y, z) & ID_MASK;
  return id === 0 || id === B.fire || id === B.soul_fire || id === B.nether_portal;
};

// axis 0: portal plane spans X (thin along Z); axis 1: spans Z
function step(axis) { return axis === 0 ? [1, 0] : [0, 1]; }

// Try to find a valid portal shape containing (x,y,z). Returns { axis, x0, y0, z0, width, height } or null.
export function findPortalShape(w, x, y, z, axis) {
  const [dx, dz] = step(axis);
  if (!isInner(w, x, y, z)) return null;
  // drop to the bottom
  let by = y;
  for (let i = 0; i < 21 && by > MIN_Y && isInner(w, x, by - 1, z); i++) by--;
  if (!isFrame(w, x, by - 1, z)) return null;
  // walk to the "left" edge
  let lx = x, lz = z, n = 0;
  while (n < 21 && isInner(w, lx - dx, by, lz - dz) && isFrame(w, lx - dx, by - 1, lz - dz)) { lx -= dx; lz -= dz; n++; }
  if (!isFrame(w, lx - dx, by, lz - dz)) return null;
  // width
  let width = 0;
  while (width < 22 && isInner(w, lx + dx * width, by, lz + dz * width) && isFrame(w, lx + dx * width, by - 1, lz + dz * width)) width++;
  if (width < 2 || width > 21 || !isFrame(w, lx + dx * width, by, lz + dz * width)) return null;
  // height: every column must be inner with frame on both sides
  let height = 0;
  outer:
  for (; height < 22; height++) {
    for (let i = 0; i < width; i++) {
      const cx = lx + dx * i, cz = lz + dz * i;
      if (!isInner(w, cx, by + height, cz)) break outer;
    }
    if (!isFrame(w, lx - dx, by + height, lz - dz) || !isFrame(w, lx + dx * width, by + height, lz + dz * width)) break;
  }
  if (height < 3 || height > 21) return null;
  // top row must be frame
  for (let i = 0; i < width; i++) if (!isFrame(w, lx + dx * i, by + height, lz + dz * i)) return null;
  return { axis, x0: lx, y0: by, z0: lz, width, height };
}

export function fillPortal(w, shape) {
  const [dx, dz] = step(shape.axis);
  for (let i = 0; i < shape.width; i++) for (let j = 0; j < shape.height; j++) {
    w.setBlock(shape.x0 + dx * i, shape.y0 + j, shape.z0 + dz * i, packBlock(B.nether_portal, shape.axis), 1 | 2 | 8);
  }
}

// Called when fire would be placed: light a portal instead if a valid frame surrounds the spot.
export function tryLightPortal(w, x, y, z) {
  for (const axis of [0, 1]) {
    const s = findPortalShape(w, x, y, z, axis);
    if (s) { fillPortal(w, s); return s; }
  }
  return null;
}

// A portal block stays only while its plane neighbours are portal/obsidian.
export function portalStillValid(w, x, y, z, v) {
  const axis = v >>> 12;
  const [dx, dz] = step(axis);
  const ok = (xx, yy, zz) => { const id = w.getBlock(xx, yy, zz) & ID_MASK; return id === B.nether_portal || id === B.obsidian; };
  return ok(x, y + 1, z) && ok(x, y - 1, z) && ok(x + dx, y, z + dz) && ok(x - dx, y, z - dz);
}

// Locate an existing portal block near (x,y,z) within `radius` blocks (only loaded chunks are searched).
export function findNearbyPortal(w, x, y, z, radius, yMin, yMax) {
  let best = null, bd = Infinity;
  const cr = Math.ceil(radius / 16);
  for (let cx = (x >> 4) - cr; cx <= (x >> 4) + cr; cx++) for (let cz = (z >> 4) - cr; cz <= (z >> 4) + cr; cz++) {
    const c = w.getChunk(cx, cz);
    if (!c || c.state < 2) continue;
    for (let si = 0; si < c.sections.length; si++) {
      const s = c.sections[si];
      if (!s) continue;
      const sy = MIN_Y + si * 16;
      if (sy + 16 < yMin || sy > yMax) continue;
      for (let i = 0; i < 4096; i++) {
        if ((s[i] & ID_MASK) !== B.nether_portal) continue;
        const px = (cx << 4) + (i & 15), py = sy + (i >> 8), pz = (cz << 4) + ((i >> 4) & 15);
        const d = (px - x) ** 2 + (py - y) ** 2 + (pz - z) ** 2;
        if (d < bd && Math.abs(px - x) <= radius && Math.abs(pz - z) <= radius) { bd = d; best = { x: px, y: py, z: pz, v: s[i] }; }
      }
    }
  }
  if (!best) return null;
  // move to the bottom of that portal column
  while ((w.getBlock(best.x, best.y - 1, best.z) & ID_MASK) === B.nether_portal) best.y--;
  return best;
}

// Build a new 4x5 portal (2x3 opening) near the target, vanilla-style: prefer standing room on solid ground.
export function createPortal(w, x, y, z, yMin, yMax) {
  let best = null, bestScore = Infinity;
  const solid = (xx, yy, zz) => BlockById[w.getBlock(xx, yy, zz) & ID_MASK].solid;
  const air = (xx, yy, zz) => { const d = BlockById[w.getBlock(xx, yy, zz) & ID_MASK]; return !d.solid && !d.liquid; };
  for (let r = 0; r <= 16 && !best; r += 2) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const px = x + dx, pz = z + dz;
      for (let py = yMax - 5; py >= yMin; py--) {
        if (!solid(px, py - 1, pz) || !solid(px + 1, py - 1, pz)) continue;
        let ok = true;
        for (let i = -1; i <= 2 && ok; i++) for (let j = 0; j < 4 && ok; j++) if (!air(px + i, py + j, pz)) ok = false;
        if (!ok) continue;
        const score = Math.abs(py - y) + r * 2;
        if (score < bestScore) { bestScore = score; best = { x: px, y: py, z: pz }; }
        break;
      }
    }
  }
  let bx, by, bz, platform = false;
  if (best) ({ x: bx, y: by, z: bz } = best);
  else { bx = x; bz = z; by = Math.max(yMin + 2, Math.min(yMax - 6, y)); platform = true; }
  // clear space and build frame (axis 0: along X)
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const frame = i === -1 || i === 2 || j === -1 || j === 3;
    w.setBlock(bx + i, by + j, bz, frame ? B.obsidian : 0);
  }
  if (platform) {
    for (let i = -1; i <= 2; i++) for (let k = -1; k <= 1; k++) if (k !== 0) {
      w.setBlock(bx + i, by - 1, bz + k, B.obsidian);
      for (let j = 0; j < 3; j++) w.setBlock(bx + i, by + j, bz + k, 0);
    }
  }
  fillPortal(w, { axis: 0, x0: bx, y0: by, z0: bz, width: 2, height: 3 });
  return { x: bx, y: by, z: bz };
}
