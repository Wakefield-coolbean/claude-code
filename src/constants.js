// Core world constants (mirrors Java Edition 1.18 values where applicable)
export const CHUNK_SIZE = 16;
export const MIN_Y = -64;          // bottom of the world (inclusive)
export const MAX_Y = 320;          // top of the world (exclusive)
export const WORLD_HEIGHT = MAX_Y - MIN_Y; // 384
export const SECTION_COUNT = WORLD_HEIGHT / 16; // 24
export const SEA_LEVEL = 63;
export const TICKS_PER_SECOND = 20;
export const TICK_MS = 1000 / TICKS_PER_SECOND;
export const DAY_LENGTH = 24000;

// Block values are packed 16-bit ints: low 12 bits = block id, high 4 bits = meta/state
export const ID_MASK = 0x0fff;
export const META_SHIFT = 12;
export const blockId = (v) => v & ID_MASK;
export const blockMeta = (v) => v >>> META_SHIFT;
export const packBlock = (id, meta = 0) => (id | (meta << META_SHIFT)) & 0xffff;

// Faces: index order used everywhere (meshing, lighting, raycast)
// 0 = -X (west), 1 = +X (east), 2 = -Y (down), 3 = +Y (up), 4 = -Z (north), 5 = +Z (south)
export const FACE_WEST = 0, FACE_EAST = 1, FACE_DOWN = 2, FACE_UP = 3, FACE_NORTH = 4, FACE_SOUTH = 5;
export const FACE_DIRS = [
  [-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1],
];
export const OPPOSITE_FACE = [1, 0, 3, 2, 5, 4];

// Horizontal facing used for block orientation meta (furnace, chest, stairs...)
// 0 = north (-Z), 1 = south (+Z), 2 = west (-X), 3 = east (+X)
export const FACING_NORTH = 0, FACING_SOUTH = 1, FACING_WEST = 2, FACING_EAST = 3;
