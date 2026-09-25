// Block ids used by world generation, resolved once from the registry (with safe fallbacks
// so generation never writes an undefined id if a block is renamed/removed).
import { B, IS_SOLID } from '../../registry/blocks.js';
import { packBlock } from '../../constants.js';

const id = (name, fallback = 'stone') => B[name] ?? B[fallback] ?? 1;

export const AIR = 0;
export const STONE = id('stone');
export const GRANITE = id('granite');
export const DIORITE = id('diorite');
export const ANDESITE = id('andesite');
export const DEEPSLATE = id('deepslate');
export const TUFF = id('tuff', 'andesite');
export const CALCITE = id('calcite', 'diorite');
export const BEDROCK = id('bedrock');
export const DIRT = id('dirt');
export const COARSE_DIRT = id('coarse_dirt', 'dirt');
export const PODZOL = id('podzol', 'dirt');
export const GRASS_BLOCK = id('grass_block', 'dirt');
export const SAND = id('sand');
export const RED_SAND = id('red_sand', 'sand');
export const SANDSTONE = id('sandstone');
export const GRAVEL = id('gravel');
export const CLAY = id('clay', 'dirt');
export const TERRACOTTA = id('terracotta', 'sandstone');
export const WATER = id('water');
export const LAVA = id('lava');
export const ICE = id('ice');
export const PACKED_ICE = id('packed_ice', 'ice');
export const SNOW = id('snow', 'air');           // snow layer, meta = layers-1
export const SNOW_BLOCK = id('snow_block');
export const OBSIDIAN = id('obsidian');
export const COBBLESTONE = id('cobblestone');
export const MOSSY_COBBLESTONE = id('mossy_cobblestone', 'cobblestone');
export const SPAWNER = id('spawner', 'cobblestone');
export const CHEST = id('chest', 'cobblestone');
export const DRIPSTONE_BLOCK = id('dripstone_block', 'stone');
export const MOSS_BLOCK = id('moss_block', 'stone');

export const COAL_ORE = id('coal_ore'), DEEPSLATE_COAL_ORE = id('deepslate_coal_ore', 'coal_ore');
export const IRON_ORE = id('iron_ore'), DEEPSLATE_IRON_ORE = id('deepslate_iron_ore', 'iron_ore');
export const COPPER_ORE = id('copper_ore'), DEEPSLATE_COPPER_ORE = id('deepslate_copper_ore', 'copper_ore');
export const GOLD_ORE = id('gold_ore'), DEEPSLATE_GOLD_ORE = id('deepslate_gold_ore', 'gold_ore');
export const REDSTONE_ORE = id('redstone_ore'), DEEPSLATE_REDSTONE_ORE = id('deepslate_redstone_ore', 'redstone_ore');
export const LAPIS_ORE = id('lapis_ore'), DEEPSLATE_LAPIS_ORE = id('deepslate_lapis_ore', 'lapis_ore');
export const DIAMOND_ORE = id('diamond_ore'), DEEPSLATE_DIAMOND_ORE = id('deepslate_diamond_ore', 'diamond_ore');
export const EMERALD_ORE = id('emerald_ore'), DEEPSLATE_EMERALD_ORE = id('deepslate_emerald_ore', 'emerald_ore');

// logs / leaves
export const OAK_LOG = id('oak_log'), SPRUCE_LOG = id('spruce_log', 'oak_log'), BIRCH_LOG = id('birch_log', 'oak_log');
export const JUNGLE_LOG = id('jungle_log', 'oak_log'), ACACIA_LOG = id('acacia_log', 'oak_log'), DARK_OAK_LOG = id('dark_oak_log', 'oak_log');
export const OAK_LEAVES = id('oak_leaves'), SPRUCE_LEAVES = id('spruce_leaves', 'oak_leaves'), BIRCH_LEAVES = id('birch_leaves', 'oak_leaves');
export const JUNGLE_LEAVES = id('jungle_leaves', 'oak_leaves'), ACACIA_LEAVES = id('acacia_leaves', 'oak_leaves'), DARK_OAK_LEAVES = id('dark_oak_leaves', 'oak_leaves');

// plants
export const GRASS = id('grass', 'air');
export const FERN = id('fern', 'grass');
export const DEAD_BUSH = id('dead_bush', 'air');
export const CACTUS = id('cactus', 'air');
export const SUGAR_CANE = id('sugar_cane', 'air');
export const PUMPKIN = id('pumpkin', 'air');
export const MELON = id('melon', 'air');
export const BROWN_MUSHROOM = id('brown_mushroom', 'air');
export const RED_MUSHROOM = id('red_mushroom', 'air');
export const SWEET_BERRY_BUSH = id('sweet_berry_bush', 'air');
export const SEAGRASS = id('seagrass', 'water');
export const LILY_PAD = id('lily_pad', 'air');
export const DANDELION = id('dandelion', 'air'), POPPY = id('poppy', 'air'), BLUE_ORCHID = id('blue_orchid', 'air');
export const ALLIUM = id('allium', 'air'), AZURE_BLUET = id('azure_bluet', 'air'), RED_TULIP = id('red_tulip', 'air');
export const ORANGE_TULIP = id('orange_tulip', 'air'), WHITE_TULIP = id('white_tulip', 'air'), PINK_TULIP = id('pink_tulip', 'air');
export const OXEYE_DAISY = id('oxeye_daisy', 'air'), CORNFLOWER = id('cornflower', 'air'), LILY_OF_THE_VALLEY = id('lily_of_the_valley', 'air');

export const SWEET_BERRY_MATURE = packBlock(SWEET_BERRY_BUSH, 3);
export const LOG_X = 1, LOG_Z = 2; // axis meta
export const logX = (logId) => packBlock(logId, LOG_X);
export const logZ = (logId) => packBlock(logId, LOG_Z);

// Lookup: natural terrain blocks that carvers may remove and that count as "ground".
export const CARVABLE = new Uint8Array(4096);
for (const b of [STONE, GRANITE, DIORITE, ANDESITE, DEEPSLATE, TUFF, CALCITE, DIRT, COARSE_DIRT, PODZOL, GRASS_BLOCK,
  SAND, RED_SAND, SANDSTONE, GRAVEL, CLAY, TERRACOTTA, SNOW_BLOCK, PACKED_ICE, DRIPSTONE_BLOCK, MOSS_BLOCK,
  COAL_ORE, DEEPSLATE_COAL_ORE, IRON_ORE, DEEPSLATE_IRON_ORE, COPPER_ORE, DEEPSLATE_COPPER_ORE]) CARVABLE[b] = 1;

// Solid (collidable) lookup by id; mirrors the registry.
export const SOLID = IS_SOLID;
