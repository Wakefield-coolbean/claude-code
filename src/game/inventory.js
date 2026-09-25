// Item stacks, inventories and containers.
import { ItemById, Items } from '../registry/items.js';

export class ItemStack {
  constructor(id, count = 1, damage = 0, tag = null) {
    this.id = typeof id === 'string' ? Items[id]?.id ?? 0 : id;
    this.count = count;
    this.damage = damage;       // durability used
    this.tag = tag;             // { enchantments: [{id, lvl}], name, color, ... }
  }
  get item() { return ItemById[this.id]; }
  get maxStack() { return this.item?.stack ?? 64; }
  get empty() { return this.count <= 0 || !this.item; }
  copy(count = this.count) { return new ItemStack(this.id, count, this.damage, this.tag ? JSON.parse(JSON.stringify(this.tag)) : null); }
  canStackWith(o) {
    return o && o.id === this.id && this.damage === o.damage && JSON.stringify(this.tag) === JSON.stringify(o.tag) && this.maxStack > 1;
  }
  enchantLevel(id) {
    const e = this.tag?.enchantments?.find((x) => x.id === id);
    return e ? e.lvl : 0;
  }
  // Damage a tool/armor; returns true if it broke
  hurt(amount, rand = Math.random) {
    const max = this.item?.durability;
    if (!max) return false;
    const unbreaking = this.enchantLevel('unbreaking');
    let applied = 0;
    for (let i = 0; i < amount; i++) {
      if (unbreaking > 0) {
        const isArmor = !!this.item.armor;
        const chance = isArmor ? 0.6 + 0.4 / (unbreaking + 1) : 1 / (unbreaking + 1);
        if (rand() > chance) continue;
      }
      applied++;
    }
    this.damage += applied;
    if (this.damage >= max) { this.count--; this.damage = 0; return true; }
    return false;
  }
  serialize() { return [this.id, this.count, this.damage, this.tag]; }
  static deserialize(a) {
    if (!a) return null;
    const s = new ItemStack(a[0], a[1], a[2] ?? 0, a[3] ?? null);
    return s.empty ? null : s;
  }
  static of(name, count = 1) { return new ItemStack(Items[name].id, count); }
}

export class Inventory {
  constructor(size) {
    this.size = size;
    this.slots = new Array(size).fill(null);
    this.onChange = null;
  }
  get(i) { return this.slots[i]; }
  set(i, stack) {
    this.slots[i] = stack && !stack.empty ? stack : null;
    this.changed();
  }
  changed() { if (this.onChange) this.onChange(); }
  clear() { this.slots.fill(null); this.changed(); }

  // Adds a stack into the given slot range; returns the leftover count (stack is mutated)
  addToRange(stack, from, to) {
    // merge with existing stacks first
    for (let i = from; i < to && stack.count > 0; i++) {
      const s = this.slots[i];
      if (s && s.canStackWith(stack) && s.count < s.maxStack) {
        const n = Math.min(stack.count, s.maxStack - s.count);
        s.count += n; stack.count -= n;
      }
    }
    for (let i = from; i < to && stack.count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(stack.count, stack.maxStack);
        this.slots[i] = stack.copy(n);
        stack.count -= n;
      }
    }
    this.changed();
    return stack.count;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }
  removeItem(id, count) {
    for (let i = 0; i < this.size && count > 0; i++) {
      const s = this.slots[i];
      if (s && s.id === id) {
        const n = Math.min(count, s.count);
        s.count -= n; count -= n;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    this.changed();
    return count === 0;
  }
  serialize() { return this.slots.map((s) => (s ? s.serialize() : null)); }
  deserialize(arr) {
    for (let i = 0; i < this.size; i++) this.slots[i] = arr && arr[i] ? ItemStack.deserialize(arr[i]) : null;
    this.changed();
  }
}

// Player inventory: 0-8 hotbar, 9-35 main, 36-39 armor (feet, legs, chest, head), 40 offhand
export const HOTBAR = 0, MAIN_START = 9, ARMOR_START = 36, OFFHAND = 40;
export const ARMOR_SLOT_INDEX = { feet: 36, legs: 37, chest: 38, head: 39 };

export class PlayerInventory extends Inventory {
  constructor() {
    super(41);
    this.selected = 0;
  }
  get held() { return this.slots[this.selected]; }
  set held(s) { this.set(this.selected, s); }
  get offhand() { return this.slots[OFFHAND]; }
  armor(slot) { return this.slots[ARMOR_SLOT_INDEX[slot]]; }
  armorPieces() { return [this.slots[36], this.slots[37], this.slots[38], this.slots[39]]; }

  // Minecraft pickup order: stack onto existing (hotbar, then main), then first empty (hotbar, then main)
  add(stack) {
    if (!stack || stack.empty) return 0;
    const order = [];
    for (let i = 0; i < 36; i++) order.push(i);
    order.push(OFFHAND);
    for (const i of order) {
      const s = this.slots[i];
      if (stack.count <= 0) break;
      if (s && s.canStackWith(stack) && s.count < s.maxStack) {
        const n = Math.min(stack.count, s.maxStack - s.count);
        s.count += n; stack.count -= n;
      }
    }
    for (let i = 0; i < 36 && stack.count > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(stack.count, stack.maxStack);
        this.slots[i] = stack.copy(n);
        stack.count -= n;
      }
    }
    this.changed();
    return stack.count;
  }

  findSlot(id) {
    for (let i = 0; i < 36; i++) if (this.slots[i] && this.slots[i].id === id) return i;
    return -1;
  }
}
