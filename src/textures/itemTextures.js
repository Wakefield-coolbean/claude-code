// Procedurally drawn 16x16 item sprites (original pixel art in the style of Minecraft Java 1.14+).
// generateItemTextures() -> Map<name, Uint8ClampedArray(16*16*4)>, row-major RGBA, top row first.
// Pure JS (no DOM): runs in browsers, workers and Node. All randomness is seeded.
import { PixelCanvas, mix, seeded, toRGBA } from './pixel.js';

const N = 16;
// Problems found while building sprites (bad row lengths etc). Checked by tools/preview-gui-textures.mjs.
export const ITEM_TEXTURE_WARNINGS = [];

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------
function canvas() { return new PixelCanvas(N, N); }

// Draw a 16x16 (or smaller, offset) char map. '.' and unknown chars are transparent.
function art(name, rows, pal, c = canvas(), x0 = 0, y0 = 0) {
  if (x0 === 0 && y0 === 0 && rows.length !== N) ITEM_TEXTURE_WARNINGS.push(`${name}: ${rows.length} rows`);
  rows.forEach((r, i) => { if (x0 === 0 && r.length !== N) ITEM_TEXTURE_WARNINGS.push(`${name}: row ${i} has ${r.length} chars`); });
  c.pattern(x0, y0, rows, pal);
  return c;
}

const hex = (c) => toRGBA(c);

// Material ramps: o = outline (darkest), d = dark, m = mid, l = light, h = highlight.
const MAT = {
  wooden: { o: '#3a2810', d: '#6b4f22', m: '#8f6d36', l: '#b08a4f', h: '#caa466' },
  stone: { o: '#2e2e2e', d: '#595959', m: '#757575', l: '#949494', h: '#afafaf' },
  iron: { o: '#383838', d: '#8b8b8b', m: '#b7b7b7', l: '#d8d8d8', h: '#ffffff' },
  golden: { o: '#6e3f06', d: '#c7800f', m: '#eab126', l: '#fbe052', h: '#fffbb4' },
  diamond: { o: '#0c3a36', d: '#179986', m: '#2fd8bd', l: '#88f1df', h: '#dcfff9' },
  netherite: { o: '#120e10', d: '#2e272a', m: '#453c40', l: '#5f5559', h: '#81777b' },
  leather: { o: '#3e2412', d: '#7b4a28', m: '#a06540', l: '#bd7f55', h: '#d69c70' },
  chainmail: { o: '#262626', d: '#575757', m: '#8a8a8a', l: '#b8b8b8', h: '#dedede' },
  turtle: { o: '#163d12', d: '#2f7a24', m: '#47a336', l: '#6fc74a', h: '#a4e57a' },
};
// Shared stick/handle colors (S = outline, s = dark wood, t = light wood)
const WOOD = { S: '#2c1d0b', s: '#684d1f', t: '#9a773a' };

function matPal(mat, extra = {}) { return { ...MAT[mat], ...WOOD, ...extra }; }

// Stone tool heads get a speckled cobble look, chainmail gets holes.
function speckle(c, name, from, to, chance) {
  const rnd = seeded(name);
  const f = hex(from), t = hex(to);
  c.map((x, y, p) => {
    const r = rnd();
    if (p[3] && p[0] === f[0] && p[1] === f[1] && p[2] === f[2] && r < chance) return t;
    return null;
  });
}

// Outline every opaque pixel region with a darker color (8-neighbourhood) — used for generated shapes.
function autoOutline(c, color, diag = false) {
  const src = c.clone();
  const col = hex(color);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (src.data[src.idx(x, y) + 3]) continue;
    let hit = false;
    for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (!diag && dx && dy) continue;
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= N || Y >= N) continue;
      if (src.data[src.idx(X, Y) + 3] > 0) { hit = true; break; }
    }
    if (hit) c.set(x, y, col);
  }
  return c;
}

// Shaded blob: mask(x,y) -> bool, ramp = [outline, dark, mid, light, highlight]; light from top-left.
function shadedBlob(mask, ramp, { cx = 7.5, cy = 7.5, r = 6, spec = true, bias = 0 } = {}) {
  const c = canvas();
  const inside = (x, y) => x >= 0 && y >= 0 && x < N && y < N && mask(x, y);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (!inside(x, y)) continue;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (edge) { c.set(x, y, ramp[0]); continue; }
    const nx = (x - cx) / r, ny = (y - cy) / r;
    let l = -(nx * 0.62 + ny * 0.78) + bias; // light dir from top-left
    const idx = l > 0.55 ? 4 : l > 0.15 ? 3 : l > -0.3 ? 2 : 1;
    c.set(x, y, ramp[idx]);
  }
  if (spec) {
    // little specular glint on the upper-left
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (!inside(x, y)) continue;
      const nx = (x - cx) / r, ny = (y - cy) / r;
      if (Math.abs(nx + 0.45) < 0.12 && Math.abs(ny + 0.45) < 0.12) c.set(x, y, ramp[5] ?? ramp[4]);
    }
  }
  return c;
}

const circle = (cx, cy, rx, ry = rx) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

// Pile of dust/powder (redstone, glowstone, gunpowder, sugar, bone meal)
function dustPile(name, colors, outline, { grains = false } = {}) {
  const rnd = seeded('dust:' + name);
  const c = canvas();
  const rows = [
    '................',
    '................',
    '................',
    '................',
    '.......##.......',
    '......####..#...',
    '....#.#####.....',
    '.....########...',
    '...##########.#.',
    '..############..',
    '.#############..',
    '..#############.',
    '.##############.',
    '..############..',
    '....#######.....',
    '................',
  ];
  const n = colors.length;
  rows.forEach((r, y) => {
    for (let x = 0; x < N; x++) {
      if (r[x] !== '#') continue;
      // lit from the top-left: base level from position, then a little grain noise
      const t = 0.95 - (y - 4) / 11 * 0.55 - (x - 1) / 14 * 0.35;
      let k = Math.round(t * (n - 1));
      const v = rnd();
      if (v < 0.22) k -= 1; else if (v > 0.82) k += 1;
      c.set(x, y, colors[Math.max(0, Math.min(n - 1, k))]);
    }
  });
  if (grains) {
    for (let i = 0; i < 9; i++) {
      const x = 2 + Math.floor(rnd() * 12), y = 6 + Math.floor(rnd() * 8);
      if (c.get(x, y)[3]) c.set(x, y, colors[n - 1]);
    }
  }
  autoOutline(c, outline);
  return c;
}

// ---------------------------------------------------------------------------------------------
// tools (handle bottom-left, head top-right). Legend: o d m l h = head ramp, S s t = stick.
// ---------------------------------------------------------------------------------------------
const TOOL_ART = {
  sword: [
    '................',
    '............oo..',
    '...........ohlo.',
    '..........ohlmo.',
    '.........ohlmo..',
    '........ohlmo...',
    '.......ohlmo....',
    '......ohlmo.....',
    '..oo.ohlmo......',
    '.oggohlmo.......',
    '..ogglmo........',
    '...Sggo.........',
    '..Stsggo........',
    '.StsSogo........',
    'oggo............',
    '.oo.............',
  ],
  shovel: [
    '................',
    '..........oooo..',
    '.........ohhlmo.',
    '........ohhllmo.',
    '.........ohlmdo.',
    '.........Solmdo.',
    '........Stsodo..',
    '.......StsS.o...',
    '......StsS......',
    '.....StsS.......',
    '....StsS........',
    '...StsS.........',
    '..StsS..........',
    '.StsS...........',
    '.SSS............',
    '................',
  ],
  pickaxe: [
    '................',
    '....oooooooo....',
    '...ohhhhhhllo...',
    '..olmmmmmmmmmo..',
    '.ooooooooommmdo.',
    '.........Sommdo.',
    '........Stsomdo.',
    '.......StsSomdo.',
    '......StsS.omdo.',
    '.....StsS..omdo.',
    '....StsS...omdo.',
    '...StsS....omdo.',
    '..StsS.....odo..',
    '.StsS......oo...',
    '.SSS.......o....',
    '................',
  ],
  axe: [
    '................',
    '.....oooooo.....',
    '....ohhhhhloSSS.',
    '...ohhllllmStsS.',
    '..ohhlllmmStsS..',
    '..ohllmmmStsS...',
    '..ohlmmmStsS....',
    '..olmmdStsS.....',
    '..ooooStsS......',
    '.....StsS.......',
    '....StsS........',
    '...StsS.........',
    '..StsS..........',
    '.StsS...........',
    '.SSS............',
    '................',
  ],
  hoe: [
    '................',
    '......ooooooo...',
    '.....ohhhhhhlo..',
    '....ohmmmmmmdo..',
    '....omooooStso..',
    '....oo...StsS...',
    '........StsS....',
    '.......StsS.....',
    '......StsS......',
    '.....StsS.......',
    '....StsS........',
    '...StsS.........',
    '..StsS..........',
    '.StsS...........',
    '.SSS............',
    '................',
  ],
};

function toolTexture(mat, type) {
  // sword guard / pommel: a shade between the dark and outline tones so it separates from the blade
  const pal = matPal(mat, { g: mix(MAT[mat].d, MAT[mat].o, 0.4) });
  if (mat === 'wooden') Object.assign(pal, { g: '#5a4019' });
  const c = art(`${mat}_${type}`, TOOL_ART[type], pal);
  if (mat === 'stone') { speckle(c, `${mat}_${type}`, MAT.stone.m, MAT.stone.d, 0.25); speckle(c, `${mat}_${type}b`, MAT.stone.m, MAT.stone.l, 0.2); }
  return c;
}

// ---------------------------------------------------------------------------------------------
// armor
// ---------------------------------------------------------------------------------------------
const ARMOR_ART = {
  helmet: [
    '................',
    '................',
    '................',
    '....oooooooo....',
    '...ohhhhhhllo...',
    '..ohllllllllmo..',
    '..olmmmmmmmmdo..',
    '..olmoooooomdo..',
    '..olmo....omdo..',
    '..oddo....oddo..',
    '..oooo....oooo..',
    '................',
    '................',
    '................',
    '................',
    '................',
  ],
  chestplate: [
    '................',
    '..ooo......ooo..',
    '.ohlmo....olmdo.',
    '.ohllmoooomlmdo.',
    '.ohllllhhlllmdo.',
    '.ooolllhllllooo.',
    '...olllhlllmo...',
    '...olllllllmo...',
    '...ollmmmmmmo...',
    '...olmmmmmmdo...',
    '...olmmmmmmdo...',
    '...olmmmmmddo...',
    '...oddddddddo...',
    '...oooooooooo...',
    '................',
    '................',
  ],
  leggings: [
    '................',
    '................',
    '...oooooooooo...',
    '...ohhhhhhhlo...',
    '...oddddddddo...',
    '...ohllmmllmo...',
    '...ohlmoohlmo...',
    '...ohlmo.ohmo...',
    '...ohlmo.olmo...',
    '...ohlmo.olmo...',
    '...olmdo.olmo...',
    '...olmdo.olmo...',
    '...olmdo.oldo...',
    '...oddo..oddo...',
    '...oooo..oooo...',
    '................',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '..oooo....oooo..',
    '..ohlo....ohlo..',
    '..ohlo....ohlo..',
    '..ohlo....ohlo..',
    '..olmo....olmo..',
    '.ohlmo...ohlmo..',
    'ohllmo..ohllmo..',
    'odddddo.odddddo.',
    'ooooooo.ooooooo.',
    '................',
  ],
};

function armorTexture(mat, piece) {
  const c = art(`${mat}_${piece}`, ARMOR_ART[piece], MAT[mat]);
  if (mat === 'chainmail') {
    // punch a lattice of holes into the inner area to suggest chain links
    const src = c.clone();
    const o = hex(MAT.chainmail.o);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const p = src.get(x, y);
      if (!p[3] || (p[0] === o[0] && p[1] === o[1])) continue;
      if ((x + y) % 2 === 0 && y % 2 === 1) c.set(x, y, [0, 0, 0, 0]);
      else if ((x + y) % 2 === 1 && y % 2 === 0) c.set(x, y, MAT.chainmail.d);
    }
  }
  return c;
}

// ---------------------------------------------------------------------------------------------
// hand authored sprites
// ---------------------------------------------------------------------------------------------
const SPRITES = {
  stick: [[
    '................',
    '................',
    '............SSS.',
    '...........StsS.',
    '..........StsS..',
    '.........StsS...',
    '........StsS....',
    '.......StsS.....',
    '......StsS......',
    '.....StsS.......',
    '....StsS........',
    '...StsS.........',
    '..StsS..........',
    '.StsS...........',
    '.SSS............',
    '................',
  ], WOOD],

  coal: [[
    '................',
    '................',
    '................',
    '......oooo......',
    '....oolhhmoo....',
    '...olhlmmmmdo...',
    '..olhmmmdmmmdo..',
    '..ohmmdddmmmmdo.',
    '.olmmdddmmlmmdo.',
    '.olmmddmmlhmddo.',
    '.ommmdmmmmmdddo.',
    '..odmmmmmdddddo.',
    '..oodddmdddddo..',
    '....oodddddoo...',
    '......ooooo.....',
    '................',
  ], { o: '#0b0b0b', d: '#1b1b1b', m: '#2b2b2b', l: '#454545', h: '#636363' }],

  charcoal: [[
    '................',
    '................',
    '................',
    '.....ooooo......',
    '....olhhmmoo....',
    '...ohlmmmmmmoo..',
    '..ohlmmdmmmlmdo.',
    '..olmmdddmlhmdo.',
    '.ohmmdddmmmmmddo',
    '.olmmmddmmmmddo.',
    '.ommmmmmmdddddo.',
    '..odmmmmddddddo.',
    '..oodddddddddo..',
    '....ooddddoo....',
    '......oooo......',
    '................',
  ], { o: '#0e0b08', d: '#221b14', m: '#352a1f', l: '#4f4232', h: '#6b5a45' }],

  raw_ore: [[
    '................',
    '................',
    '................',
    '.......ooo......',
    '.....oohhlo.....',
    '....ohlllmmoo...',
    '..oohlmmmmlhlo..',
    '.ohlllmmdmlllmo.',
    '.ohlmmmddmmmmdo.',
    '.olmmdmmmmmmddo.',
    '..ommmmmllmdddo.',
    '..odmmmlhhmddo..',
    '...oddmmmmddo...',
    '....oodddddo....',
    '......ooooo.....',
    '................',
  ]],

  ingot: [[
    '................',
    '................',
    '................',
    '................',
    '.........ooooo..',
    '.......oohhhhlo.',
    '.....oohhhhllmo.',
    '...oohhhhllllmo.',
    '..ohhhhllllmmoo.',
    '..olllmmmmmoodo.',
    '..odmmmmmoodddo.',
    '..oodddddddddo..',
    '...ooooooooooo..',
    '................',
    '................',
    '................',
  ]],

  nugget: [[
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......ooo......',
    '......ohhlo.....',
    '....ooohlmdoo...',
    '...ohhlomdohlo..',
    '...ohlmmdolmdo..',
    '...olmmddmmdo...',
    '....oddddddo....',
    '.....oooooo.....',
    '................',
    '................',
    '................',
  ]],

  diamond: [[
    '................',
    '................',
    '....oooooooo....',
    '...ohhwhhllmo...',
    '..ohwhhlllhlmo..',
    '.ohhhlllllllmmo.',
    '.oommmmmmmmmmdo.',
    '..ohllmmmmmmdo..',
    '...ohllmmmmdo...',
    '....ohlmmmdo....',
    '.....ohlmdo.....',
    '......oldo......',
    '.......oo.......',
    '................',
    '................',
    '................',
  ], { o: '#0c3a36', d: '#17998a', m: '#2fd8c2', l: '#7cf0e0', h: '#c9fff6', w: '#ffffff' }],

  emerald: [[
    '................',
    '......oooo......',
    '.....ohhlmo.....',
    '....ohwhllmo....',
    '...ohhlllllmo...',
    '...ohllllmmmo...',
    '...ohlmwlmmdo...',
    '...ohlmllmmdo...',
    '...olllmmmmdo...',
    '...olmmmmmmdo...',
    '...olmmmmmddo...',
    '....ommmmddo....',
    '.....oddddo.....',
    '......oooo......',
    '................',
    '................',
  ], { o: '#07401a', d: '#148a3a', m: '#1fbf55', l: '#5deb85', h: '#b2ffc6', w: '#ffffff' }],

  lapis_lazuli: [[
    '................',
    '................',
    '.......oo.......',
    '......ohlo..oo..',
    '....oohllmoohlo.',
    '...ohhlmmmmlmdo.',
    '..ohlllmmmmmmdo.',
    '..ohlmmmdmmmddo.',
    '.ohllmmddmmmdo..',
    '.olmmmmmmmmmdo..',
    '.ommmwmmmmdddo..',
    '..odmmmmmdddo...',
    '...oodmmddoo....',
    '.....oodoo......',
    '.......o........',
    '................',
  ], { o: '#0a1a5a', d: '#1a3796', m: '#2a54c9', l: '#4979ec', h: '#8db0ff', w: '#c9d8ff' }],

  flint: [[
    '................',
    '................',
    '.......ooo......',
    '......ohhmo.....',
    '.....ohllmmo....',
    '....ohlllmmdo...',
    '...ohhllmmmddo..',
    '...ohllmmmmmdo..',
    '..ohlllmmmmddo..',
    '..olllmmmmdddo..',
    '..olmmmmmddddo..',
    '...ommmmdddddo..',
    '....oommddddo...',
    '......ooddoo....',
    '........oo......',
    '................',
  ], { o: '#0d0d0d', d: '#242424', m: '#383838', l: '#525252', h: '#737373' }],

  feather: [[
    '................',
    '................',
    '...........oo...',
    '.........oowwo..',
    '........owwwlo..',
    '.......owwwgmo..',
    '......owwwglmo..',
    '.....owwwglmo...',
    '....owwwglmo....',
    '....owwglmmo....',
    '...owwglmmo.....',
    '...owglmoo......',
    '...oqglmo.......',
    '..oqoooo........',
    '.oqo............',
    '..o.............',
  ], { o: '#5b5b5b', w: '#ffffff', l: '#e2e2e2', m: '#c4c4c4', g: '#9d9d9d', q: '#d9d0bd' }],

  string: [[
    '................',
    '................',
    '.........www....',
    '........w...l...',
    '.......w.....l..',
    '.......w.....l..',
    '........w...ll..',
    '.........lll.w..',
    '............w...',
    '...wwl.....w....',
    '..w...l...w.....',
    '.w.....l.w......',
    '.w......w.......',
    '..l....l.w......',
    '...llll...l.....',
    '................',
  ], { w: '#f4f4f4', l: '#c4c4c4' }],

  bone: [[
    '................',
    '................',
    '.........oo.....',
    '........ohwo....',
    '........owwwo...',
    '.........owwwo..',
    '........owwwlo..',
    '.......owlooo...',
    '......owlo......',
    '...ooowlo.......',
    '..owwwlo........',
    '..owwlo.........',
    '...owwlo........',
    '....owlo........',
    '.....oo.........',
    '................',
  ], { o: '#56503f', w: '#f0ecdc', h: '#ffffff', l: '#c6bea4' }],

  leather: [[
    '................',
    '................',
    '..oo.......oo...',
    '.ohlooooooolmo..',
    '.ohllllhllllmo..',
    '..ohlmmlllmmo...',
    '..olmmmmmmmmo...',
    '..olmmmmmdmmdo..',
    '.ohlmmmdmmmmdo..',
    '.olmmmmmmmmddo..',
    '..olmmmmmmmdo...',
    '..olmmdmmmmdo...',
    '.oolmmmmmmddoo..',
    '.oddooooooooddo.',
    '..oo........oo..',
    '................',
  ], { o: '#3d1f0d', d: '#6e3818', m: '#8f4c24', l: '#b06636', h: '#c9804d' }],

  paper: [[
    '................',
    '................',
    '...ooooooooooo..',
    '...opppppppppPo.',
    '..opppppppppppo.',
    '..oppxxxxxpppPo.',
    '..opppppppppppo.',
    '..oppxxxxxxppPo.',
    '..opppppppppppo.',
    '..oppxxxxxpppPo.',
    '..opppppppppPo..',
    '..oppppppppppPo.',
    '..oPPPpppppPPPo.',
    '..oooPPPPPPooo..',
    '.....oooooo.....',
    '................',
  ], { o: '#8a8a80', p: '#ffffff', P: '#d8d8d0', x: '#e6e6e0' }],

  book: [[
    '................',
    '................',
    '...ooooooooo....',
    '..ohhlllllllo...',
    '..ohlllllllmo...',
    '..olllllllmmpo..',
    '..ollgllllmmpo..',
    '..olllllllmmpo..',
    '..olllllllmmpo..',
    '..olllllllmmpo..',
    '..olllllllmmpo..',
    '..ommmmmmmmmpo..',
    '..obbbbbbbbbpo..',
    '...opppppppppo..',
    '....oooooooooo..',
    '................',
  ], { o: '#3b1d0c', h: '#a55e34', l: '#8a4a26', m: '#6e3a1d', b: '#50290f', p: '#f1ebdc', g: '#d9b24a' }],

  wheat: [[
    '................',
    '....z..z...z....',
    '...zYz.zYz.zYz..',
    '...yYy.yYy.yYy..',
    '...yyY.yyY.yyY..',
    '....yY..yY.yYy..',
    '....yyYyyYyYy...',
    '.....yyYyyYy....',
    '......yyYyy.....',
    '.......kkk......',
    '.......yYy......',
    '......yYyYy.....',
    '.....yY.Y.yY....',
    '....yY..Y..yY...',
    '....Y...Y...Y...',
    '................',
  ], { y: '#dcb54a', Y: '#a8842a', z: '#f0d27a', k: '#6e5a1c' }],

  wheat_seeds: [[
    '................',
    '................',
    '................',
    '................',
    '.......qg.......',
    '.......gGD..qg..',
    '...qg...DD..gGD.',
    '...gGD.......DD.',
    '....DD..qg......',
    '........gGD.....',
    '..qg.....DD..qg.',
    '..gGD........gGD',
    '...DD..qg.....DD',
    '.......gGD......',
    '........DD......',
    '................',
  ], { q: '#a4e86a', g: '#6ecf40', G: '#3b9423', D: '#23601a' }],

  brick: [[
    '................',
    '................',
    '................',
    '................',
    '..........oooo..',
    '........oohhhlo.',
    '......oohhhlllo.',
    '....oohhhllllmo.',
    '..oohhlllllmmdo.',
    '.ohhllllllmmddo.',
    '.ollmmmmmmdddo..',
    '.odddddddddoo...',
    '..oooooooooo....',
    '................',
    '................',
    '................',
  ], { o: '#3a1508', d: '#7d2e18', m: '#a2432a', l: '#c05a3a', h: '#dc7b58' }],

  bowl: [[
    '................',
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '.oddddddddddddo.',
    '.ohhlllllllllmo.',
    '.ohlllllllllmmo.',
    '..ohllllllllmo..',
    '..olllllllmmdo..',
    '...olllmmmmdo...',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
  ], { o: '#2e1c0a', d: '#4d3214', l: '#8f6d36', m: '#6b4f22', h: '#b08a4f' }],

  arrow: [[
    '................',
    '............ooo.',
    '...........ohhlo',
    '..........ohhlmo',
    '...........olmmo',
    '..........tSomo.',
    '.........tS..o..',
    '........tS......',
    '.......tS.......',
    '......tS........',
    '...gwtSw........',
    '..gwtSwg........',
    '.gwtSwg.........',
    '..tSwg..........',
    '.tS.............',
    '................',
  ], { o: '#262626', h: '#d8d8d8', l: '#a0a0a0', m: '#6a6a6a', S: '#3a2710', t: '#8a6a34', w: '#f4f4f4', g: '#b4b4b4' }],

  apple: [[
    '................',
    '........s.......',
    '.......s..ggG...',
    '....ooosooGGo...',
    '..oowlrrsrroo...',
    '.owwlrrrrrrrro..',
    '.owlrrrrrrrrRo..',
    '.olrrrrrrrrrRRo.',
    '.orrrrrrrrrrRRo.',
    '.orrrrrrrrrRRRo.',
    '.oRrrrrrrrrRRRo.',
    '..oRrrrrrrRRRo..',
    '..oRRrrrRRRRDo..',
    '...oRRDoRRDDo...',
    '....ooo.oooo....',
    '................',
  ], { o: '#4a0707', r: '#d62727', R: '#a41616', D: '#7d0e0e', l: '#f25a4a', w: '#ffc4b8', s: '#5a3a1a', g: '#63b43b', G: '#2f7a1f' }],


  bread: [[
    '................',
    '................',
    '................',
    '..........ooo...',
    '........oohhlo..',
    '......oohhhhlmo.',
    '.....ohhclhhlmo.',
    '....ohlhhclhlmdo',
    '...ohhclhhclmmdo',
    '..ohlhhclhmmmdo.',
    '..ohhclhhmmmddo.',
    '.ohlhhclmmmddo..',
    '.olhhmmmmdddo...',
    '.oddmmmddddo....',
    '..ooooooooo.....',
    '................',
  ], { o: '#4a2a07', d: '#8a5214', m: '#b0701f', l: '#d0913a', h: '#e9b35a', c: '#f5d58f' }],

  porkchop: [[
    '................',
    '................',
    '................',
    '.....ooooo......',
    '...oofffffoo....',
    '..offpppppffoo..',
    '.ofpppPPppppffo.',
    '.ofppPppppppPfo.',
    '.ofpppppwwpppfo.',
    '.ofpppppwwwppfo.',
    '.offppPpppppffo.',
    '..offpppppPffo..',
    '...ooffffffoo...',
    '.....oooooo.....',
    '................',
    '................',
  ], { o: '#7a2a32', f: '#f6d0cf', p: '#f08a8e', P: '#d0626a', w: '#fbeaea' }],

  cooked_porkchop: [[
    '................',
    '................',
    '................',
    '.....ooooo......',
    '...ooffffffo....',
    '..offpppppffoo..',
    '.ofpppPPppppffo.',
    '.ofppPppppppPfo.',
    '.ofpppppwwpppfo.',
    '.ofpppppwwwppfo.',
    '.offppPpppppffo.',
    '..offpppppPffo..',
    '...ooffffffoo...',
    '.....oooooo.....',
    '................',
    '................',
  ], { o: '#3c1f0a', f: '#e4b87a', p: '#b37a3e', P: '#8a5426', w: '#f0d6a8' }],

  beef: [[
    '................',
    '................',
    '....oooo........',
    '...orrrroooo....',
    '..orrRrrrrrroo..',
    '.orrrrrwRrrrrro.',
    '.orRrrwwrrrRrro.',
    '.orrrrrrrrrrRro.',
    '.orrRrrrRrwrrro.',
    '.owrrrrrrwwrrro.',
    '.owwrrRrrrrrRro.',
    '..owwrrrrRrrrro.',
    '...owwwrrrrrro..',
    '....oowwwwwoo...',
    '......ooooo.....',
    '................',
  ], { o: '#4a0a0a', r: '#c0302a', R: '#8e1d1b', w: '#f1d9d6' }],

  cooked_beef: [[
    '................',
    '................',
    '....oooo........',
    '...ogggboooo....',
    '..oggbbbbbbboo..',
    '.oggbbbgbbbbbbo.',
    '.ogbbbggbbbbbBo.',
    '.obbbbbbbbbbBBo.',
    '.obbbbbbbbgbbBo.',
    '.owbbbbbbggbbBo.',
    '.owwbbbbbbbbBBo.',
    '..owwbbbbbbbBBo.',
    '...owwwbbbbBBo..',
    '....oowwwwwoo...',
    '......ooooo.....',
    '................',
  ], { o: '#2a1206', b: '#7a4122', B: '#56291a', g: '#9c5c35', w: '#d9b58a' }],

  chicken: [[
    '................',
    '................',
    '.......ooo......',
    '.....ooppPoo....',
    '....opppppPPo...',
    '...oppwppppPPo..',
    '...opwwpppppPo..',
    '...oppppppppPo..',
    '...opppppppPPo..',
    '....oppppppPo...',
    '.....oPpppPo....',
    '......oPPPwo....',
    '.......oowwwo...',
    '........owwwwo..',
    '.........oooo...',
    '................',
  ], { o: '#7a4a3c', p: '#f5c8b0', P: '#d99f86', w: '#fbf3e8' }],

  cooked_chicken: [[
    '................',
    '................',
    '.......ooo......',
    '.....ooppPoo....',
    '....opppppPPo...',
    '...oppwppppPPo..',
    '...opwwpppppPo..',
    '...oppppppppPo..',
    '...opppppppPPo..',
    '....oppppppPo...',
    '.....oPpppPo....',
    '......oPPPwo....',
    '.......oowwwo...',
    '........owwwwo..',
    '.........oooo...',
    '................',
  ], { o: '#4a260c', p: '#d09040', P: '#9c6224', w: '#f3e6cc' }],

  mutton: [[
    '................',
    '................',
    '................',
    '....oooooo......',
    '...orrrrrroo....',
    '..orrRrrrrrro...',
    '..orrrrrwrrRo...',
    '..orRrrrrrrrro..',
    '..orrrrrrrRrro..',
    '...orrrRrrrrroo.',
    '....orrrrrrroBBo',
    '.....ooooooooBBo',
    '..............o.',
    '................',
    '................',
    '................',
  ], { o: '#4a0a0a', r: '#c73b35', R: '#8e2320', w: '#f3dcd8', B: '#f4efe3' }],

  cooked_mutton: [[
    '................',
    '................',
    '................',
    '....oooooo......',
    '...orrrrrroo....',
    '..orrRrrrrrro...',
    '..orrrrrwrrRo...',
    '..orRrrrrrrrro..',
    '..orrrrrrrRrro..',
    '...orrrRrrrrroo.',
    '....orrrrrrroBBo',
    '.....ooooooooBBo',
    '..............o.',
    '................',
    '................',
    '................',
  ], { o: '#2a1206', r: '#8a4b27', R: '#5c2e17', w: '#c08a55', B: '#f4efe3' }],

  carrot: [[
    '................',
    '...........g.G..',
    '..........gGgG..',
    '.........ooggGG.',
    '........ohlogG..',
    '.......ohllmo...',
    '......ohllmdo...',
    '.....ohllmdo....',
    '....ohlmmdo.....',
    '....olmmdo......',
    '...olmmdo.......',
    '...olmdo........',
    '..omddo.........',
    '..oddo..........',
    '.ooo............',
    '................',
  ], { o: '#5a2604', d: '#b8520a', m: '#e27415', l: '#fb9a32', h: '#ffc26b', g: '#58b53a', G: '#2c7a1c' }],


  potato: [[
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....ohhllllo....',
    '...ohlllllllo...',
    '..ohllldllllmo..',
    '..ollllllllmmo..',
    '..olllllldlmmo..',
    '..ollldllllmmo..',
    '..olllllllmmdo..',
    '...ommmmmmmdo...',
    '....oodddddo....',
    '......ooooo.....',
    '................',
    '................',
  ], { o: '#5a3d14', d: '#a8803a', m: '#c9a35a', l: '#dfc07a', h: '#f0dca0' }],

  baked_potato: [[
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....ohhwwllo....',
    '...ohlwwwlllo...',
    '..ohllwwwwllmo..',
    '..olllwwwwlmmo..',
    '..ollllwwllmmo..',
    '..ollldllllmmo..',
    '..olllllllmmdo..',
    '...ommmmmmmdo...',
    '....oodddddo....',
    '......ooooo.....',
    '................',
    '................',
  ], { o: '#4a2a06', d: '#94591c', m: '#b87a2e', l: '#d49c48', h: '#e8bd6a', w: '#fcefb4' }],

  poisonous_potato: [[
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....ohhllllo....',
    '...ohllgllllo...',
    '..ohllldllgllo..',
    '..olglllllllmo..',
    '..olllllgdlmmo..',
    '..ollldllllmmo..',
    '..olllglllmmdo..',
    '...ommmmmmmdo...',
    '....oodddddo....',
    '......ooooo.....',
    '................',
    '................',
  ], { o: '#3e4a14', d: '#8a9a3a', m: '#aabb52', l: '#c7d270', h: '#e2e89c', g: '#6f8f1c' }],

  cookie: [[
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....ohhllllo....',
    '...ohlcllcllo...',
    '..ohlllllllmmo..',
    '..olclllcllmmo..',
    '..olllllllcmmo..',
    '..ollcllllmmmo..',
    '..olllllcmmmdo..',
    '...ommcmmmmdo...',
    '....oodddddo....',
    '......ooooo.....',
    '................',
    '................',
  ], { o: '#4a2408', d: '#9b5a1e', m: '#bd7a34', l: '#d6974a', h: '#e8b36a', c: '#3a1a08' }],

  melon_slice: [[
    '................',
    '................',
    '................',
    '................',
    '.gggggggggggggg.',
    '.GwwwwwwwwwwwwG.',
    '..GrrrkrrrrkrG..',
    '..GrrrrrrrrrrG..',
    '...GrrkrrkrrG...',
    '...GrrrrrrrrG...',
    '....GrrrkrrG....',
    '.....GrrrrG.....',
    '......GrrG......',
    '.......GG.......',
    '................',
    '................',
  ], { g: '#3e7a1c', G: '#23501a', w: '#d4e87a', r: '#e2322e', k: '#2a0d0d' }],

  pumpkin_pie: [[
    '................',
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '...oocccccccoo..',
    '..occfffffffcco.',
    '.ocfffhfffffffco',
    '.ocfffffffhfffco',
    '.occfffffffffcco',
    '.oocccccccccccoo',
    '.odcccccccccccdo',
    '..oddddddddddoo.',
    '....ooooooooo...',
    '................',
    '................',
  ], { o: '#3e1f06', c: '#d8a45e', d: '#a8702c', f: '#e27a18', h: '#f5a346' }],

  mushroom_stew: [[
    '................',
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '.osskSsssksSsso.',
    '.osSsskksssSsSo.',
    '.ohhlllllllllmo.',
    '.ohlllllllllmmo.',
    '..ohllllllllmo..',
    '..olllllllmmdo..',
    '...olllmmmmdo...',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
  ], { o: '#2e1c0a', l: '#8f6d36', m: '#6b4f22', h: '#b08a4f', d: '#4d3214', s: '#c79a68', S: '#a47348', k: '#efdcb8' }],

  sweet_berries: [[
    '................',
    '................',
    '.........gG.....',
    '........gGG.....',
    '.......oogo.....',
    '....oooorRoooo..',
    '...orrRorRorrRo.',
    '..orwrRRoRorwrRo',
    '..orrRRRoorrRRo.',
    '...oRRoorrRooo..',
    '....ooorwrRo....',
    '......orrRRo....',
    '.......oRRo.....',
    '........oo......',
    '................',
    '................',
  ], { o: '#3a0710', r: '#c82040', R: '#861228', w: '#ff9aa8', g: '#4f8f2a', G: '#2c5e19' }],

  cod: [[
    '................',
    '................',
    '................',
    '................',
    '..oo............',
    '.oTTo..ooooooo..',
    '.oTtToobbbbbbbo.',
    '..oTtbbbbbbbbkbo',
    '..oTtbbbbbbbbbbo',
    '..oTtwwwwwwwwwwo',
    '.oTtoowwwwwwwwo.',
    '.oTTo.oooooooo..',
    '..oo............',
    '................',
    '................',
    '................',
  ], { o: '#3a2c1c', b: '#b39a70', T: '#9a8058', t: '#c7b08a', w: '#e8dcc0', k: '#111111' }],

  cooked_cod: [[
    '................',
    '................',
    '................',
    '................',
    '..oo............',
    '.oTTo..ooooooo..',
    '.oTtToobbbbbbbo.',
    '..oTtbbbbbbbbkbo',
    '..oTtbbbbbbbbbbo',
    '..oTtwwwwwwwwwwo',
    '.oTtoowwwwwwwwo.',
    '.oTTo.oooooooo..',
    '..oo............',
    '................',
    '................',
    '................',
  ], { o: '#2e1a08', b: '#9a6430', T: '#7a4a1e', t: '#b07a40', w: '#e2c490', k: '#111111' }],

};

// ---------------------------------------------------------------------------------------------
// item builders
// ---------------------------------------------------------------------------------------------
function fromSprite(name, key = name, pal) {
  const [rows, p] = SPRITES[key];
  return art(name, rows, pal ?? p);
}

function buildItems() {
  const T = new Map();
  const put = (name, c) => T.set(name, c);

  // ---- tools ----
  for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
    for (const type of ['sword', 'shovel', 'pickaxe', 'axe', 'hoe']) put(`${mat}_${type}`, toolTexture(mat, type));
  }
  // ---- armor ----
  for (const mat of ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite']) {
    for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) put(`${mat}_${piece}`, armorTexture(mat, piece));
  }
  put('turtle_helmet', armorTexture('turtle', 'helmet'));

  // ---- simple hand drawn sprites ----
  for (const k of ['stick', 'coal', 'charcoal', 'diamond', 'emerald', 'lapis_lazuli', 'flint', 'feather', 'string', 'bone',
    'leather', 'paper', 'book', 'wheat', 'wheat_seeds', 'brick', 'bowl', 'arrow', 'apple', 'bread', 'porkchop', 'cooked_porkchop',
    'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'carrot', 'potato', 'baked_potato',
    'poisonous_potato', 'cookie', 'melon_slice', 'pumpkin_pie', 'mushroom_stew', 'sweet_berries', 'cod', 'cooked_cod']) {
    put(k, fromSprite(k));
  }

  // raw ores / ingots / nuggets share shapes
  put('raw_iron', fromSprite('raw_iron', 'raw_ore', { o: '#4a3326', d: '#9c7a62', m: '#bf9d82', l: '#d8bca0', h: '#efdcc6' }));
  put('raw_gold', fromSprite('raw_gold', 'raw_ore', { o: '#6a3905', d: '#c27a0c', m: '#e5a923', l: '#f7d148', h: '#fff29c' }));
  put('raw_copper', fromSprite('raw_copper', 'raw_ore', { o: '#4a200c', d: '#9a4a24', m: '#c2683c', l: '#dd8958', h: '#f2b18a' }));
  put('iron_ingot', fromSprite('iron_ingot', 'ingot', MAT.iron));
  put('gold_ingot', fromSprite('gold_ingot', 'ingot', MAT.golden));
  put('copper_ingot', fromSprite('copper_ingot', 'ingot', { o: '#4a1f0c', d: '#a4502a', m: '#c96b3e', l: '#e58f5f', h: '#f8b894' }));
  put('netherite_ingot', fromSprite('netherite_ingot', 'ingot', { o: '#0f0b0d', d: '#2b2427', m: '#443a3e', l: '#5f5458', h: '#857a7e' }));
  put('iron_nugget', fromSprite('iron_nugget', 'nugget', MAT.iron));
  put('gold_nugget', fromSprite('gold_nugget', 'nugget', MAT.golden));

  // dust piles
  put('redstone', dustPile('redstone', ['#5c0000', '#8a0000', '#b80a0a', '#e01818', '#ff4a3a'], '#2a0000'));
  put('glowstone_dust', dustPile('glowstone_dust', ['#8a5a14', '#c08a2a', '#e8b445', '#fbd66a', '#fff2a8'], '#4a2e08'));
  put('gunpowder', dustPile('gunpowder', ['#3a3a3a', '#555555', '#6e6e6e', '#8a8a8a', '#a8a8a8'], '#1c1c1c'));
  put('sugar', dustPile('sugar', ['#c8c8d0', '#dcdce4', '#ececf2', '#f8f8fc', '#ffffff'], '#8a8a96', { grains: true }));
  put('bone_meal', dustPile('bone_meal', ['#b8b4a4', '#cfcbbb', '#e2dfd2', '#f1efe6', '#ffffff'], '#6e6a5c'));

  // round things
  put('snowball', shadedBlob(circle(7.5, 8, 5.6), ['#6f8a9e', '#b9d0e0', '#dbe9f3', '#f4f9fd', '#ffffff'], { cy: 8, r: 5.6 }));
  put('slime_ball', slimeBall());
  put('ender_pearl', enderPearl());
  put('clay_ball', clayBall());
  put('egg', egg());
  put('spider_eye', spiderEye());
  put('rotten_flesh', rottenFlesh());

  // golden variants
  put('golden_apple', goldenApple());
  put('golden_carrot', goldenCarrot());

  // dyes
  const DYES = {
    green_dye: ['#1f3a07', '#3f5c12', '#5e7c16', '#7c9e25', '#a3c24a'],
    red_dye: ['#4a0c0a', '#8a1c18', '#b02e26', '#d4463c', '#ee7a6e'],
    yellow_dye: ['#6a4a06', '#c89a1c', '#fed83d', '#ffe873', '#fff6b8'],
    white_dye: ['#6e7474', '#bcc4c4', '#e4eaea', '#f9fffe', '#ffffff'],
    black_dye: ['#050506', '#141417', '#1d1d21', '#2e2e34', '#4a4a52'],
    blue_dye: ['#101450', '#252c86', '#3c44aa', '#5a63cc', '#8a92ea'],
  };
  for (const [n, ramp] of Object.entries(DYES)) put(n, dye(ramp));

  // misc tools and gear
  put('shears', shears());
  put('flint_and_steel', flintAndSteel());
  put('bow', bow(0));
  put('bow_pulling_0', bow(1));
  put('bow_pulling_1', bow(2));
  put('bow_pulling_2', bow(3));
  put('crossbow_standby', crossbow(0));
  put('crossbow', crossbow(0));
  put('crossbow_pulling_0', crossbow(1));
  put('crossbow_pulling_1', crossbow(2));
  put('crossbow_pulling_2', crossbow(3));
  put('crossbow_arrow', crossbow(4));
  put('shield', shield());
  put('fishing_rod', fishingRod());
  put('bucket', bucket(null));
  put('water_bucket', bucket('water'));
  put('lava_bucket', bucket('lava'));
  put('milk_bucket', bucket('milk'));
  put('compass', compass());
  put('clock', clock());

  // misc
  put('experience_bottle', experienceBottle());
  put('name_tag', nameTag());
  put('saddle', saddle());
  put('lead', lead());
  put('map', mapItem());
  put('ender_eye', enderEye());
  put('totem_of_undying', totem());

  // block items with flat sprites
  put('oak_door', oakDoor());
  put('red_bed', redBed());

  // ghost icons for empty equipment slots
  for (const [n, c] of Object.entries(emptySlotIcons())) put(n, c);

  return T;
}

// ---------------------------------------------------------------------------------------------
// individual drawings that need a bit of code
// ---------------------------------------------------------------------------------------------
function slimeBall() {
  const c = shadedBlob(circle(7.5, 8, 5.4), ['#2f6b25', '#5ab046', '#76cc5c', '#98e27c', '#c8f7b0'], { cy: 8, r: 5.4, spec: false });
  // darker inner core suggesting translucency
  for (const [x, y] of [[8, 9], [9, 9], [8, 10], [9, 8], [7, 9], [9, 10]]) c.set(x, y, '#4c9a3a');
  c.set(5, 5, '#ffffff'); c.set(6, 5, '#e2fbd4'); c.set(5, 6, '#e2fbd4');
  return c;
}

function enderPearl() {
  const c = shadedBlob(circle(7.5, 7.5, 5.5), ['#062a24', '#0b4d42', '#137060', '#2a9a7f', '#58c7a6'], { r: 5.5, spec: false });
  // swirl
  for (const [x, y] of [[7, 6], [8, 6], [9, 7], [9, 8], [8, 9], [7, 9], [6, 8], [6, 7]]) c.set(x, y, '#1e8a70');
  c.set(7, 7, '#0b4d42'); c.set(8, 8, '#0b4d42'); c.set(7, 8, '#062a24'); c.set(8, 7, '#0f5a4c');
  c.set(5, 4, '#b8f5e0'); c.set(4, 5, '#7fdcc0'); c.set(5, 5, '#7fdcc0');
  return c;
}

function clayBall() {
  const rows = [
    '................',
    '................',
    '................',
    '......oooo......',
    '....oohhllo.....',
    '...ohhllllmoo...',
    '..ohllllllmmmo..',
    '..ohllllmmmmmo..',
    '..olllmmmmmmdo..',
    '..ollmmmmmmddo..',
    '..olmmmmmmdddo..',
    '...ommmmmdddo...',
    '....ooddddoo....',
    '......oooo......',
    '................',
    '................',
  ];
  return art('clay_ball', rows, { o: '#4a5058', d: '#7e8794', m: '#9aa3b0', l: '#b3bcc8', h: '#cfd6de' });
}

function egg() {
  const c = shadedBlob((x, y) => {
    const cy = y < 8 ? 8 : 8;
    const ry = y < 8 ? 6 : 5.2;
    const rx = y < 8 ? 4.2 + (y - 2) * 0.12 : 4.8;
    return ((x - 7.5) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  }, ['#7a6448', '#c9b08a', '#e2cda8', '#f2e4c8', '#fdf6e6'], { cx: 7.5, cy: 8, r: 5.5 });
  const rnd = seeded('egg-speckle');
  for (let i = 0; i < 7; i++) {
    const x = 5 + Math.floor(rnd() * 6), y = 5 + Math.floor(rnd() * 8);
    const p = c.get(x, y);
    if (p[3] && !(p[0] === 0x7a)) c.set(x, y, '#b89a6e');
  }
  return c;
}

function spiderEye() {
  const rows = [
    '................',
    '................',
    '................',
    '.....oooooo.....',
    '....orrrrrRo....',
    '...orwrrrrrRo...',
    '..orwwrrprrRRo..',
    '..orrrrpkprRRo..',
    '..orrrprkkpRRo..',
    '..orrrrppprRRo..',
    '..oRrrrrrrRRDo..',
    '...oRRrrrRRDo...',
    '....ooRRRDoo....',
    '......oooo......',
    '................',
    '................',
  ];
  return art('spider_eye', rows, { o: '#3a0612', r: '#b22a48', R: '#841a33', D: '#5c1024', w: '#f6a2b6', p: '#6e1830', k: '#1a0208' });
}

function rottenFlesh() {
  const rows = [
    '................',
    '................',
    '.........ooo....',
    '......oooggbo...',
    '.....obbgGgbbo..',
    '....obbbbgbbBo..',
    '...obrbbbbbbBo..',
    '..obbrrbbgbBo...',
    '..obbbbbGgbBo...',
    '.obbgbbbbbBo....',
    '.obggbbrbbBo....',
    '.obbbbbbbBo.....',
    '..obwbbbBBo.....',
    '...owwwBBo......',
    '....oooo........',
    '................',
  ];
  return art('rotten_flesh', rows, { o: '#2e1a0c', b: '#9a5f3a', B: '#6e3f22', g: '#7f9c3a', G: '#56701f', r: '#b8453a', w: '#d6ab80' });
}

function goldenApple() {
  const c = fromSprite('golden_apple', 'apple', {
    o: '#6a3a02', r: '#f2c21c', R: '#d09010', D: '#a86808', l: '#fce35a', w: '#fffbd0', s: '#5a3a1a', g: '#63b43b', G: '#2f7a1f',
  });
  return c;
}

function goldenCarrot() {
  return fromSprite('golden_carrot', 'carrot', {
    o: '#6a3a02', d: '#c7800f', m: '#eab126', l: '#fbe052', h: '#fffbb4', g: '#e8c030', G: '#b08010',
  });
}

function dye(ramp) {
  const rows = [
    '................',
    '................',
    '................',
    '.......oo.......',
    '......ohlo......',
    '.....ohllmo.....',
    '....ohllmmdo....',
    '...ohhlmmmmdo...',
    '...ohlmmmmmdo...',
    '..ohllmmmmmmdo..',
    '..ohlmmmmmmmdo..',
    '..olmmmmmmmddo..',
    '...odmmmmmddo...',
    '....oodddddo....',
    '......oooo......',
    '................',
  ];
  const [o, d, m, l, h] = ramp;
  return art('dye', rows, { o, d, m, l, h });
}

function shears() {
  const rows = [
    '................',
    '.........oo.....',
    '........ohlo....',
    '.......ohlooo...',
    '......ohloohlo..',
    '.....ohloohlo...',
    '....ohloohlo....',
    '...ohlrrhlo.....',
    '..oooRrooo......',
    '.ohdo.odho......',
    '.odo...odo......',
    '.odo...odo......',
    '.ohdo.odho......',
    '..ohdoodo.......',
    '...oooo.........',
    '................',
  ];
  return art('shears', rows, { o: '#2a2a2a', h: '#ffffff', l: '#b8b8b8', d: '#7a7a7a', r: '#5a5a5a', R: '#1e1e1e' });
}

function flintAndSteel() {
  const rows = [
    '................',
    '................',
    '..oooooo........',
    '.ohhhhhlo.......',
    '.ohoooolmo......',
    '.olo...omo......',
    '.olo...ooo......',
    '.olo............',
    '.omo.....ooo....',
    '.omo....onnfoo..',
    '.odo...onnfffo..',
    '..oo..onffffFo..',
    '......offfFFFo..',
    '......ofFFFFo...',
    '.......ooooo....',
    '................',
  ];
  return art('flint_and_steel', rows, { o: '#1c1c1c', h: '#f4f4f4', l: '#c0c0c0', m: '#8e8e8e', d: '#5e5e5e', n: '#707070', f: '#4a4a4a', F: '#2e2e2e' });
}

// Bow: limb bulges to the upper-right, string from the top-left tip to the bottom-right tip.
// stage 0 = idle, 1..3 = pulling frames (arrow nocked and drawn further back each frame).
function bow(stage) {
  const c = canvas();
  const limb = [
    '................',
    '.....SSS........',
    '....SttsSS......',
    '.....SSttsS.....',
    '.......SStsS....',
    '.........StsS...',
    '.........SttsS..',
    '..........StsS..',
    '..........StsS..',
    '..........StsS..',
    '..........SttS..',
    '...........SsS..',
    '...........SsS..',
    '............S...',
    '................',
    '................',
  ];
  art('bow', limb, { S: '#2c1d0b', t: '#a07c3e', s: '#684d1f' }, c);
  const str = '#dcdcdc';
  const A = [5, 3], B = [12, 12];
  if (stage === 0) { c.line(A[0], A[1], B[0], B[1], str); return c; }
  // nock point pulled back towards the bottom-left along the x+y=16 axis
  const N = [[7, 9], [6, 10], [5, 11]][stage - 1];
  c.line(A[0], A[1], N[0], N[1], str);
  c.line(N[0], N[1], B[0], B[1], str);
  // arrow along x+y=16 with a fixed length, so the head moves back with the string
  const len = 7;
  const T = [N[0] + len, N[1] - len];
  for (let i = 1; i < len - 1; i++) {
    c.set(N[0] + i, N[1] - i, '#8a6a34');
    c.set(N[0] + i + 1, N[1] - i, '#3a2710'); // dark underside
  }
  // head
  c.set(T[0], T[1], '#e0e0e0'); c.set(T[0] - 1, T[1], '#a8a8a8'); c.set(T[0], T[1] + 1, '#a8a8a8');
  c.set(T[0] - 1, T[1] + 1, '#6a6a6a'); c.set(T[0] + 1, T[1] - 1, '#262626');
  c.set(T[0] - 2, T[1], '#262626'); c.set(T[0], T[1] + 2, '#262626');
  // fletching
  c.set(N[0], N[1], '#f4f4f4'); c.set(N[0] - 1, N[1], '#b4b4b4'); c.set(N[0], N[1] + 1, '#b4b4b4');
  c.set(N[0] + 1, N[1] - 1, '#f4f4f4'); c.set(N[0], N[1] - 1, '#f4f4f4'); c.set(N[0] + 1, N[1], '#f4f4f4');
  return c;
}

// Crossbow: stock along the diagonal, prod (limb) arching over its front end.
// stage 0 = standby, 1..3 = pulling (string drawn back), 4 = loaded with an arrow.
function crossbow(stage) {
  const c = canvas();
  const rows = [
    '................',
    '....ooo.........',
    '....oiLoo.......',
    '.....ooLLoo.....',
    '.......ooLLo....',
    '.........oLLo...',
    '........SSSoLo..',
    '.......StsSoLo..',
    '......StgsS.oLo.',
    '.....StggS..oLo.',
    '....StsS....oio.',
    '...StsS......o..',
    '..StsS..........',
    '.StsS...........',
    '.SSS............',
    '................',
  ];
  art('crossbow', rows, { S: '#2c1d0b', t: '#9a773a', s: '#684d1f', g: '#8e8e8e', o: '#241708', L: '#7a5a2a', i: '#a8a8a8' }, c);
  const str = '#dcdcdc';
  const A = [5, 3], B = [13, 11];
  if (stage === 0) { c.line(A[0], A[1], B[0], B[1], str); return c; }
  const N = [[8, 8], [7, 9], [6, 10], [6, 10]][stage - 1];
  c.line(A[0], A[1], N[0], N[1], str);
  c.line(N[0], N[1], B[0], B[1], str);
  if (stage === 4) {
    // loaded bolt lying along the stock, head poking out past the prod
    for (let x = N[0] + 1, y = N[1] - 1; x <= 12; x++, y--) { c.set(x, y, '#8a6a34'); }
    c.set(13, 2, '#e0e0e0'); c.set(12, 2, '#a8a8a8'); c.set(13, 3, '#a8a8a8'); c.set(14, 1, '#262626');
    c.set(11, 2, '#262626'); c.set(13, 4, '#262626');
  }
  return c;
}

function shield() {
  const rows = [
    '................',
    '..oooooooooooo..',
    '..oiiiiiiiiiio..',
    '..oiwwwwwwwwio..',
    '..oiwWwwwWwwio..',
    '..oiwwwwwwwwio..',
    '..oiwwwIIwwwio..',
    '..oiwWwIIwWwio..',
    '..oiwwwwwwwwio..',
    '..oiwwwwwwwwio..',
    '..oiwWwwwWwwio..',
    '...oiwwwwwwio...',
    '...oiiwwwwiio...',
    '....ooiiiioo....',
    '......oooo......',
    '................',
  ];
  const c = art('shield', rows, { o: '#2a2a2a', i: '#8e8e8e', I: '#c4c4c4', w: '#9a773a', W: '#7a5a2a' });
  // plank seams
  for (let y = 3; y < 13; y++) { if (c.get(6, y)[3]) c.blend(6, y, '#5a3f18', 0.35); if (c.get(10, y)[3]) c.blend(10, y, '#5a3f18', 0.35); }
  return c;
}

function fishingRod() {
  const rows = [
    '................',
    '............SS..',
    '...........SttSl',
    '..........StsS.l',
    '.........StsS..l',
    '........StsS...l',
    '.......StsS....l',
    '......StsS.....l',
    '.....StsS......l',
    '....StsS.......l',
    '...StsS........l',
    '..SggS.........l',
    '.SggS........llg',
    '.SSS.........g.g',
    '..............g.',
    '................',
  ];
  return art('fishing_rod', rows, { S: '#2c1d0b', t: '#9a773a', s: '#684d1f', g: '#8a8a8a', l: '#d8d8d8' });
}

function bucket(kind) {
  const rows = [
    '................',
    '................',
    '................',
    '..oooooooooooo..',
    '.ohhlllllllllmo.',
    '.olFFFFFFFFFFmo.',
    '.olfffffffffflo.',
    '..ohlllllllmmo..',
    '..ohllllllmmdo..',
    '..olllllllmmdo..',
    '...ohllllmmdo...',
    '...olllllmmdo...',
    '...ollllmmddo...',
    '....oddddddo....',
    '.....oooooo.....',
    '................',
  ];
  const inside = {
    null: { F: '#3a3a3a', f: '#4d4d4d' },
    water: { F: '#2a4fd0', f: '#3f76e4' },
    lava: { F: '#e05a0a', f: '#ffb020' },
    milk: { F: '#e6e6e6', f: '#ffffff' },
  }[kind];
  const c = art(`bucket_${kind}`, rows, { o: '#2b2b2b', h: '#ffffff', l: '#d0d0d0', m: '#a6a6a6', d: '#707070', ...inside });
  if (kind === 'lava') { c.set(4, 6, '#ffe070'); c.set(9, 6, '#ffe070'); c.set(7, 5, '#ff8a10'); }
  if (kind === 'water') { c.set(4, 6, '#7fa6f5'); c.set(10, 6, '#7fa6f5'); }
  return c;
}

function compass() {
  const rows = [
    '................',
    '................',
    '.....oooooo.....',
    '....oiIIIIio....',
    '...oiIddddIio...',
    '..oiIddddrddio..',
    '..oIdddrrdddIo..',
    '..oIdddwrdddIo..',
    '..oIddgwddddIo..',
    '..oIdggddddIio..',
    '..oiIddddddIio..',
    '...oiIIddIIio...',
    '....oiiiiiio....',
    '.....oooooo.....',
    '................',
    '................',
  ];
  return art('compass', rows, { o: '#232323', i: '#6e6e6e', I: '#a6a6a6', d: '#3c3c46', r: '#e02020', w: '#f8f8f8', g: '#9a9a9a' });
}

function clock() {
  const rows = [
    '................',
    '................',
    '.....oooooo.....',
    '....oGggggGo....',
    '...oGbbbbbbGo...',
    '..oGbbbyybbbGo..',
    '..ogbbyYYybbgo..',
    '..ogbbbyybbbgo..',
    '..oGGGGGGGGGGo..',
    '..ogkkkkkkkkgo..',
    '..oGkkswkkkkGo..',
    '...oGkkkkkkGo...',
    '....oGggggGo....',
    '.....oooooo.....',
    '................',
    '................',
  ];
  return art('clock', rows, { o: '#4a2c04', g: '#f2c21c', G: '#c08a10', b: '#4a8ae8', y: '#ffe060', Y: '#fff6c0', k: '#101838', s: '#c8c8ff', w: '#ffffff' });
}

function experienceBottle() {
  const rows = [
    '................',
    '................',
    '......oooo......',
    '......obbo......',
    '......oooo......',
    '.......oo.......',
    '......oggo......',
    '....ooglggoo....',
    '...oggGlGgggo...',
    '..oggGGyGGgggo..',
    '..ogGGyYyGGggo..',
    '..ogGGGyGGGggo..',
    '..oggGGGGGgggo..',
    '...ogggggggo....',
    '....ooooooo.....',
    '................',
  ];
  const c = art('experience_bottle', rows, { o: '#3a3a4a', b: '#8a5a2e', g: '#b6e7ee', l: '#ffffff', G: '#9be05a', y: '#e6ff7a', Y: '#ffffff' });
  // fix row 13 asymmetry
  c.set(12, 13, '#3a3a4a');
  return c;
}

function nameTag() {
  const rows = [
    '................',
    '................',
    '................',
    '..ss............',
    '.s..s...........',
    '.s...ooooooooo..',
    '..s.oTTTTTTTTTo.',
    '...soTttttttTTo.',
    '....oTTTTTTTTTo.',
    '....oTttttTTTTo.',
    '....oTTTTTTTTdo.',
    '.....oddddddddo.',
    '......oooooooo..',
    '................',
    '................',
    '................',
  ];
  return art('name_tag', rows, { o: '#3a2a14', T: '#e2cf9a', t: '#b8a472', d: '#b09a60', s: '#c8c8c8' });
}

function saddle() {
  const rows = [
    '................',
    '................',
    '................',
    '.....oo....oo...',
    '....ohlo..olmo..',
    '...ohllloolmmdo.',
    '..ohlllllllmmdo.',
    '..olllllllmmmdo.',
    '..odddmmmmmmddo.',
    '...ooodddddddo..',
    '.....ooooooo....',
    '......i....i....',
    '......i....i....',
    '.....iIi..iIi...',
    '.....iii..iii...',
    '................',
  ];
  return art('saddle', rows, { o: '#2e1608', d: '#6a3414', m: '#8a4a22', l: '#a86232', h: '#c47e4c', i: '#5a5a5a', I: '#a8a8a8' });
}

function lead() {
  const rows = [
    '................',
    '................',
    '......oooo......',
    '....ooRrrRoo....',
    '...oRro..orRo...',
    '..oRo......oro..',
    '..oro......oRo..',
    '..oRo......oro..',
    '..orRo....oRro..',
    '...oRrooooRro...',
    '....ooRrrRooo...',
    '......oooorRo...',
    '..........oRro..',
    '...........oRo..',
    '............o...',
    '................',
  ];
  return art('lead', rows, { o: '#3a2a14', r: '#c9a86a', R: '#8f7444' });
}

function mapItem() {
  const rows = [
    '................',
    '................',
    '..oooooooooooo..',
    '..opppppppppPo..',
    '..opglpppbbpPo..',
    '..opggllpbbbPo..',
    '..oppglllpbpPo..',
    '..opppgllppppo..',
    '..opbppglllppo..',
    '..opbbppggllpo..',
    '..opbbbpppglPo..',
    '..opppppppppPo..',
    '..oPPPPPPPPPPo..',
    '..oooooooooooo..',
    '................',
    '................',
  ];
  return art('map', rows, { o: '#5a4a2a', p: '#e9dcb4', P: '#c8b88a', g: '#8ab45a', l: '#6e9a44', b: '#8aaed8' });
}

function enderEye() {
  const c = shadedBlob(circle(7.5, 7.5, 5.5), ['#10301e', '#1e6a3a', '#2e9a52', '#5cc873', '#a8f0a0'], { r: 5.5, spec: false });
  // cat-like slit pupil
  for (let y = 5; y <= 10; y++) c.set(7, y, '#0a1a0f');
  c.set(8, 6, '#0a1a0f'); c.set(8, 9, '#0a1a0f'); c.set(8, 7, '#0a1a0f'); c.set(8, 8, '#0a1a0f');
  c.set(6, 7, '#e8ff9a'); c.set(9, 7, '#e8ff9a');
  c.set(5, 4, '#e0ffe0'); c.set(4, 5, '#bff5c0');
  return c;
}

function totem() {
  const rows = [
    '................',
    '......oooo......',
    '.....ohhlmo.....',
    '.....ogklgo.....',
    '.....ohlllo.....',
    '..ooooommooooo..',
    '.ohhlllllllllmo.',
    '.oddooolmmoooddo',
    '..oo..olmmo..oo.',
    '......ollmo.....',
    '.....ohllmmo....',
    '.....olggmmo....',
    '.....olmmmmo....',
    '......olmmo.....',
    '.......oo.......',
    '................',
  ];
  return art('totem_of_undying', rows, { o: '#5a3200', d: '#c07a10', m: '#e6ac22', l: '#f8d850', h: '#fff4a8', g: '#2fb85a', k: '#0e4a22' });
}

function oakDoor() {
  const rows = [
    '....oooooooo....',
    '....ohhhhhlo....',
    '....o..hl..o....',
    '....o..hl..o....',
    '....o..hl..o....',
    '....ohhhllmo....',
    '....oddddddo....',
    '....ohllmmdo....',
    '....ohlllmio....',
    '....ohllmmdo....',
    '....oddddddo....',
    '....ohllmmdo....',
    '....ohlllmdo....',
    '....ohllmmdo....',
    '....oddddddo....',
    '....oooooooo....',
  ];
  return art('oak_door', rows, { o: '#3a2810', d: '#6b4f22', m: '#8f6d36', l: '#b08a4f', h: '#caa466', i: '#5a5a5a' });
}

function redBed() {
  const rows = [
    '................',
    '................',
    '................',
    '................',
    '................',
    '.oooooo.........',
    '.owwwwwoooooooo.',
    '.owwwwWrrrrrrro.',
    '.oWWWWWrrrrrrro.',
    '.ooooooRRRRRRRo.',
    '.obbbbbbbbbbbbo.',
    '.oBoooooooooBBo.',
    '.oBo.......oBo..',
    '.ooo.......ooo..',
    '................',
    '................',
  ];
  return art('red_bed', rows, { o: '#2a0a08', w: '#f2f2f2', W: '#c8c8c8', r: '#b8231c', R: '#861610', b: '#9a773a', B: '#684d1f' });
}

function emptySlotIcons() {
  // faint light-gray silhouettes drawn at partial alpha, like the vanilla ghost icons
  const fill = [255, 255, 255, 58], edge = [55, 55, 55, 120];
  const mk = (name, rows) => art(name, rows, { '#': fill, e: edge });
  return {
    empty_armor_slot_helmet: mk('empty_armor_slot_helmet', [
      '................',
      '................',
      '................',
      '....eeeeeeee....',
      '...e########e...',
      '..e##########e..',
      '..e##########e..',
      '..e###eeee###e..',
      '..e##e....e##e..',
      '..e##e....e##e..',
      '..eeee....eeee..',
      '................',
      '................',
      '................',
      '................',
      '................',
    ]),
    empty_armor_slot_chestplate: mk('empty_armor_slot_chestplate', [
      '................',
      '..eee......eee..',
      '.e###e....e###e.',
      '.e####eeee####e.',
      '.e############e.',
      '.eee########eee.',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...eeeeeeeeee...',
      '................',
      '................',
    ]),
    empty_armor_slot_leggings: mk('empty_armor_slot_leggings', [
      '................',
      '................',
      '...eeeeeeeeee...',
      '...e########e...',
      '...e########e...',
      '...e########e...',
      '...e###ee###e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...e###e.e##e...',
      '...eeeee.eeee...',
      '................',
    ]),
    empty_armor_slot_boots: mk('empty_armor_slot_boots', [
      '................',
      '................',
      '................',
      '................',
      '................',
      '................',
      '..eeee....eeee..',
      '..e##e....e##e..',
      '..e##e....e##e..',
      '..e##e....e##e..',
      '..e##e....e##e..',
      '.e###e...e###e..',
      'e####e..e####e..',
      'e#####e.e#####e.',
      'eeeeeee.eeeeeee.',
      '................',
    ]),
    empty_armor_slot_shield: mk('empty_armor_slot_shield', [
      '................',
      '..eeeeeeeeeeee..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '..e##########e..',
      '...e########e...',
      '...ee######ee...',
      '....eee##eee....',
      '......eeee......',
      '................',
    ]),
  };
}

// ---------------------------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------------------------
let cache = null;
export function generateItemTextures() {
  if (!cache) {
    const m = buildItems();
    cache = new Map();
    for (const [k, c] of m) cache.set(k, c.data);
  }
  // hand out copies so callers can't corrupt the cache
  const out = new Map();
  for (const [k, v] of cache) out.set(k, new Uint8ClampedArray(v));
  return out;
}

// Material colour ramps (o/d/m/l/h), e.g. for tinting related sprites elsewhere.
export const ITEM_MATERIAL_RAMPS = MAT;
