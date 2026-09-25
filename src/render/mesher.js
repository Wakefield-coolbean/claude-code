// Builds vertex data for one 16x16x16 chunk section.
// Vertex layout (20 bytes): pos u16x3 | uv u16x2 | layer u16 | sky u8 | block u8 | shade u8 | anim u8 | tint rgb u8x3 | flags u8
import { MIN_Y, ID_MASK, SECTION_COUNT } from '../constants.js';
import { BlockById, IS_OPAQUE, RENDER_TYPE, B } from '../registry/blocks.js';
import { BiomeById } from '../registry/biomes.js';
import { getRenderBoxes } from '../registry/shapes.js';
import { hash4 } from '../util/rng.js';

const S = 18;           // padded size
const SS = S * S;
const IDX = (x, y, z) => ((y + 1) * S + (z + 1)) * S + (x + 1);
const NOFF = [-1, 1, -SS, SS, -S, S]; // W E D U N S in padded index space
const FACE_SHADE = [0.6, 0.6, 0.5, 1.0, 0.8, 0.8];
const AO_CURVE = [0.48, 0.66, 0.83, 1.0];
const POS_SCALE = 2048, POS_OFF = 8;
const UV_SCALE = 256;
const VERT_BYTES = 20;

const FACE_VERTS = [
  [[0, 1, 0], [0, 0, 0], [0, 0, 1], [0, 1, 1]], // W
  [[1, 1, 1], [1, 0, 1], [1, 0, 0], [1, 1, 0]], // E
  [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], // D
  [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], // U
  [[1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]], // N
  [[0, 1, 1], [0, 0, 1], [1, 0, 1], [1, 1, 1]], // S
];
const FACE_UV = [[0, 0], [0, 1], [1, 1], [1, 0]];
const FACE_AXIS = [0, 0, 1, 1, 2, 2];

// Per face, per vertex: padded-index offsets (relative to face-adjacent cell) of side1, side2, corner
const AO_OFFS = [];
for (let f = 0; f < 6; f++) {
  const n = FACE_AXIS[f];
  const tangents = [0, 1, 2].filter((a) => a !== n);
  const stride = [1, SS, S];
  AO_OFFS.push(FACE_VERTS[f].map((p) => {
    const s1 = (p[tangents[0]] === 1 ? 1 : -1) * stride[tangents[0]];
    const s2 = (p[tangents[1]] === 1 ? 1 : -1) * stride[tangents[1]];
    return [s1, s2, s1 + s2];
  }));
}

// UV from position (pixels) for model boxes, per face
function uvFromPos(f, x, y, z) {
  switch (f) {
    case 0: return [z, 16 - y];
    case 1: return [16 - z, 16 - y];
    case 2: return [x, 16 - z];
    case 3: return [x, z];
    case 4: return [16 - x, 16 - y];
    default: return [x, 16 - y];
  }
}

export class Mesher {
  constructor(textures) {
    this.tex = textures; // { layerOf(name) -> {layer, anim} }
    this.blocks = new Uint16Array(S * S * S);
    this.light = new Uint8Array(S * S * S);
    this.opaque = new Uint8Array(S * S * S);
    this.solid = new Out(1 << 16);
    this.trans = new Out(1 << 14);
    this.buildFaceTables();
  }

  buildFaceTables() {
    // default texture layer per block face, + front texture
    this.faceLayer = new Uint16Array(4096 * 6);
    this.faceAnim = new Uint8Array(4096 * 6);
    this.frontLayer = new Int32Array(4096).fill(-1);
    for (const b of BlockById) {
      for (let f = 0; f < 6; f++) {
        const t = this.tex.get(b.faces[f]);
        this.faceLayer[b.id * 6 + f] = t.layer;
        this.faceAnim[b.id * 6 + f] = t.anim;
      }
      if (b.front) this.frontLayer[b.id] = this.tex.get(b.front).layer;
    }
    this.overlayLayer = this.tex.get('grass_block_side_overlay').layer;
    this.snowySideLayer = this.tex.get('grass_block_snow').layer;
    this.farmMoistLayer = this.tex.get('farmland_moist').layer;
    this.furnaceFront = this.tex.get('furnace_front').layer;
  }

  // Copy the section and its 1-block border into padded arrays. Returns false if section is empty.
  gather(world, chunk, si) {
    const blocks = this.blocks, light = this.light, opaque = this.opaque;
    const cx = chunk.cx, cz = chunk.cz;
    const y0 = MIN_Y + si * 16;
    // neighbour chunks 3x3
    const nbs = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nbs.push(world.getChunk(cx + dx, cz + dz));
    const sec = chunk.sections[si];
    const secUp = si + 1 < SECTION_COUNT ? chunk.sections[si + 1] : null;
    const secDown = si > 0 ? chunk.sections[si - 1] : null;
    if (!sec) {
      // An empty section can still need faces from blocks in the neighbouring sections? No:
      // faces belong to the section of the block that owns them.
      return false;
    }
    blocks.fill(0);
    for (let py = -1; py <= 16; py++) {
      const wy = y0 + py;
      for (let pz = -1; pz <= 16; pz++) {
        const cdz = pz < 0 ? 0 : pz > 15 ? 2 : 1;
        for (let px = -1; px <= 16; px++) {
          const cdx = px < 0 ? 0 : px > 15 ? 2 : 1;
          const i = ((py + 1) * S + (pz + 1)) * S + (px + 1);
          let v, l;
          if (cdx === 1 && cdz === 1 && py >= 0 && py <= 15) {
            const li = py << 8 | pz << 4 | px;
            v = sec[li];
            const la = chunk.light[si];
            l = la ? la[li] : chunk.fullLight;
          } else {
            const c = nbs[cdz * 3 + cdx];
            if (wy < MIN_Y) { v = B.bedrock; l = 0; }
            else if (!c) { v = 0; l = chunk.fullLight; }
            else {
              v = c.getLocal(px & 15, wy, pz & 15);
              l = c.getLightLocal(px & 15, wy, pz & 15);
            }
          }
          blocks[i] = v;
          light[i] = l;
          opaque[i] = IS_OPAQUE[v & ID_MASK];
        }
      }
    }
    void secUp; void secDown;
    return true;
  }

  // Biome tints for the 18x18 padded columns (cached per chunk)
  tints(world, chunk) {
    if (chunk.tintCache) return chunk.tintCache;
    const grass = new Uint8Array(S * S * 3), foliage = new Uint8Array(S * S * 3), water = new Uint8Array(S * S * 3);
    const bx = chunk.cx << 4, bz = chunk.cz << 4;
    const R = 2;
    for (let pz = -1; pz <= 16; pz++) for (let px = -1; px <= 16; px++) {
      let gr = 0, gg = 0, gb = 0, fr = 0, fg = 0, fb = 0, wr = 0, wg = 0, wb = 0, n = 0;
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const x = bx + px + dx, z = bz + pz + dz;
        const c = world.getChunk(x >> 4, z >> 4);
        const biome = BiomeById[c ? c.biomes[(z & 15) * 16 + (x & 15)] : 0] ?? BiomeById[0];
        gr += (biome.grass >> 16) & 255; gg += (biome.grass >> 8) & 255; gb += biome.grass & 255;
        fr += (biome.foliage >> 16) & 255; fg += (biome.foliage >> 8) & 255; fb += biome.foliage & 255;
        wr += (biome.water >> 16) & 255; wg += (biome.water >> 8) & 255; wb += biome.water & 255;
        n++;
      }
      const i = ((pz + 1) * S + (px + 1)) * 3;
      grass[i] = gr / n; grass[i + 1] = gg / n; grass[i + 2] = gb / n;
      foliage[i] = fr / n; foliage[i + 1] = fg / n; foliage[i + 2] = fb / n;
      water[i] = wr / n; water[i + 1] = wg / n; water[i + 2] = wb / n;
    }
    // only cache when all neighbours were present
    const t = { grass, foliage, water };
    let complete = true;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (!world.getChunk(chunk.cx + dx, chunk.cz + dz)) complete = false;
    if (complete) chunk.tintCache = t;
    return t;
  }

  mesh(world, chunk, si) {
    if (!this.gather(world, chunk, si)) return null;
    const tints = this.tints(world, chunk);
    const solid = this.solid, trans = this.trans;
    solid.reset(); trans.reset();
    const blocks = this.blocks;
    const bx = chunk.cx << 4, by = MIN_Y + si * 16, bz = chunk.cz << 4;
    this.bx = bx; this.by = by; this.bz = bz;
    this.tintData = tints;

    for (let y = 0; y < 16; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = IDX(x, y, z);
      const v = blocks[i];
      if (v === 0) continue;
      const id = v & ID_MASK;
      const rt = RENDER_TYPE[id];
      const def = BlockById[id];
      switch (rt) {
        case 1: this.cube(def, v, x, y, z, i); break;
        case 2:
          this.cross(def, v, x, y, z, i);
          if (def.waterlogged) this.liquid(BlockById[B.water], B.water, x, y, z, i);
          break;
        case 3: this.liquid(def, v, x, y, z, i); break;
        case 4: this.model(def, v, x, y, z, i); break;
        default: break;
      }
    }
    return { solid: solid.slice(), trans: trans.slice(), solidCount: solid.count, transCount: trans.count };
  }

  tint(kind, x, z) {
    if (!kind) return 0xffffff;
    if (kind === 'birch') return 0x80a755;
    if (kind === 'spruce') return 0x619961;
    if (kind === 'lily') return 0x208030;
    const arr = kind === 'grass' ? this.tintData.grass : kind === 'water' ? this.tintData.water : this.tintData.foliage;
    const k = ((z + 1) * S + (x + 1)) * 3;
    return (arr[k] << 16) | (arr[k + 1] << 8) | arr[k + 2];
  }

  // ---------- cubes ----------
  cube(def, v, x, y, z, i) {
    const blocks = this.blocks, opaque = this.opaque, light = this.light;
    const id = def.id, meta = v >>> 12;
    const out = def.layer === 'translucent' ? this.trans : this.solid;
    const cullSame = def.cullSame;
    let snowy = false;
    if (id === B.grass_block) {
      const above = blocks[i + SS] & ID_MASK;
      snowy = above === B.snow || above === B.snow_block;
    }
    for (let f = 0; f < 6; f++) {
      const ni = i + NOFF[f];
      if (opaque[ni]) continue;
      const nid = blocks[ni] & ID_MASK;
      if (cullSame && nid === id) continue;
      let layer = this.faceLayer[id * 6 + f];
      let anim = this.faceAnim[id * 6 + f];
      let rot = 0;
      let tintKind = null;
      // orientation
      if (def.orient === 'axis' && meta !== 0) {
        const axisFace = meta === 1 ? (f === 0 || f === 1) : (f === 4 || f === 5);
        if (axisFace) layer = this.faceLayer[id * 6 + 3];
        else {
          layer = this.faceLayer[id * 6 + 0];
          if (meta === 1) rot = 90; // x axis: rotate every side face
          else if (f === 0 || f === 1) rot = 90;
        }
      } else if (def.orient === 'facing' && this.frontLayer[id] >= 0) {
        const frontFace = [4, 5, 0, 1][meta & 3];
        if (f === frontFace) layer = this.frontLayer[id];
        else if (f === 4 || f === 5 || f === 0 || f === 1) layer = this.faceLayer[id * 6 + 0];
      }
      if (def.tint) {
        if (def.tintTop) { if (f === 3) tintKind = def.tint; }
        else tintKind = def.tint;
      }
      if (snowy && f !== 3 && f !== 2) layer = this.snowySideLayer;
      const tint = this.tint(tintKind, x, z);
      this.emitCubeFace(out, f, x, y, z, i, ni, layer, anim, tint, rot, FACE_SHADE[f]);
      if (id === B.grass_block && !snowy && f !== 3 && f !== 2) {
        this.emitCubeFace(out, f, x, y, z, i, ni, this.overlayLayer, 0, this.tint('grass', x, z), 0, FACE_SHADE[f]);
      }
    }
  }

  emitCubeFace(out, f, x, y, z, i, ni, layer, anim, tint, rot, shadeBase) {
    const opaque = this.opaque, light = this.light;
    const verts = FACE_VERTS[f], aos = AO_OFFS[f];
    const aoV = [0, 0, 0, 0];
    const sky = [0, 0, 0, 0], blk = [0, 0, 0, 0];
    const l0 = light[ni];
    for (let k = 0; k < 4; k++) {
      const o = aos[k];
      const s1 = opaque[ni + o[0]], s2 = opaque[ni + o[1]], c = opaque[ni + o[2]];
      aoV[k] = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
      let ss = l0 >> 4, bs = l0 & 15, n = 1;
      if (!s1) { const l = light[ni + o[0]]; ss += l >> 4; bs += l & 15; n++; }
      if (!s2) { const l = light[ni + o[1]]; ss += l >> 4; bs += l & 15; n++; }
      if (!c && (!s1 || !s2)) { const l = light[ni + o[2]]; ss += l >> 4; bs += l & 15; n++; }
      sky[k] = ss / n; blk[k] = bs / n;
    }
    const flip = aoV[0] + aoV[2] < aoV[1] + aoV[3];
    const base = out.reserve(4);
    for (let q = 0; q < 4; q++) {
      const k = flip ? (q + 1) & 3 : q;
      const p = verts[k];
      let u = FACE_UV[k][0] * 16, vv = FACE_UV[k][1] * 16;
      if (rot) [u, vv] = rotUV(u, vv, rot);
      out.vertex(base + q, x + p[0], y + p[1], z + p[2], u, vv, layer, sky[k], blk[k], shadeBase * AO_CURVE[aoV[k]], anim, tint, 0);
    }
  }

  // ---------- cross plants ----------
  cross(def, v, x, y, z, i) {
    const l = this.light[i];
    const sky = l >> 4, blk = l & 15;
    const id = def.id, meta = v >>> 12;
    let layer = this.faceLayer[id * 6 + 4];
    let anim = this.faceAnim[id * 6 + 4];
    if (def.berry) { const t = this.tex.get(`sweet_berry_bush_stage${Math.min(3, meta)}`); layer = t.layer; }
    if (def.name === 'fire') { const t = this.tex.get((this.bx + x + this.bz + z) & 1 ? 'fire_1' : 'fire_0'); layer = t.layer; anim = t.anim; }
    const tint = this.tint(def.tint, x, z);
    let ox = 0, oz = 0, oy = 0;
    if (def.support === 'soil' || def.name === 'grass' || def.name === 'fern' || def.flower) {
      const h = hash4(this.bx + x, 0, this.bz + z, 7);
      ox = ((h & 15) / 15 - 0.5) * 0.5;
      oz = (((h >> 4) & 15) / 15 - 0.5) * 0.5;
      if (def.name === 'grass' || def.name === 'fern') oy = -(((h >> 8) & 15) / 15) * 0.2;
      if (def.name.endsWith('_sapling') || def.berry) { ox = oz = 0; }
    }
    const a = 0.5 - 0.3536, b = 0.5 + 0.3536;
    const out = this.solid;
    const X = x + ox, Y = y + oy, Z = z + oz;
    const quads = [
      [[a, 1, a], [a, 0, a], [b, 0, b], [b, 1, b]],
      [[b, 1, b], [b, 0, b], [a, 0, a], [a, 1, a]],
      [[a, 1, b], [a, 0, b], [b, 0, a], [b, 1, a]],
      [[b, 1, a], [b, 0, a], [a, 0, b], [a, 1, b]],
    ];
    for (const q of quads) {
      const base = out.reserve(4);
      for (let k = 0; k < 4; k++) {
        const p = q[k];
        out.vertex(base + k, X + p[0], Y + p[1], Z + p[2], FACE_UV[k][0] * 16, FACE_UV[k][1] * 16, layer, sky, blk, 1, anim, tint, 1);
      }
    }
  }

  // ---------- liquids ----------
  isSameFluid(v, kind) {
    const d = BlockById[v & ID_MASK];
    return d.liquid === kind || (kind === 'water' && d.waterlogged);
  }
  fluidH(v) {
    const d = BlockById[v & ID_MASK];
    if (d.waterlogged) return 8 / 9;
    const m = v >>> 12;
    if (m >= 8) return 1;
    return (8 - m) / 9;
  }
  cornerHeight(x, y, z, kind) {
    // corner at (x, z) in block-corner space: the 4 columns (x-1..x, z-1..z)
    let total = 0, count = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const i = IDX(x + dx, y, z + dz);
      const v = this.blocks[i];
      if (this.isSameFluid(v, kind)) {
        if (this.isSameFluid(this.blocks[i + SS], kind)) return 1;
        const h = this.fluidH(v);
        if (h >= 0.8) { total += h * 10; count += 10; } else { total += h; count++; }
      } else if (!BlockById[v & ID_MASK].solid) { count++; }
    }
    return count ? total / count : 0;
  }

  liquid(def, v, x, y, z, i) {
    const kind = def.liquid;
    const blocks = this.blocks, opaque = this.opaque;
    const out = kind === 'water' ? this.trans : this.solid;
    const still = this.tex.get(kind === 'water' ? 'water_still' : 'lava_still');
    const flow = this.tex.get(kind === 'water' ? 'water_flow' : 'lava_flow');
    const tint = kind === 'water' ? this.tint('water', x, z) : 0xffffff;
    const upSame = this.isSameFluid(blocks[i + SS], kind);
    let h00, h10, h11, h01; // corners (x,z): (0,0) (1,0) (1,1) (0,1)
    if (upSame) h00 = h10 = h11 = h01 = 1;
    else {
      h00 = this.cornerHeight(x, y, z, kind);
      h10 = this.cornerHeight(x + 1, y, z, kind);
      h11 = this.cornerHeight(x + 1, y, z + 1, kind);
      h01 = this.cornerHeight(x, y, z + 1, kind);
    }
    const lOwn = this.light[i], lUp = this.light[i + SS];
    const lTop = Math.max(lOwn >> 4, lUp >> 4) << 4 | Math.max(lOwn & 15, lUp & 15);
    const isLava = kind === 'lava';
    // top
    if (!upSame) {
      const s = lTop >> 4, b = lTop & 15;
      const base = out.reserve(4);
      const pts = [[0, h00, 0], [0, h01, 1], [1, h11, 1], [1, h10, 0]];
      for (let k = 0; k < 4; k++) {
        const p = pts[k];
        out.vertex(base + k, x + p[0], y + p[1] - 0.001, z + p[2], p[0] * 16, p[2] * 16, still.layer, s, b, 1, still.anim, tint, 2);
      }
      if (!isLava) { // underside of the surface, visible from below
        const base2 = out.reserve(4);
        for (let k = 0; k < 4; k++) {
          const p = pts[3 - k];
          out.vertex(base2 + k, x + p[0], y + p[1] - 0.001, z + p[2], p[0] * 16, p[2] * 16, still.layer, s, b, 0.9, still.anim, tint, 2);
        }
      }
    }
    // bottom
    const dn = blocks[i - SS];
    if (!opaque[i - SS] && !this.isSameFluid(dn, kind)) {
      const l = this.light[i - SS];
      const base = out.reserve(4);
      const pts = [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]];
      for (let k = 0; k < 4; k++) {
        const p = pts[k];
        out.vertex(base + k, x + p[0], y + p[1], z + p[2], p[0] * 16, p[2] * 16, still.layer, l >> 4, l & 15, 0.5, still.anim, tint, 2);
      }
    }
    // sides
    const sides = [
      [0, [0, 0, 0], [0, 0, 1], h00, h01, -1, 0],   // west: from z0 to z1 at x=0
      [1, [1, 0, 1], [1, 0, 0], h11, h10, 1, 0],    // east
      [4, [1, 0, 0], [0, 0, 0], h10, h00, 0, -1],   // north
      [5, [0, 0, 1], [1, 0, 1], h01, h11, 0, 1],    // south
    ];
    for (const [f, pa, pb, ha, hb, dx, dz] of sides) {
      const ni = i + NOFF[f];
      const nv = blocks[ni];
      if (opaque[ni] || this.isSameFluid(nv, kind)) continue;
      const l = this.light[ni];
      const shade = FACE_SHADE[f];
      const base = out.reserve(4);
      // top-left, bottom-left, bottom-right, top-right as seen from outside
      const q = [[pa[0], ha, pa[2]], [pa[0], 0, pa[2]], [pb[0], 0, pb[2]], [pb[0], hb, pb[2]]];
      const uvs = [[0, (1 - ha) * 16], [0, 16], [16, 16], [16, (1 - hb) * 16]];
      for (let k = 0; k < 4; k++) {
        const p = q[k];
        out.vertex(base + k, x + p[0], y + p[1], z + p[2], uvs[k][0] * 0.5, uvs[k][1] * 0.5, flow.layer, l >> 4, l & 15, shade, flow.anim, tint, 2);
      }
      if (!isLava) { // inner side (visible from inside the water)
        const base2 = out.reserve(4);
        for (let k = 0; k < 4; k++) {
          const p = q[3 - k];
          out.vertex(base2 + k, x + p[0], y + p[1], z + p[2], uvs[3 - k][0] * 0.5, uvs[3 - k][1] * 0.5, flow.layer, l >> 4, l & 15, shade, flow.anim, tint, 2);
        }
      }
      void dx; void dz;
    }
  }

  // ---------- model blocks ----------
  model(def, v, x, y, z, i) {
    const meta = v >>> 12;
    if (def.shape === 'crop') return this.crop(def, meta, x, y, z, i);
    const blocks = this.blocks, opaque = this.opaque, light = this.light;
    const nb = (dx, dy, dz) => blocks[i + dx + dy * SS + dz * S];
    const boxes = getRenderBoxes(def, meta, nb);
    const out = def.layer === 'translucent' ? this.trans : this.solid;
    const own = light[i];
    const tintAll = def.tint ? this.tint(def.tint, x, z) : 0xffffff;
    let texOverride = null;
    if (def.name === 'farmland' && meta >= 7) texOverride = { 3: this.farmMoistLayer };
    for (const box of boxes) {
      const [x0, y0, z0, x1, y1, z1] = box.f;
      const mask = box.faces ?? 0b111111;
      for (let f = 0; f < 6; f++) {
        if (!(mask & (1 << f))) continue;
        // on the block boundary?
        const onEdge = (f === 0 && x0 === 0) || (f === 1 && x1 === 16) || (f === 2 && y0 === 0) ||
          (f === 3 && y1 === 16) || (f === 4 && z0 === 0) || (f === 5 && z1 === 16);
        const ni = i + NOFF[f];
        if (onEdge && !box.noCull && opaque[ni]) continue;
        // skip faces hidden against the same block with full face (slab on slab etc) - keep simple
        const l = onEdge ? light[ni] : own;
        const lUse = onEdge && opaque[ni] ? own : l;
        let layer, anim = 0;
        if (texOverride && texOverride[f] !== undefined) layer = texOverride[f];
        else if (box.tex) {
          const name = typeof box.tex === 'string' ? box.tex : box.tex[f];
          const t = this.tex.get(name); layer = t.layer; anim = t.anim;
        } else {
          layer = this.faceLayer[def.id * 6 + f]; anim = this.faceAnim[def.id * 6 + f];
          if (box.facing !== undefined && this.frontLayer[def.id] >= 0) {
            const frontFace = [4, 5, 0, 1][box.facing];
            if (f === frontFace) layer = this.frontLayer[def.id];
            else if (f !== 2 && f !== 3) layer = this.faceLayer[def.id * 6 + 0];
          }
        }
        const verts = FACE_VERTS[f];
        const base = out.reserve(4);
        const uvo = box.uv && box.uv[f];
        const rotDeg = box.uvRot && box.uvRot[f];
        for (let k = 0; k < 4; k++) {
          const p = verts[k];
          let px = p[0] ? x1 : x0, py = p[1] ? y1 : y0, pz = p[2] ? z1 : z0;
          let u, vv;
          if (uvo) { u = uvo[0] + (uvo[2] - uvo[0]) * FACE_UV[k][0]; vv = uvo[1] + (uvo[3] - uvo[1]) * FACE_UV[k][1]; }
          else [u, vv] = uvFromPos(f, px, py, pz);
          if (rotDeg) [u, vv] = rotUV(u, vv, rotDeg);
          if (box.rot) [px, py, pz] = rotatePoint(px, py, pz, box.rot);
          out.vertex(base + k, x + px / 16, y + py / 16, z + pz / 16, u, vv, layer, lUse >> 4, lUse & 15, FACE_SHADE[f], anim, box.tint || def.tint ? tintAll : 0xffffff, 0);
        }
      }
    }
  }

  crop(def, meta, x, y, z, i) {
    const l = this.light[i];
    const stage = def.crop.texStages ? def.crop.texStages[Math.min(meta, 7)] : Math.min(meta, def.crop.stages - 1);
    const t = this.tex.get(`${def.crop.tex}${stage}`);
    const out = this.solid;
    const planes = [
      [[4, 16, 0], [4, 0, 0], [4, 0, 16], [4, 16, 16]],
      [[12, 16, 16], [12, 0, 16], [12, 0, 0], [12, 16, 0]],
      [[16, 16, 4], [16, 0, 4], [0, 0, 4], [0, 16, 4]],
      [[0, 16, 12], [0, 0, 12], [16, 0, 12], [16, 16, 12]],
    ];
    for (const pl of planes) {
      for (const dir of [0, 1]) {
        const base = out.reserve(4);
        for (let k = 0; k < 4; k++) {
          const p = pl[dir ? 3 - k : k];
          const uvk = FACE_UV[dir ? 3 - k : k];
          out.vertex(base + k, x + p[0] / 16, y + p[1] / 16 - 1 / 16, z + p[2] / 16, uvk[0] * 16, uvk[1] * 16, t.layer, l >> 4, l & 15, 1, 0, 0xffffff, 1);
        }
      }
    }
  }
}

function rotUV(u, v, deg) {
  switch (deg) {
    case 90: return [16 - v, u];
    case 180: return [16 - u, 16 - v];
    case 270: return [v, 16 - u];
    default: return [u, v];
  }
}

function rotatePoint(x, y, z, rot) {
  const a = rot.angle * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const [ox, oy, oz] = rot.origin;
  let dx = x - ox, dy = y - oy, dz = z - oz;
  if (rot.axis === 'x') { const ny = dy * c - dz * s, nz = dy * s + dz * c; dy = ny; dz = nz; }
  else if (rot.axis === 'z') { const nx = dx * c - dy * s, ny = dx * s + dy * c; dx = nx; dy = ny; }
  else { const nx = dx * c + dz * s, nz = -dx * s + dz * c; dx = nx; dz = nz; }
  return [ox + dx, oy + dy, oz + dz];
}

// Growable vertex output
class Out {
  constructor(capVerts) {
    this.buf = new ArrayBuffer(capVerts * VERT_BYTES);
    this.u16 = new Uint16Array(this.buf);
    this.u8 = new Uint8Array(this.buf);
    this.count = 0;
    this.cap = capVerts;
  }
  reset() { this.count = 0; }
  reserve(n) {
    if (this.count + n > this.cap) {
      const nc = Math.max(this.cap * 2, this.count + n);
      const nb = new ArrayBuffer(nc * VERT_BYTES);
      new Uint8Array(nb).set(this.u8.subarray(0, this.count * VERT_BYTES));
      this.buf = nb; this.u16 = new Uint16Array(nb); this.u8 = new Uint8Array(nb); this.cap = nc;
    }
    const b = this.count;
    this.count += n;
    return b;
  }
  vertex(idx, x, y, z, u, v, layer, sky, blk, shade, anim, tint, flags) {
    const o16 = idx * 10, o8 = idx * 20;
    const u16 = this.u16, u8 = this.u8;
    u16[o16] = (x + POS_OFF) * POS_SCALE;
    u16[o16 + 1] = (y + POS_OFF) * POS_SCALE;
    u16[o16 + 2] = (z + POS_OFF) * POS_SCALE;
    u16[o16 + 3] = u * UV_SCALE;
    u16[o16 + 4] = v * UV_SCALE;
    u16[o16 + 5] = layer;
    u8[o8 + 12] = sky * 17;
    u8[o8 + 13] = blk * 17;
    u8[o8 + 14] = shade * 255;
    u8[o8 + 15] = anim;
    u8[o8 + 16] = (tint >> 16) & 255;
    u8[o8 + 17] = (tint >> 8) & 255;
    u8[o8 + 18] = tint & 255;
    u8[o8 + 19] = flags;
  }
  slice() { return this.u8.slice(0, this.count * VERT_BYTES); }
}

export { VERT_BYTES, POS_SCALE, POS_OFF, UV_SCALE, FACE_VERTS, FACE_UV, uvFromPos, rotUV };
