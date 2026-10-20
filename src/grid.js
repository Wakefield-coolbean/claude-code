// Collision, wall segments, line of sight and the vision polygon.
//
// Cells are floor, wall face (the visible front of a north wall, up to 2 cells above
// a floor) or solid. Light passes floor<->floor, face<->face and down from a face into
// its own floor; every other open/solid boundary becomes a wall segment.

const BUCKET = 8;
const KIND_SOLID = 0;
const KIND_FLOOR = 1;
const KIND_FACE = 2;

export class World {
  constructor(map) {
    this.map = map;
    this.doorClosed = new Uint8Array(map.doors.length);
    this.doorCell = new Int16Array(map.W * map.H).fill(-1);
    map.doors.forEach((d) => d.cells.forEach((c) => (this.doorCell[c] = d.id)));
    this.rebuild();
  }

  setDoor(id, closed) {
    if (!!this.doorClosed[id] === closed) return;
    this.doorClosed[id] = closed ? 1 : 0;
    this.rebuild();
  }

  rebuild() {
    const { W, H, floor, face } = this.map;
    const kind = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const door = this.doorCell[i];
      const closed = door >= 0 && this.doorClosed[door];
      if (floor[i] && !closed) kind[i] = KIND_FLOOR;
      else if (face[i]) kind[i] = KIND_FACE;
      else kind[i] = KIND_SOLID;
    }
    this.kind = kind;
    this.buildSegments();
  }

  isFloor(cx, cy) {
    const { W, H } = this.map;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    return this.kind[cy * W + cx] === KIND_FLOOR;
  }

  /** Walkable for pathfinding: floor, not a prop, not a closed door. */
  passable(cx, cy) {
    const { W, H, blocked } = this.map;
    if (cx < 0 || cy < 0 || cx >= W || cy >= H) return false;
    const i = cy * W + cx;
    return !blocked[i] && this.kind[i] === KIND_FLOOR;
  }

  buildSegments() {
    const { W, H } = this.map;
    const k = this.kind;
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? KIND_SOLID : k[y * W + x]);
    const segs = [];
    // Horizontal edges at y (between row y-1 above and row y below).
    for (let y = 0; y <= H; y++) {
      let start = -1;
      for (let x = 0; x <= W; x++) {
        let wall = false;
        if (x < W) {
          const u = at(x, y - 1);
          const l = at(x, y);
          const open = (c) => c !== KIND_SOLID;
          const clear = (u === KIND_FLOOR && l === KIND_FLOOR) || (u === KIND_FACE && l !== KIND_SOLID);
          wall = (open(u) || open(l)) && !clear;
        }
        if (wall && start < 0) start = x;
        if (!wall && start >= 0) {
          segs.push(start, y, x, y);
          start = -1;
        }
      }
    }
    // Vertical edges at x (between column x-1 and column x).
    for (let x = 0; x <= W; x++) {
      let start = -1;
      for (let y = 0; y <= H; y++) {
        let wall = false;
        if (y < H) {
          const a = at(x - 1, y);
          const b = at(x, y);
          const clear = a === b && a !== KIND_SOLID;
          wall = (a !== KIND_SOLID || b !== KIND_SOLID) && !clear;
        }
        if (wall && start < 0) start = y;
        if (!wall && start >= 0) {
          segs.push(x, start, x, y);
          start = -1;
        }
      }
    }
    this.segs = new Float32Array(segs);
    // Spatial buckets of segment indices.
    const bw = Math.ceil(W / BUCKET) + 1;
    const bh = Math.ceil(H / BUCKET) + 1;
    const buckets = Array.from({ length: bw * bh }, () => []);
    for (let s = 0; s < this.segs.length; s += 4) {
      const [x1, y1, x2, y2] = this.segs.subarray(s, s + 4);
      const bx0 = Math.floor(Math.min(x1, x2) / BUCKET);
      const bx1 = Math.floor(Math.max(x1, x2) / BUCKET);
      const by0 = Math.floor(Math.min(y1, y2) / BUCKET);
      const by1 = Math.floor(Math.max(y1, y2) / BUCKET);
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) buckets[by * bw + bx].push(s);
    }
    this.buckets = buckets;
    this.bw = bw;
    this.bh = bh;
    this.stamp = new Uint32Array(this.segs.length / 4);
    this.stampId = 0;
  }

  /** Segment offsets (into this.segs) overlapping a box, without duplicates. */
  segmentsIn(x0, y0, x1, y1) {
    const out = [];
    const id = ++this.stampId;
    const bx0 = Math.max(0, Math.floor(x0 / BUCKET));
    const by0 = Math.max(0, Math.floor(y0 / BUCKET));
    const bx1 = Math.min(this.bw - 1, Math.floor(x1 / BUCKET));
    const by1 = Math.min(this.bh - 1, Math.floor(y1 / BUCKET));
    for (let by = by0; by <= by1; by++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        for (const s of this.buckets[by * this.bw + bx]) {
          if (this.stamp[s / 4] === id) continue;
          this.stamp[s / 4] = id;
          out.push(s);
        }
      }
    }
    return out;
  }

  /** True when a wall blocks the straight line between two points. */
  blocked(ax, ay, bx, by) {
    const segs = this.segs;
    const list = this.segmentsIn(Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by));
    const dx = bx - ax;
    const dy = by - ay;
    for (const s of list) {
      const x1 = segs[s];
      const y1 = segs[s + 1];
      const ex = segs[s + 2] - x1;
      const ey = segs[s + 3] - y1;
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((x1 - ax) * ey - (y1 - ay) * ex) / den;
      const u = ((x1 - ax) * dy - (y1 - ay) * dx) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= 0 && u <= 1) return true;
    }
    return false;
  }

  /** Can an eye at (ox, oy) with radius r see point (x, y)? */
  canSee(ox, oy, r, x, y) {
    const d2 = (x - ox) ** 2 + (y - oy) ** 2;
    if (d2 > r * r) return false;
    return !this.blocked(ox, oy, x, y);
  }

  /** Visibility polygon around (ox, oy) clipped to radius r: flat [x0, y0, x1, y1, ...]. */
  visibility(ox, oy, r) {
    const segs = this.segs;
    const list = this.segmentsIn(ox - r, oy - r, ox + r, oy + r);
    const angles = [];
    const r2 = (r + 1) * (r + 1);
    for (const s of list) {
      for (let e = 0; e < 4; e += 2) {
        const px = segs[s + e];
        const py = segs[s + e + 1];
        if ((px - ox) ** 2 + (py - oy) ** 2 > r2) continue;
        const a = Math.atan2(py - oy, px - ox);
        angles.push(a - 0.0004, a, a + 0.0004);
      }
    }
    const N = 96;
    for (let i = 0; i < N; i++) angles.push(-Math.PI + (i / N) * Math.PI * 2);
    angles.sort((a, b) => a - b);
    const pts = new Float32Array(angles.length * 2);
    let n = 0;
    let lastA = -10;
    for (const a of angles) {
      if (a - lastA < 1e-5) continue;
      lastA = a;
      const dx = Math.cos(a);
      const dy = Math.sin(a);
      let best = r;
      for (const s of list) {
        const x1 = segs[s];
        const y1 = segs[s + 1];
        const ex = segs[s + 2] - x1;
        const ey = segs[s + 3] - y1;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((x1 - ox) * ey - (y1 - oy) * ex) / den;
        if (t <= 0 || t >= best) continue;
        const u = ((x1 - ox) * dy - (y1 - oy) * dx) / den;
        if (u >= -1e-6 && u <= 1 + 1e-6) best = t;
      }
      pts[n++] = ox + dx * best;
      pts[n++] = oy + dy * best;
    }
    return pts.subarray(0, n);
  }

  /** Push a circle out of solid cells and props. Returns [x, y]. */
  resolve(x, y, r) {
    const { W, H, props } = this.map;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      const cx0 = Math.floor(x - r);
      const cy0 = Math.floor(y - r);
      const cx1 = Math.floor(x + r);
      const cy1 = Math.floor(y + r);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const inside = cx >= 0 && cy >= 0 && cx < W && cy < H;
          if (inside && this.kind[cy * W + cx] === KIND_FLOOR) continue;
          const nx = Math.max(cx, Math.min(x, cx + 1));
          const ny = Math.max(cy, Math.min(y, cy + 1));
          let dx = x - nx;
          let dy = y - ny;
          const d = Math.hypot(dx, dy);
          if (d >= r) continue;
          if (d < 1e-6) {
            // Center inside the cell: push toward the cell's nearest side.
            const left = x - cx;
            const right = cx + 1 - x;
            const up = y - cy;
            const down = cy + 1 - y;
            const m = Math.min(left, right, up, down);
            if (m === left) x = cx - r;
            else if (m === right) x = cx + 1 + r;
            else if (m === up) y = cy - r;
            else y = cy + 1 + r;
          } else {
            x = nx + (dx / d) * r;
            y = ny + (dy / d) * r;
          }
          moved = true;
        }
      }
      for (const p of props) {
        if (p.circle) {
          const [px, py, pr] = p.circle;
          const dx = x - px;
          const dy = y - py;
          const d = Math.hypot(dx, dy);
          if (d < pr + r && d > 1e-6) {
            x = px + (dx / d) * (pr + r);
            y = py + (dy / d) * (pr + r);
            moved = true;
          }
        } else {
          const [x0, y0, x1, y1] = p.rect;
          const nx = Math.max(x0, Math.min(x, x1));
          const ny = Math.max(y0, Math.min(y, y1));
          const dx = x - nx;
          const dy = y - ny;
          const d = Math.hypot(dx, dy);
          if (d < r) {
            if (d > 1e-6) {
              x = nx + (dx / d) * r;
              y = ny + (dy / d) * r;
            } else {
              const opts = [
                [x0 - r - x, 0],
                [x1 + r - x, 0],
                [0, y0 - r - y],
                [0, y1 + r - y],
              ].sort((a, b) => Math.abs(a[0] + a[1]) - Math.abs(b[0] + b[1]));
              x += opts[0][0];
              y += opts[0][1];
            }
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return [x, y];
  }

  /** Move a circle by (dx, dy) with wall sliding. */
  move(x, y, dx, dy, r) {
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.2));
    for (let i = 0; i < steps; i++) {
      [x, y] = this.resolve(x + dx / steps, y + dy / steps, r);
    }
    return [x, y];
  }
}
