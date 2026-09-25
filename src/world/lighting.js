// Sky + block light propagation (flood fill), modelled on Minecraft's light engine.
// Light is stored per cell as (sky << 4) | block.
import { MIN_Y, MAX_Y, SECTION_COUNT, ID_MASK } from '../constants.js';
import { LIGHT_EMIT, LIGHT_FILTER } from '../registry/blocks.js';
import { CS_LIT } from './chunk.js';

const DX = [-1, 1, 0, 0, 0, 0];
const DY = [0, 0, -1, 1, 0, 0];
const DZ = [0, 0, 0, 0, -1, 1];

class Queue {
  constructor(cap = 1 << 15) {
    this.x = new Int32Array(cap); this.y = new Int16Array(cap); this.z = new Int32Array(cap); this.l = new Uint8Array(cap);
    this.head = 0; this.tail = 0; this.cap = cap;
  }
  grow() {
    const n = this.cap * 2;
    const nx = new Int32Array(n), ny = new Int16Array(n), nz = new Int32Array(n), nl = new Uint8Array(n);
    nx.set(this.x.subarray(this.head, this.tail)); ny.set(this.y.subarray(this.head, this.tail));
    nz.set(this.z.subarray(this.head, this.tail)); nl.set(this.l.subarray(this.head, this.tail));
    this.tail -= this.head; this.head = 0;
    this.x = nx; this.y = ny; this.z = nz; this.l = nl; this.cap = n;
  }
  push(x, y, z, l) {
    if (this.tail >= this.cap) {
      if (this.head > this.cap >> 1) { // compact
        this.x.copyWithin(0, this.head, this.tail); this.y.copyWithin(0, this.head, this.tail);
        this.z.copyWithin(0, this.head, this.tail); this.l.copyWithin(0, this.head, this.tail);
        this.tail -= this.head; this.head = 0;
      } else this.grow();
    }
    const t = this.tail++;
    this.x[t] = x; this.y[t] = y; this.z[t] = z; this.l[t] = l;
  }
  get empty() { return this.head >= this.tail; }
  reset() { this.head = this.tail = 0; }
}

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.inc = new Queue();
    this.dec = new Queue();
    this._c = null; // cached chunk
    this.touched = new Set(); // chunks whose light changed during an operation
    this.markDirty = true;
    this.lightingChunk = null;
  }

  chunk(x, z) {
    const cx = x >> 4, cz = z >> 4;
    const c = this._c;
    if (c !== null && c.cx === cx && c.cz === cz) return c;
    const n = this.world.getChunk(cx, cz);
    if (n) this._c = n;
    return n;
  }

  canLight(c) { return c !== null && c !== undefined && (c.state >= CS_LIT || c === this.lightingChunk); }

  getBlockId(c, x, y, z) {
    return c.getLocal(x & 15, y, z & 15) & ID_MASK;
  }

  // Recompute a column heightmap (highest block with non-zero light filter)
  updateHeight(c, lx, lz) {
    const top = c.topSection();
    let y = top < 0 ? MIN_Y - 1 : MIN_Y + top * 16 + 15;
    for (; y >= MIN_Y; y--) {
      if (LIGHT_FILTER[c.getLocal(lx, y, lz) & ID_MASK] > 0) break;
    }
    c.heightmap[lz * 16 + lx] = y;
    return y;
  }

  // ---------------- full chunk lighting ----------------
  lightChunk(c) {
    this.lightingChunk = c;
    this._c = null;
    const top = c.topSection();
    // allocate fresh arrays (all dark) for every section up to one above the highest non-empty one
    for (let i = 0; i < SECTION_COUNT; i++) {
      c.light[i] = i <= Math.min(SECTION_COUNT - 1, top + 1) ? new Uint8Array(4096) : null;
    }
    const topY = top < 0 ? MIN_Y : Math.min(MAX_Y - 1, MIN_Y + (top + 2) * 16 - 1);
    const bx = c.cx << 4, bz = c.cz << 4;
    const inc = this.inc;

    // vertical sky pass
    const skyTop = this.world.hasSky === false ? 0 : 15;
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      let level = skyTop;
      let h = MIN_Y - 1;
      for (let y = topY; y >= MIN_Y; y--) {
        const f = LIGHT_FILTER[c.getLocal(lx, y, lz) & ID_MASK];
        if (f > 0) {
          if (h === MIN_Y - 1) h = y;
          level = f >= 15 ? 0 : Math.max(0, level - f);
        } else if (level < 15) level = Math.max(0, level - 1);
        if (level === 0) break;
        const si = (y - MIN_Y) >> 4;
        const arr = c.light[si];
        if (arr) arr[((y - MIN_Y) & 15) << 8 | lz << 4 | lx] = level << 4;
      }
      if (h === MIN_Y - 1) {
        // find height even if loop ended early
        h = this.updateHeight(c, lx, lz);
      }
      c.heightmap[lz * 16 + lx] = h;
    }

    // seeds for horizontal sky spreading: cells that are lit next to columns that are higher
    for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
      const h = c.heightmap[lz * 16 + lx];
      let maxN = h;
      for (let d = 0; d < 4; d++) {
        const nx = lx + (d === 0 ? -1 : d === 1 ? 1 : 0), nz = lz + (d === 2 ? -1 : d === 3 ? 1 : 0);
        let nh;
        if (nx >= 0 && nx < 16 && nz >= 0 && nz < 16) nh = c.heightmap[nz * 16 + nx];
        else {
          const nc = this.chunk(bx + nx, bz + nz);
          nh = this.canLight(nc) ? nc.heightmap[(nz & 15) * 16 + (nx & 15)] : h;
        }
        if (nh > maxN) maxN = nh;
      }
      const yTop = Math.min(MAX_Y - 1, maxN + 1);
      for (let y = yTop; y >= MIN_Y; y--) {
        const l = c.getLightLocal(lx, y, lz) >> 4;
        if (y <= h && l <= 1) break;
        if (l > 1) inc.push(bx + lx, y, bz + lz, l);
      }
    }
    // neighbour borders spreading into us (sky)
    this.seedFromNeighbours(c, true);
    this.propagateIncrease(true);

    // block light: emitters in this chunk
    for (let si = 0; si < SECTION_COUNT; si++) {
      const s = c.sections[si];
      if (!s) continue;
      for (let i = 0; i < 4096; i++) {
        const v = s[i];
        if (v === 0) continue;
        const e = LIGHT_EMIT[v & ID_MASK];
        if (e > 0) {
          const lx = i & 15, lz = (i >> 4) & 15, y = MIN_Y + si * 16 + (i >> 8);
          const arr = c.light[si] ?? (c.light[si] = new Uint8Array(4096).fill(0xf0));
          arr[i] = (arr[i] & 0xf0) | e;
          inc.push(bx + lx, y, bz + lz, e);
        }
      }
    }
    this.seedFromNeighbours(c, false);
    this.propagateIncrease(false);
    this.lightingChunk = null;
    this.touched.clear();
  }

  seedFromNeighbours(c, sky) {
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const [dx, dz] of sides) {
      const n = this.world.getChunk(c.cx + dx, c.cz + dz);
      if (!n || n.state < CS_LIT) continue;
      const top = Math.max(n.topSection(), c.topSection());
      const yMax = Math.min(MAX_Y - 1, MIN_Y + (top + 2) * 16 - 1);
      for (let i = 0; i < 16; i++) {
        // cell in the neighbour touching our border, and our own border cell
        const nlx = dx === -1 ? 15 : dx === 1 ? 0 : i;
        const nlz = dz === -1 ? 15 : dz === 1 ? 0 : i;
        const olx = dx === -1 ? 0 : dx === 1 ? 15 : i;
        const olz = dz === -1 ? 0 : dz === 1 ? 15 : i;
        const wx = ((c.cx + dx) << 4) + nlx, wz = ((c.cz + dz) << 4) + nlz;
        for (let y = MIN_Y; y <= yMax; y++) {
          const lv = n.getLightLocal(nlx, y, nlz);
          const l = sky ? lv >> 4 : lv & 15;
          if (l <= 1) continue;
          const ov = c.getLightLocal(olx, y, olz);
          const ol = sky ? ov >> 4 : ov & 15;
          if (l - 1 > ol) this.inc.push(wx, y, wz, l);
        }
      }
    }
  }

  // ---------------- propagation ----------------
  getLevel(c, x, y, z, sky) {
    const v = c.getLightLocal(x & 15, y, z & 15);
    return sky ? v >> 4 : v & 15;
  }
  setLevel(c, x, y, z, sky, l) {
    const lx = x & 15, lz = z & 15;
    const v = c.getLightLocal(lx, y, lz);
    const nv = sky ? (v & 15) | (l << 4) : (v & 0xf0) | l;
    if (nv === v) return;
    c.setLightLocal(lx, y, lz, nv);
    if (this.markDirty && c !== this.lightingChunk) this.touch(c, x, y, z);
  }

  touch(c, x, y, z) {
    this.touched.add(c);
    this.world.markDirtyAt(x, y, z);
  }

  propagateIncrease(sky) {
    const q = this.inc;
    while (!q.empty) {
      const h = q.head++;
      const x = q.x[h], y = q.y[h], z = q.z[h], level = q.l[h];
      const cur = this.chunk(x, z);
      if (!cur || this.getLevel(cur, x, y, z, sky) !== level) continue; // outdated entry
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < MIN_Y || ny >= MAX_Y) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        const nc = (d >= 4 || d <= 1) ? this.chunk(nx, nz) : cur;
        if (!this.canLight(nc)) continue;
        const id = nc.getLocal(nx & 15, ny, nz & 15) & ID_MASK;
        const f = LIGHT_FILTER[id];
        if (f >= 15) continue;
        let nl;
        if (sky && d === 2 && level === 15 && f === 0) nl = 15;
        else nl = level - Math.max(1, f);
        if (nl <= 0) continue;
        if (this.getLevel(nc, nx, ny, nz, sky) < nl) {
          this.setLevel(nc, nx, ny, nz, sky, nl);
          q.push(nx, ny, nz, nl);
        }
      }
    }
    q.reset();
  }

  propagateDecrease(sky) {
    const q = this.dec;
    while (!q.empty) {
      const h = q.head++;
      const x = q.x[h], y = q.y[h], z = q.z[h], level = q.l[h];
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < MIN_Y || ny >= MAX_Y) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        const nc = this.chunk(nx, nz);
        if (!this.canLight(nc)) continue;
        const nl = this.getLevel(nc, nx, ny, nz, sky);
        if (nl === 0) continue;
        const dependent = nl < level || (sky && d === 2 && level === 15 && nl === 15);
        if (dependent) {
          // keep emitters
          const emit = sky ? 0 : LIGHT_EMIT[nc.getLocal(nx & 15, ny, nz & 15) & ID_MASK];
          this.setLevel(nc, nx, ny, nz, sky, emit);
          if (emit > 0) this.inc.push(nx, ny, nz, emit);
          q.push(nx, ny, nz, nl);
        } else {
          this.inc.push(nx, ny, nz, nl);
        }
      }
    }
    q.reset();
  }

  // ---------------- incremental update ----------------
  onBlockChanged(x, y, z, oldV, newV) {
    const c = this.chunk(x, z);
    if (!c || c.state < CS_LIT) return;
    const oldId = oldV & ID_MASK, newId = newV & ID_MASK;
    const lx = x & 15, lz = z & 15;
    if (LIGHT_FILTER[oldId] === LIGHT_FILTER[newId] && LIGHT_EMIT[oldId] === LIGHT_EMIT[newId]) return;

    // heightmap maintenance
    const hIdx = lz * 16 + lx;
    const fNew = LIGHT_FILTER[newId];
    if (fNew > 0 && y > c.heightmap[hIdx]) c.heightmap[hIdx] = y;
    else if (fNew === 0 && y === c.heightmap[hIdx]) this.updateHeight(c, lx, lz);

    // make sure a light section exists here (placing torch in an empty high section)
    for (const sky of this.world.hasSky === false ? [false] : [true, false]) {
      const cur = this.getLevel(c, x, y, z, sky);
      const emit = sky ? 0 : LIGHT_EMIT[newId];
      // remove old light at this cell
      if (cur > 0) {
        this.setLevel(c, x, y, z, sky, 0);
        this.dec.push(x, y, z, cur);
        this.propagateDecrease(sky);
      }
      if (emit > 0) {
        this.setLevel(c, x, y, z, sky, emit);
        this.inc.push(x, y, z, emit);
      }
      // neighbours re-flood (covers block removal and the removed cell)
      if (LIGHT_FILTER[newId] < 15) {
        for (let d = 0; d < 6; d++) {
          const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
          if (ny < MIN_Y || ny >= MAX_Y) {
            if (sky && ny >= MAX_Y) this.inc.push(x, MAX_Y - 1, z, 15);
            continue;
          }
          const nc = this.chunk(nx, nz);
          if (!this.canLight(nc)) continue;
          const l = this.getLevel(nc, nx, ny, nz, sky);
          if (l > 0) this.inc.push(nx, ny, nz, l);
        }
        if (sky && y >= MAX_Y - 1) { this.setLevel(c, x, y, z, true, 15); this.inc.push(x, y, z, 15); }
        // above the top of loaded blocks: implicit full sky
        if (sky && c.light[(y + 1 - MIN_Y) >> 4] === null && y + 1 < MAX_Y) {
          this.inc.push(x, y + 1, z, 15);
        }
      }
      this.propagateIncrease(sky);
    }
    this.touched.clear();
  }
}
