// Per-biome generation properties: surface materials, snow line, vegetation, tree mix.
import { BiomeById, BIOME } from '../../registry/biomes.js';
import * as I from './ids.js';

// surface categories
export const S_GRASS = 0, S_DESERT = 1, S_BEACH = 2, S_STONY_SHORE = 3, S_BADLANDS = 4, S_SNOWY_SLOPES = 5,
  S_JAGGED = 6, S_FROZEN_PEAKS = 7, S_STONY_PEAKS = 8, S_WINDSWEPT = 9, S_TAIGA = 10, S_OCEAN_WARM = 11,
  S_OCEAN = 12, S_OCEAN_COLD = 13, S_RIVER = 14, S_SWAMP = 15, S_GROVE = 16, S_SAVANNA = 17;

const FLOWERS_PLAINS = [I.DANDELION, I.POPPY, I.AZURE_BLUET, I.OXEYE_DAISY, I.CORNFLOWER, I.RED_TULIP, I.ORANGE_TULIP, I.WHITE_TULIP, I.PINK_TULIP];
const FLOWERS_FOREST = [I.DANDELION, I.POPPY, I.LILY_OF_THE_VALLEY];
const FLOWERS_FLOWER_FOREST = [I.DANDELION, I.POPPY, I.ALLIUM, I.AZURE_BLUET, I.RED_TULIP, I.ORANGE_TULIP, I.WHITE_TULIP,
  I.PINK_TULIP, I.OXEYE_DAISY, I.CORNFLOWER, I.LILY_OF_THE_VALLEY];
const FLOWERS_MEADOW = [I.DANDELION, I.POPPY, I.ALLIUM, I.AZURE_BLUET, I.OXEYE_DAISY, I.CORNFLOWER];
const FLOWERS_BASIC = [I.DANDELION, I.POPPY];
const FLOWERS_SWAMP = [I.BLUE_ORCHID];

// trees: list of [kind, weight]
const def = {
  surface: S_GRASS, grass: 0.12, fern: 0, flowers: FLOWERS_BASIC, flowerChance: 0.004,
  trees: 0, treeMix: [['oak', 1]], cold: false, snowLine: 1e9, deadBush: 0, cactus: 0, sugarCane: 0.3,
  mushrooms: 0.0005, berries: 0, pumpkin: 1 / 50, melon: 0, seagrass: 0, lilyPad: 0, water: false, mountain: false,
};

const P = {
  plains: { grass: 0.32, flowers: FLOWERS_PLAINS, flowerChance: 0.01, trees: 0.25, treeMix: [['oak', 9], ['fancy_oak', 1]] },
  sunflower_plains: { grass: 0.35, flowers: FLOWERS_PLAINS, flowerChance: 0.03, trees: 0.25, treeMix: [['oak', 9], ['fancy_oak', 1]] },
  forest: { grass: 0.14, flowers: FLOWERS_FOREST, flowerChance: 0.008, trees: 10, treeMix: [['oak', 72], ['birch', 20], ['fancy_oak', 8]] },
  flower_forest: { grass: 0.08, flowers: FLOWERS_FLOWER_FOREST, flowerChance: 0.2, trees: 5, treeMix: [['oak', 70], ['birch', 20], ['fancy_oak', 10]] },
  birch_forest: { grass: 0.14, flowers: FLOWERS_FOREST, flowerChance: 0.008, trees: 10, treeMix: [['birch', 80], ['tall_birch', 20]] },
  dark_forest: { grass: 0.1, flowers: FLOWERS_BASIC, flowerChance: 0.004, mushrooms: 0.012, trees: 16, treeMix: [['dark_oak', 75], ['oak', 12], ['birch', 8], ['fancy_oak', 5]] },
  taiga: { surface: S_TAIGA, grass: 0.12, fern: 0.6, trees: 10, treeMix: [['spruce', 2], ['pine', 1]], berries: 0.004, mushrooms: 0.002 },
  snowy_taiga: { surface: S_TAIGA, grass: 0.06, fern: 0.7, trees: 10, treeMix: [['spruce', 2], ['pine', 1]], cold: true },
  snowy_plains: { grass: 0.02, trees: 0.12, treeMix: [['spruce', 1]], cold: true, pumpkin: 0 },
  desert: { surface: S_DESERT, grass: 0, flowerChance: 0, deadBush: 0.02, cactus: 0.022, sugarCane: 0.6, pumpkin: 0 },
  savanna: { surface: S_SAVANNA, grass: 0.45, flowerChance: 0.003, trees: 1.2, treeMix: [['acacia', 8], ['oak', 2]] },
  jungle: { grass: 0.3, fern: 0.35, flowerChance: 0.003, trees: 24, treeMix: [['jungle', 45], ['jungle_bush', 35], ['mega_jungle', 8], ['fancy_oak', 4]], melon: 1 / 3 },
  swamp: { surface: S_SWAMP, grass: 0.18, flowers: FLOWERS_SWAMP, flowerChance: 0.01, trees: 2, treeMix: [['swamp_oak', 1]], lilyPad: 0.07, mushrooms: 0.006, sugarCane: 0.5 },
  beach: { surface: S_BEACH, grass: 0, flowerChance: 0, sugarCane: 0.4, pumpkin: 0 },
  snowy_beach: { surface: S_BEACH, grass: 0, flowerChance: 0, cold: true, sugarCane: 0, pumpkin: 0 },
  stony_shore: { surface: S_STONY_SHORE, grass: 0, flowerChance: 0, sugarCane: 0, pumpkin: 0 },
  river: { surface: S_RIVER, grass: 0.1, water: true, seagrass: 0.08, sugarCane: 0.5 },
  frozen_river: { surface: S_RIVER, grass: 0, water: true, cold: true, seagrass: 0.03, pumpkin: 0 },
  ocean: { surface: S_OCEAN, water: true, seagrass: 0.14 },
  deep_ocean: { surface: S_OCEAN_COLD, water: true, seagrass: 0.06 },
  warm_ocean: { surface: S_OCEAN_WARM, water: true, seagrass: 0.2 },
  lukewarm_ocean: { surface: S_OCEAN_WARM, water: true, seagrass: 0.18 },
  cold_ocean: { surface: S_OCEAN_COLD, water: true, seagrass: 0.1 },
  frozen_ocean: { surface: S_OCEAN_COLD, water: true, cold: true, seagrass: 0.03 },
  windswept_hills: { surface: S_WINDSWEPT, grass: 0.12, trees: 0.6, treeMix: [['oak', 1], ['spruce', 2]], mountain: true },
  meadow: { grass: 0.5, flowers: FLOWERS_MEADOW, flowerChance: 0.05, trees: 0.1, treeMix: [['oak', 1], ['birch', 1], ['fancy_oak', 1]], mountain: true, pumpkin: 0 },
  grove: { surface: S_GROVE, grass: 0, trees: 8, treeMix: [['spruce', 3], ['pine', 1]], cold: true, mountain: true, pumpkin: 0 },
  snowy_slopes: { surface: S_SNOWY_SLOPES, grass: 0, flowerChance: 0, cold: true, mountain: true, pumpkin: 0, sugarCane: 0 },
  jagged_peaks: { surface: S_JAGGED, grass: 0, flowerChance: 0, cold: true, mountain: true, pumpkin: 0, sugarCane: 0 },
  frozen_peaks: { surface: S_FROZEN_PEAKS, grass: 0, flowerChance: 0, cold: true, mountain: true, pumpkin: 0, sugarCane: 0 },
  stony_peaks: { surface: S_STONY_PEAKS, grass: 0.02, flowerChance: 0, mountain: true, pumpkin: 0, sugarCane: 0 },
  mushroom_fields: { grass: 0, mushrooms: 0.02 },
  badlands: { surface: S_BADLANDS, grass: 0, flowerChance: 0, deadBush: 0.02, cactus: 0.008, pumpkin: 0, sugarCane: 0.3 },
};

export const BINFO = BiomeById.map((b) => {
  const info = { ...def, ...(P[b.name] ?? {}), id: b.id, name: b.name };
  info.cold = info.cold || !!b.snowy;
  // snow line from temperature, like MC: temp drops 0.05 per 30 blocks above y=80, snow below 0.15
  info.snowLine = info.cold ? -1e9 : b.temperature <= 0.15 ? -1e9 : 80 + (b.temperature - 0.15) / (0.05 / 30);
  info.freezes = info.snowLine < 64;
  // cumulative tree weights
  const tot = info.treeMix.reduce((s, [, w]) => s + w, 0);
  let acc = 0;
  info.treeCum = info.treeMix.map(([k, w]) => { acc += w / tot; return [k, acc]; });
  return info;
});

export function pickTree(info, r) {
  for (const [k, c] of info.treeCum) if (r <= c) return k;
  return info.treeCum[info.treeCum.length - 1][0];
}

export { BIOME };
