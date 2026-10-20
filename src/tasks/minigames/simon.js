// Start Reactor: watch the sequence on the left screen, repeat it on the right keypad. 5 rounds.
import { makeCanvas, panel, box, screen, led, PALETTE, inRect } from '../kit.js';

const ROUNDS = 5;
const CELL = 64;
const GAP = 8;
const LEFT = { x: 22, y: 150 };
const RIGHT = { x: 266, y: 150 };
const cellRect = (o, i) => ({ x: o.x + 8 + (i % 3) * (CELL + GAP), y: o.y + 8 + Math.floor(i / 3) * (CELL + GAP), w: CELL, h: CELL });

export default {
  id: 'simon',
  title: 'Start Reactor',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const newSeq = () => Array.from({ length: ROUNDS }, () => Math.floor(api.rng() * 9));
    let seq = newSeq();
    let round = 1;
    let phase = 'show'; // show | input | fail | done
    let timer = -0.8; // negative = pause before showing
    let input = 0;
    let shown = -1; // index into seq lit on the left screen
    let pressed = { i: -1, t: 0 };
    let lastBeep = -1;

    v.onDown((x, y) => {
      if (phase !== 'input') return;
      for (let i = 0; i < 9; i++) {
        if (!inRect(x, y, cellRect(RIGHT, i))) continue;
        pressed = { i, t: 0.25 };
        if (i !== seq[input]) {
          api.sfx('bad');
          phase = 'fail';
          timer = 0;
          return;
        }
        api.sfx('beep');
        input++;
        if (input >= round) {
          if (round >= ROUNDS) {
            phase = 'done';
            api.complete();
          } else {
            round++;
            api.sfx('good');
            phase = 'show';
            timer = -0.8;
            lastBeep = -1;
          }
        }
      }
    });

    function grid(o, lit, color) {
      screen(ctx, o.x, o.y, 3 * CELL + 2 * GAP + 16, 3 * CELL + 2 * GAP + 16, 10);
      for (let i = 0; i < 9; i++) {
        const r = cellRect(o, i);
        box(ctx, r.x, r.y, r.w, r.h, 8, lit(i) ? color : '#26404c', PALETTE.ink, 3);
      }
    }

    api.loop((dt) => {
      pressed.t = Math.max(0, pressed.t - dt);
      if (phase === 'show') {
        timer += dt;
        const step = 0.6;
        const k = Math.floor(timer / step);
        shown = timer >= 0 && timer % step < 0.42 && k < round ? seq[k] : -1;
        if (timer >= 0 && k >= round) {
          phase = 'input';
          input = 0;
          shown = -1;
        } else if (shown >= 0 && k !== lastBeep) {
          lastBeep = k;
          api.sfx('beep');
        }
      } else if (phase === 'fail') {
        timer += dt;
        if (timer > 0.9) {
          seq = newSeq();
          round = 1;
          phase = 'show';
          timer = -0.6;
          lastBeep = -1;
        }
      }

      panel(ctx, w, h, '#7d8894');
      const fail = phase === 'fail' && timer % 0.3 < 0.18;
      for (let i = 0; i < ROUNDS; i++) {
        const done = i < round - 1 || phase === 'done';
        led(ctx, LEFT.x + 30 + i * 36, 110, 11, done || fail, fail ? PALETTE.red : PALETTE.green);
        led(ctx, RIGHT.x + 30 + i * 36, 110, 11, (phase === 'input' && i < input) || done || fail, fail ? PALETTE.red : PALETTE.green);
      }
      grid(LEFT, (i) => fail || i === shown, fail ? PALETTE.red : '#4fa8ff');
      grid(RIGHT, (i) => fail || (pressed.t > 0 && pressed.i === i), fail ? PALETTE.red : '#4fa8ff');
      if (phase !== 'input' && !fail) {
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(RIGHT.x + 4, RIGHT.y + 4, 3 * CELL + 2 * GAP + 8, 3 * CELL + 2 * GAP + 8);
      }
    });

    return () => v.destroy();
  },
};
