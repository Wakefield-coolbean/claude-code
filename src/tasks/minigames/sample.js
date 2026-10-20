// Inspect Sample: 'start' begins the analysis; 'pick' asks for the anomalous (red) sample.
import { makeCanvas, panel, box, screen, text, PALETTE, inRect } from '../kit.js';
import { TIMING } from '../../config.js';

const TUBES = 5;
const tubeX = (i) => 70 + i * 90;

export default {
  id: 'sample',
  title: 'Inspect Sample',
  mount(root, api) {
    const v = makeCanvas(root, 500, 500);
    const { ctx, w, h } = v;
    const pick = api.data.phase === 'pick';
    let started = false;
    let doneAt = 0;
    let time = 0;
    let bad = 0;
    let anomaly = Math.floor(api.rng() * TUBES);
    let finished = false;
    const startBtn = { x: 150, y: 380, w: 200, h: 80 };
    const tubeBtn = (i) => ({ x: tubeX(i) - 32, y: 400, w: 64, h: 56 });

    v.onDown((x, y) => {
      if (finished) return;
      if (!pick) {
        if (!started && inRect(x, y, startBtn)) {
          started = true;
          doneAt = time + 1.2;
          api.sfx('beep');
        }
        return;
      }
      for (let i = 0; i < TUBES; i++) {
        if (!inRect(x, y, tubeBtn(i))) continue;
        if (i === anomaly) {
          finished = true;
          api.sfx('good');
          api.complete();
        } else {
          api.sfx('bad');
          bad = 0.8;
          let next = anomaly;
          while (next === anomaly) next = Math.floor(api.rng() * TUBES);
          anomaly = next;
        }
      }
    });

    function tube(i, liquid, frac) {
      const x = tubeX(i);
      box(ctx, x - 22, 140, 44, 190, 20, 'rgba(220,240,255,0.25)', PALETTE.ink, 4);
      if (frac > 0) {
        const lh = 96 * frac;
        ctx.fillStyle = liquid;
        ctx.beginPath();
        ctx.roundRect(x - 18, 326 - lh, 36, lh, [0, 0, 18, 18]);
        ctx.fill();
      }
      box(ctx, x - 28, 128, 56, 18, 6, '#5b6672', PALETTE.ink, 3);
    }

    api.loop((dt) => {
      time += dt;
      bad = Math.max(0, bad - dt);
      if (!pick && started && !finished && time >= doneAt) {
        finished = true;
        api.complete();
      }

      panel(ctx, w, h, '#7d8894');
      screen(ctx, 30, 30, 440, 80, 10);
      let msg;
      if (pick) msg = bad > 0 ? 'BAD RESULT. TRY AGAIN.' : 'SELECT ANOMALY';
      else msg = started ? `RESULTS IN ${TIMING.sampleWait} SECONDS` : 'PRESS TO START TEST';
      text(ctx, msg, 250, 64, { size: 26, color: bad > 0 ? '#ff6b5b' : '#7dff8a', stroke: null, weight: 700 });
      if (!pick && started) text(ctx, 'GO DO SOMETHING ELSE.', 250, 92, { size: 16, color: '#7dff8a', stroke: null, weight: 600 });

      box(ctx, 30, 335, 440, 26, 6, '#5b6672');
      for (let i = 0; i < TUBES; i++) {
        const liquid = pick && i === anomaly ? PALETTE.red : '#3d8fe0';
        const pour = started ? Math.min(1, Math.max(0, (time - (doneAt - 1.2)) * 2.5 - i * 0.25)) : 0;
        tube(i, liquid, pick ? 1 : pour);
      }

      if (pick) {
        for (let i = 0; i < TUBES; i++) {
          const b = tubeBtn(i);
          box(ctx, b.x, b.y, b.w, b.h, 10, '#d6e0f0');
          text(ctx, String(i + 1), b.x + b.w / 2, b.y + b.h / 2, { size: 26 });
        }
      } else {
        const b = startBtn;
        box(ctx, b.x, b.y + (started ? 4 : 0), b.w, b.h, 16, started ? '#1e5aa8' : PALETTE.blue);
        text(ctx, started ? 'RUNNING' : 'START', b.x + b.w / 2, b.y + b.h / 2 + (started ? 4 : 0), { size: 30 });
      }
    });

    return () => v.destroy();
  },
};
