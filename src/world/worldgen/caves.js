// Cave generation: 1.18-style noise caves (cheese caverns with pillars, spaghetti tunnels,
// noodle caves, 2D "spaghetti" corridors), aquifer-lite fluid rules and classic worm/ravine
// carvers. Everything is a pure function of (seed, position) so chunks can be generated in any
// order and still line up.
import { MIN_Y } from '../../constants.js';
import { Fractal, Rng, hash32, clamp } from './noise.js';
import { fractalSd } from './climate.js';
import { AIR, WATER, LAVA, CARVABLE } from './ids.js';

const SD3_1 = 0.275, SD3_2 = 0.198; // std-dev of 1/2 octave 3D fractals (measured)
const LAVA_LEVEL = -55;             // caves at/below this y fill with lava
const AQ_SIZE = 64;                 // aquifer region size (blocks)

export class CaveNoise {
  constructor(seed) {
    const h = (k) => hash32(seed, k, 0xca7e, 0x33);
    this.seed = seed;
    this.cheese = new Fractal(h(1), 2, 1 / 100, { yFreq: 1 / 66 });
    this.pillar = new Fractal(h(2), 1, 1 / 13, { yFreq: 1 / 42 });
    this.entrance = new Fractal(h(3), 1, 1 / 150, { yFreq: 1 / 90 });
    this.spagA = new Fractal(h(4), 1, 1 / 72, { yFreq: 1 / 54 });
    this.spagB = new Fractal(h(5), 1, 1 / 72, { yFreq: 1 / 54 });
    this.spagMod = new Fractal(h(6), 2, 1 / 170, { yFreq: 1 / 110 });
    this.noodA = new Fractal(h(7), 1, 1 / 30, { yFreq: 1 / 26 });
    this.noodB = new Fractal(h(8), 1, 1 / 30, { yFreq: 1 / 26 });
    this.noodToggle = new Fractal(h(9), 2, 1 / 120, { yFreq: 1 / 90 });
    // 2D spaghetti corridors: two layers
    this.s2Ridge = [new Fractal(h(10), 2, 1 / 95), new Fractal(h(11), 2, 1 / 110)];
    this.s2Elev = [new Fractal(h(12), 2, 1 / 260), new Fractal(h(13), 2, 1 / 300)];
    this.s2Gate = [new Fractal(h(14), 1, 1 / 330), new Fractal(h(15), 1, 1 / 360)];
    this.s2Thick = new Fractal(h(16), 1, 1 / 45);
    this.s2sd = fractalSd(2, 0.5);
    this.aqSalt = hash32(seed, 0xa9f1, 5, 7);
    this.aqOffX = hash32(seed, 1, 0xa9f1, 1) & 63;
    this.aqOffZ = hash32(seed, 2, 0xa9f1, 1) & 63;
    this.aqWarpX = new Fractal(h(17), 2, 1 / 40);
    this.aqWarpZ = new Fractal(h(18), 2, 1 / 40);
  }

  // Compute cave channels at a coarse grid corner.
  // surfaceY: estimated terrain surface above this corner; protectY: caves disabled at y >= protectY.
  // Writes into arrays at index i: cv (cheese density, <0 = air), sa/sb/sr (spaghetti), na/nb/nr (noodle)
  corner(x, y, z, surfaceY, protectY, i, cv, sa, sb, sr, na, nb, nr) {
    if (y >= protectY || y < MIN_Y + 4) {
      cv[i] = 1; sr[i] = -1; nr[i] = -1; sa[i] = 9; sb[i] = 9; na[i] = 9; nb[i] = 9;
      return;
    }
    // fade out towards the protected water floor so interpolation never punches through
    const pf = protectY < 1e6 ? clamp((protectY - y) / 12, 0, 1) : 1;
    const depth = surfaceY - y;
    const bottomFade = clamp((y - (MIN_Y + 4)) / 10, 0, 1);

    // --- cheese caverns ---
    let thr;
    if (y < -40) thr = 0.88;
    else if (y < 0) thr = 0.88 + (y + 40) * 0.004;
    else if (y < 64) thr = 1.04 + y * 0.008;
    else thr = 1.55 + (y - 64) * 0.013;
    if (depth < 24) {
      const e = this.entrance.sample3(x, y, z) / SD3_1;
      const open = e > 1.1 ? Math.min(1, (e - 1.1) * 2) : 0; // rare cavern entrances
      thr += ((24 - Math.max(depth, 0)) / 24) * 1.8 * (1 - open);
    }
    thr += (1 - pf) * 3 + (1 - bottomFade) * 3;
    const n = this.cheese.sample3(x, y, z) / SD3_2;
    let c = thr - n;
    if (c < 0.6) { // only care about pillars inside/near caverns
      const p = this.pillar.sample3(x, y, z) / SD3_1;
      if (p > 1.05) { const pv = (p - 1.05) * 2.2; if (pv > c) c = pv; }
    }
    cv[i] = c;

    // --- spaghetti tunnels ---
    const m = this.spagMod.sample3(x, y, z) / SD3_2;
    let r = m < -0.95 ? -1 : 0.23 + 0.08 * clamp(m, -0.95, 1.2);
    if (r > 0) {
      r *= pf * bottomFade;
      if (depth < 4) r *= 0.6;
      sa[i] = this.spagA.sample3(x, y, z) / SD3_1;
      sb[i] = this.spagB.sample3(x, y, z) / SD3_1;
    } else { sa[i] = 9; sb[i] = 9; }
    sr[i] = r;

    // --- noodle caves ---
    const t = y < surfaceY - 6 ? this.noodToggle.sample3(x, y, z) / SD3_2 : -1;
    if (t > 0) {
      nr[i] = (0.065 + 0.035 * clamp(t, 0, 1)) * pf * bottomFade;
      na[i] = this.noodA.sample3(x, y, z) / SD3_1;
      nb[i] = this.noodB.sample3(x, y, z) / SD3_1;
    } else { nr[i] = -1; na[i] = 9; nb[i] = 9; }
  }

  // ---- aquifer-lite ----
  // Each 64x64 region below y=0 is either dry or flooded up to a level in [-50, -4].
  regionLevel(rx, rz) {
    const hh = hash32(this.aqSalt, rx, rz, 0x51);
    if ((hh & 1023) > 380) return -1000; // ~37% of regions flooded
    return -50 + ((hh >>> 10) % 47);
  }
  static stateAt(level, y) { return y <= level ? WATER : y <= LAVA_LEVEL ? LAVA : AIR; }

  // Block to place in a carved cave cell at (x,y,z), or -1 to leave it solid (aquifer barrier).
  // Region borders are domain-warped so barriers are irregular, and only ~2 blocks thick.
  fluidAt(x, y, z) {
    if (y > 0) return AIR;
    const fx = (x + this.aqOffX + this.aqWarpX.sample2(x, z) * 26) / AQ_SIZE;
    const fz = (z + this.aqOffZ + this.aqWarpZ.sample2(x, z) * 26) / AQ_SIZE;
    const rx = Math.floor(fx), rz = Math.floor(fz);
    const st = CaveNoise.stateAt(this.regionLevel(rx, rz), y);
    const ux = (fx - rx) * AQ_SIZE, uz = (fz - rz) * AQ_SIZE;
    if (ux < 1 || ux > AQ_SIZE - 1) {
      if (CaveNoise.stateAt(this.regionLevel(ux < 1 ? rx - 1 : rx + 1, rz), y) !== st) return -1;
    }
    if (uz < 1 || uz > AQ_SIZE - 1) {
      if (CaveNoise.stateAt(this.regionLevel(rx, uz < 1 ? rz - 1 : rz + 1), y) !== st) return -1;
    }
    return st;
  }

  // ---- 2D spaghetti corridors (per column) ----
  // Returns number of intervals written to out ([lo, hi] pairs).
  corridors(x, z, out) {
    let k = 0;
    for (let L = 0; L < 2; L++) {
      if (this.s2Gate[L].sample2(x, z) < -0.08) continue;
      const rr = this.s2Ridge[L].sample2(x, z) / this.s2sd;
      const w = 0.085;
      if (rr > w || rr < -w) continue;
      const e = clamp(this.s2Elev[L].sample2(x, z) / this.s2sd, -1.6, 1.6);
      const center = L === 0 ? -30 + e * 18 : 22 + e * 22;
      const th = 2.2 + 1.3 * (this.s2Thick.sample2(x, z) / 0.309 + 0.5);
      const q = rr / w;
      const s = Math.sqrt(1 - q * q);
      out[k++] = Math.round(center - th * s * 0.8);
      out[k++] = Math.round(center + th * s);
    }
    return k;
  }
}

// ---------------------------------------------------------------------------------------------
// Worm tunnels and ravines (MC CaveWorldCarver / CanyonWorldCarver port, simplified).
// ctx: { cx, cz, buf, protY: Int16Array(256), caves: CaveNoise, seed }
const RANGE = 6;
const TWO_PI = Math.PI * 2;

export function runCarvers(ctx) {
  const { cx, cz, seed } = ctx;
  const rng = new Rng(0);
  for (let sx = cx - RANGE; sx <= cx + RANGE; sx++) {
    for (let sz = cz - RANGE; sz <= cz + RANGE; sz++) {
      // --- caves ---
      rng.seed(hash32(seed, sx, sz, 0xc4e5));
      if (rng.next() < 0.14) {
        const n = rng.int(rng.int(rng.int(15) + 1) + 1);
        for (let i = 0; i < n; i++) {
          const x = sx * 16 + rng.int(16);
          const y = -56 + rng.int(236); // -56..180 (mostly above the ground in hills -> clipped)
          const z = sz * 16 + rng.int(16);
          const hMul = 0.7 + rng.next() * 0.7;
          const vMul = 0.8 + rng.next() * 0.5;
          const floor = -1 + rng.next() * 0.6;
          let tunnels = 1;
          if (rng.int(4) === 0) {
            const rad = 1.5 + 1 + rng.next() * 6;
            carveEllipsoid(ctx, x + 1, y, z, rad * hMul, rad * 0.5 * vMul, floor, false, null);
            tunnels += rng.int(4);
          }
          for (let j = 0; j < tunnels; j++) {
            const yaw = rng.next() * TWO_PI;
            const pitch = (rng.next() - 0.5) / 4;
            let thick = rng.next() * 2 + rng.next();
            if (rng.int(10) === 0) thick *= rng.next() * rng.next() * 3 + 1;
            const maxD = (RANGE * 2 - 1) * 16;
            const count = maxD - rng.int(maxD >> 2);
            tunnel(ctx, (rng.next() * 4294967296) | 0, x, y, z, hMul, vMul, floor, thick, yaw, pitch, 0, count, 1);
          }
        }
      }
      // --- ravines ---
      rng.seed(hash32(seed, sx, sz, 0x7a1e));
      if (rng.next() < 0.018) {
        const x = sx * 16 + rng.int(16);
        const y = 10 + rng.int(58);
        const z = sz * 16 + rng.int(16);
        const yaw = rng.next() * TWO_PI;
        const pitch = (rng.next() - 0.5) * 0.25;
        const thick = (rng.next() * 2 + rng.next()) * 2;
        const maxD = (RANGE * 2 - 1) * 16;
        const count = Math.floor(maxD * (0.75 + rng.next() * 0.25));
        ravine(ctx, (rng.next() * 4294967296) | 0, x, y, z, thick, yaw, pitch, count);
      }
    }
  }
}

function canReach(cx, cz, x, z, k, count, thick) {
  const dx = x - (cx * 16 + 8), dz = z - (cz * 16 + 8);
  const rem = count - k;
  const m = thick + 2 + 16;
  return dx * dx + dz * dz - rem * rem <= m * m;
}

function tunnel(ctx, s, x, y, z, hMul, vMul, floor, thick, yaw, pitch, start, count, yScale) {
  const r = new Rng(s);
  const split = r.int(count >> 1) + (count >> 2);
  const steep = r.int(6) === 0;
  let dYaw = 0, dPitch = 0;
  for (let k = start; k < count; k++) {
    const hr = 1.5 + Math.sin((Math.PI * k) / count) * thick;
    const vr = hr * yScale;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp; y += Math.sin(pitch); z += Math.sin(yaw) * cp;
    pitch *= steep ? 0.92 : 0.7;
    pitch += dPitch * 0.1; yaw += dYaw * 0.1;
    dPitch *= 0.9; dYaw *= 0.75;
    dPitch += (r.next() - r.next()) * r.next() * 2;
    dYaw += (r.next() - r.next()) * r.next() * 4;
    if (k === split && thick > 1) {
      tunnel(ctx, (r.next() * 4294967296) | 0, x, y, z, hMul, vMul, floor, r.next() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, k, count, 1);
      tunnel(ctx, (r.next() * 4294967296) | 0, x, y, z, hMul, vMul, floor, r.next() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, k, count, 1);
      return;
    }
    if (r.int(4) === 0) continue;
    if (!canReach(ctx.cx, ctx.cz, x, z, k, count, thick)) return;
    carveEllipsoid(ctx, x, y, z, hr * hMul, vr * vMul, floor, false, null);
  }
}

const widthBuf = new Float32Array(400);
function ravine(ctx, s, x, y, z, thick, yaw, pitch, count) {
  const r = new Rng(s);
  // per-y wall roughness
  let f = 1;
  for (let i = 0; i < 384; i++) {
    if (i === 0 || r.int(3) === 0) f = 1 + r.next() * r.next();
    widthBuf[i] = f * f;
  }
  const hFac = 0.75 + r.next() * 0.25;
  let dYaw = 0, dPitch = 0;
  for (let k = 0; k < count; k++) {
    let hr = 1.5 + Math.sin((k * Math.PI) / count) * thick;
    let vr = hr * 3;
    hr *= hFac;
    hr *= 0.75 + r.next() * 0.25;
    vr *= 0.8 + r.next() * 0.3;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp; y += Math.sin(pitch); z += Math.sin(yaw) * cp;
    pitch *= 0.7;
    pitch += dPitch * 0.05; yaw += dYaw * 0.05;
    dPitch *= 0.8; dYaw *= 0.5;
    dPitch += (r.next() - r.next()) * r.next() * 2;
    dYaw += (r.next() - r.next()) * r.next() * 4;
    if (r.int(4) === 0) continue;
    if (!canReach(ctx.cx, ctx.cz, x, z, k, count, thick)) return;
    carveEllipsoid(ctx, x, y, z, hr, vr, -0.7, true, widthBuf);
  }
}

// Carve an ellipsoid, clipped to the current chunk.
function carveEllipsoid(ctx, x, y, z, hr, vr, floor, ravineMode, widths) {
  const x0 = ctx.cx << 4, z0 = ctx.cz << 4;
  if (x + hr + 1 < x0 || x - hr - 1 > x0 + 16 || z + hr + 1 < z0 || z - hr - 1 > z0 + 16) return;
  const minX = Math.max(0, Math.floor(x - hr) - x0 - 1), maxX = Math.min(15, Math.floor(x + hr) - x0 + 1);
  const minZ = Math.max(0, Math.floor(z - hr) - z0 - 1), maxZ = Math.min(15, Math.floor(z + hr) - z0 + 1);
  const minY = Math.max(MIN_Y + 1, Math.floor(y - vr) - 1), maxY = Math.min(310, Math.floor(y + vr) + 1);
  const { buf, protY, caves } = ctx;
  for (let lx = minX; lx <= maxX; lx++) {
    const dx = (lx + x0 + 0.5 - x) / hr;
    const dx2 = dx * dx;
    if (dx2 >= 1) continue;
    for (let lz = minZ; lz <= maxZ; lz++) {
      const dz = (lz + z0 + 0.5 - z) / hr;
      const dxz = dx2 + dz * dz;
      if (dxz >= 1) continue;
      const col = lz * 16 + lx;
      const py = protY[col];
      for (let yy = minY; yy <= maxY; yy++) {
        if (yy >= py) break;
        const dy = (yy + 0.5 - y) / vr;
        if (ravineMode) {
          if (dxz * widths[yy - MIN_Y] + (dy * dy) / 6 >= 1) continue;
        } else {
          if (dy <= floor || dxz + dy * dy >= 1) continue;
        }
        const idx = ((yy - MIN_Y) << 8) | col;
        const v = buf[idx];
        if (!CARVABLE[v & 0xfff]) continue;
        const f = caves.fluidAt(lx + x0, yy, lz + z0);
        if (f < 0) continue;
        buf[idx] = f;
      }
    }
  }
}
