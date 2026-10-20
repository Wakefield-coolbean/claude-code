// A* over map cells (8 directions, no corner cutting), then string-pulled to waypoints.

const SQRT2 = Math.SQRT2;

class Heap {
  constructor() {
    this.items = [];
  }
  push(node, f) {
    const a = this.items;
    a.push([f, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() {
    return this.items.length;
  }
}

/** Nearest passable cell to a point (spiral search). */
export function nearestPassable(world, x, y) {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  if (world.passable(cx, cy)) return [cx, cy];
  for (let r = 1; r < 6; r++) {
    let best = null;
    let bd = Infinity;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (!world.passable(cx + dx, cy + dy)) continue;
        const d = (cx + dx + 0.5 - x) ** 2 + (cy + dy + 0.5 - y) ** 2;
        if (d < bd) {
          bd = d;
          best = [cx + dx, cy + dy];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Can a body of radius ~0.3 walk straight from a to b? */
export function walkable(world, ax, ay, bx, by) {
  const d = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(d / 0.25));
  const o = 0.4;
  for (let i = 0; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    for (const [ox, oy] of [
      [-o, -o],
      [o, -o],
      [-o, o],
      [o, o],
    ]) {
      if (!world.passable(Math.floor(x + ox), Math.floor(y + oy))) return false;
    }
  }
  return true;
}

/** Returns waypoints [[x, y], ...] from (sx, sy) to (tx, ty), or null. */
export function findPath(world, sx, sy, tx, ty) {
  const { W, H } = world.map;
  const s = nearestPassable(world, sx, sy);
  const t = nearestPassable(world, tx, ty);
  if (!s || !t) return null;
  const start = s[1] * W + s[0];
  const goal = t[1] * W + t[0];
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const h = (i) => {
    const dx = Math.abs((i % W) - t[0]);
    const dy = Math.abs(Math.floor(i / W) - t[1]);
    return dx + dy + (SQRT2 - 2) * Math.min(dx, dy);
  };
  const open = new Heap();
  g[start] = 0;
  open.push(start, h(start));
  let found = false;
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const cx = cur % W;
    const cy = (cur - cx) / W;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!world.passable(nx, ny)) continue;
        if (dx && dy && (!world.passable(cx + dx, cy) || !world.passable(cx, cy + dy))) continue;
        const n = ny * W + nx;
        if (closed[n]) continue;
        const ng = g[cur] + (dx && dy ? SQRT2 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          from[n] = cur;
          open.push(n, ng + h(n));
        }
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = goal; c !== -1; c = from[c]) cells.push([(c % W) + 0.5, Math.floor(c / W) + 0.5]);
  cells.reverse();
  cells[cells.length - 1] = [tx, ty];
  // String pulling.
  const out = [];
  let anchor = [sx, sy];
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !walkable(world, anchor[0], anchor[1], cells[j][0], cells[j][1])) j--;
    out.push(cells[j]);
    anchor = cells[j];
    i = j + 1;
  }
  return out;
}
