// Biome registry. Colors are 0xRRGGBB. Ids are stored in saves: append only.
export const BiomeById = [];
export const Biomes = Object.create(null);
export const BIOME = Object.create(null); // name -> id

function reg(name, p) {
  const def = {
    id: BiomeById.length, name,
    display: name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    temperature: 0.8, downfall: 0.4,
    grass: 0x91bd59, foliage: 0x77ab2f, water: 0x3f76e4, waterFog: 0x050533,
    sky: 0x78a7ff, fog: 0xc0d8ff,
    snowy: false, // precipitation falls as snow / water freezes
    ...p,
  };
  BiomeById.push(def);
  Biomes[name] = def;
  BIOME[name] = def.id;
  return def;
}

reg('plains', { temperature: 0.8, downfall: 0.4, grass: 0x91bd59, foliage: 0x77ab2f, sky: 0x78a7ff });
reg('sunflower_plains', { temperature: 0.8, downfall: 0.4, grass: 0x91bd59, foliage: 0x77ab2f });
reg('forest', { temperature: 0.7, downfall: 0.8, grass: 0x79c05a, foliage: 0x59ae30, sky: 0x79a6ff });
reg('flower_forest', { temperature: 0.7, downfall: 0.8, grass: 0x79c05a, foliage: 0x59ae30 });
reg('birch_forest', { temperature: 0.6, downfall: 0.6, grass: 0x88bb67, foliage: 0x6ba941, sky: 0x7aa5ff });
reg('dark_forest', { temperature: 0.7, downfall: 0.8, grass: 0x507a32, foliage: 0x59ae30 });
reg('taiga', { temperature: 0.25, downfall: 0.8, grass: 0x86b783, foliage: 0x68a464, sky: 0x7da3ff });
reg('snowy_taiga', { temperature: -0.5, downfall: 0.4, grass: 0x80b497, foliage: 0x60a17b, snowy: true, water: 0x3d57d6, sky: 0x839eff });
reg('snowy_plains', { temperature: 0.0, downfall: 0.5, grass: 0x80b497, foliage: 0x60a17b, snowy: true, sky: 0x7fa1ff });
reg('desert', { temperature: 2.0, downfall: 0.0, grass: 0xbfb755, foliage: 0xaea42a, sky: 0x6eb1ff });
reg('savanna', { temperature: 2.0, downfall: 0.0, grass: 0xbfb755, foliage: 0xaea42a, sky: 0x6eb1ff });
reg('jungle', { temperature: 0.95, downfall: 0.9, grass: 0x59c93c, foliage: 0x30bb0b, sky: 0x77a8ff });
reg('swamp', { temperature: 0.8, downfall: 0.9, grass: 0x6a7039, foliage: 0x6a7039, water: 0x617b64, waterFog: 0x232317 });
reg('beach', { temperature: 0.8, downfall: 0.4, grass: 0x91bd59, foliage: 0x77ab2f });
reg('snowy_beach', { temperature: 0.05, downfall: 0.3, grass: 0x83b593, foliage: 0x64a278, snowy: true, water: 0x3d57d6 });
reg('stony_shore', { temperature: 0.2, downfall: 0.3, grass: 0x8ab689, foliage: 0x6da36b });
reg('river', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d });
reg('frozen_river', { temperature: 0.0, downfall: 0.5, grass: 0x80b497, foliage: 0x60a17b, snowy: true, water: 0x3938c9 });
reg('ocean', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d });
reg('deep_ocean', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d });
reg('warm_ocean', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d, water: 0x43d5ee });
reg('lukewarm_ocean', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d, water: 0x45adf2 });
reg('cold_ocean', { temperature: 0.5, downfall: 0.5, grass: 0x8eb971, foliage: 0x71a74d, water: 0x3d57d6 });
reg('frozen_ocean', { temperature: 0.0, downfall: 0.5, grass: 0x80b497, foliage: 0x60a17b, snowy: true, water: 0x3938c9 });
reg('windswept_hills', { temperature: 0.2, downfall: 0.3, grass: 0x8ab689, foliage: 0x6da36b, sky: 0x7da2ff });
reg('meadow', { temperature: 0.5, downfall: 0.8, grass: 0x83bb6d, foliage: 0x63a948, water: 0x0e4ecf });
reg('grove', { temperature: -0.2, downfall: 0.8, grass: 0x80b497, foliage: 0x60a17b, snowy: true });
reg('snowy_slopes', { temperature: -0.3, downfall: 0.9, grass: 0x80b497, foliage: 0x60a17b, snowy: true });
reg('jagged_peaks', { temperature: -0.7, downfall: 0.9, grass: 0x80b497, foliage: 0x60a17b, snowy: true });
reg('frozen_peaks', { temperature: -0.7, downfall: 0.9, grass: 0x80b497, foliage: 0x60a17b, snowy: true });
reg('stony_peaks', { temperature: 1.0, downfall: 0.3, grass: 0x9abe4b, foliage: 0x82ac1e });
reg('mushroom_fields', { temperature: 0.9, downfall: 1.0, grass: 0x55c93f, foliage: 0x2bbb0f });
reg('dripstone_caves', { temperature: 0.8, downfall: 0.4 });
reg('lush_caves', { temperature: 0.5, downfall: 0.5 });
reg('badlands', { temperature: 2.0, downfall: 0.0, grass: 0x90814d, foliage: 0x9e814d, sky: 0x6eb1ff });

// Nether biomes (no sky: `sky` is unused, `fog` is the dimension fog colour)
reg('nether_wastes', { temperature: 2.0, downfall: 0, fog: 0x330808, nether: true, grass: 0xbfb755, foliage: 0xaea42a });
reg('crimson_forest', { temperature: 2.0, downfall: 0, fog: 0x330303, nether: true, grass: 0xbfb755, foliage: 0xaea42a });
reg('warped_forest', { temperature: 2.0, downfall: 0, fog: 0x1a051a, nether: true, grass: 0xbfb755, foliage: 0xaea42a });
reg('soul_sand_valley', { temperature: 2.0, downfall: 0, fog: 0x1b4745, nether: true, grass: 0xbfb755, foliage: 0xaea42a });
reg('basalt_deltas', { temperature: 2.0, downfall: 0, fog: 0x685f70, nether: true, grass: 0xbfb755, foliage: 0xaea42a });

export const BIOME_COUNT = BiomeById.length;
