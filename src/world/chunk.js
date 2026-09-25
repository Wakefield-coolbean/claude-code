import { SECTION_COUNT, MIN_Y, MAX_Y } from '../constants.js';

// Chunk lifecycle
export const CS_EMPTY = 0;      // allocated, waiting for terrain
export const CS_TERRAIN = 1;    // terrain generated (or loaded), features not yet received
export const CS_DECORATED = 2;  // features from all 9 source chunks applied
export const CS_LIT = 3;        // light computed -> can be meshed once neighbours are lit

const SKY_FULL = 0xf0; // sky=15, block=0

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.sections = new Array(SECTION_COUNT).fill(null); // Uint16Array(4096) | null
    this.light = new Array(SECTION_COUNT).fill(null);    // Uint8Array(4096) | null  (sky << 4 | block)
    this.biomes = new Uint8Array(256);
    this.heightmap = new Int16Array(256).fill(MIN_Y - 1); // highest block that blocks/filters sky light
    this.features = [];          // feature descriptors (kept so re-generated neighbours can receive them)
    this.state = CS_EMPTY;
    this.fromSave = false;       // loaded from disk: never receives feature writes
    this.modified = false;       // needs saving
    this.dirty = new Set();      // section indices needing a remesh
    this.meshes = new Array(SECTION_COUNT).fill(null); // renderer data per section
    this.blockEntities = new Map(); // key local index "x,y,z" -> object (chests, furnaces...)
    this.entitiesToSpawn = null; // initial passive mobs from generation
    this.lastSaved = 0;
    this.inhabited = 0;
  }

  get key() { return chunkKey(this.cx, this.cz); }

  getLocal(x, y, z) {
    const s = this.sections[(y - MIN_Y) >> 4];
    if (s === null || s === undefined) return 0;
    return s[((y - MIN_Y) & 15) << 8 | z << 4 | x];
  }

  setLocal(x, y, z, v) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    let s = this.sections[si];
    if (s === null) {
      if (v === 0) return;
      s = this.sections[si] = new Uint16Array(4096);
    }
    s[((y - MIN_Y) & 15) << 8 | z << 4 | x] = v;
  }

  getLightLocal(x, y, z) {
    if (y >= MAX_Y) return SKY_FULL;
    if (y < MIN_Y) return 0;
    const l = this.light[(y - MIN_Y) >> 4];
    if (l === null) return SKY_FULL;
    return l[((y - MIN_Y) & 15) << 8 | z << 4 | x];
  }

  setLightLocal(x, y, z, v) {
    const si = (y - MIN_Y) >> 4;
    if (si < 0 || si >= SECTION_COUNT) return;
    let l = this.light[si];
    if (l === null) {
      if (v === SKY_FULL) return;
      l = this.light[si] = new Uint8Array(4096).fill(SKY_FULL);
    }
    l[((y - MIN_Y) & 15) << 8 | z << 4 | x] = v;
  }

  topSection() {
    for (let i = SECTION_COUNT - 1; i >= 0; i--) if (this.sections[i]) return i;
    return -1;
  }

  // Remove all-air sections to save memory
  compact() {
    for (let i = 0; i < SECTION_COUNT; i++) {
      const s = this.sections[i];
      if (!s) continue;
      let empty = true;
      for (let j = 0; j < 4096; j++) if (s[j] !== 0) { empty = false; break; }
      if (empty) this.sections[i] = null;
    }
  }
}

export function chunkKey(cx, cz) {
  return ((cx & 0xffff) | ((cz & 0xffff) << 16)) >>> 0;
}
