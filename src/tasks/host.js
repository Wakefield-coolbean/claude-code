// Opens a minigame in the modal panel and gives it the MinigameApi.
//
// MinigameApi (what each minigame's mount(root, api) receives):
//   api.data        step data from the task definition (e.g. { mode: 'fill' }); for
//                   sabotage panels it may also hold live game objects
//   api.complete()  call once when solved; shows "Task Completed!" and closes
//   api.close()     close without completing
//   api.sfx(name)   click | good | bad | beep | drag | done | whoosh | door
//   api.rng()       random number in [0, 1)
//   api.loop(fn)    fn(dt, time) every frame while open
//   api.state()     live state for sabotage panels (see sabotage minigames)
//   api.act(a)      send an action to the game (sabotage panels)
// mount() returns an optional cleanup function.

import { sfx } from '../audio.js';
import { MINIGAMES } from './minigames/index.js';

export class MinigameHost {
  constructor(root) {
    this.root = root;
    this.current = null;
    root.innerHTML = `
      <div class="mg-frame" role="dialog" aria-modal="true">
        <button class="mg-close" type="button" aria-label="Close task">✕</button>
        <div class="mg-title"></div>
        <div class="mg-root"></div>
        <div class="mg-done" hidden>Task Completed!</div>
      </div>`;
    this.titleEl = root.querySelector('.mg-title');
    this.mountEl = root.querySelector('.mg-root');
    this.doneEl = root.querySelector('.mg-done');
    root.querySelector('.mg-close').addEventListener('click', () => this.close());
    root.addEventListener('pointerdown', (e) => {
      if (e.target === root) this.close();
    });
    root.hidden = true;
  }

  get isOpen() {
    return !!this.current;
  }

  /**
   * @param {string} id minigame id
   * @param {object} opts { data, title, doneText, state, act, onComplete, onClose, rng }
   */
  open(id, opts = {}) {
    this.close();
    const mg = MINIGAMES[id];
    if (!mg) {
      console.warn('Unknown minigame', id);
      return false;
    }
    const loops = [];
    let finished = false;
    const cur = { id, opts, loops, cleanup: null, closing: false };
    const api = {
      data: opts.data || {},
      rng: opts.rng || Math.random,
      sfx: (n) => sfx(n),
      loop: (fn) => loops.push(fn),
      state: opts.state || (() => ({})),
      act: opts.act || (() => {}),
      complete: () => {
        if (finished || this.current !== cur) return;
        finished = true;
        sfx('done');
        this.doneEl.textContent = opts.doneText || 'Task Completed!';
        this.doneEl.hidden = false;
        cur.closing = true;
        setTimeout(() => {
          if (this.current !== cur) return;
          this._teardown();
          opts.onComplete?.();
        }, 750);
      },
      close: () => {
        if (this.current === cur) this.close();
      },
    };
    this.current = cur;
    this.titleEl.textContent = opts.title || mg.title || '';
    this.doneEl.hidden = true;
    this.mountEl.innerHTML = '';
    this.mountEl.dataset.game = id;
    this.root.hidden = false;
    cur.cleanup = mg.mount(this.mountEl, api) || null;
    return true;
  }

  /** Close without completing. */
  close() {
    if (!this.current) return;
    const cur = this.current;
    this._teardown();
    cur.opts.onClose?.();
  }

  _teardown() {
    const cur = this.current;
    if (!cur) return;
    try {
      cur.cleanup?.();
    } catch (e) {
      console.error(e);
    }
    this.mountEl.querySelectorAll('canvas').forEach((c) => c.remove());
    this.mountEl.innerHTML = '';
    this.current = null;
    this.root.hidden = true;
  }

  tick(dt, t) {
    if (!this.current) return;
    for (const fn of this.current.loops) {
      try {
        fn(dt, t);
      } catch (e) {
        console.error(e);
      }
    }
  }
}
