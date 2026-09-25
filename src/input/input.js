// Keyboard / mouse input with pointer lock (and a drag-to-look fallback when pointer lock is unavailable).
export const DEFAULT_KEYS = {
  forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sneak: 'ShiftLeft', sprint: 'ControlLeft',
  inventory: 'KeyE', drop: 'KeyQ', swapHands: 'KeyF', chat: 'KeyT', command: 'Slash', playerList: 'Tab',
  perspective: 'F5', debug: 'F3', hideGui: 'F1', screenshot: 'F2', fullscreen: 'F11', smoothCamera: 'F8',
  hotbar1: 'Digit1', hotbar2: 'Digit2', hotbar3: 'Digit3', hotbar4: 'Digit4', hotbar5: 'Digit5',
  hotbar6: 'Digit6', hotbar7: 'Digit7', hotbar8: 'Digit8', hotbar9: 'Digit9',
};

export class Input {
  constructor(target) {
    this.target = target;
    this.keys = new Set();
    this.mouse = [false, false, false];
    this.mouseDX = 0; this.mouseDY = 0;
    this.wheel = 0;
    this.mx = 0; this.my = 0;
    this.events = [];           // queued UI events
    this.bindings = { ...DEFAULT_KEYS };
    this.pointerLocked = false;
    this.pointerLockSupported = 'pointerLockElement' in document && !!target.requestPointerLock;
    this.pointerLockFailed = false;
    this.dragLook = false;
    this.wantsCapture = false;  // game wants mouse captured (no GUI open)
    this.lastKeyTime = {};
    this.pressedThisFrame = new Set();
    this.mousePressedThisFrame = [false, false, false];
    this.onCaptureChange = null;

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => { this.keys.clear(); this.mouse = [false, false, false]; });
    target.addEventListener('mousedown', (e) => this.onMouseDown(e));
    window.addEventListener('mouseup', (e) => this.onMouseUp(e));
    window.addEventListener('mousemove', (e) => this.onMouseMove(e));
    target.addEventListener('wheel', (e) => { e.preventDefault(); this.onWheel(e); }, { passive: false });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === target;
      if (!this.pointerLocked && this.wantsCapture) this.onCaptureChange?.(false);
    });
    document.addEventListener('pointerlockerror', () => { this.pointerLockFailed = true; });
    // touch: basic support maps to drag-look
    target.addEventListener('touchstart', (e) => { const t = e.touches[0]; this.mx = t.clientX; this.my = t.clientY; }, { passive: true });
  }

  isDown(action) { const code = this.bindings[action]; return code ? this.keys.has(code) : false; }
  pressed(action) { const code = this.bindings[action]; return code ? this.pressedThisFrame.has(code) : false; }
  keyPressed(code) { return this.pressedThisFrame.has(code); }

  onKey(e, down) {
    // keep browser shortcuts we don't need from interfering
    const block = ['Space', 'Tab', 'F1', 'F3', 'F5', 'F2', 'F8', 'Slash', 'Quote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (block.includes(e.code) || (e.ctrlKey && ['KeyW', 'KeyS', 'KeyD', 'KeyF', 'KeyQ', 'KeyA'].includes(e.code))) e.preventDefault();
    if (down) {
      if (!this.keys.has(e.code)) {
        this.pressedThisFrame.add(e.code);
        this.lastKeyTime[e.code] = performance.now();
      }
      this.keys.add(e.code);
      this.events.push({ type: 'keydown', code: e.code, key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey, repeat: e.repeat });
    } else {
      this.keys.delete(e.code);
      this.events.push({ type: 'keyup', code: e.code, key: e.key });
    }
  }

  onMouseDown(e) {
    this.mouse[e.button] = true;
    this.mousePressedThisFrame[e.button] = true;
    this.updateMousePos(e);
    this.events.push({ type: 'mousedown', button: e.button, x: this.mx, y: this.my, shift: e.shiftKey, ctrl: e.ctrlKey });
    if (this.wantsCapture && !this.pointerLocked) {
      this.capture();
      if (this.pointerLockFailed || !this.pointerLockSupported) this.dragLook = true;
    }
  }
  onMouseUp(e) {
    this.mouse[e.button] = false;
    this.updateMousePos(e);
    this.events.push({ type: 'mouseup', button: e.button, x: this.mx, y: this.my, shift: e.shiftKey });
  }
  onMouseMove(e) {
    if (this.pointerLocked) {
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    } else if (this.wantsCapture && (this.pointerLockFailed || !this.pointerLockSupported) && (this.mouse[0] || this.mouse[2] || this.dragLook)) {
      // fallback: move the mouse to look around
      this.mouseDX += e.movementX; this.mouseDY += e.movementY;
    }
    this.updateMousePos(e);
    this.events.push({ type: 'mousemove', x: this.mx, y: this.my });
  }
  onWheel(e) {
    const d = Math.sign(e.deltaY);
    this.wheel += d;
    this.events.push({ type: 'wheel', delta: d, x: this.mx, y: this.my });
  }
  updateMousePos(e) {
    const r = this.target.getBoundingClientRect();
    this.mx = (e.clientX - r.left) * (this.target.width / r.width);
    this.my = (e.clientY - r.top) * (this.target.height / r.height);
  }

  capture() {
    this.wantsCapture = true;
    if (this.pointerLockSupported && !this.pointerLockFailed && !this.pointerLocked) {
      try {
        const p = this.target.requestPointerLock({ unadjustedMovement: false });
        if (p && p.catch) p.catch(() => { this.pointerLockFailed = true; });
      } catch (err) { this.pointerLockFailed = true; }
    }
  }
  release() {
    this.wantsCapture = false;
    this.dragLook = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  get captured() { return this.pointerLocked || (this.wantsCapture && (this.pointerLockFailed || !this.pointerLockSupported)); }

  consumeMouseDelta() { const d = [this.mouseDX, this.mouseDY]; this.mouseDX = 0; this.mouseDY = 0; return d; }
  consumeWheel() { const w = this.wheel; this.wheel = 0; return w; }
  consumeEvents() { const e = this.events; this.events = []; return e; }
  endFrame() { this.pressedThisFrame.clear(); this.mousePressedThisFrame = [false, false, false]; }
}
