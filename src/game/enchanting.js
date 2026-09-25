// Enchantments: definitions (vanilla power ranges and weights), enchanting-table selection and anvil combining.
import { Random } from '../util/rng.js';

const armor = (it) => !!it.armor;
const slot = (s) => (it) => it.armor?.slot === s;
const weapon = (it) => it.tool?.type === 'sword';
const axe = (it) => it.tool?.type === 'axe';
const digger = (it) => it.tool && ['pickaxe', 'axe', 'shovel', 'hoe'].includes(it.tool.type);
const bow = (it) => it.name === 'bow';
const durable = (it) => !!it.durability;

// weight, maxLevel, minPower(lvl), maxPower(lvl), applies(item), exclusive group, treasure
export const ENCHANTMENTS = {
  protection: { w: 10, max: 4, min: (l) => 1 + (l - 1) * 11, maxP: (l) => 12 + (l - 1) * 11, ok: armor, group: 'protection' },
  fire_protection: { w: 5, max: 4, min: (l) => 10 + (l - 1) * 8, maxP: (l) => 18 + (l - 1) * 8, ok: armor, group: 'protection' },
  feather_falling: { w: 5, max: 4, min: (l) => 5 + (l - 1) * 6, maxP: (l) => 11 + (l - 1) * 6, ok: slot('feet') },
  blast_protection: { w: 2, max: 4, min: (l) => 5 + (l - 1) * 8, maxP: (l) => 13 + (l - 1) * 8, ok: armor, group: 'protection' },
  projectile_protection: { w: 5, max: 4, min: (l) => 3 + (l - 1) * 6, maxP: (l) => 9 + (l - 1) * 6, ok: armor, group: 'protection' },
  respiration: { w: 2, max: 3, min: (l) => 10 * l, maxP: (l) => 10 * l + 30, ok: slot('head') },
  aqua_affinity: { w: 2, max: 1, min: () => 1, maxP: () => 41, ok: slot('head') },
  thorns: { w: 1, max: 3, min: (l) => 10 + 20 * (l - 1), maxP: (l) => 60 + 20 * (l - 1), ok: slot('chest') },
  depth_strider: { w: 2, max: 3, min: (l) => 10 * l, maxP: (l) => 10 * l + 15, ok: slot('feet') },
  sharpness: { w: 10, max: 5, min: (l) => 1 + (l - 1) * 11, maxP: (l) => 21 + (l - 1) * 11, ok: (it) => weapon(it) || axe(it), tableOk: weapon, group: 'damage' },
  smite: { w: 5, max: 5, min: (l) => 5 + (l - 1) * 8, maxP: (l) => 25 + (l - 1) * 8, ok: (it) => weapon(it) || axe(it), tableOk: weapon, group: 'damage' },
  bane_of_arthropods: { w: 5, max: 5, min: (l) => 5 + (l - 1) * 8, maxP: (l) => 25 + (l - 1) * 8, ok: (it) => weapon(it) || axe(it), tableOk: weapon, group: 'damage' },
  knockback: { w: 5, max: 2, min: (l) => 5 + 20 * (l - 1), maxP: (l) => 55 + 20 * (l - 1), ok: weapon },
  fire_aspect: { w: 2, max: 2, min: (l) => 10 + 20 * (l - 1), maxP: (l) => 60 + 20 * (l - 1), ok: weapon },
  looting: { w: 2, max: 3, min: (l) => 15 + (l - 1) * 9, maxP: (l) => 65 + (l - 1) * 9, ok: weapon },
  sweeping: { w: 2, max: 3, min: (l) => 5 + (l - 1) * 9, maxP: (l) => 20 + (l - 1) * 9, ok: weapon },
  efficiency: { w: 10, max: 5, min: (l) => 1 + 10 * (l - 1), maxP: (l) => 51 + 10 * (l - 1), ok: (it) => digger(it) || it.name === 'shears', tableOk: digger },
  silk_touch: { w: 1, max: 1, min: () => 15, maxP: () => 65, ok: digger, group: 'loot' },
  unbreaking: { w: 5, max: 3, min: (l) => 5 + (l - 1) * 8, maxP: (l) => 55 + (l - 1) * 8, ok: durable },
  fortune: { w: 2, max: 3, min: (l) => 15 + (l - 1) * 9, maxP: (l) => 65 + (l - 1) * 9, ok: digger, group: 'loot' },
  power: { w: 10, max: 5, min: (l) => 1 + (l - 1) * 10, maxP: (l) => 16 + (l - 1) * 10, ok: bow },
  punch: { w: 2, max: 2, min: (l) => 12 + (l - 1) * 20, maxP: (l) => 37 + (l - 1) * 20, ok: bow },
  flame: { w: 2, max: 1, min: () => 20, maxP: () => 50, ok: bow },
  infinity: { w: 1, max: 1, min: () => 20, maxP: () => 50, ok: bow, group: 'infinity' },
  mending: { w: 2, max: 1, min: () => 25, maxP: () => 75, ok: durable, treasure: true, group: 'infinity' },
};

const TOOL_ENCHANTABILITY = { wooden: 15, stone: 5, iron: 14, golden: 22, diamond: 10, netherite: 15 };
const ARMOR_ENCHANTABILITY = { leather: 15, chainmail: 12, iron: 9, golden: 25, diamond: 10, netherite: 15, turtle: 9 };

export function enchantability(it) {
  if (!it) return 0;
  if (it.name === 'book') return 1;
  if (it.name === 'bow' || it.name === 'fishing_rod' || it.name === 'crossbow') return 1;
  if (it.armor) return ARMOR_ENCHANTABILITY[it.material] ?? 9;
  if (it.tool && it.material) return TOOL_ENCHANTABILITY[it.material] ?? 0;
  return 0;
}

export function compatible(a, b) {
  if (a === b) return false;
  const ga = ENCHANTMENTS[a]?.group, gb = ENCHANTMENTS[b]?.group;
  return !(ga && ga === gb);
}

function weightedPick(rand, list) {
  const total = list.reduce((s, e) => s + e.w, 0);
  let r = rand.nextInt(total);
  for (const e of list) { r -= e.w; if (r < 0) return e; }
  return list[list.length - 1];
}

// vanilla EnchantmentHelper.getAvailableEnchantmentResults
function available(power, it, isBook) {
  const out = [];
  for (const [id, e] of Object.entries(ENCHANTMENTS)) {
    if (e.treasure) continue;
    if (!isBook && !(e.tableOk ?? e.ok)(it)) continue;
    for (let l = e.max; l >= 1; l--) {
      if (power >= e.min(l) && power <= e.maxP(l)) { out.push({ id, lvl: l, w: e.w }); break; }
    }
  }
  return out;
}

// vanilla EnchantmentHelper.selectEnchantment
export function selectEnchantments(seed, it, level) {
  const rand = new Random(seed);
  const ench = enchantability(it);
  if (ench <= 0) return [];
  const isBook = it.name === 'book';
  let power = level + 1 + rand.nextInt(Math.floor(ench / 4) + 1) + rand.nextInt(Math.floor(ench / 4) + 1);
  const f = (rand.nextFloat() + rand.nextFloat() - 1) * 0.15;
  power = Math.max(1, Math.round(power + power * f));
  let list = available(power, it, isBook);
  const result = [];
  if (!list.length) return result;
  result.push(weightedPick(rand, list));
  while (rand.nextInt(50) <= power) {
    list = list.filter((e) => result.every((r) => compatible(r.id, e.id)));
    if (!list.length) break;
    result.push(weightedPick(rand, list));
    power = Math.floor(power / 2);
  }
  if (isBook && result.length > 1) result.splice(rand.nextInt(result.length), 1);
  return result.map(({ id, lvl }) => ({ id, lvl }));
}

// enchanting table: slot costs from bookshelf count (vanilla EnchantmentHelper.getEnchantmentCost)
export function tableCosts(seed, shelves, it) {
  const rand = new Random(seed);
  shelves = Math.min(15, shelves);
  const costs = [];
  for (let slotIdx = 0; slotIdx < 3; slotIdx++) {
    if (enchantability(it) <= 0) { costs.push(0); continue; }
    const i = rand.nextInt(8) + 1 + (shelves >> 1) + rand.nextInt(shelves + 1);
    let c;
    if (slotIdx === 0) c = Math.max(Math.floor(i / 3), 1);
    else if (slotIdx === 1) c = Math.floor(i * 2 / 3) + 1;
    else c = Math.max(i, shelves * 2);
    costs.push(c < slotIdx + 1 ? 0 : c);
  }
  return costs;
}

export function enchantName(id) { return id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '); }
export function roman(n) { return ['', 'I', 'II', 'III', 'IV', 'V'][n] ?? String(n); }

// ---------- anvil ----------
const MULT = { common: [1, 1], uncommon: [2, 1], rare: [4, 2], very_rare: [8, 4] };
const RARITY = {
  protection: 'common', sharpness: 'common', efficiency: 'common', power: 'common', fire_protection: 'uncommon', feather_falling: 'uncommon',
  projectile_protection: 'uncommon', smite: 'uncommon', bane_of_arthropods: 'uncommon', knockback: 'uncommon', unbreaking: 'uncommon',
  blast_protection: 'rare', respiration: 'rare', aqua_affinity: 'rare', depth_strider: 'rare', fire_aspect: 'rare', looting: 'rare',
  sweeping: 'rare', fortune: 'rare', punch: 'rare', flame: 'rare', mending: 'rare', thorns: 'very_rare', silk_touch: 'very_rare', infinity: 'very_rare',
};

export function repairMaterial(it) {
  const m = it.material;
  if (!m) return null;
  return { wooden: '#planks', stone: '#stone_crafting', iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond', netherite: 'netherite_ingot', leather: 'leather', chainmail: 'iron_ingot' }[m] ?? null;
}

// Returns { result, cost, materialUsed } or null. left/right are ItemStacks; name = new name or null.
export function anvilResult(left, right, name, isMaterial) {
  if (!left) return null;
  const it = left.item;
  let cost = 0;
  const result = left.copy(1);
  result.tag = result.tag ? JSON.parse(JSON.stringify(result.tag)) : null;
  let repairCost = (left.tag?.repairCost ?? 0) + (right?.tag?.repairCost ?? 0);
  let materialUsed = 0;
  if (right) {
    if (it.durability && isMaterial(right, it)) {
      // repair with raw material: each unit restores 25%
      let dmg = Math.min(result.damage, Math.floor(it.durability / 4));
      if (dmg <= 0) return null;
      let n = 0;
      while (dmg > 0 && n < right.count) {
        result.damage -= dmg;
        cost++; n++;
        dmg = Math.min(result.damage, Math.floor(it.durability / 4));
      }
      materialUsed = n;
    } else {
      const rIsBook = right.item.name === 'enchanted_book';
      if (!rIsBook && (right.id !== left.id || !it.durability)) return null;
      // combine durability
      if (it.durability && !rIsBook) {
        const l1 = it.durability - left.damage, l2 = it.durability - right.damage;
        const bonus = Math.floor(it.durability * 12 / 100);
        const newDamage = Math.max(0, it.durability - (l1 + l2 + bonus));
        if (newDamage < result.damage) { result.damage = newDamage; cost += 2; }
      }
      const rEnch = rIsBook ? (right.tag?.stored ?? []) : (right.tag?.enchantments ?? []);
      const lEnch = result.tag?.enchantments ?? [];
      let anyApplied = false;
      for (const e of rEnch) {
        const def = ENCHANTMENTS[e.id];
        if (!def) continue;
        const canApply = it.name === 'enchanted_book' || def.ok(it);
        const conflict = lEnch.some((x) => x.id !== e.id && !compatible(x.id, e.id));
        if (!canApply || conflict) { cost++; continue; }
        const existing = lEnch.find((x) => x.id === e.id);
        let lvl = e.lvl;
        if (existing) { lvl = existing.lvl === e.lvl ? Math.min(def.max, e.lvl + 1) : Math.max(existing.lvl, e.lvl); existing.lvl = lvl; }
        else lEnch.push({ id: e.id, lvl });
        const m = MULT[RARITY[e.id] ?? 'common'][rIsBook ? 1 : 0];
        cost += m * lvl;
        anyApplied = true;
      }
      if (!anyApplied && !(it.durability && !rIsBook && cost > 0)) return null;
      if (lEnch.length) { result.tag = result.tag ?? {}; result.tag.enchantments = lEnch; }
    }
  }
  let renameCost = 0;
  if (name !== null && name !== undefined && name !== (left.tag?.name ?? it.display)) {
    renameCost = 1;
    result.tag = result.tag ?? {};
    if (name) result.tag.name = name; else delete result.tag.name;
  }
  if (cost + renameCost <= 0) return null;
  const total = repairCost + cost + renameCost;
  if (total >= 40 && !(renameCost && cost === 0)) return { result, cost: total, materialUsed, tooExpensive: true };
  result.tag = result.tag ?? {};
  result.tag.repairCost = (Math.max(left.tag?.repairCost ?? 0, right?.tag?.repairCost ?? 0)) * 2 + 1;
  return { result, cost: Math.min(total, 39), materialUsed };
}
