// Keyboard, touch joystick and mouse click-and-hold movement.

const MOVE = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const ACTIONS = {
  KeyE: 'use',
  Space: 'use',
  Enter: 'use',
  KeyR: 'report',
  KeyQ: 'kill',
  KeyV: 'vent',
  KeyF: 'sabotage',
  Tab: 'map',
  KeyM: 'map',
  Escape: 'close',
};

export class Input {
  constructor(surface, joyEl) {
    this.keys = new Set();
    this.queue = [];
    this.pointer = null; // { id, type, ox, oy, x, y }
    this.surface = surface;
    this.joyEl = joyEl;
    this.enabled = true;

    window.addEventListener('keydown', (e) => {
      if (isTyping(e)) return;
      if (MOVE[e.code]) {
        this.keys.add(e.code);
        e.preventDefault();
      } else if (ACTIONS[e.code] && !e.repeat) {
        this.queue.push(ACTIONS[e.code]);
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.release();
    });

    surface.addEventListener('pointerdown', (e) => {
      if (this.pointer || e.button > 0) return;
      surface.setPointerCapture(e.pointerId);
      this.pointer = { id: e.pointerId, type: e.pointerType, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      if (e.pointerType !== 'mouse') this.showJoy();
      e.preventDefault();
    });
    surface.addEventListener('pointermove', (e) => {
      if (!this.pointer || e.pointerId !== this.pointer.id) return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      if (this.pointer.type !== 'mouse') this.showJoy();
    });
    const end = (e) => {
      if (this.pointer && e.pointerId === this.pointer.id) this.release();
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  release() {
    this.pointer = null;
    if (this.joyEl) this.joyEl.hidden = true;
  }

  showJoy() {
    const p = this.pointer;
    const el = this.joyEl;
    if (!el) return;
    el.hidden = false;
    el.style.left = `${p.ox}px`;
    el.style.top = `${p.oy}px`;
    const [x, y] = this.joyVector(p);
    const knob = el.firstElementChild;
    knob.style.transform = `translate(${x * 34}px, ${y * 34}px)`;
  }

  joyVector(p) {
    const dx = p.x - p.ox;
    const dy = p.y - p.oy;
    const d = Math.hypot(dx, dy);
    if (d < 6) return [0, 0];
    const m = Math.min(1, d / 40);
    return [(dx / d) * m, (dy / d) * m];
  }

  /** Movement vector, length <= 1. */
  vector() {
    if (!this.enabled) return [0, 0];
    let x = 0;
    let y = 0;
    for (const k of this.keys) {
      x += MOVE[k][0];
      y += MOVE[k][1];
    }
    if (x || y) {
      const d = Math.hypot(x, y);
      return [x / d, y / d];
    }
    const p = this.pointer;
    if (!p) return [0, 0];
    if (p.type === 'mouse') {
      // Walk toward the cursor, measured from the middle of the screen (where you are).
      const r = this.surface.getBoundingClientRect();
      const dx = p.x - (r.left + r.width / 2);
      const dy = p.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      return d < 24 ? [0, 0] : [dx / d, dy / d];
    }
    return this.joyVector(p);
  }

  drain() {
    const q = this.queue;
    this.queue = [];
    return this.enabled ? q : q.filter((a) => a === 'close' || a === 'map');
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
