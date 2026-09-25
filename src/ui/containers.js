// Container menus (slot logic mirroring vanilla AbstractContainerMenu) and their screens.
import { Screen } from './screens.js';
import { TextField } from './widgets.js';
import { ItemStack, Inventory, OFFHAND, ARMOR_SLOT_INDEX } from '../game/inventory.js';
import { matchRecipe, SMELTING } from '../registry/recipes.js';
import { ItemById, Items } from '../registry/items.js';
import { BlockById } from '../registry/blocks.js';

export class Slot {
  constructor(inv, index, x, y, opts = {}) {
    this.inv = inv; this.index = index; this.x = x; this.y = y;
    this.filter = opts.filter ?? null; this.max = opts.max ?? 64; this.output = !!opts.output; this.icon = opts.icon ?? null;
    this.onTake = opts.onTake ?? null;
    this.group = opts.group ?? 'container';
  }
  get stack() { return this.inv.get(this.index); }
  set stack(s) { this.inv.set(this.index, s && !s.empty ? s : null); }
  mayPlace(s) { if (this.output) return false; return !this.filter || this.filter(s); }
  maxFor(s) { return Math.min(this.max, s.maxStack); }
}

export class Menu {
  constructor(game) {
    this.game = game;
    this.slots = [];
    this.carried = null;
    this.drag = null;
  }
  get player() { return this.game.player; }
  addPlayerSlots(x0, y0) {
    const inv = this.player.inventory;
    this.playerStart = this.slots.length;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 9; c++) this.slots.push(new Slot(inv, 9 + r * 9 + c, x0 + c * 18, y0 + r * 18, { group: 'main' }));
    this.hotbarStart = this.slots.length;
    for (let c = 0; c < 9; c++) this.slots.push(new Slot(inv, c, x0 + c * 18, y0 + 58, { group: 'hotbar' }));
    this.playerEnd = this.slots.length;
  }
  slotChanged() {}

  // move stack into slot range; returns true if something moved
  moveItemStackTo(stack, start, end, reverse = false) {
    let moved = false;
    const order = [];
    for (let i = start; i < end; i++) order.push(i);
    if (reverse) order.reverse();
    if (stack.maxStack > 1) {
      for (const i of order) {
        if (stack.count <= 0) break;
        const sl = this.slots[i];
        const s = sl.stack;
        if (s && s.canStackWith(stack) && sl.mayPlace(stack)) {
          const max = sl.maxFor(s);
          const n = Math.min(stack.count, max - s.count);
          if (n > 0) { s.count += n; stack.count -= n; sl.inv.changed(); moved = true; }
        }
      }
    }
    for (const i of order) {
      if (stack.count <= 0) break;
      const sl = this.slots[i];
      if (!sl.stack && sl.mayPlace(stack)) {
        const n = Math.min(stack.count, sl.maxFor(stack));
        sl.stack = stack.copy(n);
        stack.count -= n;
        moved = true;
      }
    }
    return moved;
  }

  // default shift-click: container <-> player inventory
  quickMove(i) {
    const sl = this.slots[i];
    const s = sl.stack;
    if (!s) return;
    const copy = s.copy();
    if (i < this.playerStart) {
      if (!this.moveItemStackTo(copy, this.playerStart, this.playerEnd, true)) return;
    } else if (!this.moveItemStackTo(copy, 0, this.playerStart, false)) {
      // move between main inventory and hotbar
      if (i >= this.hotbarStart) this.moveItemStackTo(copy, this.playerStart, this.hotbarStart);
      else this.moveItemStackTo(copy, this.hotbarStart, this.playerEnd);
    }
    sl.stack = copy.count > 0 ? copy : null;
    if (sl.output && copy.count !== s.count) sl.onTake?.(s.count - copy.count);
    this.slotChanged(i);
  }

  // mouse click on a slot. button 0 left, 1 right. mode: 'pickup' | 'quick' | 'swap' (key) | 'throw' | 'collect'
  click(i, button, mode, extra) {
    const sl = i >= 0 ? this.slots[i] : null;
    if (mode === 'outside') {
      if (this.carried) {
        const n = button === 0 ? this.carried.count : 1;
        this.game.dropFromPlayer(this.carried.copy(n));
        this.carried.count -= n;
        if (this.carried.count <= 0) this.carried = null;
      }
      return;
    }
    if (!sl) return;
    if (mode === 'quick') {
      if (sl.output) { this.quickCraft(i); return; }
      this.quickMove(i);
      return;
    }
    if (mode === 'swap') {
      const inv = this.player.inventory;
      const hi = extra;
      const hs = inv.get(hi);
      const s = sl.stack;
      if (sl.output) {
        if (s && !hs) { inv.set(hi, s.copy()); sl.stack = null; sl.onTake?.(s.count); this.slotChanged(i); }
        return;
      }
      if (hs && !sl.mayPlace(hs)) return;
      sl.stack = hs ? hs.copy() : null;
      inv.set(hi, s ? s.copy() : null);
      this.slotChanged(i);
      return;
    }
    if (mode === 'throw') {
      const s = sl.stack;
      if (!s || this.carried) return;
      const n = button === 1 ? s.count : 1;
      this.game.dropFromPlayer(s.copy(n));
      if (sl.output) { sl.onTake?.(n); }
      s.count -= n;
      sl.stack = s.count > 0 ? s : null;
      this.slotChanged(i);
      return;
    }
    if (mode === 'collect') {
      const c = this.carried;
      if (!c || sl.output) return;
      for (const pass of [0, 1]) {
        for (let k = 0; k < this.slots.length && c.count < c.maxStack; k++) {
          const o = this.slots[k];
          const s = o.stack;
          if (!s || o.output || !s.canStackWith(c)) continue;
          if (pass === 0 && s.count >= s.maxStack) continue;
          const n = Math.min(s.count, c.maxStack - c.count);
          s.count -= n; c.count += n;
          o.stack = s.count > 0 ? s : null;
        }
      }
      this.slotChanged(-1);
      return;
    }
    // pickup
    const s = sl.stack;
    let c = this.carried;
    if (sl.output) {
      if (!s) return;
      if (!c) { this.carried = s.copy(); sl.stack = null; sl.onTake?.(s.count); }
      else if (c.canStackWith(s) && c.count + s.count <= c.maxStack) { c.count += s.count; sl.stack = null; sl.onTake?.(s.count); }
      this.slotChanged(i);
      return;
    }
    if (!s && c) {
      if (!sl.mayPlace(c)) return;
      const n = button === 0 ? Math.min(c.count, sl.maxFor(c)) : 1;
      sl.stack = c.copy(n);
      c.count -= n;
      if (c.count <= 0) this.carried = null;
    } else if (s && !c) {
      const n = button === 0 ? s.count : Math.ceil(s.count / 2);
      this.carried = s.copy(n);
      s.count -= n;
      sl.stack = s.count > 0 ? s : null;
    } else if (s && c) {
      if (s.canStackWith(c) && sl.mayPlace(c)) {
        const n = button === 0 ? Math.min(c.count, sl.maxFor(s) - s.count) : Math.min(1, sl.maxFor(s) - s.count);
        if (n > 0) { s.count += n; c.count -= n; if (c.count <= 0) this.carried = null; sl.inv.changed(); }
      } else if (sl.mayPlace(c) && c.count <= sl.maxFor(c)) {
        sl.stack = c; this.carried = s;
      }
    }
    this.slotChanged(i);
  }

  // drag-distribute ("quick craft")
  finishDrag(button, slotsIdx) {
    const c = this.carried;
    if (!c) return;
    const targets = slotsIdx.filter((i) => {
      const sl = this.slots[i];
      if (sl.output || !sl.mayPlace(c)) return false;
      const s = sl.stack;
      return !s || (s.canStackWith(c) && s.count < sl.maxFor(s));
    });
    if (!targets.length) return;
    const per = button === 0 ? Math.floor(c.count / targets.length) : 1;
    if (per <= 0) return;
    for (const i of targets) {
      if (c.count <= 0) break;
      const sl = this.slots[i];
      const s = sl.stack;
      const room = s ? sl.maxFor(s) - s.count : sl.maxFor(c);
      const n = Math.min(per, room, c.count);
      if (s) { s.count += n; sl.inv.changed(); } else sl.stack = c.copy(n);
      c.count -= n;
    }
    if (c.count <= 0) this.carried = null;
    this.slotChanged(-1);
  }

  quickCraft(i) {
    // shift-click on a crafting result: craft as many as possible into the player inventory
    const sl = this.slots[i];
    let guard = 0;
    while (sl.stack && guard++ < 64) {
      const s = sl.stack.copy();
      const before = s.count;
      if (!this.canFit(s)) break;
      this.moveItemStackTo(s, this.playerStart, this.playerEnd, true);
      sl.stack = null;
      sl.onTake?.(before);
      this.slotChanged(i);
    }
  }
  canFit(stack) {
    let room = 0;
    for (let k = this.playerStart; k < this.playerEnd; k++) {
      const s = this.slots[k].stack;
      if (!s) room += stack.maxStack; else if (s.canStackWith(stack)) room += s.maxStack - s.count;
      if (room >= stack.count) return true;
    }
    return false;
  }

  removed() {
    if (this.carried) {
      const left = this.player.inventory.add(this.carried);
      if (left > 0) this.game.dropFromPlayer(this.carried);
      this.carried = null;
    }
  }
}

// ---------- crafting ----------
class CraftingGrid extends Inventory {
  constructor(w, h) { super(w * h + 1); this.w = w; this.h = h; }
}

class CraftingMenuBase extends Menu {
  setupCrafting(w, h, gx, gy, rx, ry) {
    this.grid = new CraftingGrid(w, h);
    this.gridStart = this.slots.length;
    this.resultSlot = new Slot(this.grid, w * h, rx, ry, { output: true, onTake: (n) => this.onCraft(n) });
    this.slots.push(this.resultSlot);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.slots.push(new Slot(this.grid, y * w + x, gx + x * 18, gy + y * 18));
    this.gridEnd = this.slots.length;
  }
  updateResult() {
    const g = this.grid;
    const ids = [];
    for (let i = 0; i < g.w * g.h; i++) ids.push(g.get(i)?.id ?? null);
    const r = matchRecipe(ids, g.w, g.h);
    this.recipe = r;
    g.slots[g.w * g.h] = r ? new ItemStack(r.result, r.count) : null;
  }
  onCraft() {
    const g = this.grid;
    for (let i = 0; i < g.w * g.h; i++) {
      const s = g.get(i);
      if (!s) continue;
      s.count--;
      const cont = s.item?.container;
      if (s.count <= 0) g.slots[i] = cont ? ItemStack.of(cont) : null;
      else if (cont) { const left = this.player.inventory.add(ItemStack.of(cont)); if (left) this.game.dropFromPlayer(ItemStack.of(cont)); }
    }
    this.game.stats.crafted = (this.game.stats.crafted ?? 0) + 1;
    this.updateResult();
  }
  slotChanged() { this.updateResult(); }
  quickMove(i) {
    if (i >= this.gridStart && i < this.gridEnd && !this.slots[i].output) {
      const sl = this.slots[i]; const s = sl.stack; if (!s) return;
      const c = s.copy();
      this.moveItemStackTo(c, this.playerStart, this.playerEnd, false);
      sl.stack = c.count > 0 ? c : null;
      this.updateResult();
      return;
    }
    super.quickMove(i);
  }
  removed() {
    super.removed();
    const g = this.grid;
    for (let i = 0; i < g.w * g.h; i++) {
      const s = g.get(i);
      if (s) { const left = this.player.inventory.add(s); if (left > 0) this.game.dropFromPlayer(s); g.slots[i] = null; }
    }
  }
}

export class InventoryMenu extends CraftingMenuBase {
  constructor(game) {
    super(game);
    const inv = this.player.inventory;
    this.setupCrafting(2, 2, 98, 18, 154, 28);
    // 0 result, 1-4 grid
    this.armorStart = this.slots.length;
    const armorOrder = ['head', 'chest', 'legs', 'feet'];
    armorOrder.forEach((slot, k) => {
      this.slots.push(new Slot(inv, ARMOR_SLOT_INDEX[slot], 8, 8 + k * 18, {
        max: 1, icon: `empty_armor_slot_${({ head: 'helmet', chest: 'chestplate', legs: 'leggings', feet: 'boots' })[slot]}`,
        filter: (s) => s.item?.armor?.slot === slot || (slot === 'head' && s.item?.block !== undefined && BlockById[s.item.block]?.armorSlot === 'head'), group: 'armor',
      }));
    });
    this.addPlayerSlots(8, 84);
    this.offhandSlot = this.slots.length;
    this.slots.push(new Slot(inv, OFFHAND, 77, 62, { icon: 'empty_armor_slot_shield', group: 'offhand' }));
  }
  quickMove(i) {
    const sl = this.slots[i];
    const s = sl.stack;
    if (!s) return;
    if (i >= this.playerStart && i < this.playerEnd) {
      // armor goes to its slot first, shields to offhand
      const a = s.item?.armor;
      if (a) {
        const t = this.slots.find((x) => x.group === 'armor' && x.mayPlace(s) && !x.stack);
        if (t) { t.stack = s.copy(1); s.count--; sl.stack = s.count > 0 ? s : null; return; }
      }
      if (s.item?.use === 'shield' && !this.slots[this.offhandSlot].stack) { this.slots[this.offhandSlot].stack = s.copy(); sl.stack = null; return; }
      const c = s.copy();
      if (i >= this.hotbarStart) this.moveItemStackTo(c, this.playerStart, this.hotbarStart);
      else this.moveItemStackTo(c, this.hotbarStart, this.playerEnd);
      sl.stack = c.count > 0 ? c : null;
      return;
    }
    if (sl.output) { this.quickCraft(i); return; }
    const c = s.copy();
    this.moveItemStackTo(c, this.playerStart, this.playerEnd, false);
    sl.stack = c.count > 0 ? c : null;
    this.updateResult();
  }
}

export class CraftingTableMenu extends CraftingMenuBase {
  constructor(game) {
    super(game);
    this.setupCrafting(3, 3, 30, 17, 124, 35);
    this.addPlayerSlots(8, 84);
  }
}

export class ChestMenu extends Menu {
  constructor(game, be, rows = 3) {
    super(game);
    this.be = be;
    this.rows = rows;
    const inv = be.inventory;
    for (let r = 0; r < rows; r++) for (let c = 0; c < 9; c++) this.slots.push(new Slot(inv, r * 9 + c, 8 + c * 18, 18 + r * 18));
    this.addPlayerSlots(8, 103 + (rows - 4) * 18);
  }
}

export class FurnaceMenu extends Menu {
  constructor(game, be) {
    super(game);
    this.be = be;
    const inv = be.inventory;
    this.slots.push(new Slot(inv, 0, 56, 17));
    this.slots.push(new Slot(inv, 1, 56, 53, { filter: (s) => fuelOf(s) > 0 || s.item?.name === 'bucket' }));
    this.slots.push(new Slot(inv, 2, 116, 35, { output: true, onTake: (n) => this.onTakeResult(n) }));
    this.addPlayerSlots(8, 84);
  }
  onTakeResult(n) {
    const xp = this.be.xp ?? 0;
    const give = Math.floor(xp);
    if (give > 0 || Math.random() < xp - give) this.game.spawnXp(this.player.x, this.player.y + 0.5, this.player.z, Math.max(1, give));
    this.be.xp = 0;
    void n;
  }
  quickMove(i) {
    const sl = this.slots[i];
    const s = sl.stack;
    if (!s) return;
    if (i >= this.playerStart) {
      const c = s.copy();
      if (SMELTING.has(s.id)) this.moveItemStackTo(c, 0, 1);
      else if (fuelOf(s) > 0) this.moveItemStackTo(c, 1, 2);
      else if (i >= this.hotbarStart) this.moveItemStackTo(c, this.playerStart, this.hotbarStart);
      else this.moveItemStackTo(c, this.hotbarStart, this.playerEnd);
      sl.stack = c.count > 0 ? c : null;
      return;
    }
    super.quickMove(i);
  }
}

export function fuelOf(s) {
  if (!s) return 0;
  const it = s.item;
  if (!it) return 0;
  if (it.fuel) return it.fuel;
  if (it.block !== undefined && BlockById[it.block]?.fuel) return BlockById[it.block].fuel;
  return 0;
}

// ---------- screens ----------
export class ContainerScreen extends Screen {
  constructor(game, menu, title, w = 176, h = 166) {
    super(game);
    this.menu = menu; this.containerTitle = title; this.imageWidth = w; this.imageHeight = h;
    this.hoverSlot = -1;
    this.dragging = null;
    this.lastClick = { t: 0, slot: -1 };
  }
  get pausesGame() { return false; }
  get transparent() { return true; }
  build(w, h) { this.left = Math.floor((w - this.imageWidth) / 2); this.top = Math.floor((h - this.imageHeight) / 2); }
  slotAt(mx, my) {
    const lx = mx - this.left, ly = my - this.top;
    for (let i = 0; i < this.menu.slots.length; i++) {
      const s = this.menu.slots[i];
      const size = s.output && this.bigOutput ? 26 : 18;
      const off = size === 26 ? 4 : 1;
      if (lx >= s.x - off && lx < s.x - off + size && ly >= s.y - off && ly < s.y - off + size) return i;
    }
    return -1;
  }
  renderBg(gui) { gui.panel(this.left, this.top, this.imageWidth, this.imageHeight); }
  renderLabels(gui) {
    gui.text(this.containerTitle, this.left + 8, this.top + 6, '#404040', false);
    if (this.menu.playerStart !== undefined) {
      const py = this.menu.slots[this.menu.playerStart].y;
      gui.text('Inventory', this.left + 8, this.top + py - 11, '#404040', false);
    }
  }
  render(gui, mx, my) {
    gui.darkOverlay();
    this.renderBg(gui);
    const L = this.left, T = this.top;
    const menu = this.menu;
    this.hoverSlot = this.slotAt(mx, my);
    for (let i = 0; i < menu.slots.length; i++) {
      const s = menu.slots[i];
      if (s.output && this.bigOutput) gui.slot(L + s.x - 5, T + s.y - 5, 26, 26); else gui.slot(L + s.x - 1, T + s.y - 1);
      if (!s.stack && s.icon) { const ic = this.game.icons.sprite(s.icon); if (ic) gui.ctx.drawImage(ic, L + s.x, T + s.y, 16, 16); }
    }
    this.renderExtra?.(gui, mx, my);
    this.renderLabels(gui);
    const dragSet = this.dragging && this.dragging.slots.length > 1 ? new Set(this.dragging.slots) : null;
    for (let i = 0; i < menu.slots.length; i++) {
      const s = menu.slots[i];
      let st = s.stack;
      if (dragSet && dragSet.has(i) && menu.carried) {
        gui.fill(L + s.x, T + s.y, 16, 16, 'rgba(255,255,255,0.4)');
      }
      gui.item(st, L + s.x, T + s.y);
      if (i === this.hoverSlot) gui.slotHighlight(L + s.x, T + s.y);
    }
    // carried item follows the mouse
    if (menu.carried) {
      let shown = menu.carried;
      if (dragSet) {
        const per = this.dragging.button === 0 ? Math.floor(shown.count / dragSet.size) : 1;
        const left = shown.count - per * dragSet.size;
        shown = shown.copy(Math.max(0, left));
      }
      if (shown.count > 0 || !dragSet) gui.item(shown, mx - 8, my - 8);
    } else if (this.hoverSlot >= 0) {
      const st = menu.slots[this.hoverSlot].stack;
      if (st) gui.itemTooltip(st, mx, my, this.game.settings.advancedTooltips);
    }
  }
  mouseDown(mx, my, b, shift) {
    const i = this.slotAt(mx, my);
    const menu = this.menu;
    const lx = mx - this.left, ly = my - this.top;
    const outside = lx < 0 || ly < 0 || lx >= this.imageWidth || ly >= this.imageHeight;
    if (b === 2) { // middle click: creative clone
      if (i >= 0 && this.game.player.creative && menu.slots[i].stack && !menu.carried) { menu.carried = menu.slots[i].stack.copy(menu.slots[i].stack.maxStack); }
      return true;
    }
    if (i < 0) {
      if (outside && this.outsideClickDrops !== false) menu.click(-1, b, 'outside');
      return true;
    }
    const now = performance.now();
    if (b === 0 && !shift && now - this.lastClick.t < 250 && this.lastClick.slot === i && menu.carried) {
      menu.click(i, 0, 'collect');
      this.lastClick = { t: 0, slot: -1 };
      return true;
    }
    this.lastClick = { t: now, slot: i };
    if (shift) { menu.click(i, b, 'quick'); this.shiftDrag = true; return true; }
    if (menu.carried && !menu.slots[i].output) {
      this.dragging = { button: b, slots: [i], start: i };
      return true;
    }
    menu.click(i, b, 'pickup');
    return true;
  }
  mouseMove(mx, my) {
    const i = this.slotAt(mx, my);
    if (this.dragging && i >= 0 && !this.dragging.slots.includes(i) && !this.menu.slots[i].output) {
      const c = this.menu.carried;
      const sl = this.menu.slots[i];
      const s = sl.stack;
      if (c && sl.mayPlace(c) && (!s || s.canStackWith(c))) {
        if (this.dragging.slots.length < c.count || this.dragging.button === 0 && this.dragging.slots.length < c.count) this.dragging.slots.push(i);
      }
    }
  }
  mouseUp(mx, my, b) {
    if (this.dragging && this.dragging.button === b) {
      const d = this.dragging;
      this.dragging = null;
      if (d.slots.length > 1) this.menu.finishDrag(b, d.slots);
      else this.menu.click(d.start, b, 'pickup');
    }
    this.shiftDrag = false;
  }
  keyDown(e) {
    const inp = this.game.input;
    if (e.code === 'Escape' || e.code === inp.bindings.inventory) { this.onClose(); return true; }
    if (this.hoverSlot >= 0) {
      for (let k = 1; k <= 9; k++) if (e.code === inp.bindings[`hotbar${k}`]) { this.menu.click(this.hoverSlot, 0, 'swap', k - 1); return true; }
      if (e.code === inp.bindings.swapHands) { this.menu.click(this.hoverSlot, 0, 'swap', OFFHAND); return true; }
      if (e.code === inp.bindings.drop) { this.menu.click(this.hoverSlot, e.ctrl ? 1 : 0, 'throw'); return true; }
    }
    return false;
  }
  onClose() { this.menu.removed(); this.game.setScreen(null); }
  removed() { this.game.playerPreview = null; }
}

export class InventoryScreen extends ContainerScreen {
  constructor(game) { super(game, new InventoryMenu(game), 'Crafting'); }
  renderBg(gui) {
    super.renderBg(gui);
    const L = this.left, T = this.top;
    // player preview window
    gui.fill(L + 25, T + 7, 52, 72, '#000000');
    gui.slot(L + 25, T + 7, 52, 72);
    gui.fill(L + 26, T + 8, 50, 70, '#000000');
    // arrow between grid and result
    this.drawArrow(gui, L + 135, T + 29);
  }
  drawArrow(gui, x, y) {
    gui.fill(x, y + 3, 12, 2, '#8b8b8b');
    gui.fill(x + 9, y, 1, 8, '#8b8b8b'); gui.fill(x + 10, y + 1, 1, 6, '#8b8b8b'); gui.fill(x + 11, y + 2, 1, 4, '#8b8b8b'); gui.fill(x + 12, y + 3, 1, 2, '#8b8b8b');
  }
  renderLabels(gui) { gui.text('Crafting', this.left + 97, this.top + 8, '#404040', false); }
  renderExtra(gui, mx, my) {
    const s = gui.scale;
    this.game.playerPreview = { x: (this.left + 26) * s, y: (this.top + 8) * s, w: 50 * s, h: 70 * s, mx: mx * s, my: my * s };
    gui.ctx.clearRect(this.left + 26, this.top + 8, 50, 70);
  }
}

export class CraftingScreen extends ContainerScreen {
  constructor(game) { super(game, new CraftingTableMenu(game), 'Crafting'); this.bigOutput = true; }
  renderBg(gui) {
    super.renderBg(gui);
    const L = this.left, T = this.top;
    const x = L + 90, y = T + 35;
    gui.fill(x, y + 6, 16, 3, '#8b8b8b');
    for (let k = 0; k < 7; k++) gui.fill(x + 15 + k, y + k, 1, 15 - k * 2, '#8b8b8b');
  }
  renderLabels(gui) { gui.text('Crafting', this.left + 29, this.top + 6, '#404040', false); gui.text('Inventory', this.left + 8, this.top + 72, '#404040', false); }
  onClose() { this.menu.removed(); this.game.setScreen(null); }
}

export class ChestScreen extends ContainerScreen {
  constructor(game, be, title = 'Chest', rows = 3) {
    super(game, new ChestMenu(game, be, rows), title, 176, 114 + rows * 18);
    this.be = be;
  }
  onClose() { super.onClose(); this.game.onChestClosed?.(this.be); }
}

export class FurnaceScreen extends ContainerScreen {
  constructor(game, be) { super(game, new FurnaceMenu(game, be), 'Furnace'); this.be = be; this.bigOutput = true; }
  renderExtra(gui) {
    const L = this.left, T = this.top, be = this.be;
    gui.sprite('furnace_burn_empty', L + 56, T + 36);
    if (be.burnTime > 0) {
      const f = Math.ceil(be.burnTime / Math.max(1, be.burnDuration) * 13) + 1;
      gui.sprite('furnace_burn_progress', L + 56, T + 36 + 14 - f, 0, 14 - f, 14, f);
    }
    gui.sprite('furnace_arrow_empty', L + 79, T + 34);
    const p = Math.floor((be.cookTime / Math.max(1, be.cookDuration)) * 24);
    if (p > 0) gui.sprite('furnace_arrow_progress', L + 79, T + 34, 0, 0, p, 17);
  }
}

// ---------- creative inventory ----------
const TABS = [
  { id: 'building', name: 'Building Blocks', icon: 'bricks', col: 0, row: 0 },
  { id: 'decoration', name: 'Decoration Blocks', icon: 'peony', iconAlt: 'poppy', col: 1, row: 0 },
  { id: 'redstone', name: 'Redstone', icon: 'redstone', col: 2, row: 0 },
  { id: 'misc', name: 'Miscellaneous', icon: 'lava_bucket', col: 3, row: 0 },
  { id: 'search', name: 'Search Items', icon: 'compass', col: 5, row: 0 },
  { id: 'food', name: 'Foodstuffs', icon: 'apple', col: 0, row: 1 },
  { id: 'tools', name: 'Tools', icon: 'iron_axe', col: 1, row: 1 },
  { id: 'combat', name: 'Combat', icon: 'golden_sword', col: 2, row: 1 },
  { id: 'inventory', name: 'Survival Inventory', icon: 'chest', col: 5, row: 1 },
];

function categorize(it) {
  if (it.food) return 'food';
  if (it.tool && it.tool.type !== 'sword') return 'tools';
  if (it.armor || it.tool?.type === 'sword' || ['bow', 'crossbow', 'arrow', 'shield', 'trident'].includes(it.name)) return 'combat';
  if (['bucket', 'water_bucket', 'lava_bucket', 'milk_bucket', 'flint_and_steel', 'compass', 'clock', 'shears', 'fishing_rod', 'lead', 'name_tag', 'saddle', 'map'].includes(it.name)) return 'tools';
  if (['redstone', 'redstone_block', 'tnt', 'oak_door', 'oak_trapdoor'].includes(it.name)) return 'redstone';
  if (it.block !== undefined) {
    const b = BlockById[it.block];
    if (b.render === 'cube' && !b.interact && !b.leaves && b.name !== 'glass' && b.name !== 'glowstone') return 'building';
    if (['slab', 'stairs'].includes(b.shape)) return 'building';
    return 'decoration';
  }
  return 'misc';
}

class CreativePalette extends Inventory { constructor() { super(45); } }

export class CreativeMenu extends Menu {
  constructor(game) {
    super(game);
    this.palette = new CreativePalette();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 9; c++) this.slots.push(new Slot(this.palette, r * 9 + c, 9 + c * 18, 18 + r * 18, { group: 'palette' }));
    const inv = this.player.inventory;
    this.hotbarStart = this.slots.length;
    for (let c = 0; c < 9; c++) this.slots.push(new Slot(inv, c, 9 + c * 18, 112, { group: 'hotbar' }));
    this.playerStart = this.hotbarStart; this.playerEnd = this.slots.length;
  }
  click(i, button, mode, extra) {
    const sl = i >= 0 ? this.slots[i] : null;
    if (sl && sl.group === 'palette') {
      const s = sl.stack;
      if (mode === 'quick') { if (s) this.player.inventory.add(s.copy(s.maxStack)); return; }
      if (mode === 'swap') { if (s) this.player.inventory.set(extra, s.copy(s.maxStack)); return; }
      if (mode === 'throw') { if (s) this.game.dropFromPlayer(s.copy(button === 1 ? s.maxStack : 1)); return; }
      if (this.carried) {
        if (s && this.carried.canStackWith(s)) { if (button === 0) this.carried.count = Math.min(this.carried.maxStack, this.carried.count + 1); else this.carried.count--; if (this.carried.count <= 0) this.carried = null; }
        else this.carried = button === 1 ? (this.carried.count > 1 ? (this.carried.count--, this.carried) : null) : null;
        return;
      }
      if (s) this.carried = s.copy(button === 1 ? s.maxStack : 1);
      return;
    }
    super.click(i, button, mode, extra);
  }
  quickMove(i) {
    const sl = this.slots[i];
    if (sl.group === 'hotbar') { sl.stack = null; return; }
    super.quickMove(i);
  }
  removed() { this.carried = null; }
}

export class CreativeScreen extends ContainerScreen {
  constructor(game) {
    super(game, new CreativeMenu(game), '', 195, 136);
    this.tab = game.lastCreativeTab ?? 'building';
    this.scroll = 0;
    this.items = [];
    this.search = '';
    this.outsideClickDrops = true;
  }
  build(w, h) {
    super.build(w, h);
    this.searchField = this.add(new TextField(this.left + 82, this.top + 6, 89, 9, this.search, { maxLength: 50, onChange: (v) => { this.search = v; this.refresh(); } }));
    this.searchField.visible = this.tab === 'search';
    this.searchField.focused = this.tab === 'search';
    if (this.tab === 'inventory') this.switchToInventory();
    else this.refresh();
  }
  allItems() {
    const out = [];
    for (const it of ItemById) {
      if (!it) continue;
      if (it.name === 'air') continue;
      out.push(it);
    }
    return out;
  }
  refresh() {
    let list;
    if (this.tab === 'search') {
      const q = this.search.toLowerCase();
      list = this.allItems().filter((it) => it.display.toLowerCase().includes(q) || it.name.includes(q));
    } else list = this.allItems().filter((it) => categorize(it) === this.tab);
    this.items = list;
    this.scroll = Math.min(this.scroll, this.maxScroll());
    this.fillPalette();
  }
  maxScroll() { return Math.max(0, Math.ceil(this.items.length / 9) - 5); }
  fillPalette() {
    const p = this.menu.palette;
    for (let k = 0; k < 45; k++) {
      const it = this.items[this.scroll * 9 + k];
      p.slots[k] = it ? new ItemStack(it.id, 1) : null;
    }
  }
  switchToInventory() {
    this.inventoryMenu = this.inventoryMenu ?? new InventoryMenu(this.game);
    this.menuBackup = this.menuBackup ?? this.menu;
  }
  setTab(id) {
    this.tab = id;
    this.game.lastCreativeTab = id;
    this.scroll = 0;
    this.searchField.visible = id === 'search';
    this.searchField.focused = id === 'search';
    if (id === 'inventory') {
      this.menuBackup = this.menuBackup ?? this.menu;
      const inv = new InventoryMenu(this.game);
      inv.carried = this.menu.carried; this.menu.carried = null;
      // relayout player inventory slots into the creative frame
      for (const s of inv.slots) {
        if (s.group === 'armor') { s.x = 54 + (Math.floor((inv.slots.indexOf(s) - inv.armorStart) / 2)) * 54; s.y = 6 + ((inv.slots.indexOf(s) - inv.armorStart) % 2) * 27; }
      }
      inv.slots.forEach((s, k) => {
        if (s.group === 'main') { const idx = k - inv.playerStart; s.x = 9 + (idx % 9) * 18; s.y = 54 + Math.floor(idx / 9) * 18; }
        if (s.group === 'hotbar') { const idx = k - inv.hotbarStart; s.x = 9 + idx * 18; s.y = 112; }
        if (s.group === 'offhand') { s.x = 35; s.y = 20; }
        if (s.group === 'container' || s.output) { s.x = -1000; s.y = -1000; }
      });
      this.menu = inv;
    } else {
      if (this.menuBackup && this.menu !== this.menuBackup) { this.menuBackup.carried = this.menu.carried; this.menu = this.menuBackup; }
      this.refresh();
    }
  }
  tabRect(i) {
    const t = TABS[i];
    const x = this.left + t.col * 29 + (t.col === 5 ? -1 : 0);
    const y = t.row === 0 ? this.top - 28 : this.top + this.imageHeight - 4;
    return { x, y, w: 28, h: 32, top: t.row === 0 };
  }
  renderBg(gui) {
    // tabs behind
    TABS.forEach((t, i) => { if (t.id !== this.tab) this.drawTab(gui, i, false); });
    gui.panel(this.left, this.top, this.imageWidth, this.imageHeight);
    const L = this.left, T = this.top;
    if (this.tab !== 'inventory') {
      // scrollbar track
      gui.slot(L + 174, T + 17, 14, 112);
      gui.fill(L + 175, T + 18, 12, 110, '#8b8b8b');
      const ms = this.maxScroll();
      const sy = T + 18 + (ms ? (this.scroll / ms) * (110 - 15) : 0);
      gui.sprite(ms ? 'scroller' : 'scroller_disabled', L + 175, sy);
      if (this.tab === 'search') gui.fill(L + 80, T + 4, 91, 12, '#000000');
    } else {
      gui.fill(L + 73, T + 6, 32, 43, '#000000');
      gui.slot(L + 72, T + 5, 34, 45);
      gui.fill(L + 73, T + 6, 32, 43, '#000000');
      // destroy item slot
      gui.slot(L + 172, T + 111);
      const ic = this.game.icons.sprite('empty_armor_slot_shield');
      void ic;
    }
    this.drawTab(gui, TABS.findIndex((t) => t.id === this.tab), true);
  }
  drawTab(gui, i, selected) {
    const r = this.tabRect(i);
    const name = selected ? 'inventory_tab_selected' : 'inventory_tab';
    const c = gui.ctx;
    if (!r.top) { c.save(); c.translate(r.x, r.y + r.h); c.scale(1, -1); gui.sprite(name, 0, 0); c.restore(); } else gui.sprite(name, r.x, r.y);
    const t = TABS[i];
    const it = Items[t.icon] ?? Items[t.iconAlt];
    if (it) gui.item(new ItemStack(it.id, 1), r.x + 6, r.top ? r.y + 9 : r.y + 7, { count: false });
  }
  renderLabels(gui) {
    const t = TABS.find((x) => x.id === this.tab);
    if (this.tab !== 'search' && this.tab !== 'inventory') gui.text(t.name, this.left + 8, this.top + 6, '#404040', false);
  }
  renderExtra(gui, mx, my) {
    if (this.tab === 'inventory') {
      const s = gui.scale;
      this.game.playerPreview = { x: (this.left + 73) * s, y: (this.top + 6) * s, w: 32 * s, h: 43 * s, mx: mx * s, my: my * s };
      gui.ctx.clearRect(this.left + 73, this.top + 6, 32, 43);
    } else this.game.playerPreview = null;
  }
  render(gui, mx, my) {
    super.render(gui, mx, my);
    for (const w of this.widgets) w.render(gui, mx, my);
    // tab tooltips
    TABS.forEach((t, i) => {
      const r = this.tabRect(i);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h - 4) gui.tooltip([t.name], mx, my);
    });
    if (this.tab === 'inventory' && this.menu.carried) {
      const L = this.left, T = this.top;
      if (mx >= L + 173 && mx < L + 189 && my >= T + 112 && my < T + 128) gui.tooltip(['Destroy Item'], mx, my);
    }
  }
  mouseDown(mx, my, b, shift) {
    for (let i = 0; i < TABS.length; i++) {
      const r = this.tabRect(i);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h - 4) { this.setTab(TABS[i].id); this.game.sound.play('random.click', { volume: 0.25 }); return true; }
    }
    if (this.searchField.visible && this.searchField.mouseDown(mx, my, b)) return true;
    const L = this.left, T = this.top;
    if (this.tab !== 'inventory' && mx >= L + 175 && mx < L + 187 && my >= T + 18 && my < T + 128) { this.draggingScroll = true; this.setScrollFromMouse(my); return true; }
    if (this.tab === 'inventory' && mx >= L + 172 && mx < L + 190 && my >= T + 111 && my < T + 129) {
      if (this.menu.carried) this.menu.carried = null;
      else if (shift) for (let k = 0; k < 41; k++) this.game.player.inventory.slots[k] = null;
      this.game.player.inventory.changed();
      return true;
    }
    // clicking outside with an item in creative drops it
    return super.mouseDown(mx, my, b, shift);
  }
  setScrollFromMouse(my) {
    const ms = this.maxScroll();
    const f = (my - this.top - 18 - 7) / (110 - 15);
    this.scroll = Math.round(Math.max(0, Math.min(1, f)) * ms);
    this.fillPalette();
  }
  mouseMove(mx, my) { if (this.draggingScroll) this.setScrollFromMouse(my); else super.mouseMove(mx, my); }
  mouseUp(mx, my, b) { this.draggingScroll = false; super.mouseUp(mx, my, b); }
  wheel(d) {
    if (this.tab === 'inventory') return true;
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + d));
    this.fillPalette();
    return true;
  }
  keyDown(e) {
    if (this.tab === 'search' && this.searchField.focused) {
      if (e.code === 'Escape') { this.onClose(); return true; }
      if (this.searchField.keyDown(e)) return true;
    }
    if (this.tab !== 'search' && e.key && e.key.length === 1 && /[a-z0-9]/i.test(e.key) && !Object.values(this.game.input.bindings).includes(e.code)) {
      this.setTab('search');
      this.searchField.insert(e.key);
      return true;
    }
    return super.keyDown(e);
  }
  onClose() {
    if (this.menu !== this.menuBackup && this.menuBackup) this.menu.removed();
    this.game.setScreen(null);
  }
}

// ---------- enchanting table ----------
import { tableCosts, selectEnchantments, enchantability, enchantName, roman, anvilResult, repairMaterial } from '../game/enchanting.js';
import * as FONT_MODULE from '../textures/font.js';
import { TAGS } from '../registry/recipes.js';

class SmallInv extends Inventory {}

export class EnchantmentMenu extends Menu {
  constructor(game, pos) {
    super(game);
    this.pos = pos;
    this.inv = new SmallInv(2);
    this.slots.push(new Slot(this.inv, 0, 15, 47, { max: 1 }));
    this.slots.push(new Slot(this.inv, 1, 35, 47, { filter: (s) => s.item?.name === 'lapis_lazuli', icon: 'empty_slot_lapis_lazuli' }));
    this.addPlayerSlots(8, 84);
    this.costs = [0, 0, 0];
    this.clues = [null, null, null];
    this.shelves = this.countShelves();
  }
  countShelves() {
    const w = this.game.world, [x, y, z] = this.pos;
    let n = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((dx || dz) && w.getBlock(x + dx, y, z + dz) === 0 && w.getBlock(x + dx, y + 1, z + dz) === 0) {
        for (const dy of [0, 1]) {
          if (w.getBlockDef(x + dx * 2, y + dy, z + dz * 2).name === 'bookshelf') n++;
          if (dx && dz) {
            if (w.getBlockDef(x + dx * 2, y + dy, z + dz).name === 'bookshelf') n++;
            if (w.getBlockDef(x + dx, y + dy, z + dz * 2).name === 'bookshelf') n++;
          }
        }
      }
    }
    return n;
  }
  slotChanged() {
    const s = this.inv.get(0);
    const p = this.player;
    if (!s || s.tag?.enchantments?.length || enchantability(s.item) <= 0) { this.costs = [0, 0, 0]; this.clues = [null, null, null]; return; }
    this.costs = tableCosts(p.enchantSeed, this.shelves, s.item);
    this.clues = this.costs.map((c, i) => {
      if (!c) return null;
      const list = selectEnchantments(p.enchantSeed + i, s.item, c);
      return list.length ? list[Math.floor(((p.enchantSeed >>> 3) + i) % list.length)] : null;
    });
  }
  canEnchant(i) {
    const p = this.player, c = this.costs[i];
    const lapis = this.inv.get(1)?.count ?? 0;
    if (!c || !this.inv.get(0)) return false;
    if (p.creative) return true;
    return p.xpLevel >= c && lapis >= i + 1;
  }
  enchant(i) {
    if (!this.canEnchant(i)) return false;
    const p = this.player;
    const s = this.inv.get(0);
    const list = selectEnchantments(p.enchantSeed + i, s.item, this.costs[i]);
    if (!list.length) return false;
    let out = s.copy(1);
    if (s.item.name === 'book') { out = ItemStack.of('enchanted_book'); out.tag = { stored: list }; }
    else { out.tag = out.tag ?? {}; out.tag.enchantments = list; }
    this.inv.set(0, out);
    if (!p.creative) {
      p.giveLevels(-(i + 1));
      const l = this.inv.get(1); l.count -= i + 1; if (l.count <= 0) this.inv.set(1, null);
    }
    p.enchantSeed = (Math.random() * 2 ** 31) | 0;
    this.game.stats.enchanted = (this.game.stats.enchanted ?? 0) + 1;
    this.game.sound.play('block.enchantment_table.use', { x: this.pos[0] + 0.5, y: this.pos[1] + 0.5, z: this.pos[2] + 0.5, pitch: Math.random() * 0.1 + 0.9 });
    this.slotChanged();
    return true;
  }
  quickMove(i) {
    const sl = this.slots[i];
    const s = sl.stack;
    if (!s) return;
    if (i >= this.playerStart) {
      const c = s.copy();
      if (s.item.name === 'lapis_lazuli') this.moveItemStackTo(c, 1, 2);
      else if (!this.inv.get(0)) { this.inv.set(0, c.copy(1)); c.count--; }
      sl.stack = c.count > 0 ? c : null;
      this.slotChanged();
      return;
    }
    super.quickMove(i);
    this.slotChanged();
  }
  removed() {
    super.removed();
    for (let k = 0; k < 2; k++) { const s = this.inv.get(k); if (s) { if (this.player.inventory.add(s) > 0) this.game.dropFromPlayer(s); this.inv.set(k, null); } }
  }
}

function sgaWord(seed, len) {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let out = '', x = seed >>> 0;
  for (let i = 0; i < len; i++) { x = (x * 1103515245 + 12345) >>> 0; out += letters[(x >>> 16) % 26]; if (i > 1 && ((x >>> 8) & 7) === 0 && i < len - 2) out += ' '; }
  return out;
}

export class EnchantmentScreen extends ContainerScreen {
  constructor(game, pos) { super(game, new EnchantmentMenu(game, pos), 'Enchant'); this.bookFlip = 0; }
  renderExtra(gui, mx, my) {
    const L = this.left, T = this.top, menu = this.menu, p = this.game.player;
    gui.sprite('enchanting_book_background', L + 7, T + 17);
    // spinning pages: simple animated book glyph
    const t = performance.now() / 400;
    gui.fill(L + 20, T + 25, 12, 16, '#5b3b1d'); gui.fill(L + 33, T + 25, 12, 16, '#5b3b1d');
    gui.fill(L + 21, T + 26, 11, 14, '#e8e0c8'); gui.fill(L + 33, T + 26, 11, 14, '#e8e0c8');
    const flip = Math.abs(Math.sin(t)) * 10;
    gui.fill(L + 33 - flip, T + 26, 1 + flip * 0.2, 14, '#fffaf0');
    for (let i = 0; i < 3; i++) {
      const bx = L + 60, by = T + 14 + 19 * i;
      const cost = menu.costs[i];
      const can = menu.canEnchant(i);
      const hover = mx >= bx && mx < bx + 108 && my >= by && my < by + 19;
      if (!cost) { gui.sprite('enchanting_button_disabled', bx, by); continue; }
      gui.sprite(!can ? 'enchanting_button_disabled' : hover ? 'enchanting_button_highlighted' : 'enchanting_button', bx, by);
      gui.sprite(`enchanting_level_${i + 1}${can ? '' : '_disabled'}`, bx + 1, by + 1);
      // galactic runes
      const word = sgaWord(p.enchantSeed + i * 7919, 10);
      this.drawRunes(gui, word, bx + 20, by + 2, can ? (hover ? '#ffff80' : '#685e4a') : '#342f25', 86);
      const cs = String(cost);
      gui.text(cs, bx + 106 - gui.textWidth(cs), by + 10, can ? '#80ff20' : '#407f10', true);
      if (hover) {
        const clue = menu.clues[i];
        const lines = [];
        if (clue) lines.push({ text: `${enchantName(clue.id)} ${roman(clue.lvl)} . . . ?`, color: '#ffffff' });
        if (!p.creative) {
          lines.push({ text: '' });
          if (p.xpLevel < cost) lines.push({ text: `Level Requirement: ${cost}`, color: '#ff5555' });
          else {
            lines.push({ text: `${i + 1} Lapis Lazuli`, color: (menu.inv.get(1)?.count ?? 0) >= i + 1 ? '#aaaaaa' : '#ff5555' });
            lines.push({ text: `${i + 1} Enchantment Level${i ? 's' : ''}`, color: '#aaaaaa' });
          }
        }
        this.pendingTooltip = { lines, mx, my };
      }
    }
  }
  drawRunes(gui, word, x, y, color, maxW) {
    let cx = x;
    const c = gui.ctx;
    c.fillStyle = color;
    for (const ch of word) {
      const g = FONT_MODULE.SGA_GLYPHS?.[ch] ?? FONT_MODULE.FONT.glyphs[ch];
      if (!g) { cx += 3; continue; }
      if (cx + g.width > x + maxW) break;
      g.rows.forEach((row, yy) => { for (let xx = 0; xx < g.width; xx++) if (row[xx] === '#') c.fillRect(cx + xx, y + yy, 1, 1); });
      cx += g.width + 1;
      if (cx > x + maxW / 2 && y < 10000) { /* keep single line */ }
    }
  }
  render(gui, mx, my) {
    this.pendingTooltip = null;
    super.render(gui, mx, my);
    if (this.pendingTooltip && !this.menu.carried) gui.tooltip(this.pendingTooltip.lines, this.pendingTooltip.mx, this.pendingTooltip.my);
  }
  mouseDown(mx, my, b, shift) {
    for (let i = 0; i < 3; i++) {
      const bx = this.left + 60, by = this.top + 14 + 19 * i;
      if (b === 0 && mx >= bx && mx < bx + 108 && my >= by && my < by + 19) { this.menu.enchant(i); return true; }
    }
    return super.mouseDown(mx, my, b, shift);
  }
}

// ---------- anvil ----------
export class AnvilMenu extends Menu {
  constructor(game, pos) {
    super(game);
    this.pos = pos;
    this.inv = new SmallInv(3);
    this.name = null;
    this.slots.push(new Slot(this.inv, 0, 27, 47));
    this.slots.push(new Slot(this.inv, 1, 76, 47));
    this.slots.push(new Slot(this.inv, 2, 134, 47, { output: true, onTake: () => this.onTake() }));
    this.addPlayerSlots(8, 84);
    this.cost = 0;
  }
  isMaterial(stack, it) {
    const m = repairMaterial(it);
    if (!m) return false;
    if (m.startsWith('#')) return TAGS[m.slice(1)].includes(stack.item.name);
    return stack.item.name === m;
  }
  slotChanged(i) {
    if (i === 2) return;
    const left = this.inv.get(0), right = this.inv.get(1);
    const r = left ? anvilResult(left, right, this.name, (s, it) => this.isMaterial(s, it)) : null;
    this.info = r;
    this.cost = r ? r.cost : 0;
    const can = r && !r.tooExpensive && (this.player.creative || this.player.xpLevel >= r.cost);
    this.inv.slots[2] = can ? r.result : null;
  }
  onTake() {
    const r = this.info;
    if (!r) return;
    const p = this.player;
    if (!p.creative) p.giveLevels(-r.cost);
    this.inv.set(0, null);
    const right = this.inv.get(1);
    if (right) {
      if (r.materialUsed) { right.count -= r.materialUsed; if (right.count <= 0) this.inv.set(1, null); }
      else this.inv.set(1, null);
    }
    this.game.sound.play('random.anvil_use', { x: this.pos[0] + 0.5, y: this.pos[1] + 0.5, z: this.pos[2] + 0.5, pitch: Math.random() * 0.1 + 0.9 });
    this.name = null;
    this.info = null;
    this.inv.slots[2] = null;
  }
  removed() {
    super.removed();
    for (let k = 0; k < 2; k++) { const s = this.inv.get(k); if (s) { if (this.player.inventory.add(s) > 0) this.game.dropFromPlayer(s); this.inv.set(k, null); } }
  }
}

export class AnvilScreen extends ContainerScreen {
  constructor(game, pos) { super(game, new AnvilMenu(game, pos), 'Repair & Name'); }
  build(w, h) {
    super.build(w, h);
    this.nameField = this.add(new TextField(this.left + 62, this.top + 24, 103, 12, '', { maxLength: 50, onChange: (v) => { this.menu.name = v; this.menu.slotChanged(0); } }));
  }
  renderBg(gui) {
    super.renderBg(gui);
    gui.sprite('anvil_arrow', this.left + 99, this.top + 45);
    const r = this.menu.info;
    if (this.menu.inv.get(0) && !this.menu.inv.get(2) && (this.menu.inv.get(1) || r)) gui.sprite('anvil_error', this.left + 99, this.top + 45);
  }
  renderLabels(gui) {
    gui.text('Repair & Name', this.left + 60, this.top + 6, '#404040', false);
    gui.text('Inventory', this.left + 8, this.top + 73, '#404040', false);
    const r = this.menu.info;
    if (r && r.cost > 0) {
      const p = this.game.player;
      const tooExp = r.tooExpensive && !p.creative;
      const txt = tooExp ? 'Too Expensive!' : `Enchantment Cost: ${r.cost}`;
      const ok = !tooExp && (p.creative || p.xpLevel >= r.cost);
      const x = this.left + 168 - gui.textWidth(txt) - 2;
      gui.fill(x - 2, this.top + 67, gui.textWidth(txt) + 4, 12, 'rgba(79,79,79,1)');
      gui.text(txt, x, this.top + 69, ok ? '#80ff20' : '#ff6060', true);
    }
  }
  render(gui, mx, my) {
    super.render(gui, mx, my);
    const left = this.menu.inv.get(0);
    if (left && !this.nameField.focused && this.nameField.value === '') { this.nameField.value = left.tag?.name ?? left.item.display; this.nameField.cursor = this.nameField.value.length; }
    if (!left && this.nameField.value) this.nameField.value = '';
    this.nameField.render(gui, mx, my);
  }
  mouseDown(mx, my, b, shift) {
    if (this.nameField.mouseDown(mx, my, b)) return true;
    return super.mouseDown(mx, my, b, shift);
  }
  keyDown(e) {
    if (this.nameField.focused) {
      if (e.code === 'Escape') { this.onClose(); return true; }
      if (this.nameField.keyDown(e)) return true;
    }
    return super.keyDown(e);
  }
}
