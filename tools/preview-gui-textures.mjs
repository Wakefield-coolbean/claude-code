// Verifies and previews item textures, GUI sprites, the bitmap font and the title logo.
// Usage: node tools/preview-gui-textures.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';
import { contactSheet, writePNG } from './png.mjs';
import { collectItemTextureNames } from '../src/registry/items.js';
import { generateItemTextures, ITEM_TEXTURE_WARNINGS } from '../src/textures/itemTextures.js';
import { generateGuiTextures, GUI_SPRITE_SIZES } from '../src/textures/guiTextures.js';
import { FONT, renderText, renderTitleLogo } from '../src/textures/font.js';

const OUT = process.argv[2] ?? '/tmp/claude-0/-home-user-claude-code/1054d6a7-65b9-540d-9b00-48ba961164e3/scratchpad/gui';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const fail = (msg) => errors.push(msg);

// composite an RGBA image over a solid color (so sprites are judged the way they appear in a slot)
function onBg(img, bg = [139, 139, 139]) {
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < data.length; i += 4) {
    const a = img.data[i + 3] / 255;
    for (let k = 0; k < 3; k++) data[i + k] = img.data[i + k] * a + bg[k] * (1 - a);
    data[i + 3] = 255;
  }
  return { w: img.w, h: img.h, data };
}

// simple RGBA image helpers -------------------------------------------------------------------
function image(w, h, fill = [0, 0, 0, 0]) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { w, h, data };
}
// alpha-composite src onto dst at (dx,dy) scaled by s (nearest neighbour)
function blit(dst, src, dx, dy, s = 1, sx = 0, sy = 0, sw = src.w, sh = src.h) {
  for (let y = 0; y < sh * s; y++) for (let x = 0; x < sw * s; x++) {
    const X = dx + x, Y = dy + y;
    if (X < 0 || Y < 0 || X >= dst.w || Y >= dst.h) continue;
    const si = ((sy + Math.floor(y / s)) * src.w + sx + Math.floor(x / s)) * 4;
    const a = src.data[si + 3] / 255;
    if (!a) continue;
    const di = (Y * dst.w + X) * 4;
    for (let k = 0; k < 3; k++) dst.data[di + k] = src.data[si + k] * a + dst.data[di + k] * (1 - a);
    dst.data[di + 3] = Math.max(dst.data[di + 3], src.data[si + 3]);
  }
}
// shelf-pack images (scaled) into one sheet
function packSheet(list, { scale = 4, maxW = 1400, pad = 8, bg = [40, 40, 48, 255] } = {}) {
  let x = pad, y = pad, rowH = 0; const pos = [];
  for (const img of list) {
    const w = img.w * scale, h = img.h * scale;
    if (x + w + pad > maxW && x > pad) { x = pad; y += rowH + pad; rowH = 0; }
    pos.push([x, y]); x += w + pad; rowH = Math.max(rowH, h);
  }
  const out = image(maxW, y + rowH + pad, bg);
  list.forEach((img, i) => {
    const [px, py] = pos[i];
    // checkerboard behind each sprite so transparency is visible
    for (let yy = 0; yy < img.h * scale; yy++) for (let xx = 0; xx < img.w * scale; xx++) {
      const v = ((xx >> 3) + (yy >> 3)) & 1 ? 96 : 72; const di = ((py + yy) * out.w + px + xx) * 4;
      out.data[di] = v; out.data[di + 1] = v; out.data[di + 2] = v + 8;
    }
    blit(out, img, px, py, scale);
  });
  return out;
}

// ---------------- items ----------------
const items = generateItemTextures();
const names = collectItemTextureNames();
for (const w of ITEM_TEXTURE_WARNINGS) fail(`item warning: ${w}`);
for (const n of names) {
  const d = items.get(n);
  if (!d) { fail(`missing item texture: ${n}`); continue; }
  if (!(d instanceof Uint8ClampedArray) || d.length !== 16 * 16 * 4) fail(`item texture ${n} is not 16x16 RGBA (${d?.length})`);
  let opaque = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) opaque++;
  if (opaque < 6) fail(`item texture ${n} is (nearly) empty`);
}
const ordered = [...names, ...[...items.keys()].filter((k) => !names.includes(k))];
const itemImgs = ordered.filter((n) => items.has(n)).map((n) => ({ w: 16, h: 16, data: items.get(n) }));
const sheet = contactSheet(itemImgs, { cols: 12, scale: 4, pad: 4 });
writePNG(path.join(OUT, 'items.png'), sheet.w, sheet.h, sheet.data);
// larger per-group sheets for close inspection
const groups = {};
ordered.forEach((n, i) => { const g = Math.floor(i / 24); (groups[g] ??= []).push(n); });
for (const [g, list] of Object.entries(groups)) {
  const s = contactSheet(list.map((n) => onBg({ w: 16, h: 16, data: items.get(n) })), { cols: 6, scale: 8, pad: 6 });
  writePNG(path.join(OUT, `items_${g}.png`), s.w, s.h, s.data);
  console.log(`items_${g}.png: ${list.join(' ')}`);
}
console.log(`items: ${names.length} required, ${items.size} generated`);

// ---------------- GUI sprites ----------------
const gui = generateGuiTextures();
for (const [n, [w, h]] of Object.entries(GUI_SPRITE_SIZES)) {
  const g = gui.get(n);
  if (!g) { fail(`missing gui sprite: ${n}`); continue; }
  if (g.w !== w || g.h !== h) fail(`gui sprite ${n} is ${g.w}x${g.h}, expected ${w}x${h}`);
  if (g.data.length !== g.w * g.h * 4) fail(`gui sprite ${n} has wrong data length`);
}
const small = [...gui.entries()].filter(([, g]) => g.w <= 32 && g.h <= 32).map(([, g]) => g);
const wide = [...gui.entries()].filter(([, g]) => g.w > 32 || g.h > 32).map(([, g]) => g);
const gs = packSheet(small, { scale: 6, maxW: 1400 });
writePNG(path.join(OUT, 'gui_small.png'), gs.w, gs.h, gs.data);
const gw = packSheet(wide, { scale: 3, maxW: 1300 });
writePNG(path.join(OUT, 'gui_wide.png'), gw.w, gw.h, gw.data);
console.log(`gui: ${gui.size} sprites (${Object.keys(GUI_SPRITE_SIZES).length} required): ${[...gui.keys()].join(' ')}`);

// HUD mock-up: a survival HUD over a sky/grass backdrop, rendered at 3x
{
  const W = 260, H = 110, S = 3;
  const scene = image(W, H, [120, 167, 255, 255]);
  for (let y = 60; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4; const v = ((x * 7 + y * 13) % 5) * 4;
    scene.data.set(y < 64 ? [95 + v, 159, 53, 255] : [134 - v, 96, 67, 255], i);
  }
  const G = (n) => gui.get(n);
  const cx = Math.floor(W / 2);
  blit(scene, G('crosshair'), cx - 7, 30 - 7);
  blit(scene, G('crosshair_attack_indicator_background'), cx - 8, 30 + 9);
  const prog = G('crosshair_attack_indicator_progress');
  blit(scene, prog, cx - 8, 30 + 9, 1, 0, 0, 10, 4);
  const hbX = cx - 91, hbY = H - 22;
  blit(scene, G('hotbar'), hbX, hbY);
  blit(scene, G('hotbar_selection'), hbX - 1 + 20 * 2, hbY - 1);
  blit(scene, G('hotbar_offhand_left'), hbX - 29, hbY - 1);
  const hot = ['diamond_sword', 'iron_pickaxe', 'stone_axe', 'bread', 'cooked_beef', 'torch_missing', 'bow', 'water_bucket', 'golden_apple'];
  hot.forEach((n, i) => { const d = items.get(n); if (d) blit(scene, { w: 16, h: 16, data: d }, hbX + 3 + i * 20, hbY + 3); });
  blit(scene, { w: 16, h: 16, data: items.get('shield') }, hbX - 26, hbY + 3);
  blit(scene, G('hotbar_attack_indicator_background'), hbX + 182 + 6, hbY + 2);
  blit(scene, G('hotbar_attack_indicator_progress'), hbX + 182 + 6, hbY + 2 + 8, 1, 0, 8, 18, 10);
  const xpY = hbY - 7;
  blit(scene, G('experience_bar_background'), hbX, xpY);
  blit(scene, G('experience_bar_progress'), hbX, xpY, 1, 0, 0, 120, 5);
  const rowY = xpY - 10;
  for (let i = 0; i < 10; i++) {
    const x = hbX + i * 8;
    blit(scene, G(i === 9 ? 'heart_container_blinking' : 'heart_container'), x, rowY);
    if (i < 6) blit(scene, G('heart_full'), x, rowY); else if (i === 6) blit(scene, G('heart_half'), x, rowY);
    const fx = hbX + 182 - 9 - i * 8;
    blit(scene, G('food_empty'), fx, rowY);
    if (i < 7) blit(scene, G('food_full'), fx, rowY); else if (i === 7) blit(scene, G('food_half'), fx, rowY);
    blit(scene, G(i < 4 ? 'armor_full' : i === 4 ? 'armor_half' : 'armor_empty'), x, rowY - 10);
    blit(scene, G(i < 8 ? 'air' : 'air_bursting'), fx, rowY - 10);
  }
  // status variants row
  ['heart_poisoned_full', 'heart_withered_full', 'heart_absorbing_full', 'heart_frozen_full', 'heart_poisoned_half', 'heart_absorbing_half',
    'food_full_hunger', 'food_half_hunger', 'food_empty_hunger'].forEach((n, i) => {
    if (n.startsWith('heart')) blit(scene, G('heart_container'), 4 + i * 10, 4);
    blit(scene, G(n), 4 + i * 10, 4);
  });
  const big = image(W * S, H * S); blit(big, scene, 0, 0, S);
  writePNG(path.join(OUT, 'hud_mock.png'), big.w, big.h, big.data);
}

// Menu mock-up: dirt background, buttons, slider, text field, checkbox
{
  const W = 240, H = 150, S = 3;
  const scene = image(W, H, [0, 0, 0, 255]);
  const dirtTile = gui.get('options_background');
  for (let y = 0; y < H; y += 16) for (let x = 0; x < W; x += 16) blit(scene, dirtTile, x, y);
  for (let i = 0; i < scene.data.length; i += 4) for (let k = 0; k < 3; k++) scene.data[i + k] *= 0.25;
  const nine = (name, x, y, w, h) => { // 9-slice with 3px corners
    const g = gui.get(name), c = 3;
    const parts = [[0, c], [c, g.w - 2 * c], [g.w - c, c]], vparts = [[0, c], [c, g.h - 2 * c], [g.h - c, c]];
    const dx = [0, c, w - c], dw = [c, w - 2 * c, c], dy = [0, c, h - c], dh = [c, h - 2 * c, c];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      for (let yy = 0; yy < dh[j]; yy++) for (let xx = 0; xx < dw[i]; xx++) {
        const sx = parts[i][0] + (xx % parts[i][1]), sy = vparts[j][0] + (yy % vparts[j][1]);
        const si = (sy * g.w + sx) * 4; const di = ((y + dy[j] + yy) * W + x + dx[i] + xx) * 4;
        const a = g.data[si + 3] / 255;
        for (let k = 0; k < 3; k++) scene.data[di + k] = g.data[si + k] * a + scene.data[di + k] * (1 - a);
      }
    }
  };
  nine('button', 20, 10, 200, 20);
  nine('button_highlighted', 20, 34, 98, 20);
  nine('button_disabled', 122, 34, 98, 20);
  nine('slider', 20, 58, 150, 20);
  blit(scene, gui.get('slider_handle'), 70, 58);
  nine('slider', 174, 58, 46, 20);
  blit(scene, gui.get('slider_handle_highlighted'), 190, 58);
  nine('text_field', 20, 82, 150, 20);
  nine('text_field_highlighted', 20, 106, 150, 20);
  blit(scene, gui.get('checkbox'), 176, 82);
  blit(scene, gui.get('checkbox_selected'), 200, 82);
  blit(scene, gui.get('checkbox_highlighted'), 176, 106);
  blit(scene, gui.get('checkbox_selected_highlighted'), 200, 106);
  const big = image(W * S, H * S); blit(big, scene, 0, 0, S);
  writePNG(path.join(OUT, 'menu_mock.png'), big.w, big.h, big.data);
}

// Container mock-up: creative tabs, panel, slots, scroller, furnace progress widgets
{
  const W = 230, H = 120, S = 3;
  const scene = image(W, H, [30, 30, 36, 255]);
  const px = 10, py = 30, pw = 195, ph = 84;
  const tabs = ['inventory_tab', 'inventory_tab_selected', 'inventory_tab', 'inventory_tab'];
  // unselected tabs are drawn behind the panel, the selected one in front
  tabs.forEach((t, i) => { if (t === 'inventory_tab') blit(scene, gui.get(t), px + i * 29, py - 28); });
  const panel = image(pw, ph, [198, 198, 198, 255]);
  for (let x = 0; x < pw; x++) { panel.data.set([0, 0, 0, 255], x * 4); panel.data.set([0, 0, 0, 255], ((ph - 1) * pw + x) * 4); panel.data.set([255, 255, 255, 255], (pw + x) * 4); panel.data.set([85, 85, 85, 255], ((ph - 2) * pw + x) * 4); }
  for (let y = 0; y < ph; y++) { panel.data.set([0, 0, 0, 255], (y * pw) * 4); panel.data.set([0, 0, 0, 255], (y * pw + pw - 1) * 4); if (y > 0 && y < ph - 1) { panel.data.set([255, 255, 255, 255], (y * pw + 1) * 4); panel.data.set([85, 85, 85, 255], (y * pw + pw - 2) * 4); } }
  blit(scene, panel, px, py);
  tabs.forEach((t, i) => { if (t === 'inventory_tab_selected') blit(scene, gui.get(t), px + i * 29, py - 28); });
  // tab icons
  ['diamond_sword', 'golden_apple', 'iron_pickaxe', 'redstone'].forEach((n, i) => blit(scene, { w: 16, h: 16, data: items.get(n) }, px + i * 29 + 6, py - 28 + 9));
  // slots
  const slot = (x, y) => {
    const img = image(18, 18, [139, 139, 139, 255]);
    for (let k = 0; k < 17; k++) { img.data.set([55, 55, 55, 255], k * 4); img.data.set([55, 55, 55, 255], (k * 18) * 4); img.data.set([255, 255, 255, 255], (17 * 18 + k + 1) * 4); img.data.set([255, 255, 255, 255], ((k + 1) * 18 + 17) * 4); }
    blit(scene, img, x, y);
  };
  const show = ['iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'coal', 'redstone', 'lapis_lazuli', 'apple', 'bread',
    'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots', 'bow', 'arrow', 'shield', 'bucket', 'water_bucket'];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 9; c++) {
    slot(px + 8 + c * 18, py + 8 + r * 18);
    const n = show[r * 9 + c]; if (n) blit(scene, { w: 16, h: 16, data: items.get(n) }, px + 9 + c * 18, py + 9 + r * 18);
  }
  blit(scene, gui.get('scroller'), px + pw - 18, py + 8);
  blit(scene, gui.get('scroller_disabled'), px + pw - 18, py + 26);
  // furnace row
  slot(px + 8, py + 50); blit(scene, { w: 16, h: 16, data: items.get('raw_iron') }, px + 9, py + 51);
  blit(scene, gui.get('furnace_burn_empty'), px + 30, py + 52);
  blit(scene, gui.get('furnace_burn_progress'), px + 30, py + 52 + 5, 1, 0, 5, 14, 9);
  blit(scene, gui.get('furnace_arrow_empty'), px + 50, py + 51);
  blit(scene, gui.get('furnace_arrow_progress'), px + 50, py + 51, 1, 0, 0, 14, 17);
  slot(px + 80, py + 50); blit(scene, { w: 16, h: 16, data: items.get('iron_ingot') }, px + 81, py + 51);
  blit(scene, gui.get('recipe_book_button'), px + 104, py + 50);
  blit(scene, renderText('Inventory', { color: [64, 64, 64], shadow: false }), px + 110, py + 70);
  const big = image(W * S, H * S); blit(big, scene, 0, 0, S);
  writePNG(path.join(OUT, 'container_mock.png'), big.w, big.h, big.data);
}

// ---------------- font ----------------
if (FONT.cellHeight !== 8 || FONT.ascent !== 7) fail('FONT cellHeight/ascent must be 8/7');
const requiredChars = [];
for (let c = 32; c <= 126; c++) requiredChars.push(String.fromCharCode(c));
requiredChars.push('§', '°', '•', '→', '←', '✔', '✖', '█', '░');
for (const ch of requiredChars) if (!FONT.glyphs[ch]) fail(`font: missing glyph ${JSON.stringify(ch)}`);
for (const [ch, g] of Object.entries(FONT.glyphs)) {
  if (!Number.isInteger(g.width) || g.width < 1) fail(`font: glyph ${JSON.stringify(ch)} has bad width ${g.width}`);
  if (!Array.isArray(g.rows) || g.rows.length !== 8) { fail(`font: glyph ${JSON.stringify(ch)} has ${g.rows?.length} rows`); continue; }
  g.rows.forEach((r, i) => {
    if (r.length !== g.width) fail(`font: glyph ${JSON.stringify(ch)} row ${i} length ${r.length} != width ${g.width}`);
    if (/[^#.]/.test(r)) fail(`font: glyph ${JSON.stringify(ch)} row ${i} has invalid chars`);
  });
  if (ch !== ' ' && !g.rows.some((r) => r.includes('#'))) fail(`font: glyph ${JSON.stringify(ch)} is empty`);
  if (!'gjpqy,;_|'.includes(ch) && g.rows[7].includes('#') && !'█░'.includes(ch)) fail(`font: glyph ${JSON.stringify(ch)} uses descender row`);
}
if (FONT.glyphs[' '].width !== 3) fail('font: space must be 3 wide');
{
  const lines = [
    'The quick brown fox jumps over the lazy dog 0123456789 !?',
    'THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG',
    'Sphinx of black quartz, judge my vow; (a+b)=[c] {d} <e> @f #g $h %i ^j &k *l',
    'Singleplayer   Multiplayer   Options...   Quit Game',
    '§eMinecraft-like §aBlockCraft §c1.18 §9§lcolors§r: \'quotes\' "double" `tick` ~tilde | _under_',
    '§ ° • → ← ✔ ✖ █ ░   Hunger: 20/20   XP 30   Diamond Pickaxe',
    'jumpy quay: pygmy grip, jolly query (glyph)',
  ];
  const imgs = lines.map((l) => renderText(l));
  const W = Math.max(...imgs.map((i) => i.w)) + 8, H = imgs.length * 12 + 22, S = 4;
  const sheet = image(W, H, [58, 58, 64, 255]);
  // a dirt-ish strip + a light gui strip to judge contrast
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (y >= H - 14) sheet.data.set([198, 198, 198, 255], (y * W + x) * 4);
  imgs.forEach((img, i) => blit(sheet, img, 4, 4 + i * 12));
  blit(sheet, renderText('Inventory', { color: [64, 64, 64], shadow: false }), 4, H - 11);
  const big = image(W * S, H * S); blit(big, sheet, 0, 0, S);
  writePNG(path.join(OUT, 'font.png'), big.w, big.h, big.data);
  // all glyphs grid
  const all = Object.entries(FONT.glyphs).map(([ch]) => renderText(ch));
  const gsheet = packSheet(all, { scale: 8, maxW: 1400, pad: 10 });
  writePNG(path.join(OUT, 'font_glyphs.png'), gsheet.w, gsheet.h, gsheet.data);
}

// ---------------- logo ----------------
{
  const logo = renderTitleLogo('BLOCKCRAFT');
  if (!logo || !logo.w || !logo.h || logo.data.length !== logo.w * logo.h * 4) fail('logo: bad image');
  const logo2 = renderTitleLogo('ABCDEFGHIJKLM NOPQRSTUVWXYZ 0123456789!?');
  const W = Math.max(logo.w, logo2.w) + 8, H = logo.h + logo2.h + 12, S = 4;
  const sheet = image(W, H, [110, 150, 220, 255]);
  blit(sheet, logo, 4, 4); blit(sheet, logo2, 4, logo.h + 8);
  const big = image(W * S, H * S); blit(big, sheet, 0, 0, S);
  writePNG(path.join(OUT, 'logo.png'), big.w, big.h, big.data);
  console.log(`logo: BLOCKCRAFT -> ${logo.w}x${logo.h}`);
}

if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(`OK — previews written to ${OUT}`);
