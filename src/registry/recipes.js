// Crafting (shaped + shapeless) and smelting recipes.
import { Items, I } from './items.js';
import { WOOL_COLORS } from './blocks.js';

const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak'];
export const TAGS = {
  planks: WOODS.map((w) => `${w}_planks`),
  logs: WOODS.map((w) => `${w}_log`),
  wool: WOOL_COLORS.map((c) => `${c}_wool`),
  stone_crafting: ['cobblestone', 'cobbled_deepslate'],
  coals: ['coal', 'charcoal'],
};

export const RECIPES = [];

// shaped(pattern rows, key {char: itemName|#tag}, result, count)
function shaped(pattern, key, result, count = 1) {
  const keyIds = {};
  for (const [ch, v] of Object.entries(key)) keyIds[ch] = resolve(v);
  RECIPES.push({ type: 'shaped', pattern, key: keyIds, result: I[result], count, w: Math.max(...pattern.map((r) => r.length)), h: pattern.length });
  if (I[result] === undefined) console.warn('recipe result missing', result);
}
function shapeless(ingredients, result, count = 1) {
  RECIPES.push({ type: 'shapeless', ingredients: ingredients.map(resolve), result: I[result], count });
  if (I[result] === undefined) console.warn('recipe result missing', result);
}
function resolve(v) {
  if (v.startsWith('#')) return new Set(TAGS[v.slice(1)].map((n) => I[n]).filter((x) => x !== undefined));
  if (I[v] === undefined) console.warn('recipe ingredient missing', v);
  return new Set([I[v]]);
}

// ---- wood ----
for (const w of WOODS) {
  shapeless([`${w}_log`], `${w}_planks`, 4);
}
shaped(['#', '#'], { '#': '#planks' }, 'stick', 4);
shaped(['##', '##'], { '#': '#planks' }, 'crafting_table');
shaped(['###', '# #', '###'], { '#': '#planks' }, 'chest');
shaped(['###', '# #', '###'], { '#': '#stone_crafting' }, 'furnace');
shaped(['X', '#'], { X: '#coals', '#': 'stick' }, 'torch', 4);
shaped(['# #', '###', '# #'], { '#': 'stick' }, 'ladder', 3);
shaped(['##', '##', '##'], { '#': 'oak_planks' }, 'oak_door', 3);
shaped(['###', '###'], { '#': 'oak_planks' }, 'oak_trapdoor', 2);
shaped(['W#W', 'W#W'], { W: 'oak_planks', '#': 'stick' }, 'oak_fence', 3);
shaped(['# #', ' # '], { '#': '#planks' }, 'bowl', 4);
shaped(['###', 'XXX', '###'], { '#': '#planks', X: 'book' }, 'bookshelf');
shaped(['###', 'XXX'], { '#': '#wool', X: '#planks' }, 'red_bed');
// slabs & stairs
const slabStairs = [
  ['oak_planks', 'oak_slab', 'oak_stairs'], ['spruce_planks', 'spruce_slab', 'spruce_stairs'], ['birch_planks', 'birch_slab', 'birch_stairs'],
  ['cobblestone', 'cobblestone_slab', 'cobblestone_stairs'], ['stone_bricks', 'stone_brick_slab', 'stone_brick_stairs'],
  ['bricks', 'brick_slab', 'brick_stairs'], ['sandstone', 'sandstone_slab', 'sandstone_stairs'],
];
for (const [mat, slab, stairs] of slabStairs) {
  shaped(['###'], { '#': mat }, slab, 6);
  shaped(['#  ', '## ', '###'], { '#': mat }, stairs, 4);
}
shaped(['###'], { '#': 'smooth_stone' }, 'stone_slab', 6);

// ---- tools ----
const TOOL_MATS = [['#planks', 'wooden'], ['#stone_crafting', 'stone'], ['iron_ingot', 'iron'], ['gold_ingot', 'golden'], ['diamond', 'diamond']];
for (const [m, n] of TOOL_MATS) {
  shaped(['XXX', ' # ', ' # '], { X: m, '#': 'stick' }, `${n}_pickaxe`);
  shaped(['XX', 'X#', ' #'], { X: m, '#': 'stick' }, `${n}_axe`);
  shaped(['X', '#', '#'], { X: m, '#': 'stick' }, `${n}_shovel`);
  shaped(['XX', ' #', ' #'], { X: m, '#': 'stick' }, `${n}_hoe`);
  shaped(['X', 'X', '#'], { X: m, '#': 'stick' }, `${n}_sword`);
}
// ---- armor ----
for (const [m, n] of [['leather', 'leather'], ['iron_ingot', 'iron'], ['gold_ingot', 'golden'], ['diamond', 'diamond']]) {
  shaped(['XXX', 'X X'], { X: m }, `${n}_helmet`);
  shaped(['X X', 'XXX', 'XXX'], { X: m }, `${n}_chestplate`);
  shaped(['XXX', 'X X', 'X X'], { X: m }, `${n}_leggings`);
  shaped(['X X', 'X X'], { X: m }, `${n}_boots`);
}
// ---- combat & misc tools ----
shaped([' #X', '# X', ' #X'], { '#': 'stick', X: 'string' }, 'bow');
shaped(['X', '#', 'Y'], { X: 'flint', '#': 'stick', Y: 'feather' }, 'arrow', 4);
shaped(['WoW', 'WWW', ' W '], { W: '#planks', o: 'iron_ingot' }, 'shield');
shaped(['# #', ' # '], { '#': 'iron_ingot' }, 'bucket');
shapeless(['iron_ingot', 'flint'], 'flint_and_steel');
shaped([' #', '# '], { '#': 'iron_ingot' }, 'shears');
shaped([' # ', '#X#', ' # '], { '#': 'iron_ingot', X: 'redstone' }, 'compass');
shaped([' # ', '#X#', ' # '], { '#': 'gold_ingot', X: 'redstone' }, 'clock');
shaped(['  #', ' #X', '# X'], { '#': 'stick', X: 'string' }, 'fishing_rod');

// ---- food ----
shaped(['###'], { '#': 'wheat' }, 'bread');
shapeless(['pumpkin', 'sugar', 'egg'], 'pumpkin_pie');
shapeless(['bowl', 'brown_mushroom', 'red_mushroom'], 'mushroom_stew');
shaped(['###', '#X#', '###'], { '#': 'gold_ingot', X: 'apple' }, 'golden_apple');
shaped(['###', '#X#', '###'], { '#': 'gold_nugget', X: 'carrot' }, 'golden_carrot');
shaped(['#X#'], { '#': 'wheat', X: 'sugar' }, 'cookie', 8);
shapeless(['sugar_cane'], 'sugar');
shaped(['###'], { '#': 'sugar_cane' }, 'paper', 3);
shapeless(['paper', 'paper', 'paper', 'leather'], 'book');

// ---- building blocks ----
shaped(['##', '##'], { '#': 'stone' }, 'stone_bricks', 4);
shapeless(['cobblestone', 'moss_block'], 'mossy_cobblestone');
shapeless(['stone_bricks', 'moss_block'], 'mossy_stone_bricks');
shaped(['##', '##'], { '#': 'brick' }, 'bricks');
shaped(['##', '##'], { '#': 'sand' }, 'sandstone');
shaped(['##', '##'], { '#': 'sandstone' }, 'cut_sandstone', 4);
shaped(['###', '###'], { '#': 'glass' }, 'glass_pane', 16);
shaped(['X#X', '#X#', 'X#X'], { X: 'gunpowder', '#': 'sand' }, 'tnt');
shaped(['##', '##'], { '#': 'snowball' }, 'snow_block');
shaped(['###'], { '#': 'snow_block' }, 'snow', 6);
shaped(['##', '##'], { '#': 'clay_ball' }, 'clay');
shaped(['##', '##'], { '#': 'glowstone_dust' }, 'glowstone');
shaped(['##', '##'], { '#': 'granite' }, 'polished_granite', 4);
shaped(['##', '##'], { '#': 'diorite' }, 'polished_diorite', 4);
shaped(['##', '##'], { '#': 'andesite' }, 'polished_andesite', 4);
shapeless(['diorite', 'cobblestone'], 'andesite', 2);
shaped(['##', '##'], { '#': 'cobbled_deepslate' }, 'polished_deepslate', 4);
shaped(['##', '##'], { '#': 'polished_deepslate' }, 'deepslate_bricks', 4);
shaped(['##', '##'], { '#': 'deepslate_bricks' }, 'deepslate_tiles', 4);
shaped(['DG', 'GD'], { D: 'dirt', G: 'gravel' }, 'coarse_dirt', 4);
shaped(['A', 'B'], { A: 'carved_pumpkin', B: 'torch' }, 'jack_o_lantern');
shaped(['##', '##'], { '#': 'string' }, 'white_wool');
shaped(['##'], { '#': 'white_wool' }, 'white_carpet', 3);
shaped(['##'], { '#': 'red_wool' }, 'red_carpet', 3);
shaped(['###', '###', '###'], { '#': 'wheat' }, 'hay_block');
shapeless(['hay_block'], 'wheat', 9);

// storage blocks
const STORAGE = [['iron_ingot', 'iron_block'], ['gold_ingot', 'gold_block'], ['diamond', 'diamond_block'], ['emerald', 'emerald_block'],
  ['lapis_lazuli', 'lapis_block'], ['redstone', 'redstone_block'], ['coal', 'coal_block'], ['copper_ingot', 'copper_block'],
  ['raw_iron', 'raw_iron_block'], ['raw_gold', 'raw_gold_block'], ['raw_copper', 'raw_copper_block']];
for (const [item, block] of STORAGE) {
  shaped(['###', '###', '###'], { '#': item }, block);
  shapeless([block], item, 9);
}
shaped(['###', '###', '###'], { '#': 'iron_nugget' }, 'iron_ingot');
shapeless(['iron_ingot'], 'iron_nugget', 9);
shaped(['###', '###', '###'], { '#': 'gold_nugget' }, 'gold_ingot');
shapeless(['gold_ingot'], 'gold_nugget', 9);

// dyes
shapeless(['bone'], 'bone_meal', 3);
shapeless(['poppy'], 'red_dye'); shapeless(['red_tulip'], 'red_dye');
shapeless(['dandelion'], 'yellow_dye');
shapeless(['lily_of_the_valley'], 'white_dye'); shapeless(['bone_meal'], 'white_dye');
shapeless(['cornflower'], 'blue_dye'); shapeless(['lapis_lazuli'], 'blue_dye');
for (const [dye, color] of [['red_dye', 'red'], ['yellow_dye', 'yellow'], ['blue_dye', 'blue'], ['green_dye', 'green'], ['black_dye', 'black'], ['white_dye', 'white']]) {
  if (color !== 'white') shapeless([dye, 'white_wool'], `${color}_wool`);
}

// ---------- matching ----------
// grid: array of item ids (or null), width, height. Returns { result, count, recipe } or null.
export function matchRecipe(grid, gw, gh) {
  // bounding box of used cells
  let minX = gw, minY = gh, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const id = grid[y * gw + x];
    if (id != null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); items.push(id); }
  }
  if (!items.length) return null;
  const w = maxX - minX + 1, h = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== w || r.h !== h) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < h && ok; y++) for (let x = 0; x < w && ok; x++) {
          const px = mirror ? w - 1 - x : x;
          const ch = r.pattern[y][px] ?? ' ';
          const id = grid[(minY + y) * gw + minX + x];
          if (ch === ' ') { if (id != null) ok = false; }
          else if (id == null || !r.key[ch].has(id)) ok = false;
        }
        if (ok) return r;
      }
    } else {
      if (r.ingredients.length !== items.length) continue;
      const used = new Array(items.length).fill(false);
      let ok = true;
      for (const ing of r.ingredients) {
        let found = false;
        for (let i = 0; i < items.length; i++) if (!used[i] && ing.has(items[i])) { used[i] = true; found = true; break; }
        if (!found) { ok = false; break; }
      }
      if (ok) return r;
    }
  }
  return null;
}

// ---------- smelting ----------
export const SMELTING = new Map(); // input id -> { result, xp }
function smelt(input, result, xp) {
  const ins = Array.isArray(input) ? input : [input];
  for (const n of ins) {
    if (I[n] === undefined || I[result] === undefined) { console.warn('smelt missing', n, result); continue; }
    SMELTING.set(I[n], { result: I[result], xp });
  }
}
smelt(['iron_ore', 'deepslate_iron_ore', 'raw_iron'], 'iron_ingot', 0.7);
smelt(['gold_ore', 'deepslate_gold_ore', 'raw_gold'], 'gold_ingot', 1.0);
smelt(['copper_ore', 'deepslate_copper_ore', 'raw_copper'], 'copper_ingot', 0.7);
smelt(['coal_ore', 'deepslate_coal_ore'], 'coal', 0.1);
smelt(['diamond_ore', 'deepslate_diamond_ore'], 'diamond', 1.0);
smelt(['emerald_ore', 'deepslate_emerald_ore'], 'emerald', 1.0);
smelt(['lapis_ore', 'deepslate_lapis_ore'], 'lapis_lazuli', 0.2);
smelt(['redstone_ore', 'deepslate_redstone_ore'], 'redstone', 0.7);
smelt(['sand', 'red_sand'], 'glass', 0.1);
smelt('cobblestone', 'stone', 0.1);
smelt('stone', 'smooth_stone', 0.1);
smelt('cobbled_deepslate', 'deepslate', 0.1);
smelt('stone_bricks', 'cracked_stone_bricks', 0.1);
smelt(TAGS.logs, 'charcoal', 0.15);
smelt('clay_ball', 'brick', 0.3);
smelt('clay', 'terracotta', 0.35);
smelt('cactus', 'green_dye', 1.0);
smelt('porkchop', 'cooked_porkchop', 0.35);
smelt('beef', 'cooked_beef', 0.35);
smelt('chicken', 'cooked_chicken', 0.35);
smelt('mutton', 'cooked_mutton', 0.35);
smelt('cod', 'cooked_cod', 0.35);
smelt('potato', 'baked_potato', 0.35);

export function fuelValue(id) {
  const it = Items[id] ?? null;
  void it;
  return 0;
}

export { Items };
