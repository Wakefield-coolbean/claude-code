// Swipe Card: pull the card out of the wallet, then swipe it through the reader at the right speed.
import { makeCanvas, panel, box, screen, text, led, PALETTE, clamp, inRect } from '../kit.js';

const START_X = 30;
const END_X = 320;
const TRACK_Y = 170;
const CARD_W = 150;
const CARD_H = 95;

export default {
  id: 'swipe',
  title: 'Swipe Card',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    let state = 'wallet'; // wallet | rising | ready | dragging | done
    let msg = 'PLEASE INSERT CARD';
    let light = null; // null | 'good' | 'bad'
    let card = { x: 175, y: 330 };
    let time = 0;
    let grabDX = 0;
    let moveT = null;
    let reachT = null;
    let doneAt = 0;

    const cardRect = () => ({ x: card.x, y: card.y, w: CARD_W, h: CARD_H });

    v.onDown((x, y) => {
      if (state === 'wallet' && (inRect(x, y, cardRect()) || inRect(x, y, { x: 110, y: 350, w: 280, h: 140 }))) {
        state = 'rising';
        msg = 'PLEASE SWIPE CARD';
        api.sfx('click');
      } else if (state === 'ready' && inRect(x, y, { x: card.x - 10, y: card.y - 20, w: CARD_W + 20, h: CARD_H + 40 })) {
        state = 'dragging';
        grabDX = x - card.x;
        moveT = null;
        reachT = null;
        light = null;
      }
    });
    v.onMove((x) => {
      if (state !== 'dragging') return;
      card.x = clamp(x - grabDX, START_X, END_X);
      if (moveT === null && card.x > START_X + 6) moveT = time;
      if (reachT === null && card.x >= END_X - 2) reachT = time;
    });
    v.onUp(() => {
      if (state !== 'dragging') return;
      state = 'ready';
      if (moveT === null) return;
      const took = reachT === null ? null : reachT - moveT;
      if (took === null) msg = 'BAD READ. TRY AGAIN.';
      else if (took < 0.6) msg = 'TOO FAST. TRY AGAIN.';
      else if (took > 1.2) msg = 'TOO SLOW. TRY AGAIN.';
      else {
        msg = 'ACCEPTED. THANK YOU.';
        light = 'good';
        state = 'done';
        doneAt = time + 0.45;
        api.sfx('good');
        return;
      }
      light = 'bad';
      api.sfx('bad');
    });

    function drawCard() {
      const { x, y } = card;
      box(ctx, x, y, CARD_W, CARD_H, 10, '#e9eef2');
      ctx.fillStyle = '#2f6fe0';
      ctx.fillRect(x + 3, y + 14, CARD_W - 6, 16);
      box(ctx, x + 12, y + 40, 40, 44, 6, '#9fb0bf', PALETTE.ink, 3);
      ctx.fillStyle = '#c51111';
      ctx.beginPath();
      ctx.ellipse(x + 32, y + 66, 12, 15, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5b6672';
      [46, 58, 70].forEach((ly, i) => ctx.fillRect(x + 62, y + ly, 70 - i * 14, 6));
    }

    api.loop((dt) => {
      time += dt;
      if (state === 'rising') {
        card.x += (START_X - card.x) * Math.min(1, dt * 9);
        card.y += (TRACK_Y - card.y) * Math.min(1, dt * 9);
        if (Math.abs(card.y - TRACK_Y) < 1 && Math.abs(card.x - START_X) < 1) {
          card = { x: START_X, y: TRACK_Y };
          state = 'ready';
        }
      } else if (state === 'ready') {
        card.x += (START_X - card.x) * Math.min(1, dt * 8);
      } else if (state === 'done' && time >= doneAt) {
        state = 'finished';
        api.complete();
      }

      panel(ctx, w, h, '#7d8894');
      // reader body
      box(ctx, 14, 24, 472, 270, 18, '#5b6672');
      screen(ctx, 34, 42, 360, 54, 8);
      text(ctx, msg, 214, 70, { size: 22, color: light === 'bad' ? '#ff6b5b' : '#7dff8a', stroke: null, weight: 700 });
      led(ctx, 420, 69, 14, light === 'bad', PALETTE.red, '#4a1d1d');
      led(ctx, 456, 69, 14, light === 'good', PALETTE.green, '#1d3a22');
      // slot back
      box(ctx, 14, TRACK_Y + 44, 472, 26, 4, '#1b2229');
      if (state !== 'wallet') drawCard();
      // slot front lip
      box(ctx, 14, TRACK_Y + 70, 472, 64, 10, '#8a96a3');
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(20, TRACK_Y + 74, 460, 8);
      if (state === 'ready' || state === 'dragging') text(ctx, '→', 440, TRACK_Y + 104, { size: 34 });

      // wallet
      if (state === 'wallet') drawCard();
      box(ctx, 110, 380, 280, 110, 22, '#8a4f22');
      box(ctx, 124, 394, 252, 82, 16, '#a2622e', PALETTE.ink, 3);
      if (state === 'wallet') text(ctx, 'TAP CARD', 250, 438, { size: 24 });
    });

    return () => v.destroy();
  },
};
