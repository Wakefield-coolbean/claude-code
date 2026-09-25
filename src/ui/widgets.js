// Vanilla-style widgets: buttons, sliders, text fields, cycle buttons, scrolling lists.
export class Widget {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; this.visible = true; this.active = true; this.focused = false; this.tooltip = null; }
  hit(mx, my) { return this.visible && mx >= this.x && my >= this.y && mx < this.x + this.w && my < this.y + this.h; }
  render() {}
  mouseDown() { return false; }
  mouseUp() {}
  mouseDrag() {}
  keyDown() { return false; }
  wheel() { return false; }
}

export class Button extends Widget {
  constructor(x, y, w, h, label, onPress, opts = {}) {
    super(x, y, w, h);
    this.label = label; this.onPress = onPress;
    Object.assign(this, opts);
  }
  get text() { return typeof this.label === 'function' ? this.label() : this.label; }
  render(gui, mx, my) {
    if (!this.visible) return;
    const hover = this.active && this.hit(mx, my);
    this.hovered = hover;
    gui.nineSlice(!this.active ? 'button_disabled' : hover || this.focused ? 'button_highlighted' : 'button', this.x, this.y, this.w, this.h, 3);
    const col = !this.active ? '#a0a0a0' : hover ? '#ffffa0' : '#ffffff';
    let t = this.text;
    while (gui.textWidth(t) > this.w - 6 && t.length > 1) t = t.slice(0, -1);
    gui.textCentered(t, this.x + this.w / 2, this.y + (this.h - 8) / 2, col, true);
  }
  mouseDown(mx, my, b, game) {
    if (b !== 0 || !this.active || !this.hit(mx, my)) return false;
    game?.sound?.play('random.click', { volume: 0.25 });
    this.onPress?.(this);
    return true;
  }
}

// Button that cycles through values and displays "Label: Value"
export class CycleButton extends Button {
  constructor(x, y, w, h, name, values, get, set, fmt = (v) => String(v)) {
    super(x, y, w, h, () => (name ? `${name}: ${fmt(get())}` : fmt(get())), () => {
      const i = values.indexOf(get());
      set(values[(i + 1) % values.length]);
    });
  }
}

export class Slider extends Widget {
  constructor(x, y, w, h, label, get, set, { min = 0, max = 1, step = 0 } = {}) {
    super(x, y, w, h);
    this.labelFn = label; this.get = get; this.set = set; this.min = min; this.max = max; this.step = step;
    this.dragging = false;
  }
  norm() { return (this.get() - this.min) / (this.max - this.min); }
  setFromMouse(mx) {
    let f = (mx - (this.x + 4)) / (this.w - 8);
    f = Math.max(0, Math.min(1, f));
    let v = this.min + f * (this.max - this.min);
    if (this.step) v = Math.round(v / this.step) * this.step;
    this.set(Math.max(this.min, Math.min(this.max, v)));
  }
  render(gui, mx, my) {
    if (!this.visible) return;
    const hover = this.hit(mx, my);
    gui.nineSlice('slider', this.x, this.y, this.w, this.h, 3);
    const hx = this.x + Math.round(this.norm() * (this.w - 8));
    gui.nineSlice(hover || this.dragging ? 'slider_handle_highlighted' : 'slider_handle', hx, this.y, 8, this.h, 2);
    gui.textCentered(this.labelFn(this.get()), this.x + this.w / 2, this.y + (this.h - 8) / 2, hover ? '#ffffa0' : '#ffffff', true);
  }
  mouseDown(mx, my, b, game) {
    if (b !== 0 || !this.hit(mx, my)) return false;
    this.dragging = true;
    this.setFromMouse(mx);
    game?.sound?.play('random.click', { volume: 0.25 });
    return true;
  }
  mouseDrag(mx) { if (this.dragging) this.setFromMouse(mx); }
  mouseUp() { this.dragging = false; }
}

export class TextField extends Widget {
  constructor(x, y, w, h, value = '', { maxLength = 32, placeholder = '', onChange = null, filter = null } = {}) {
    super(x, y, w, h);
    this.value = value; this.cursor = value.length; this.maxLength = maxLength; this.placeholder = placeholder;
    this.onChange = onChange; this.filter = filter;
    this.blink = 0;
    this.scroll = 0;
  }
  render(gui, mx, my) {
    if (!this.visible) return;
    gui.fill(this.x - 1, this.y - 1, this.w + 2, this.h + 2, this.focused ? '#ffffff' : '#a0a0a0');
    gui.fill(this.x, this.y, this.w, this.h, '#000000');
    const ty = this.y + (this.h - 8) / 2;
    let text = this.value;
    // keep cursor visible
    while (gui.textWidth(text.slice(this.scroll, this.cursor)) > this.w - 8 && this.scroll < this.cursor) this.scroll++;
    if (this.cursor < this.scroll) this.scroll = this.cursor;
    let shown = text.slice(this.scroll);
    while (gui.textWidth(shown) > this.w - 8 && shown.length) shown = shown.slice(0, -1);
    if (!text && this.placeholder && !this.focused) gui.text(this.placeholder, this.x + 4, ty, '#707070', true);
    gui.text(shown, this.x + 4, ty, '#e0e0e0', true);
    this.blink++;
    if (this.focused && Math.floor(this.blink / 20) % 2 === 0) {
      const cx = this.x + 4 + gui.textWidth(text.slice(this.scroll, this.cursor));
      if (this.cursor < text.length) gui.fill(cx, ty - 1, 1, 10, '#d0d0d0');
      else gui.text('_', cx + 1, ty, '#d0d0d0', true);
    }
    void mx; void my;
  }
  mouseDown(mx, my, b) {
    const was = this.focused;
    this.focused = this.hit(mx, my);
    if (this.focused && !was) this.cursor = this.value.length;
    return this.focused;
  }
  keyDown(e) {
    if (!this.focused) return false;
    const v = this.value;
    if (e.code === 'Backspace') { if (this.cursor > 0) { this.value = v.slice(0, this.cursor - 1) + v.slice(this.cursor); this.cursor--; this.changed(); } return true; }
    if (e.code === 'Delete') { if (this.cursor < v.length) { this.value = v.slice(0, this.cursor) + v.slice(this.cursor + 1); this.changed(); } return true; }
    if (e.code === 'ArrowLeft') { this.cursor = Math.max(0, this.cursor - 1); return true; }
    if (e.code === 'ArrowRight') { this.cursor = Math.min(v.length, this.cursor + 1); return true; }
    if (e.code === 'Home') { this.cursor = 0; return true; }
    if (e.code === 'End') { this.cursor = v.length; return true; }
    if (e.ctrl && e.code === 'KeyV') {
      navigator.clipboard?.readText?.().then((t) => this.insert(t)).catch(() => {});
      return true;
    }
    if (e.ctrl && e.code === 'KeyA') { this.cursor = v.length; return true; }
    if (e.key && e.key.length === 1 && !e.ctrl) { this.insert(e.key); return true; }
    return false;
  }
  insert(t) {
    t = t.replace(/[\n\r§]/g, '');
    if (this.filter) t = [...t].filter(this.filter).join('');
    const v = this.value;
    const room = this.maxLength - v.length;
    if (room <= 0) return;
    t = t.slice(0, room);
    this.value = v.slice(0, this.cursor) + t + v.slice(this.cursor);
    this.cursor += t.length;
    this.changed();
  }
  changed() { this.blink = 0; this.onChange?.(this.value); }
}

// Scrolling list of entries (world list, key bindings)
export class ScrollList extends Widget {
  constructor(x, y, w, h, itemHeight) {
    super(x, y, w, h);
    this.itemHeight = itemHeight;
    this.entries = [];
    this.scroll = 0;
    this.selected = -1;
    this.onSelect = null; this.onDouble = null;
    this.lastClick = 0;
    this.rowWidth = 220;
  }
  maxScroll() { return Math.max(0, this.entries.length * this.itemHeight + 4 - this.h); }
  render(gui, mx, my) {
    gui.fill(this.x, this.y, this.w, this.h, 'rgba(0,0,0,0.5)');
    const c = gui.ctx;
    c.save();
    c.beginPath(); c.rect(this.x, this.y, this.w, this.h); c.clip();
    const rx = this.x + (this.w - this.rowWidth) / 2;
    this.entries.forEach((e, i) => {
      const y = this.y + 4 + i * this.itemHeight - this.scroll;
      if (y + this.itemHeight < this.y || y > this.y + this.h) return;
      if (i === this.selected) {
        gui.fill(rx - 2, y - 2, this.rowWidth + 4, this.itemHeight, '#808080');
        gui.fill(rx - 1, y - 1, this.rowWidth + 2, this.itemHeight - 2, '#000000');
      }
      e.render(gui, rx, y, this.rowWidth, this.itemHeight - 4, mx, my, i === this.selected);
    });
    c.restore();
    // edge shadows like vanilla
    gui.gradient(this.x, this.y, this.w, 4, 'rgba(0,0,0,1)', 'rgba(0,0,0,0)');
    gui.gradient(this.x, this.y + this.h - 4, this.w, 4, 'rgba(0,0,0,0)', 'rgba(0,0,0,1)');
    // scrollbar
    const ms = this.maxScroll();
    if (ms > 0) {
      const sx = this.x + this.w - 6;
      const bh = Math.max(32, this.h * this.h / (this.entries.length * this.itemHeight + 4));
      const by = this.y + (this.h - bh) * (this.scroll / ms);
      gui.fill(sx, this.y, 6, this.h, '#000000');
      gui.fill(sx, by, 6, bh, '#808080');
      gui.fill(sx, by, 5, bh - 1, '#c0c0c0');
    }
  }
  mouseDown(mx, my, b) {
    if (!this.hit(mx, my) || b !== 0) return false;
    const i = Math.floor((my - this.y - 4 + this.scroll) / this.itemHeight);
    if (i >= 0 && i < this.entries.length) {
      const now = performance.now();
      const dbl = i === this.selected && now - this.lastClick < 300;
      this.selected = i; this.lastClick = now;
      const e = this.entries[i];
      if (e.mouseDown?.(mx, my)) return true;
      this.onSelect?.(i);
      if (dbl) this.onDouble?.(i);
    }
    return true;
  }
  wheel(d, mx, my) {
    if (!this.hit(mx, my)) return false;
    this.scroll = Math.max(0, Math.min(this.maxScroll(), this.scroll + d * this.itemHeight / 2));
    return true;
  }
}
