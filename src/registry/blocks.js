// Block registry. Ids are assigned in declaration order and are saved to disk,
// so only ever APPEND new blocks to the end of the list.
//
// Field reference:
//   name       - registry name (also the default texture name)
//   display    - UI name
//   tex        - texture spec: 'name' | { top, bottom, side, north, south, east, west, front }
//   render     - 'air' | 'cube' | 'cross' | 'liquid' | 'model'
//   shape      - for render 'model': key into registry/shapes.js
//   layer      - 'solid' | 'cutout' | 'translucent'
//   opaque     - full, light-blocking cube that hides neighbour faces
//   solid      - participates in collision
//   hardness   - base break hardness (-1 = unbreakable)
//   tool       - preferred tool type: pickaxe | axe | shovel | hoe | shears | sword
//   tier       - minimum tool tier to harvest (0 wood, 1 stone, 2 iron, 3 diamond)
//   needsTool  - block drops nothing unless mined with the correct tool/tier
//   sound      - sound group: stone | wood | gravel | grass | sand | glass | wool | snow | metal | ladder
//   light      - light emission (0-15)
//   filter     - extra light absorption for non-opaque blocks
//   tint       - biome tint: grass | foliage | water | birch | spruce
//   drops      - undefined = itself, null = nothing, 'item' or function(ctx) -> [{ item, count }]
//   gravity    - falls like sand
//   replaceable- can be placed into (air, grass, water, snow layer)
//   orient     - how meta is set on placement: 'axis' | 'facing' | 'slab' | 'stairs' | 'torch' | 'door' | 'bed' | 'ladder'
//   interact   - right click behaviour key (crafting_table, furnace, chest, door, bed, tnt ...)
//   randomTick - receives random ticks
//   support    - 'soil' (needs grass/dirt below) | 'solid' (needs sturdy block below) | 'farmland' | 'sand' | 'wall'
//   slip       - friction factor (default 0.6, ice 0.98)
import { blockId as _bid, blockMeta as _bmeta } from '../constants.js';

export const BlockById = [];
export const Blocks = Object.create(null); // name -> def
export const B = Object.create(null);      // name -> id (shorthand for code)

const DEFAULTS = {
  render: 'cube', layer: 'solid', opaque: true, solid: true, hardness: 1, tool: null, tier: 0,
  needsTool: false, sound: 'stone', light: 0, filter: 0, tint: null, gravity: false,
  replaceable: false, orient: null, interact: null, randomTick: false, support: null,
  slip: 0.6, liquid: null, item: true, flammable: false, climbable: false, shape: null,
  xp: null, stack: 64,
};

function titleCase(name) {
  return name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function resolveTextures(tex, name) {
  // Returns [west, east, down, up, north, south] texture names (face index order).
  if (tex == null) tex = name;
  if (typeof tex === 'string') return [tex, tex, tex, tex, tex, tex];
  const side = tex.side ?? tex.all ?? name;
  const top = tex.top ?? tex.end ?? side;
  const bottom = tex.bottom ?? tex.end ?? top;
  return [
    tex.west ?? side, tex.east ?? side, bottom, top,
    tex.north ?? tex.front ?? side, tex.south ?? side,
  ];
}

function reg(name, props = {}) {
  const def = { ...DEFAULTS, ...props };
  def.id = BlockById.length;
  def.name = name;
  def.display = props.display ?? titleCase(name);
  def.faces = resolveTextures(props.tex, name);
  def.front = typeof props.tex === 'object' && props.tex ? props.tex.front ?? null : null;
  def.particle = props.particle ?? def.faces[4];
  if (def.render === 'cross' || def.render === 'air' || def.render === 'liquid' || def.render === 'model') {
    if (props.opaque === undefined) def.opaque = false;
  }
  if (def.render === 'cross') {
    if (props.solid === undefined) def.solid = false;
    if (props.layer === undefined) def.layer = 'cutout';
    if (props.hardness === undefined) def.hardness = 0;
    if (props.sound === undefined) def.sound = 'grass';
  }
  BlockById.push(def);
  Blocks[name] = def;
  B[name] = def.id;
  return def;
}

// ---------- helpers for common block families ----------
const stoneLike = (hardness = 1.5, extra = {}) => ({ hardness, tool: 'pickaxe', needsTool: true, sound: 'stone', ...extra });
const oreDrop = (item, min = 1, max = 1) => (ctx) => {
  if (ctx.silkTouch) return [{ item: ctx.block.name, count: 1 }];
  let count = min + Math.floor(ctx.rand() * (max - min + 1));
  if (ctx.fortune > 0) {
    const bonus = Math.floor(ctx.rand() * (ctx.fortune + 2)) - 1;
    count *= Math.max(1, bonus + 1);
  }
  return [{ item, count }];
};
const plant = (extra = {}) => ({ render: 'cross', support: 'soil', replaceable: false, ...extra });
const log = (name) => ({ tex: { side: name, top: name + '_top' }, hardness: 2, tool: 'axe', sound: 'wood', orient: 'axis', flammable: true, fuel: 300 });
const leaves = (tint, sapling) => ({
  layer: 'cutout', opaque: false, hardness: 0.2, tool: 'hoe', sound: 'grass', tint, filter: 1,
  randomTick: true, flammable: true, leaves: true, sapling,
  drops: (ctx) => {
    if (ctx.tool === 'shears' || ctx.silkTouch) return [{ item: ctx.block.name, count: 1 }];
    const out = [];
    if (ctx.rand() < (sapling === 'jungle_sapling' ? 0.025 : 0.05)) out.push({ item: sapling, count: 1 });
    if (ctx.rand() < 0.02) out.push({ item: 'stick', count: 1 + Math.floor(ctx.rand() * 2) });
    if ((ctx.block.name === 'oak_leaves' || ctx.block.name === 'dark_oak_leaves') && ctx.rand() < 0.005) out.push({ item: 'apple', count: 1 });
    return out;
  },
});
const wool = { hardness: 0.8, tool: 'shears', sound: 'wool', flammable: true };

// ---------- the registry ----------
reg('air', { render: 'air', opaque: false, solid: false, hardness: 0, replaceable: true, item: false, layer: 'none' });
reg('stone', stoneLike(1.5, { drops: 'cobblestone' }));
reg('granite', stoneLike());
reg('polished_granite', stoneLike());
reg('diorite', stoneLike());
reg('polished_diorite', stoneLike());
reg('andesite', stoneLike());
reg('polished_andesite', stoneLike());
reg('grass_block', {
  tex: { top: 'grass_block_top', bottom: 'dirt', side: 'dirt' }, overlay: 'grass_block_side_overlay',
  snowySide: 'grass_block_snow', hardness: 0.6, tool: 'shovel', sound: 'grass', tint: 'grass', tintTop: true,
  randomTick: true, drops: 'dirt', particle: 'dirt',
});
reg('dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg('coarse_dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg('podzol', { tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hardness: 0.5, tool: 'shovel', sound: 'gravel', drops: 'dirt' });
reg('cobblestone', stoneLike(2));
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
  reg(`${w}_planks`, { hardness: 2, tool: 'axe', sound: 'wood', flammable: true, fuel: 300 });
}
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
  reg(`${w}_sapling`, plant({ randomTick: true, sapling: w, fuel: 100 }));
}
reg('bedrock', { hardness: -1, sound: 'stone' });
reg('water', {
  render: 'liquid', layer: 'translucent', solid: false, hardness: 100, liquid: 'water', tint: 'water',
  tex: { side: 'water_flow', top: 'water_still' }, filter: 1, replaceable: true, item: false, drops: null, sound: 'none',
});
reg('lava', {
  render: 'liquid', layer: 'solid', solid: false, hardness: 100, liquid: 'lava',
  tex: { side: 'lava_flow', top: 'lava_still' }, light: 15, filter: 15, replaceable: true, item: false, drops: null, sound: 'none',
});
reg('sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
reg('red_sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
reg('gravel', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drops: (ctx) => [{ item: !ctx.silkTouch && ctx.rand() < [0.1, 0.14, 0.25, 1][Math.min(3, ctx.fortune)] ? 'flint' : 'gravel', count: 1 }],
});
reg('gold_ore', stoneLike(3, { tier: 2, drops: oreDrop('raw_gold') }));
reg('deepslate_gold_ore', stoneLike(4.5, { tier: 2, drops: oreDrop('raw_gold'), sound: 'deepslate' }));
reg('iron_ore', stoneLike(3, { tier: 1, drops: oreDrop('raw_iron') }));
reg('deepslate_iron_ore', stoneLike(4.5, { tier: 1, drops: oreDrop('raw_iron'), sound: 'deepslate' }));
reg('coal_ore', stoneLike(3, { tier: 0, drops: oreDrop('coal'), xp: [0, 2] }));
reg('deepslate_coal_ore', stoneLike(4.5, { tier: 0, drops: oreDrop('coal'), xp: [0, 2], sound: 'deepslate' }));
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) reg(`${w}_log`, log(`${w}_log`));
reg('oak_leaves', leaves('foliage', 'oak_sapling'));
reg('spruce_leaves', leaves('spruce', 'spruce_sapling'));
reg('birch_leaves', leaves('birch', 'birch_sapling'));
reg('jungle_leaves', leaves('foliage', 'jungle_sapling'));
reg('acacia_leaves', leaves('foliage', 'acacia_sapling'));
reg('dark_oak_leaves', leaves('foliage', 'dark_oak_sapling'));
reg('glass', { layer: 'cutout', opaque: false, hardness: 0.3, sound: 'glass', drops: null, cullSame: true });
reg('lapis_ore', stoneLike(3, { tier: 1, drops: oreDrop('lapis_lazuli', 4, 9), xp: [2, 5] }));
reg('deepslate_lapis_ore', stoneLike(4.5, { tier: 1, drops: oreDrop('lapis_lazuli', 4, 9), xp: [2, 5], sound: 'deepslate' }));
reg('lapis_block', stoneLike(3, { tier: 1 }));
reg('sandstone', stoneLike(0.8, { tex: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' } }));
reg('cut_sandstone', stoneLike(0.8, { tex: { side: 'cut_sandstone', top: 'sandstone_top' } }));
export const WOOL_COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
for (const c of WOOL_COLORS) reg(`${c}_wool`, { ...wool });
for (const f of ['dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip',
  'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley']) {
  reg(f, plant({ flower: true }));
}
reg('brown_mushroom', plant({ support: 'mushroom', light: 1 }));
reg('red_mushroom', plant({ support: 'mushroom' }));
reg('gold_block', stoneLike(3, { tier: 2, sound: 'metal' }));
reg('iron_block', stoneLike(5, { tier: 1, sound: 'metal' }));
reg('bricks', stoneLike(2));
reg('tnt', { tex: { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' }, hardness: 0, sound: 'grass', interact: 'tnt', flammable: true });
reg('bookshelf', { tex: { side: 'bookshelf', top: 'oak_planks' }, hardness: 1.5, tool: 'axe', sound: 'wood', drops: (ctx) => [{ item: 'book', count: 3 }], flammable: true, fuel: 300 });
reg('mossy_cobblestone', stoneLike(2));
reg('obsidian', stoneLike(50, { tier: 3 }));
reg('torch', { render: 'model', shape: 'torch', layer: 'cutout', solid: false, hardness: 0, light: 14, sound: 'wood', orient: 'torch', support: 'torch', tex: 'torch' });
reg('chest', {
  render: 'model', shape: 'chest', tex: { top: 'chest_top', side: 'chest_side', front: 'chest_front', bottom: 'chest_top' },
  hardness: 2.5, tool: 'axe', sound: 'wood', orient: 'facing', interact: 'chest', fuel: 300, particle: 'oak_planks',
});
reg('diamond_ore', stoneLike(3, { tier: 2, drops: oreDrop('diamond'), xp: [3, 7] }));
reg('deepslate_diamond_ore', stoneLike(4.5, { tier: 2, drops: oreDrop('diamond'), xp: [3, 7], sound: 'deepslate' }));
reg('diamond_block', stoneLike(5, { tier: 2, sound: 'metal' }));
reg('crafting_table', {
  tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', north: 'crafting_table_front', south: 'crafting_table_front' },
  hardness: 2.5, tool: 'axe', sound: 'wood', interact: 'crafting_table', fuel: 300,
});
reg('wheat', {
  render: 'model', shape: 'crop', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'crop', item: false,
  support: 'farmland', randomTick: true, crop: { stages: 8, tex: 'wheat_stage', seed: 'wheat_seeds', produce: 'wheat' },
  drops: (ctx) => ctx.meta >= 7
    ? [{ item: 'wheat', count: 1 }, { item: 'wheat_seeds', count: 1 + Math.floor(ctx.rand() * 3) }]
    : [{ item: 'wheat_seeds', count: 1 }],
  tex: 'wheat_stage7',
});
reg('farmland', {
  render: 'model', shape: 'farmland', opaque: false, tex: { top: 'farmland', side: 'dirt', bottom: 'dirt' },
  hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: 'dirt', randomTick: true, particle: 'dirt',
});
reg('furnace', {
  tex: { front: 'furnace_front', side: 'furnace_side', top: 'furnace_top' }, ...stoneLike(3.5), orient: 'facing', interact: 'furnace',
});
reg('lit_furnace', {
  tex: { front: 'furnace_front_on', side: 'furnace_side', top: 'furnace_top' }, ...stoneLike(3.5), orient: 'facing', interact: 'furnace',
  light: 13, drops: (ctx) => ctx.canHarvest ? [{ item: 'furnace', count: 1 }] : [], item: false, display: 'Furnace',
});
reg('oak_door', {
  render: 'model', shape: 'door', layer: 'cutout', tex: { top: 'oak_door_top', bottom: 'oak_door_bottom', side: 'oak_door_bottom' }, hardness: 3, tool: 'axe',
  sound: 'wood', orient: 'door', interact: 'door', support: 'door', fuel: 200, itemTexture: 'oak_door', particle: 'oak_door_bottom',
});
reg('ladder', { render: 'model', shape: 'ladder', layer: 'cutout', hardness: 0.4, tool: 'axe', sound: 'ladder', orient: 'ladder', climbable: true, support: 'wall', fuel: 300 });
reg('oak_stairs', { render: 'model', shape: 'stairs', tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'stairs', fuel: 300 });
reg('cobblestone_stairs', { render: 'model', shape: 'stairs', tex: 'cobblestone', ...stoneLike(2), orient: 'stairs' });
reg('stone_brick_stairs', { render: 'model', shape: 'stairs', tex: 'stone_bricks', ...stoneLike(1.5), orient: 'stairs' });
reg('redstone_ore', stoneLike(3, { tier: 2, drops: oreDrop('redstone', 4, 5), xp: [1, 5] }));
reg('deepslate_redstone_ore', stoneLike(4.5, { tier: 2, drops: oreDrop('redstone', 4, 5), xp: [1, 5], sound: 'deepslate' }));
reg('snow', {
  render: 'model', shape: 'layer', tex: 'snow', hardness: 0.1, tool: 'shovel', needsTool: true, sound: 'snow', replaceable: true,
  support: 'solid', drops: (ctx) => [{ item: 'snowball', count: (ctx.meta + 1) }], display: 'Snow',
});
reg('ice', { layer: 'translucent', opaque: false, hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: null, filter: 1, cullSame: true });
reg('snow_block', { tex: 'snow', hardness: 0.2, tool: 'shovel', needsTool: true, sound: 'snow', drops: (ctx) => [{ item: 'snowball', count: 4 }] });
reg('cactus', {
  render: 'model', shape: 'cactus', layer: 'cutout', tex: { top: 'cactus_top', side: 'cactus_side', bottom: 'cactus_bottom' },
  hardness: 0.4, sound: 'wool', randomTick: true, support: 'sand', damageOnTouch: 1,
});
reg('clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: (ctx) => [{ item: 'clay_ball', count: 4 }] });
reg('sugar_cane', { render: 'cross', tint: 'grass', support: 'cane', randomTick: true, drops: 'sugar_cane', solid: false, sound: 'grass', hardness: 0 });
reg('oak_fence', { render: 'model', shape: 'fence', tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300 });
reg('pumpkin', { tex: { side: 'pumpkin_side', top: 'pumpkin_top' }, hardness: 1, tool: 'axe', sound: 'wood' });
reg('carved_pumpkin', { tex: { side: 'pumpkin_side', top: 'pumpkin_top', front: 'carved_pumpkin' }, hardness: 1, tool: 'axe', sound: 'wood', orient: 'facing', armorSlot: 'head' });
reg('jack_o_lantern', { tex: { side: 'pumpkin_side', top: 'pumpkin_top', front: 'jack_o_lantern' }, hardness: 1, tool: 'axe', sound: 'wood', orient: 'facing', light: 15 });
reg('glowstone', { hardness: 0.3, sound: 'glass', light: 15, drops: (ctx) => [{ item: 'glowstone_dust', count: 2 + Math.floor(ctx.rand() * 3) }] });
reg('stone_bricks', stoneLike(1.5));
reg('mossy_stone_bricks', stoneLike(1.5));
reg('cracked_stone_bricks', stoneLike(1.5));
reg('melon', { tex: { side: 'melon_side', top: 'melon_top' }, hardness: 1, tool: 'axe', sound: 'wood', drops: (ctx) => [{ item: 'melon_slice', count: 3 + Math.floor(ctx.rand() * 5) }] });
reg('emerald_ore', stoneLike(3, { tier: 2, drops: oreDrop('emerald'), xp: [3, 7] }));
reg('deepslate_emerald_ore', stoneLike(4.5, { tier: 2, drops: oreDrop('emerald'), xp: [3, 7], sound: 'deepslate' }));
reg('emerald_block', stoneLike(5, { tier: 2, sound: 'metal' }));
reg('copper_ore', stoneLike(3, { tier: 1, drops: oreDrop('raw_copper', 2, 5) }));
reg('deepslate_copper_ore', stoneLike(4.5, { tier: 1, drops: oreDrop('raw_copper', 2, 5), sound: 'deepslate' }));
reg('copper_block', stoneLike(3, { tier: 1, sound: 'metal' }));
reg('coal_block', stoneLike(5, { tier: 0, fuel: 16000 }));
reg('redstone_block', stoneLike(5, { tier: 0, sound: 'metal' }));
reg('hay_block', { tex: { side: 'hay_block_side', top: 'hay_block_top' }, hardness: 0.5, tool: 'hoe', sound: 'grass', orient: 'axis' });
reg('packed_ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: null });
reg('grass', plant({ tint: 'grass', replaceable: true, drops: (ctx) => (ctx.tool === 'shears' ? [{ item: 'grass', count: 1 }] : ctx.rand() < 0.125 ? [{ item: 'wheat_seeds', count: 1 }] : []) }));
reg('fern', plant({ tint: 'grass', replaceable: true, drops: (ctx) => (ctx.tool === 'shears' ? [{ item: 'fern', count: 1 }] : ctx.rand() < 0.125 ? [{ item: 'wheat_seeds', count: 1 }] : []) }));
reg('dead_bush', plant({ support: 'dead_bush', replaceable: true, drops: (ctx) => (ctx.tool === 'shears' ? [{ item: 'dead_bush', count: 1 }] : [{ item: 'stick', count: Math.floor(ctx.rand() * 3) }]), fuel: 100 }));
reg('deepslate', stoneLike(3, { tex: { side: 'deepslate', top: 'deepslate_top' }, drops: 'cobbled_deepslate', orient: 'axis', sound: 'deepslate' }));
reg('cobbled_deepslate', stoneLike(3.5, { sound: 'deepslate' }));
reg('polished_deepslate', stoneLike(3.5, { sound: 'deepslate' }));
reg('deepslate_bricks', stoneLike(3.5, { sound: 'deepslate' }));
reg('deepslate_tiles', stoneLike(3.5, { sound: 'deepslate' }));
reg('tuff', stoneLike(1.5));
reg('calcite', stoneLike(0.75));
reg('amethyst_block', stoneLike(1.5, { needsTool: false, sound: 'amethyst' }));
reg('dripstone_block', stoneLike(1.5));
reg('moss_block', { hardness: 0.1, tool: 'hoe', sound: 'grass' });
reg('smooth_stone', stoneLike(2));
reg('oak_slab', { render: 'model', shape: 'slab', tex: 'oak_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'slab', fuel: 150 });
reg('cobblestone_slab', { render: 'model', shape: 'slab', tex: 'cobblestone', ...stoneLike(2), orient: 'slab' });
reg('stone_slab', { render: 'model', shape: 'slab', tex: { top: 'smooth_stone', side: 'smooth_stone_slab_side' }, ...stoneLike(2), orient: 'slab', display: 'Smooth Stone Slab' });
reg('stone_brick_slab', { render: 'model', shape: 'slab', tex: 'stone_bricks', ...stoneLike(1.5), orient: 'slab' });
reg('red_bed', {
  render: 'model', shape: 'bed', layer: 'cutout', hardness: 0.2, sound: 'wood', orient: 'bed', interact: 'bed', stack: 1,
  tex: 'bed_foot_top', itemTexture: 'red_bed', particle: 'bed_foot_side', display: 'Red Bed',
});
reg('dirt_path', { render: 'model', shape: 'path', opaque: false, tex: { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' }, hardness: 0.65, tool: 'shovel', sound: 'grass', drops: 'dirt' });
reg('carrots', {
  render: 'model', shape: 'crop', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'crop', item: false, support: 'farmland', randomTick: true,
  crop: { stages: 8, texStages: [0, 0, 1, 1, 2, 2, 2, 3], tex: 'carrots_stage', seed: 'carrot' }, tex: 'carrots_stage3',
  drops: (ctx) => [{ item: 'carrot', count: ctx.meta >= 7 ? 2 + Math.floor(ctx.rand() * 3) : 1 }],
});
reg('potatoes', {
  render: 'model', shape: 'crop', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'crop', item: false, support: 'farmland', randomTick: true,
  crop: { stages: 8, texStages: [0, 0, 1, 1, 2, 2, 2, 3], tex: 'potatoes_stage', seed: 'potato' }, tex: 'potatoes_stage3',
  drops: (ctx) => {
    const out = [{ item: 'potato', count: ctx.meta >= 7 ? 2 + Math.floor(ctx.rand() * 3) : 1 }];
    if (ctx.meta >= 7 && ctx.rand() < 0.02) out.push({ item: 'poisonous_potato', count: 1 });
    return out;
  },
});
reg('oak_trapdoor', { render: 'model', shape: 'trapdoor', layer: 'cutout', tex: 'oak_trapdoor', hardness: 3, tool: 'axe', sound: 'wood', orient: 'trapdoor', interact: 'trapdoor', fuel: 300 });
reg('glass_pane', { render: 'model', shape: 'pane', layer: 'cutout', tex: 'glass', hardness: 0.3, sound: 'glass', drops: null, itemTexture: 'glass' });
reg('cobweb', { render: 'cross', layer: 'cutout', solid: false, hardness: 4, tool: 'sword', needsTool: true, sound: 'stone', cobweb: true, support: null, drops: (ctx) => (ctx.tool === 'shears' ? [{ item: 'cobweb', count: 1 }] : ctx.tool === 'sword' ? [{ item: 'string', count: 1 }] : []) });
reg('fire', { render: 'cross', layer: 'cutout', solid: false, hardness: 0, light: 15, item: false, drops: null, replaceable: true, randomTick: true, tex: 'fire_0', sound: 'none' });
reg('spawner', { layer: 'cutout', opaque: false, ...stoneLike(5), drops: null, xp: [15, 43], item: false });
reg('white_carpet', { render: 'model', shape: 'carpet', tex: 'white_wool', hardness: 0.1, sound: 'wool', support: 'any', flammable: true });
reg('red_carpet', { render: 'model', shape: 'carpet', tex: 'red_wool', hardness: 0.1, sound: 'wool', support: 'any', flammable: true });
reg('brick_slab', { render: 'model', shape: 'slab', tex: 'bricks', ...stoneLike(2), orient: 'slab' });
reg('brick_stairs', { render: 'model', shape: 'stairs', tex: 'bricks', ...stoneLike(2), orient: 'stairs' });
reg('sandstone_slab', { render: 'model', shape: 'slab', tex: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' }, ...stoneLike(2), orient: 'slab' });
reg('sandstone_stairs', { render: 'model', shape: 'stairs', tex: { side: 'sandstone', top: 'sandstone_top', bottom: 'sandstone_bottom' }, ...stoneLike(0.8), orient: 'stairs' });
reg('spruce_stairs', { render: 'model', shape: 'stairs', tex: 'spruce_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'stairs', fuel: 300 });
reg('birch_stairs', { render: 'model', shape: 'stairs', tex: 'birch_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'stairs', fuel: 300 });
reg('spruce_slab', { render: 'model', shape: 'slab', tex: 'spruce_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'slab', fuel: 150 });
reg('birch_slab', { render: 'model', shape: 'slab', tex: 'birch_planks', hardness: 2, tool: 'axe', sound: 'wood', orient: 'slab', fuel: 150 });
reg('raw_iron_block', stoneLike(5, { tier: 1 }));
reg('raw_gold_block', stoneLike(5, { tier: 2 }));
reg('raw_copper_block', stoneLike(5, { tier: 1 }));
reg('terracotta', stoneLike(1.25));
reg('seagrass', { render: 'cross', layer: 'cutout', solid: false, hardness: 0, sound: 'grass', waterlogged: true, drops: (ctx) => (ctx.tool === 'shears' ? [{ item: 'seagrass', count: 1 }] : []), support: 'solid' });
reg('lily_pad', { render: 'model', shape: 'lily_pad', layer: 'cutout', solid: true, hardness: 0, sound: 'grass', tint: 'lily', support: 'water' });
reg('sweet_berry_bush', { render: 'cross', layer: 'cutout', solid: false, hardness: 0, sound: 'grass', support: 'soil', randomTick: true, item: false, drops: (ctx) => (ctx.meta >= 2 ? [{ item: 'sweet_berries', count: ctx.meta >= 3 ? 2 + Math.floor(ctx.rand() * 2) : 1 + Math.floor(ctx.rand() * 2) }] : [{ item: 'sweet_berries', count: 1 }]), tex: 'sweet_berry_bush_stage3', berry: true });

reg('enchanting_table', {
  render: 'model', shape: 'enchanting_table', tex: { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'enchanting_table_bottom' },
  ...stoneLike(5), light: 7, interact: 'enchanting_table', resistance: 1200,
});
reg('anvil', {
  render: 'model', shape: 'anvil', tex: { top: 'anvil_top', side: 'anvil', bottom: 'anvil' }, ...stoneLike(5), sound: 'metal',
  orient: 'facing', interact: 'anvil', gravity: true, resistance: 1200, particle: 'anvil',
});
reg('lantern', { render: 'model', shape: 'lantern', layer: 'cutout', tex: 'lantern', ...stoneLike(3.5, { needsTool: false }), sound: 'metal', light: 15, orient: 'lantern', support: 'lantern', particle: 'lantern' });
for (const w of ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak']) {
  reg(`stripped_${w}_log`, { tex: { side: `stripped_${w}_log`, top: `stripped_${w}_log_top` }, hardness: 2, tool: 'axe', sound: 'wood', orient: 'axis', flammable: true, fuel: 300 });
}

// ---------- the Nether ----------
reg('netherrack', stoneLike(0.4, { sound: 'netherrack', flammable: false, infiniburn: true }));
reg('nether_bricks', stoneLike(2, { sound: 'nether_bricks' }));
reg('nether_brick_fence', { render: 'model', shape: 'fence', tex: 'nether_bricks', ...stoneLike(2, { sound: 'nether_bricks' }) });
reg('nether_brick_stairs', { render: 'model', shape: 'stairs', tex: 'nether_bricks', ...stoneLike(2, { sound: 'nether_bricks' }), orient: 'stairs' });
reg('nether_brick_slab', { render: 'model', shape: 'slab', tex: 'nether_bricks', ...stoneLike(2, { sound: 'nether_bricks' }), orient: 'slab' });
reg('red_nether_bricks', stoneLike(2, { sound: 'nether_bricks' }));
reg('soul_sand', { render: 'model', shape: 'soul_sand', hardness: 0.5, tool: 'shovel', sound: 'soul_sand', speedFactor: 0.4, opaque: true });
reg('soul_soil', { hardness: 0.5, tool: 'shovel', sound: 'soul_soil' });
reg('nether_quartz_ore', stoneLike(3, { tex: 'nether_quartz_ore', drops: oreDrop('quartz'), xp: [2, 5], sound: 'netherrack' }));
reg('nether_gold_ore', stoneLike(3, { drops: oreDrop('gold_nugget', 2, 6), xp: [0, 1], sound: 'netherrack' }));
reg('magma_block', stoneLike(0.5, { light: 3, hotFloor: true, sound: 'netherrack' }));
reg('basalt', stoneLike(1.25, { tex: { side: 'basalt_side', top: 'basalt_top' }, orient: 'axis', sound: 'basalt' }));
reg('blackstone', stoneLike(1.5, { tex: { side: 'blackstone', top: 'blackstone_top' } }));
reg('crimson_nylium', stoneLike(0.4, { tex: { top: 'crimson_nylium', side: 'crimson_nylium_side', bottom: 'netherrack' }, drops: 'netherrack', sound: 'nylium', particle: 'netherrack' }));
reg('warped_nylium', stoneLike(0.4, { tex: { top: 'warped_nylium', side: 'warped_nylium_side', bottom: 'netherrack' }, drops: 'netherrack', sound: 'nylium', particle: 'netherrack' }));
reg('crimson_stem', { tex: { side: 'crimson_stem', top: 'crimson_stem_top' }, hardness: 2, tool: 'axe', sound: 'stem', orient: 'axis' });
reg('warped_stem', { tex: { side: 'warped_stem', top: 'warped_stem_top' }, hardness: 2, tool: 'axe', sound: 'stem', orient: 'axis' });
reg('crimson_planks', { hardness: 2, tool: 'axe', sound: 'wood' });
reg('warped_planks', { hardness: 2, tool: 'axe', sound: 'wood' });
reg('nether_wart_block', { hardness: 1, tool: 'hoe', sound: 'wart_block' });
reg('warped_wart_block', { hardness: 1, tool: 'hoe', sound: 'wart_block' });
reg('shroomlight', { hardness: 1, tool: 'hoe', sound: 'shroomlight', light: 15 });
reg('crimson_fungus', plant({ support: 'nylium', sound: 'fungus' }));
reg('warped_fungus', plant({ support: 'nylium', sound: 'fungus' }));
reg('crimson_roots', plant({ support: 'nylium', replaceable: true, sound: 'roots' }));
reg('warped_roots', plant({ support: 'nylium', replaceable: true, sound: 'roots' }));
reg('nether_wart', {
  render: 'model', shape: 'crop', layer: 'cutout', solid: false, opaque: false, hardness: 0, sound: 'nether_wart', item: false,
  support: 'soul_sand', randomTick: true, crop: { stages: 4, texStages: [0, 1, 1, 2], tex: 'nether_wart_stage', seed: 'nether_wart' }, tex: 'nether_wart_stage2',
  drops: (ctx) => [{ item: 'nether_wart', count: ctx.meta >= 3 ? 2 + Math.floor(ctx.rand() * 3) : 1 }], netherWart: true,
});
reg('nether_portal', {
  render: 'model', shape: 'portal', layer: 'translucent', tex: 'nether_portal', solid: false, opaque: false, hardness: -1, light: 11,
  item: false, drops: null, sound: 'glass', portal: true,
});
reg('crying_obsidian', stoneLike(50, { tier: 3, light: 10, resistance: 1200 }));
reg('ancient_debris', stoneLike(30, { tier: 3, tex: { side: 'ancient_debris_side', top: 'ancient_debris_top' }, resistance: 1200, sound: 'ancient_debris' }));
reg('quartz_block', stoneLike(0.8, { tex: { side: 'quartz_block_side', top: 'quartz_block_top' } }));
reg('soul_fire', { render: 'cross', layer: 'cutout', solid: false, hardness: 0, light: 10, item: false, drops: null, replaceable: true, tex: 'soul_fire_0', sound: 'none', soulFire: true });

// ---------- derived data ----------
export const BLOCK_COUNT = BlockById.length;

// Fast lookup tables indexed by block id
export const IS_OPAQUE = new Uint8Array(4096);
export const IS_SOLID = new Uint8Array(4096);
export const LIGHT_EMIT = new Uint8Array(4096);
export const LIGHT_FILTER = new Uint8Array(4096);   // light lost when passing through (min 1 is added by propagation)
export const RENDER_TYPE = new Uint8Array(4096);    // 0 air, 1 cube, 2 cross, 3 liquid, 4 model
export const IS_REPLACEABLE = new Uint8Array(4096);
export const IS_LIQUID = new Uint8Array(4096);      // 1 water, 2 lava
const RT = { air: 0, cube: 1, cross: 2, liquid: 3, model: 4 };
for (const b of BlockById) {
  IS_OPAQUE[b.id] = b.opaque ? 1 : 0;
  IS_SOLID[b.id] = b.solid ? 1 : 0;
  LIGHT_EMIT[b.id] = b.light;
  LIGHT_FILTER[b.id] = b.opaque ? 15 : b.filter;
  RENDER_TYPE[b.id] = RT[b.render];
  IS_REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
  IS_LIQUID[b.id] = b.liquid === 'water' ? 1 : b.liquid === 'lava' ? 2 : 0;
}

export function getBlock(idOrName) {
  if (typeof idOrName === 'string') return Blocks[idOrName];
  return BlockById[_bid(idOrName)];
}

export const blockOf = (v) => BlockById[_bid(v)];
export const metaOf = (v) => _bmeta(v);

// Every block texture name referenced by the registry (the texture generator must provide all of them)
export function collectBlockTextureNames() {
  const set = new Set();
  for (const b of BlockById) {
    if (b.render === 'air') continue;
    for (const f of b.faces) set.add(f);
    if (b.front) set.add(b.front);
    if (b.overlay) set.add(b.overlay);
    if (b.snowySide) set.add(b.snowySide);
    if (b.particle) set.add(b.particle);
  }
  const extra = [
    'water_still', 'water_flow', 'lava_still', 'lava_flow', 'farmland_moist', 'furnace_front_on',
    'oak_door_top', 'oak_door_bottom', 'bed_head_top', 'bed_foot_top', 'bed_head_side', 'bed_foot_side',
    'bed_head_end', 'bed_foot_end', 'smooth_stone_slab_side', 'oak_trapdoor', 'fire_0', 'fire_1',
    'sweet_berry_bush_stage0', 'sweet_berry_bush_stage1', 'sweet_berry_bush_stage2', 'sweet_berry_bush_stage3',
    'deepslate_top', 'chest_front', 'glass_pane_top', 'nether_wart_stage0', 'nether_wart_stage1', 'nether_wart_stage2', 'soul_fire_0',
  ];
  for (let i = 0; i < 8; i++) extra.push(`wheat_stage${i}`);
  for (let i = 0; i < 4; i++) { extra.push(`carrots_stage${i}`); extra.push(`potatoes_stage${i}`); }
  for (let i = 0; i < 10; i++) extra.push(`destroy_stage_${i}`);
  for (const e of extra) set.add(e);
  return [...set];
}
