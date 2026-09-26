// Original skins for six mobs: mottled palettes with simple faces of our own design,
// shaded lighter at the top of each texel row band like the rest of the entity art.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function paint(tex, rect, palette, r) {
  const [x0, y0, x1, y1] = rect ?? [0, 0, tex.w, tex.h];
  for (let y = y0; y < Math.min(y1, tex.h); y++) for (let x = x0; x < Math.min(x1, tex.w); x++) {
    const c = palette[Math.floor(r() * palette.length)];
    const i = (y * tex.w + x) * 4;
    tex.data[i] = c[0]; tex.data[i + 1] = c[1]; tex.data[i + 2] = c[2]; tex.data[i + 3] = 255;
  }
}
function px(tex, pts, c) { for (const [x, y] of pts) { const i = (y * tex.w + x) * 4; tex.data[i] = c[0]; tex.data[i + 1] = c[1]; tex.data[i + 2] = c[2]; tex.data[i + 3] = 255; } }
const row = (y, xa, xb) => { const o = []; for (let x = xa; x <= xb; x++) o.push([x, y]); return o; };

const SKINS = {
  creeper(t, r) { // mossy plant-golem: amber slit eyes, zig-zag mouth
    paint(t, null, [[62, 110, 48], [74, 124, 56], [52, 94, 42], [88, 72, 44], [80, 136, 60]], r);
    px(t, [...row(10, 9, 10), ...row(10, 13, 14)], [255, 190, 60]);
    px(t, [[9, 13], [10, 14], [11, 13], [12, 14], [13, 13], [14, 14]], [40, 30, 20]);
  },
  zombie(t, r) { // sallow undead villager in an ochre tunic
    paint(t, null, [[118, 132, 104], [108, 122, 96], [126, 138, 110]], r);
    paint(t, [16, 16, 40, 32], [[170, 130, 50], [156, 118, 44], [182, 142, 60]], r);
    paint(t, [0, 16, 16, 32], [[66, 54, 44], [58, 48, 40]], r);
    paint(t, [16, 48, 32, 64], [[66, 54, 44], [58, 48, 40]], r);
    paint(t, [0, 0, 32, 8], [[50, 44, 36], [60, 52, 40]], r);
    px(t, [[9, 11], [10, 11], [13, 11], [14, 11]], [40, 36, 34]);
    px(t, [[10, 11], [13, 11]], [220, 220, 200]);
    px(t, row(14, 10, 13), [70, 60, 56]);
  },
  enderman(t, r) { // midnight-teal stalker with a single visor band
    paint(t, null, [[18, 40, 46], [22, 46, 52], [16, 34, 40], [22, 46, 52], [150, 200, 210]], r);
    px(t, row(12, 8, 15), [150, 245, 255]);
    px(t, [[11, 12], [12, 12]], [230, 255, 255]);
  },
  ghast(t, r, shooting) { // ash-lavender jelly with one cyclops eye
    paint(t, null, [[196, 184, 208], [184, 172, 198], [206, 196, 216]], r);
    if (shooting) {
      for (let y = 19; y <= 24; y++) px(t, row(y, 21, 26), [250, 250, 245]);
      px(t, [[23, 21], [24, 21], [23, 22], [24, 22]], [255, 140, 40]);
      for (let y = 27; y <= 30; y++) px(t, row(y, 22, 25), [70, 20, 30]);
    } else px(t, [...row(22, 20, 27), [19, 21], [28, 21]], [90, 76, 110]);
  },
  blaze(t, r) { // charcoal ember mask with white slit eyes
    paint(t, null, [[48, 42, 40], [60, 50, 46], [230, 110, 30], [40, 36, 34]], r);
    paint(t, [0, 16, 8, 26], [[220, 96, 30], [200, 80, 26], [90, 40, 20]], r);
    px(t, [...row(11, 9, 10), ...row(11, 13, 14)], [255, 250, 210]);
  },
  zombified_piglin(t, r) { // grey-mauve boar-man, one milky eye, bronze trim
    paint(t, null, [[150, 118, 128], [138, 108, 118], [160, 128, 136]], r);
    paint(t, [16, 16, 40, 32], [[150, 118, 128], [60, 44, 38], [140, 110, 120]], r);
    px(t, row(26, 16, 39), [170, 110, 60]);
    px(t, [[10, 11], [16, 11]], [235, 235, 225]);
    px(t, [[11, 11], [15, 11]], [30, 24, 26]);
  },
};

// Villager: a hooded traveller in a rust-coloured robe with a cream sash (our own design).
SKINS.villager = (t, r) => {
  const HOOD = [[46, 82, 58], [40, 74, 52], [52, 90, 64]];
  const ROBE = [[150, 74, 44], [140, 68, 40], [160, 82, 50]];
  const SKIN = [[214, 168, 128], [206, 160, 120]];
  paint(t, [0, 0, 32, 16], HOOD, r);                       // head: hood everywhere
  paint(t, [9, 10, 15, 16], SKIN, r);                      // face opening
  px(t, [[10, 12], [13, 12]], [46, 34, 28]);               // eyes
  px(t, [[10, 11], [13, 11]], [120, 90, 70]);              // brows in hood shadow
  px(t, row(14, 11, 12), [150, 100, 84]);                  // mouth
  px(t, row(10, 9, 14), [120, 92, 70]);                    // hood shadow on the forehead
  paint(t, [16, 16, 40, 32], ROBE, r);                     // body
  px(t, [...row(26, 16, 39)], [230, 214, 170]);            // sash
  px(t, [[23, 26], [24, 26]], [200, 160, 60]);             // clasp
  paint(t, [40, 16, 56, 32], ROBE, r);                     // right arm
  paint(t, [32, 48, 48, 64], ROBE, r);                     // left arm
  for (const [x0, y0] of [[40, 16], [32, 48]]) {
    px(t, row(y0 + 12, x0, x0 + 15), [230, 214, 170]);     // cuffs
    for (const y of [y0 + 14, y0 + 15]) px(t, row(y, x0, x0 + 15), SKIN[0]); // hands
  }
  for (const [x0, y0] of [[0, 16], [16, 48]]) {           // legs: robe hem, trousers, boots
    paint(t, [x0, y0, x0 + 16, y0 + 16], ROBE, r);
    paint(t, [x0, y0 + 10, x0 + 16, y0 + 13], [[70, 58, 50], [64, 52, 46]], r);
    paint(t, [x0, y0 + 13, x0 + 16, y0 + 16], [[58, 40, 28], [50, 34, 24]], r);
  }
};

export function drawOriginalSkin(name, tex, shooting = false) {
  SKINS[name](tex, rng(name.length * 7919 + (shooting ? 5 : 0)), shooting);
}
