// Procedurally drawn GUI / HUD sprites in the style of Minecraft Java 1.18 (original pixel art).
// generateGuiTextures() -> Map<name, { w, h, data: Uint8ClampedArray }>
// Pure JS (no DOM): runs in browsers, workers and Node. All randomness is seeded.
import { PixelCanvas, mix, seeded, toRGBA } from './pixel.js';

const sprite = (w, h) => new PixelCanvas(w, h);
const CLEAR = [0, 0, 0, 0];

// Vanilla-like GUI palette
export const GUI_COLORS = {
  panel: '#c6c6c6', panelLight: '#ffffff', panelDark: '#555555', outline: '#000000',
  slot: '#8b8b8b', slotDark: '#373737', slotLight: '#ffffff',
};

function paint(c, rows, pal, x0 = 0, y0 = 0) { c.pattern(x0, y0, rows, pal); return c; }
function hline(c, x0, x1, y, col) { for (let x = x0; x <= x1; x++) c.set(x, y, col); }
function vline(c, x, y0, y1, col) { for (let y = y0; y <= y1; y++) c.set(x, y, col); }
function frame(c, x, y, w, h, col) { hline(c, x, x + w - 1, y, col); hline(c, x, x + w - 1, y + h - 1, col); vline(c, x, y, y + h - 1, col); vline(c, x + w - 1, y, y + h - 1, col); }

// ---------------------------------------------------------------------------------------------
// hearts / food / armor / air (9x9)
// ---------------------------------------------------------------------------------------------
// O = outline, others = interior roles: w white glint, l light, r base, d dark
const HEART_SHAPE = [
  '.OO...OO.',
  'OwlO.OlrO',
  'OlrrOrrrO',
  'OrrrrrrdO',
  'OrrrrrrdO',
  '.OrrrrdO.',
  '..OdrdO..',
  '...OdO...',
  '....O....',
];
const HEART_RAMPS = {
  normal: { w: '#ffffff', l: '#ff8a8a', r: '#e81c1c', d: '#a00c0c' },
  blink: { w: '#ffffff', l: '#ffffff', r: '#ff9a9a', d: '#e86a6a' },
  poisoned: { w: '#f4ffc8', l: '#c8d850', r: '#8ca21a', d: '#56690c' },
  withered: { w: '#8a8a8a', l: '#555555', r: '#2c2c2c', d: '#161616' },
  absorbing: { w: '#ffffe0', l: '#fff07a', r: '#f0c418', d: '#b88400' },
  frozen: { w: '#ffffff', l: '#d4f2ff', r: '#8ccff5', d: '#4a8cc8' },
};

function heartFill(ramp, half) {
  const c = sprite(9, 9);
  HEART_SHAPE.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const k = row[x];
      if (k === '.' || k === 'O') continue;
      if (half && x > 4) continue;
      c.set(x, y, ramp[k]);
    }
  });
  return c;
}

function heartContainer(outline, inner) {
  const c = sprite(9, 9);
  HEART_SHAPE.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const k = row[x];
      if (k === 'O') c.set(x, y, outline);
      else if (k !== '.') c.set(x, y, inner);
    }
  });
  return c;
}

// Drumstick: meat top-right, bone bottom-left. O outline, h/l/m/d meat, w/W bone, i interior (empty)
const FOOD_SHAPE = [
  '...OOOO..',
  '..OhhlmO.',
  '.OhllmmdO',
  '.OlmmmmdO',
  '.OmmmmddO',
  '..OmmddO.',
  '.OWOOOO..',
  'OwwO.....',
  '.OO......',
];
const FOOD_RAMPS = {
  normal: { O: '#2a1204', h: '#e8a25e', l: '#c87a3a', m: '#a85a24', d: '#743812', w: '#f4ecdc', W: '#c8bca4', i: '#3a2616' },
  hunger: { O: '#142208', h: '#b8d070', l: '#8aa844', m: '#688a2a', d: '#3e5a14', w: '#e4ecc8', W: '#b0bc90', i: '#1e2e10' },
};

function foodIcon(kind, mode) {
  // mode: 'empty' | 'full' | 'half' (half keeps the right half, like the vanilla bar that drains from the left)
  const R = FOOD_RAMPS[kind];
  const c = sprite(9, 9);
  FOOD_SHAPE.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const k = row[x];
      if (k === '.') continue;
      if (k === 'O') { c.set(x, y, R.O); continue; }
      const filled = mode === 'full' || (mode === 'half' && x >= 4);
      c.set(x, y, filled ? R[k] : R.i);
    }
  });
  return c;
}

const ARMOR_SHAPE = [
  '.OOO.OOO.',
  'OhhhOhlmO',
  'OhllhllmO',
  'OOhlllmOO',
  '.OhllmmO.',
  '.OhllmmO.',
  '.OlmmmdO.',
  '.OOOOOOO.',
  '.........',
];
function armorIcon(mode) {
  const ramp = { O: '#1a1a1a', h: '#ffffff', l: '#d4d4d4', m: '#a4a4a4', d: '#7a7a7a', i: '#3a3a3a' };
  const c = sprite(9, 9);
  ARMOR_SHAPE.forEach((row, y) => {
    for (let x = 0; x < 9; x++) {
      const k = row[x];
      if (k === '.') continue;
      if (k === 'O') { c.set(x, y, ramp.O); continue; }
      const filled = mode === 'full' || (mode === 'half' && x <= 4);
      c.set(x, y, filled ? ramp[k] : ramp.i);
    }
  });
  return c;
}

function airBubble() {
  return paint(sprite(9, 9), [
    '..OOOOO..',
    '.OWwbbbO.',
    'OWwbbbbbO',
    'Owbbbbbdo',
    'Obbbbbbdo',
    'Obbbbbbdo',
    'Obbbbbddo',
    '.Obbdddo.',
    '..ooooo..',
  ], { O: '#1c4a96', o: '#143670', W: '#ffffff', w: '#dcefff', b: '#8cc2f8', d: '#5a8ed8' });
}
function airBursting() {
  // the bubble outline breaking apart into fragments
  return paint(sprite(9, 9), [
    '...O.O...',
    '.OO...OO.',
    '.Ow...wO.',
    'O.......O',
    '.........',
    'O.......O',
    '.Ow...dO.',
    '.OO...OO.',
    '...O.O...',
  ], { O: '#1c4a96', w: '#dcefff', d: '#8cc2f8' });
}

// ---------------------------------------------------------------------------------------------
// crosshair & attack indicators
// ---------------------------------------------------------------------------------------------
function crosshair() {
  const c = sprite(15, 15);
  hline(c, 0, 14, 7, '#ffffff');
  vline(c, 7, 0, 14, '#ffffff');
  return c;
}

// small sword icon (sits under the crosshair when an attack will land at full strength)
function crosshairAttackFull() {
  return paint(sprite(16, 16), [
    '................',
    '................',
    '................',
    '................',
    '..........www...',
    '.........wwww...',
    '........wwww....',
    '.......wwww.....',
    '...w..wwww......',
    '...wwwwww.......',
    '....wwww........',
    '....wwww........',
    '...ww..w........',
    '..ww............',
    '................',
    '................',
  ], { w: '#ffffff' });
}

function attackBar(progress) {
  const c = sprite(16, 4);
  if (progress) { c.rect(0, 0, 16, 4, '#ffffff'); return c; }
  frame(c, 0, 0, 16, 4, [255, 255, 255, 110]);
  c.rect(1, 1, 14, 2, [0, 0, 0, 90]);
  return c;
}

const HOTBAR_SWORD = [
  '..................',
  '..............oo..',
  '.............owwo.',
  '............owwwo.',
  '...........owwwo..',
  '..........owwwo...',
  '.........owwwo....',
  '........owwwo.....',
  '...oo..owwwo......',
  '...owooowwo.......',
  '....owwwwo........',
  '.....owwo.........',
  '....owowwo........',
  '...owo.owwo.......',
  '..owo...oo........',
  '.owo..............',
  '.oo...............',
  '..................',
];
function hotbarAttack(progress) {
  const c = sprite(18, 18);
  const pal = progress ? { o: '#1e1e1e', w: '#ffffff' } : { o: '#1e1e1e', w: '#5e5e5e' };
  return paint(c, HOTBAR_SWORD, pal);
}

// ---------------------------------------------------------------------------------------------
// hotbar
// ---------------------------------------------------------------------------------------------
const HB = {
  border: [22, 22, 22, 235],
  frameHi: [168, 168, 168, 255],
  frame: [128, 128, 128, 255],
  frameLo: [88, 88, 88, 255],
  well: [52, 52, 52, 150],
  wellShade: [24, 24, 24, 175],
};

function slotBox(c, x, y) {
  // one 20x20 slot cell whose 1px frame is shared with neighbours
  hline(c, x, x + 19, y, HB.frameHi);
  vline(c, x, y, y + 19, HB.frameHi);
  hline(c, x, x + 19, y + 19, HB.frameLo);
  vline(c, x + 19, y, y + 19, HB.frameLo);
  c.rect(x + 1, y + 1, 18, 18, HB.frame);
  // recessed well
  c.rect(x + 2, y + 2, 16, 16, HB.well);
  hline(c, x + 2, x + 17, y + 2, HB.wellShade);
  vline(c, x + 2, y + 2, y + 17, HB.wellShade);
}

function hotbar() {
  const c = sprite(182, 22);
  frame(c, 0, 0, 182, 22, HB.border);
  for (let i = 0; i < 9; i++) slotBox(c, 1 + i * 20, 1);
  return c;
}

function offhandSlot(left) {
  const c = sprite(29, 24);
  const x = left ? 0 : 7;
  frame(c, x, 1, 22, 22, HB.border);
  slotBox(c, x + 1, 2);
  return c;
}

function hotbarSelection() {
  const c = sprite(24, 24);
  frame(c, 0, 0, 24, 24, '#000000');
  frame(c, 1, 1, 22, 22, '#ffffff');
  frame(c, 2, 2, 20, 20, '#d8d8d8');
  // soften the lower/right inner edge a bit for a bevelled look
  hline(c, 2, 21, 21, '#a8a8a8'); vline(c, 21, 2, 21, '#a8a8a8');
  frame(c, 3, 3, 18, 18, [0, 0, 0, 200]);
  return c;
}

// ---------------------------------------------------------------------------------------------
// experience bar
// ---------------------------------------------------------------------------------------------
function xpBar(progress) {
  const c = sprite(182, 5);
  frame(c, 0, 0, 182, 5, '#000000');
  for (let x = 1; x < 181; x++) {
    if (progress) {
      c.set(x, 1, '#c8ff7a'); c.set(x, 2, '#80ff20'); c.set(x, 3, '#46a80e');
    } else {
      c.set(x, 1, '#3a3a3a'); c.set(x, 2, '#2a2a2a'); c.set(x, 3, '#1e1e1e');
    }
  }
  // segment notches every 9-10px like the vanilla bar
  for (let i = 1; i < 18; i++) {
    const x = Math.round(i * 181 / 18);
    if (!progress) vline(c, x, 1, 3, '#000000');
    else { c.set(x, 1, '#8ee84a'); c.set(x, 2, '#5ec418'); c.set(x, 3, '#2e7a06'); }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// buttons / slider / text field / checkbox
// ---------------------------------------------------------------------------------------------
function stoneNoise(c, x0, y0, w, h, base, amount, seed) {
  const rnd = seeded(seed);
  const b = toRGBA(base);
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const v = rnd();
    const f = v < 0.18 ? 1 - amount : v > 0.86 ? 1 + amount : v > 0.7 ? 1 + amount * 0.45 : 1;
    c.set(x, y, [Math.min(255, b[0] * f), Math.min(255, b[1] * f), Math.min(255, b[2] * f), 255]);
  }
}

const BUTTON_STYLES = {
  normal: { outline: '#000000', base: '#727272', hi: '#aaaaaa', hi2: '#8e8e8e', lo: '#565656', lo2: '#474747', noise: 0.09 },
  highlighted: { outline: '#ffffff', base: '#7c86be', hi: '#bec8ff', hi2: '#9aa4dc', lo: '#5a6296', lo2: '#4a5282', noise: 0.08 },
  disabled: { outline: '#000000', base: '#2e2e2e', hi: '#414141', hi2: '#373737', lo: '#262626', lo2: '#202020', noise: 0.06 },
};

function button(w, h, style, seed) {
  const s = BUTTON_STYLES[style];
  const c = sprite(w, h);
  stoneNoise(c, 1, 1, w - 2, h - 2, s.base, s.noise, seed);
  // top/left bevel (2px light), bottom/right bevel (2px dark)
  hline(c, 1, w - 2, 1, s.hi); vline(c, 1, 1, h - 2, s.hi);
  hline(c, 2, w - 3, 2, s.hi2); vline(c, 2, 2, h - 3, s.hi2);
  hline(c, 1, w - 2, h - 2, s.lo2); vline(c, w - 2, 1, h - 2, s.lo2);
  hline(c, 2, w - 3, h - 3, s.lo); vline(c, w - 3, 2, h - 3, s.lo);
  c.set(1, h - 2, s.lo2); c.set(w - 2, 1, s.lo2);
  frame(c, 0, 0, w, h, s.outline);
  return c;
}

function textField(highlighted) {
  const c = sprite(200, 20);
  c.rect(0, 0, 200, 20, '#000000');
  frame(c, 0, 0, 200, 20, highlighted ? '#ffffff' : '#a0a0a0');
  return c;
}

function checkbox(selected, highlighted) {
  const c = sprite(20, 20);
  c.rect(1, 1, 18, 18, [0, 0, 0, 200]);
  frame(c, 0, 0, 20, 20, highlighted ? '#ffffff' : '#a0a0a0');
  // subtle inner bevel
  hline(c, 1, 18, 1, [60, 60, 60, 255]); vline(c, 1, 1, 18, [60, 60, 60, 255]);
  if (selected) {
    paint(c, [
      '............',
      '...........w',
      '..........ww',
      '.........ww.',
      '........ww..',
      'w......ww...',
      'ww....ww....',
      '.ww..ww.....',
      '..wwww......',
      '...ww.......',
    ], { w: '#ffffff' }, 4, 4);
    paint(c, [
      '............',
      '............',
      '...........s',
      '..........s.',
      '.........s..',
      '........s...',
      '.s.....s....',
      '..s...s.....',
      '...s.s......',
      '....s.......',
    ], { s: '#8a8a8a' }, 4, 5);
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// backgrounds
// ---------------------------------------------------------------------------------------------
function dirt() {
  const c = sprite(16, 16);
  const rnd = seeded('gui-dirt');
  const cols = ['#593d29', '#6c4d36', '#79553a', '#866043', '#976d4d', '#b9855c'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = rnd();
    const k = v < 0.1 ? 0 : v < 0.3 ? 1 : v < 0.55 ? 2 : v < 0.82 ? 3 : v < 0.95 ? 4 : 5;
    c.set(x, y, cols[k]);
  }
  // a few small gray pebbles
  for (const [x, y] of [[3, 4], [11, 9], [6, 13], [13, 2]]) { c.set(x, y, '#8c8c8c'); c.set(x + 1, y, '#6e6e6e'); }
  return c;
}

function panoramaTile() {
  // cobblestone-like tile used when no panorama is available
  const c = sprite(16, 16);
  const rnd = seeded('gui-cobble');
  const rows = [
    'aaabbbbacccccddd',
    'aaabbbbacccccddd',
    'aaabbbbaccccccdd',
    'eaaaabbaccffffdd',
    'eeeaaaagggffffdh',
    'eeeaaaagggfffhhh',
    'eeiiiiigggjjjhhh',
    'eiiiiiigggjjjjhh',
    'kkiiiilllljjjjmm',
    'kkkkilllllljjmmm',
    'kkkkillllnnnnmmm',
    'okkkkppplnnnnmmm',
    'ooookpppqqnnnmmr',
    'ooooopppqqqqrrrr',
    'aaaoopppqqqqrrrb',
    'aaaoopppbqqqrrbb',
  ];
  const shade = {};
  for (const ch of 'abcdefghijklmnopqr') shade[ch] = 0.8 + rnd() * 0.35;
  rows.forEach((r, y) => {
    for (let x = 0; x < 16; x++) {
      const ch = r[x];
      const edge = (x < 15 && r[x + 1] !== ch) || (y < 15 && rows[y + 1][x] !== ch);
      const top = (x > 0 && r[x - 1] !== ch) || (y > 0 && rows[y - 1][x] !== ch);
      let v = 122 * shade[ch] + (rnd() - 0.5) * 14;
      if (edge) v *= 0.55; else if (top) v *= 1.18;
      c.set(x, y, [v, v, v, 255]);
    }
  });
  return c;
}

// ---------------------------------------------------------------------------------------------
// creative tabs & scroller
// ---------------------------------------------------------------------------------------------
function inventoryTab(selected) {
  const c = sprite(28, 32);
  const fill = selected ? '#c6c6c6' : '#a9a9a9';
  const hi = selected ? '#ffffff' : '#d6d6d6';
  const lo = selected ? '#555555' : '#606060';
  // body
  c.rect(1, 1, 26, 31, fill);
  // rounded top corners
  c.set(1, 1, CLEAR); c.set(26, 1, CLEAR);
  // outline
  hline(c, 2, 25, 0, '#000000');
  c.set(1, 1, '#000000'); c.set(26, 1, '#000000');
  vline(c, 0, 2, 31, '#000000'); vline(c, 27, 2, 31, '#000000');
  // bevel
  hline(c, 2, 25, 1, hi); hline(c, 2, 24, 2, hi);
  vline(c, 1, 2, 31, hi); vline(c, 2, 2, 31, hi);
  vline(c, 26, 2, 31, lo); vline(c, 25, 3, 31, lo);
  c.set(25, 2, fill);
  if (!selected) {
    // unselected tabs sit behind the panel: close the bottom edge
    hline(c, 0, 27, 31, '#000000');
    hline(c, 1, 26, 30, lo);
  }
  return c;
}

function scroller(disabled) {
  const c = sprite(12, 15);
  const fill = disabled ? '#8b8b8b' : '#c6c6c6';
  const hi = disabled ? '#b4b4b4' : '#ffffff';
  const lo = disabled ? '#5a5a5a' : '#555555';
  c.rect(0, 0, 12, 15, fill);
  hline(c, 0, 10, 0, hi); vline(c, 0, 0, 13, hi);
  hline(c, 1, 11, 14, lo); vline(c, 11, 1, 14, lo);
  hline(c, 1, 9, 1, hi); vline(c, 1, 1, 12, hi);
  hline(c, 2, 10, 13, lo); vline(c, 10, 2, 13, lo);
  c.set(11, 0, fill); c.set(0, 14, fill);
  return c;
}

// ---------------------------------------------------------------------------------------------
// furnace, recipe book
// ---------------------------------------------------------------------------------------------
const FLAME = [
  '......f.......',
  '......ff......',
  '.....fff......',
  '.....ffYf.....',
  '....ffYYff..f.',
  '..f.fYYYff.ff.',
  '..ffYYyYYfff..',
  '.ffYYyyyYYff..',
  '.fYYyyWyyYYff.',
  '.fYyyWWWyyYf..',
  '..fYyWWWyYff..',
  '..ffYyWyYYf...',
  '...ffYYYff....',
  '....ffff......',
];
function flame(lit) {
  const c = sprite(14, 14);
  if (lit) return paint(c, FLAME, { f: '#d8520a', Y: '#f89a1a', y: '#ffd84a', W: '#fff8c8' });
  return paint(c, FLAME, { f: '#8b8b8b', Y: '#8b8b8b', y: '#8b8b8b', W: '#8b8b8b' });
}

const ARROW = [
  '...............a........',
  '...............aa.......',
  '...............aaa......',
  '...............aaaa.....',
  '...............aaaaa....',
  '...............aaaaaa...',
  'aaaaaaaaaaaaaaaaaaaaaa..',
  'aaaaaaaaaaaaaaaaaaaaaaa.',
  'aaaaaaaaaaaaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaaaaaaaaa.',
  'aaaaaaaaaaaaaaaaaaaaaa..',
  '...............aaaaaa...',
  '...............aaaaa....',
  '...............aaaa.....',
  '...............aaa......',
  '...............aa.......',
  '...............a........',
];
function furnaceArrow(progress) {
  const c = sprite(24, 17);
  return paint(c, ARROW, { a: progress ? '#ffffff' : '#8b8b8b' });
}

function recipeBookButton() {
  const c = sprite(20, 18);
  return paint(c, [
    '....................',
    '....................',
    '...oooooooooooooo...',
    '..oGGGGGGGGGGGGGGo..',
    '..oGggggggggggggGo..',
    '..oGgyyyyyyyyyygGo..',
    '..oGgyggggggggygGo..',
    '..oGgyggggggggygGo..',
    '..oGgyyyyyyyyyygGo..',
    '..oGggggggggggggGo..',
    '..oGggggggggggggGo..',
    '..oGggggggggggggGo..',
    '..oDDDDDDDDDDDDDDo..',
    '..opppppppppppppPo..',
    '..oPPPPPPPPPPPPPPo..',
    '...oooooooooooooo...',
    '....................',
    '....................',
  ], { o: '#10300c', G: '#3f8a2a', g: '#2e6e1e', y: '#c8a830', D: '#1a4410', p: '#f4f0e0', P: '#c8c0a8' });
}

// ---------------------------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------------------------
function build() {
  const M = new Map();
  const put = (name, c) => M.set(name, { w: c.w, h: c.h, data: c.data });

  // hearts
  put('heart_container', heartContainer('#000000', '#2e1a1a'));
  put('heart_container_blinking', heartContainer('#ffffff', '#2e1a1a'));
  put('heart_full', heartFill(HEART_RAMPS.normal, false));
  put('heart_half', heartFill(HEART_RAMPS.normal, true));
  put('heart_full_blinking', heartFill(HEART_RAMPS.blink, false));
  put('heart_half_blinking', heartFill(HEART_RAMPS.blink, true));
  for (const k of ['poisoned', 'withered', 'absorbing', 'frozen']) {
    put(`heart_${k}_full`, heartFill(HEART_RAMPS[k], false));
    put(`heart_${k}_half`, heartFill(HEART_RAMPS[k], true));
    put(`heart_${k}_full_blinking`, heartFill({ ...HEART_RAMPS[k], r: mix(HEART_RAMPS[k].r, '#ffffff', 0.45), d: mix(HEART_RAMPS[k].d, '#ffffff', 0.4) }, false));
    put(`heart_${k}_half_blinking`, heartFill({ ...HEART_RAMPS[k], r: mix(HEART_RAMPS[k].r, '#ffffff', 0.45), d: mix(HEART_RAMPS[k].d, '#ffffff', 0.4) }, true));
  }
  put('heart_hardcore_container', heartContainer('#000000', '#2e1a1a'));

  // food
  put('food_empty', foodIcon('normal', 'empty'));
  put('food_half', foodIcon('normal', 'half'));
  put('food_full', foodIcon('normal', 'full'));
  put('food_empty_hunger', foodIcon('hunger', 'empty'));
  put('food_half_hunger', foodIcon('hunger', 'half'));
  put('food_full_hunger', foodIcon('hunger', 'full'));

  // armor & air
  put('armor_empty', armorIcon('empty'));
  put('armor_half', armorIcon('half'));
  put('armor_full', armorIcon('full'));
  put('air', airBubble());
  put('air_bursting', airBursting());

  // crosshair & attack indicator
  put('crosshair', crosshair());
  put('crosshair_attack_indicator_full', crosshairAttackFull());
  put('crosshair_attack_indicator_background', attackBar(false));
  put('crosshair_attack_indicator_progress', attackBar(true));
  put('hotbar_attack_indicator_background', hotbarAttack(false));
  put('hotbar_attack_indicator_progress', hotbarAttack(true));

  // hotbar & xp
  put('hotbar', hotbar());
  put('hotbar_selection', hotbarSelection());
  put('hotbar_offhand_left', offhandSlot(true));
  put('hotbar_offhand_right', offhandSlot(false));
  put('experience_bar_background', xpBar(false));
  put('experience_bar_progress', xpBar(true));

  // widgets
  put('button', button(200, 20, 'normal', 'button'));
  put('button_highlighted', button(200, 20, 'highlighted', 'button'));
  put('button_disabled', button(200, 20, 'disabled', 'button'));
  put('slider', button(200, 20, 'disabled', 'slider'));
  put('slider_handle', button(8, 20, 'normal', 'slider_handle'));
  put('slider_handle_highlighted', button(8, 20, 'highlighted', 'slider_handle'));
  put('text_field', textField(false));
  put('text_field_highlighted', textField(true));
  put('checkbox', checkbox(false, false));
  put('checkbox_selected', checkbox(true, false));
  put('checkbox_highlighted', checkbox(false, true));
  put('checkbox_selected_highlighted', checkbox(true, true));

  // backgrounds
  put('options_background', dirt());
  put('menu_panorama_tile', panoramaTile());

  // containers
  put('inventory_tab_selected', inventoryTab(true));
  put('inventory_tab', inventoryTab(false));
  put('scroller', scroller(false));
  put('scroller_disabled', scroller(true));
  put('recipe_book_button', recipeBookButton());
  put('furnace_burn_progress', flame(true));
  put('furnace_burn_empty', flame(false));
  put('furnace_arrow_progress', furnaceArrow(true));
  put('furnace_arrow_empty', furnaceArrow(false));
  return M;
}

// Required sprite sizes (checked by tools/preview-gui-textures.mjs)
export const GUI_SPRITE_SIZES = {
  heart_container: [9, 9], heart_container_blinking: [9, 9], heart_full: [9, 9], heart_half: [9, 9],
  heart_full_blinking: [9, 9], heart_half_blinking: [9, 9], heart_poisoned_full: [9, 9], heart_poisoned_half: [9, 9],
  heart_withered_full: [9, 9], heart_withered_half: [9, 9], heart_absorbing_full: [9, 9], heart_absorbing_half: [9, 9],
  heart_frozen_full: [9, 9], heart_frozen_half: [9, 9],
  food_empty: [9, 9], food_half: [9, 9], food_full: [9, 9], food_empty_hunger: [9, 9], food_half_hunger: [9, 9], food_full_hunger: [9, 9],
  armor_empty: [9, 9], armor_half: [9, 9], armor_full: [9, 9], air: [9, 9], air_bursting: [9, 9],
  crosshair: [15, 15], crosshair_attack_indicator_full: [16, 16], crosshair_attack_indicator_background: [16, 4],
  crosshair_attack_indicator_progress: [16, 4], hotbar_attack_indicator_background: [18, 18], hotbar_attack_indicator_progress: [18, 18],
  hotbar: [182, 22], hotbar_selection: [24, 24], hotbar_offhand_left: [29, 24], hotbar_offhand_right: [29, 24],
  experience_bar_background: [182, 5], experience_bar_progress: [182, 5],
  button: [200, 20], button_highlighted: [200, 20], button_disabled: [200, 20],
  slider: [200, 20], slider_handle: [8, 20], slider_handle_highlighted: [8, 20],
  text_field: [200, 20], text_field_highlighted: [200, 20],
  options_background: [16, 16],
  inventory_tab_selected: [28, 32], inventory_tab: [28, 32], scroller: [12, 15], scroller_disabled: [12, 15],
  furnace_burn_progress: [14, 14], furnace_burn_empty: [14, 14], furnace_arrow_progress: [24, 17], furnace_arrow_empty: [24, 17],
  checkbox: [20, 20], checkbox_selected: [20, 20],
};

let cache = null;
export function generateGuiTextures() {
  if (!cache) cache = build();
  const out = new Map();
  for (const [k, v] of cache) out.set(k, { w: v.w, h: v.h, data: new Uint8ClampedArray(v.data) });
  return out;
}
