// Item registry. Block items share ids with their blocks (0..1023); other items start at 1024.
// Only APPEND new items so saved inventories stay valid.
import { BlockById, Blocks } from './blocks.js';

export const ITEM_OFFSET = 1024;
export const ItemById = [];
export const Items = Object.create(null); // name -> def
export const I = Object.create(null);     // name -> id

function titleCase(name) {
  return name.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

// ---- block items ----
for (const b of BlockById) {
  if (!b.item) continue;
  const def = {
    id: b.id, name: b.name, display: b.display, block: b.id, stack: b.stack ?? 64,
    // cube-shaped items render as an isometric block icon, the rest use a flat sprite
    icon: (b.render === 'cube' || (b.render === 'model' && ['slab', 'stairs', 'chest', 'fence', 'layer', 'carpet', 'cactus', 'path', 'farmland'].includes(b.shape)))
      ? { kind: 'block', block: b.id }
      : { kind: 'sprite', tex: b.itemTexture ?? b.faces[4], atlas: b.itemTexture && b.itemTexture !== b.faces[4] ? 'item' : 'block', tint: b.tint },
    fuel: b.fuel ?? 0,
  };
  ItemById[b.id] = def;
  Items[b.name] = def;
  I[b.name] = b.id;
}

let nextId = ITEM_OFFSET;
function reg(name, p = {}) {
  const def = {
    id: nextId++, name, display: p.display ?? titleCase(name), stack: 64,
    icon: { kind: 'sprite', tex: p.tex ?? name, atlas: 'item' }, fuel: 0, ...p,
  };
  if (p.tex) def.icon = { kind: 'sprite', tex: p.tex, atlas: 'item' };
  ItemById[def.id] = def;
  Items[name] = def;
  I[name] = def.id;
  return def;
}

// ---- materials ----
reg('stick', { fuel: 100 });
reg('coal', { fuel: 1600 });
reg('charcoal', { fuel: 1600 });
reg('raw_iron'); reg('raw_gold'); reg('raw_copper');
reg('iron_ingot'); reg('gold_ingot'); reg('copper_ingot');
reg('iron_nugget'); reg('gold_nugget');
reg('diamond'); reg('emerald'); reg('lapis_lazuli'); reg('redstone', { display: 'Redstone Dust' });
reg('flint'); reg('feather'); reg('string'); reg('gunpowder'); reg('bone'); reg('bone_meal', { use: 'bone_meal' });
reg('leather'); reg('paper'); reg('book'); reg('sugar'); reg('wheat'); reg('wheat_seeds', { places: 'wheat' });
reg('clay_ball'); reg('brick'); reg('glowstone_dust'); reg('snowball', { stack: 16, use: 'throw_snowball' });
reg('egg', { stack: 16, use: 'throw_egg' }); reg('bowl', { fuel: 100 }); reg('slime_ball'); reg('ender_pearl', { stack: 16 });
reg('spider_eye', { food: { hunger: 2, saturation: 3.2, effects: [{ id: 'poison', duration: 100, amp: 0, chance: 1 }] } });
reg('rotten_flesh', { food: { hunger: 4, saturation: 0.8, effects: [{ id: 'hunger', duration: 600, amp: 0, chance: 0.8 }] } });
reg('arrow');
reg('green_dye'); reg('red_dye'); reg('yellow_dye'); reg('white_dye'); reg('black_dye'); reg('blue_dye');

// ---- tools ----
// Tier: 0 wood, 1 stone, 2 iron, 3 diamond, 4 netherite ; gold harvests like wood but is fastest.
export const TOOL_MATERIALS = {
  wooden: { tier: 0, speed: 2, durability: 59, bonus: 0, repair: 'oak_planks', enchant: 15 },
  stone: { tier: 1, speed: 4, durability: 131, bonus: 1, repair: 'cobblestone', enchant: 5 },
  iron: { tier: 2, speed: 6, durability: 250, bonus: 2, repair: 'iron_ingot', enchant: 14 },
  golden: { tier: 0, speed: 12, durability: 32, bonus: 0, repair: 'gold_ingot', enchant: 22 },
  diamond: { tier: 3, speed: 8, durability: 1561, bonus: 3, repair: 'diamond', enchant: 10 },
  netherite: { tier: 4, speed: 9, durability: 2031, bonus: 4, repair: 'netherite_ingot', enchant: 15 },
};
// Java 1.9+ attack damage / attack speed values
const SWORD_DMG = { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7, netherite: 8 };
const AXE_DMG = { wooden: 7, stone: 9, iron: 9, golden: 7, diamond: 9, netherite: 10 };
const AXE_SPEED = { wooden: 0.8, stone: 0.8, iron: 0.9, golden: 1.0, diamond: 1.0, netherite: 1.0 };
const PICK_DMG = { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5, netherite: 6 };
const SHOVEL_DMG = { wooden: 2.5, stone: 3.5, iron: 4.5, golden: 2.5, diamond: 5.5, netherite: 6.5 };
const HOE_SPEED = { wooden: 1, stone: 2, iron: 3, golden: 1, diamond: 4, netherite: 4 };

for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
  const m = TOOL_MATERIALS[mat];
  const base = { stack: 1, durability: m.durability, material: mat, fuel: mat === 'wooden' ? 200 : 0 };
  reg(`${mat}_sword`, { ...base, tool: { type: 'sword', tier: m.tier, speed: 1.5 }, damage: SWORD_DMG[mat], attackSpeed: 1.6 });
  reg(`${mat}_shovel`, { ...base, tool: { type: 'shovel', tier: m.tier, speed: m.speed }, damage: SHOVEL_DMG[mat], attackSpeed: 1.0 });
  reg(`${mat}_pickaxe`, { ...base, tool: { type: 'pickaxe', tier: m.tier, speed: m.speed }, damage: PICK_DMG[mat], attackSpeed: 1.2 });
  reg(`${mat}_axe`, { ...base, tool: { type: 'axe', tier: m.tier, speed: m.speed }, damage: AXE_DMG[mat], attackSpeed: AXE_SPEED[mat] });
  reg(`${mat}_hoe`, { ...base, tool: { type: 'hoe', tier: m.tier, speed: m.speed }, damage: 1, attackSpeed: HOE_SPEED[mat] });
}
reg('netherite_ingot');
reg('shears', { stack: 1, durability: 238, tool: { type: 'shears', tier: 0, speed: 1.5 } });
reg('flint_and_steel', { stack: 1, durability: 64, use: 'ignite' });
reg('bow', { stack: 1, durability: 384, use: 'bow', fuel: 300 });
reg('crossbow', { stack: 1, durability: 465, use: 'crossbow' });
reg('shield', { stack: 1, durability: 336, use: 'shield', fuel: 300 });
reg('fishing_rod', { stack: 1, durability: 64 });
reg('bucket', { stack: 16, use: 'bucket' });
reg('water_bucket', { stack: 1, use: 'bucket', fills: 'water', container: 'bucket' });
reg('lava_bucket', { stack: 1, use: 'bucket', fills: 'lava', container: 'bucket', fuel: 20000 });
reg('milk_bucket', { stack: 1, use: 'drink_milk', container: 'bucket' });
reg('compass', { stack: 64 });
reg('clock', { stack: 64 });

// ---- armor ----
// points / toughness per piece, Java values
export const ARMOR_MATERIALS = {
  leather: { mult: 5, points: [1, 3, 2, 1], toughness: 0, kb: 0, enchant: 15, repair: 'leather' },
  chainmail: { mult: 15, points: [2, 5, 4, 1], toughness: 0, kb: 0, enchant: 12, repair: 'iron_ingot' },
  iron: { mult: 15, points: [2, 6, 5, 2], toughness: 0, kb: 0, enchant: 9, repair: 'iron_ingot' },
  golden: { mult: 7, points: [2, 5, 3, 1], toughness: 0, kb: 0, enchant: 25, repair: 'gold_ingot' },
  diamond: { mult: 33, points: [3, 8, 6, 3], toughness: 2, kb: 0, enchant: 10, repair: 'diamond' },
  netherite: { mult: 37, points: [3, 8, 6, 3], toughness: 3, kb: 0.1, enchant: 15, repair: 'netherite_ingot' },
};
const PIECES = [['helmet', 'head', 11], ['chestplate', 'chest', 16], ['leggings', 'legs', 15], ['boots', 'feet', 13]];
for (const mat of Object.keys(ARMOR_MATERIALS)) {
  const m = ARMOR_MATERIALS[mat];
  PIECES.forEach(([piece, slot, dur], i) => {
    reg(`${mat}_${piece}`, {
      stack: 1, durability: dur * m.mult, material: mat,
      armor: { slot, points: m.points[i], toughness: m.toughness, knockbackResistance: m.kb },
      use: 'equip',
    });
  });
}
reg('turtle_helmet', { stack: 1, durability: 275, armor: { slot: 'head', points: 2, toughness: 0, knockbackResistance: 0 }, use: 'equip' });

// ---- food ----
const food = (hunger, saturation, extra = {}) => ({ food: { hunger, saturation, ...extra } });
reg('apple', food(4, 2.4));
reg('golden_apple', { ...food(4, 9.6, { always: true, effects: [{ id: 'regeneration', duration: 100, amp: 1, chance: 1 }, { id: 'absorption', duration: 2400, amp: 0, chance: 1 }] }), rarity: 'rare' });
reg('enchanted_golden_apple', { ...food(4, 9.6, { always: true, effects: [{ id: 'regeneration', duration: 400, amp: 1, chance: 1 }, { id: 'absorption', duration: 2400, amp: 3, chance: 1 }, { id: 'resistance', duration: 6000, amp: 0, chance: 1 }, { id: 'fire_resistance', duration: 6000, amp: 0, chance: 1 }] }), rarity: 'epic', glint: true, tex: 'golden_apple' });
reg('bread', food(5, 6));
reg('porkchop', { ...food(3, 1.8), display: 'Raw Porkchop' });
reg('cooked_porkchop', food(8, 12.8));
reg('beef', { ...food(3, 1.8), display: 'Raw Beef' });
reg('cooked_beef', { ...food(8, 12.8), display: 'Steak' });
reg('chicken', { ...food(2, 1.2, { effects: [{ id: 'hunger', duration: 600, amp: 0, chance: 0.3 }] }), display: 'Raw Chicken' });
reg('cooked_chicken', food(6, 7.2));
reg('mutton', { ...food(2, 1.2), display: 'Raw Mutton' });
reg('cooked_mutton', food(6, 9.6));
reg('carrot', { ...food(3, 3.6), places: 'carrots' });
reg('potato', { ...food(1, 0.6), places: 'potatoes' });
reg('baked_potato', food(5, 6));
reg('poisonous_potato', food(2, 1.2, { effects: [{ id: 'poison', duration: 100, amp: 0, chance: 0.6 }] }));
reg('cookie', food(2, 0.4));
reg('melon_slice', food(2, 1.2));
reg('pumpkin_pie', food(8, 4.8));
reg('mushroom_stew', { ...food(6, 7.2), stack: 1, container: 'bowl' });
reg('sweet_berries', { ...food(2, 1.2), places: 'sweet_berry_bush' });
reg('cod', { ...food(2, 0.4), display: 'Raw Cod' });
reg('cooked_cod', food(5, 6));
reg('golden_carrot', food(6, 14.4));

// ---- misc ----
reg('experience_bottle', { use: 'throw_xp', glint: true });
reg('name_tag');
reg('saddle', { stack: 1 });
reg('lead');
reg('map', { stack: 64, tex: 'map' });
reg('ender_eye');
reg('totem_of_undying', { stack: 1, rarity: 'uncommon' });

export const ITEM_COUNT = nextId;

export function getItem(idOrName) {
  if (typeof idOrName === 'string') return Items[idOrName];
  return ItemById[idOrName];
}

// Item texture names the item texture generator must provide.
export function collectItemTextureNames() {
  const set = new Set();
  for (const it of ItemById) {
    if (!it) continue;
    if (it.icon.kind === 'sprite' && it.icon.atlas === 'item') set.add(it.icon.tex);
  }
  // extra frames / variants
  for (const n of ['bow_pulling_0', 'bow_pulling_1', 'bow_pulling_2', 'crossbow_pulling_0', 'crossbow_standby', 'empty_armor_slot_helmet',
    'empty_armor_slot_chestplate', 'empty_armor_slot_leggings', 'empty_armor_slot_boots', 'empty_armor_slot_shield']) set.add(n);
  return [...set];
}

export { Blocks };
