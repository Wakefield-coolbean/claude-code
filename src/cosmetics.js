// Cosmetics: hats, visors (accessories worn over the glass), skins (outfits) and pets.
// Art is drawn in character units: feet at (0, 0), facing right, y down. The body spans
// x -0.37..0.39 and y -1.22 (top of the helmet) .. -0.24; the glass visor is centred near
// (0.26, -0.865); the backpack sits at x -0.53..-0.27, y -0.98..-0.42; legs hang from hips at
// y -0.3 (back leg x -0.16, front leg x 0.2), each 0.28 wide and 0.3 long.
// The helmet's dome is a circle of radius 0.38 around (0.01, -0.84).

export const HATS = [
  { id: 'none', name: 'None' },
  { id: 'cap', name: 'Ball Cap' },
  { id: 'beanie', name: 'Beanie' },
  { id: 'tophat', name: 'Top Hat' },
  { id: 'cowboy', name: 'Cowboy' },
  { id: 'chef', name: 'Chef' },
  { id: 'hardhat', name: 'Hard Hat' },
  { id: 'headphones', name: 'Headphones' },
  { id: 'flower', name: 'Daisy' },
  { id: 'party', name: 'Party Hat' },
  { id: 'crown', name: 'Crown' },
  { id: 'halo', name: 'Halo' },
  { id: 'horns', name: 'Horns' },
  { id: 'pirate', name: 'Pirate' },
  { id: 'police', name: 'Police Cap' },
  { id: 'wizard', name: 'Wizard' },
  { id: 'sprout', name: 'Sprout' },
  { id: 'egg', name: 'Fried Egg' },
  { id: 'bandana', name: 'Bandana' },
  { id: 'captain', name: 'Captain' },
  { id: 'viking', name: 'Viking' },
  { id: 'antenna', name: 'Antenna' },
  { id: 'bubble', name: 'Bubble' },
  { id: 'roll', name: 'Loo Roll' },
  { id: 'plunger', name: 'Plunger' },
  { id: 'cone', name: 'Traffic Cone' },
  { id: 'catears', name: 'Cat Ears' },
];
export const VISORS = [
  { id: 'none', name: 'None' },
  { id: 'shades', name: 'Shades' },
  { id: 'nerd', name: 'Specs' },
  { id: 'monocle', name: 'Monocle' },
  { id: 'eyepatch', name: 'Eye Patch' },
  { id: 'mustache', name: 'Mustache' },
  { id: 'goggles', name: 'Ski Goggles' },
  { id: 'hearts', name: 'Heart Shades' },
  { id: 'threed', name: '3D Glasses' },
];
export const SKINS = [
  { id: 'none', name: 'None' },
  { id: 'labcoat', name: 'Lab Coat' },
  { id: 'overalls', name: 'Mechanic' },
  { id: 'police', name: 'Police' },
  { id: 'suit', name: 'Suit' },
  { id: 'camo', name: 'Camo' },
  { id: 'scrubs', name: 'Scrubs' },
  { id: 'captain', name: 'Captain' },
  { id: 'hazmat', name: 'Hazmat' },
  { id: 'sweater', name: 'Sweater' },
  { id: 'astro', name: 'Astronaut' },
];
export const PETS = [
  { id: 'none', name: 'None' },
  { id: 'mini', name: 'Mini Crew' },
  { id: 'pup', name: 'Pup' },
  { id: 'bot', name: 'Robot' },
  { id: 'blob', name: 'Blob' },
  { id: 'hamster', name: 'Hamster' },
  { id: 'ufo', name: 'Saucer' },
  { id: 'crab', name: 'Crab' },
  { id: 'dino', name: 'Dino' },
];

export const PET_FRAMES = 8;

const pick = (list, id) => (list.some((it) => it.id === id) ? id : 'none');

/** A look from untrusted input: unknown ids become 'none'. */
export function cleanLook(look = {}) {
  return {
    hat: pick(HATS, look?.hat),
    visor: pick(VISORS, look?.visor),
    skin: pick(SKINS, look?.skin),
    pet: pick(PETS, look?.pet),
  };
}

/** A random look for a bot: usually a hat, sometimes a skin, visor or pet. */
export function randomLook(rng) {
  const any = (list, chance) => (list.length > 1 && rng() < chance ? list[1 + Math.floor(rng() * (list.length - 1))].id : 'none');
  return { hat: any(HATS, 0.8), visor: any(VISORS, 0.25), skin: any(SKINS, 0.4), pet: any(PETS, 0.2) };
}

// ---------- drawing helpers ----------

const INK = '#07090c';
const TAU = Math.PI * 2;
const LW = 0.06;

function finish(ctx, fill, lw = LW) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (lw) {
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}

function rr(ctx, x, y, w, h, r, fill, lw = LW) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  finish(ctx, fill, lw);
}

function disc(ctx, x, y, r, fill, lw = LW) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  finish(ctx, fill, lw);
}

function oval(ctx, x, y, rx, ry, fill, lw = LW, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  finish(ctx, fill, lw);
}

/** Filled polygon through flat [x0, y0, x1, y1, ...]. */
function poly(ctx, pts, fill, lw = LW) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  finish(ctx, fill, lw);
}

/** An outlined stroke: a dark line under a coloured one. */
function cord(ctx, draw, color, w) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  draw();
  ctx.strokeStyle = INK;
  ctx.lineWidth = w + LW * 1.6;
  ctx.stroke();
  draw();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function line(ctx, pts, color, w) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** Fill a path, shade it inside (clipped), then outline it: the crewmates' look. */
function shape(ctx, path, fill, shadeFn, lw = LW) {
  path();
  ctx.fillStyle = fill;
  ctx.fill();
  if (shadeFn) {
    ctx.save();
    path();
    ctx.clip();
    shadeFn();
    ctx.restore();
  }
  if (lw) {
    path();
    ctx.lineWidth = lw;
    ctx.strokeStyle = INK;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}

/** Several overlapping circles drawn as one puffy outline (outline pass, then fill pass). */
function puffs(ctx, circles, fill) {
  ctx.fillStyle = INK;
  for (const [x, y, r] of circles) {
    ctx.beginPath();
    ctx.arc(x, y, r + LW / 2 + 0.008, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = fill;
  for (const [x, y, r] of circles) {
    ctx.beginPath();
    ctx.arc(x, y, r - LW / 2 + 0.008, 0, TAU);
    ctx.fill();
  }
}

const shine = (ctx, x, y, rx, ry, rot = -0.35, a = 0.6) => oval(ctx, x, y, rx, ry, `rgba(255,255,255,${a})`, 0, rot);
const dark = (ctx, x, y, rx, ry, a = 0.22, rot = 0) => oval(ctx, x, y, rx, ry, `rgba(0,0,0,${a})`, 0, rot);

function star(ctx, x, y, r, fill, lw = 0.035, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const rad = i % 2 ? r * 0.45 : r;
    pts.push(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  poly(ctx, pts, fill, lw);
}

/** The helmet outline (for clipping straps to the head). */
function bodyClip(ctx) {
  ctx.beginPath();
  ctx.roundRect(-0.37, -1.22, 0.76, 0.98, [0.38, 0.38, 0.13, 0.13]);
  ctx.clip();
}

// ---------- hats ----------

/** A cap-shaped crown hugging the top of the helmet, from y `bottom` up to `top`. */
function crownPath(ctx, bottom, top, x0 = -0.35, x1 = 0.38) {
  return () => {
    const cx = (x0 + x1) / 2;
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    ctx.bezierCurveTo(x0 - 0.01, top + 0.04, cx - 0.2, top, cx, top);
    ctx.bezierCurveTo(cx + 0.2, top, x1 + 0.01, top + 0.04, x1, bottom);
    ctx.quadraticCurveTo(cx, bottom + 0.06, x0, bottom);
    ctx.closePath();
  };
}

const HAT_ART = {
  cap(ctx, layer) {
    if (layer !== 'front') return;
    shape(ctx, crownPath(ctx, -1.05, -1.36), '#d8372c', () => dark(ctx, -0.32, -1.12, 0.22, 0.3));
    line(ctx, [0.02, -1.35, 0.06, -1.2, 0.2, -1.07], 'rgba(0,0,0,0.35)', 0.025);
    shine(ctx, -0.11, -1.26, 0.1, 0.035);
    ctx.beginPath();
    ctx.moveTo(0.18, -1.08);
    ctx.quadraticCurveTo(0.5, -1.13, 0.7, -1.07);
    ctx.quadraticCurveTo(0.72, -1.02, 0.66, -1.01);
    ctx.quadraticCurveTo(0.42, -1.03, 0.2, -1.01);
    ctx.closePath();
    finish(ctx, '#a8231c');
    disc(ctx, 0.02, -1.37, 0.035, '#a8231c', 0.04);
  },

  beanie(ctx, layer) {
    if (layer !== 'front') return;
    shape(ctx, crownPath(ctx, -1.08, -1.42, -0.34, 0.37), '#2bb3a6', () => {
      dark(ctx, -0.3, -1.2, 0.2, 0.3);
      for (let x = -0.28; x < 0.36; x += 0.1) line(ctx, [x, -1.4, x + 0.02, -1.08], 'rgba(0,0,0,0.12)', 0.025);
    });
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.roundRect(-0.39, -1.16, 0.8, 0.15, 0.07);
      },
      '#1d8a80',
      () => {
        for (let x = -0.36; x < 0.42; x += 0.065) line(ctx, [x, -1.15, x, -1.02], 'rgba(0,0,0,0.2)', 0.02);
      },
    );
    puffs(
      ctx,
      [
        [0.0, -1.47, 0.08],
        [0.07, -1.5, 0.07],
        [-0.06, -1.51, 0.06],
        [0.02, -1.55, 0.06],
      ],
      '#f2f4f7',
    );
    shine(ctx, -0.12, -1.3, 0.08, 0.03);
  },

  tophat(ctx, layer) {
    if (layer !== 'front') return;
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.roundRect(-0.24, -1.68, 0.53, 0.56, [0.05, 0.05, 0.02, 0.02]);
      },
      '#26272d',
      () => {
        dark(ctx, -0.26, -1.4, 0.12, 0.4, 0.3);
        oval(ctx, -0.12, -1.48, 0.035, 0.16, 'rgba(255,255,255,0.18)', 0);
      },
    );
    rr(ctx, -0.24, -1.27, 0.53, 0.1, 0.02, '#b8322e', 0.05);
    oval(ctx, 0.03, -1.13, 0.44, 0.075, '#1b1c21');
    shine(ctx, 0.12, -1.6, 0.08, 0.025, 0, 0.25);
  },

  cowboy(ctx, layer) {
    if (layer !== 'front') return;
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-0.27, -1.12);
        ctx.quadraticCurveTo(-0.3, -1.4, -0.18, -1.47);
        ctx.quadraticCurveTo(-0.05, -1.5, 0.03, -1.42);
        ctx.quadraticCurveTo(0.12, -1.5, 0.24, -1.47);
        ctx.quadraticCurveTo(0.36, -1.4, 0.32, -1.12);
        ctx.closePath();
      },
      '#a8743f',
      () => dark(ctx, -0.26, -1.3, 0.14, 0.25, 0.25),
    );
    rr(ctx, -0.28, -1.22, 0.61, 0.08, 0.02, '#5a3a1f', 0.045);
    ctx.beginPath();
    ctx.moveTo(-0.64, -1.24);
    ctx.quadraticCurveTo(0.02, -1.03, 0.7, -1.26);
    ctx.quadraticCurveTo(0.72, -1.19, 0.64, -1.15);
    ctx.quadraticCurveTo(0.02, -0.96, -0.58, -1.15);
    ctx.quadraticCurveTo(-0.66, -1.18, -0.64, -1.24);
    ctx.closePath();
    finish(ctx, '#8f5f30');
    shine(ctx, -0.12, -1.4, 0.06, 0.025);
  },

  chef(ctx, layer) {
    if (layer !== 'front') return;
    puffs(
      ctx,
      [
        [-0.18, -1.43, 0.17],
        [0.05, -1.52, 0.2],
        [0.27, -1.42, 0.16],
        [0.04, -1.36, 0.18],
      ],
      '#f4f6f8',
    );
    dark(ctx, -0.22, -1.38, 0.1, 0.12, 0.1);
    shine(ctx, 0.0, -1.6, 0.08, 0.03, -0.2, 0.9);
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.roundRect(-0.3, -1.3, 0.64, 0.2, 0.04);
      },
      '#e7ebef',
      () => {
        dark(ctx, -0.32, -1.2, 0.12, 0.14, 0.12);
        for (let x = -0.18; x < 0.34; x += 0.16) line(ctx, [x, -1.28, x, -1.12], 'rgba(0,0,0,0.1)', 0.02);
      },
    );
  },

  hardhat(ctx, layer) {
    if (layer !== 'front') return;
    shape(ctx, crownPath(ctx, -1.1, -1.42, -0.33, 0.37), '#f2c230', () => {
      dark(ctx, -0.3, -1.2, 0.18, 0.3, 0.2);
      rr(ctx, -0.02, -1.44, 0.1, 0.34, 0.04, 'rgba(0,0,0,0.12)', 0);
    });
    shine(ctx, -0.14, -1.33, 0.08, 0.03);
    rr(ctx, -0.38, -1.15, 0.9, 0.08, 0.04, '#d9a514');
    rr(ctx, 0.24, -1.3, 0.11, 0.1, 0.03, '#3a3f48', 0.04);
    disc(ctx, 0.33, -1.25, 0.04, '#fff3b0', 0.035);
  },

  headphones(ctx, layer) {
    if (layer === 'back') {
      cord(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(0.3, -1.3);
          ctx.quadraticCurveTo(0.42, -1.2, 0.4, -1.08);
        },
        '#3a3f4a',
        0.08,
      );
      return;
    }
    cord(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-0.15, -1.02);
        ctx.bezierCurveTo(-0.22, -1.44, 0.24, -1.48, 0.3, -1.3);
      },
      '#3a3f4a',
      0.08,
    );
    rr(ctx, -0.27, -1.06, 0.24, 0.32, 0.1, '#3a3f4a');
    rr(ctx, -0.22, -1.01, 0.14, 0.22, 0.06, '#e8455a', 0.04);
    shine(ctx, -0.2, -0.99, 0.03, 0.05, 0, 0.5);
  },

  flower(ctx, layer) {
    if (layer !== 'front') return;
    line(ctx, [0.13, -1.18, 0.16, -1.36], INK, 0.06);
    line(ctx, [0.13, -1.18, 0.16, -1.36], '#4f9a3a', 0.03);
    oval(ctx, 0.07, -1.27, 0.07, 0.03, '#5cb847', 0.035, 0.6);
    const cx = 0.17;
    const cy = -1.45;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * TAU;
      oval(ctx, cx + Math.cos(a) * 0.09, cy + Math.sin(a) * 0.09, 0.075, 0.04, '#ffffff', 0.035, a);
    }
    disc(ctx, cx, cy, 0.06, '#f5c542', 0.04);
    disc(ctx, cx - 0.015, cy - 0.015, 0.018, 'rgba(255,255,255,0.7)', 0);
  },

  party(ctx, layer) {
    if (layer !== 'front') return;
    ctx.save();
    ctx.translate(0.04, -1.16);
    ctx.rotate(0.18);
    const cone = () => {
      ctx.beginPath();
      ctx.moveTo(-0.22, 0);
      ctx.lineTo(-0.02, -0.56);
      ctx.quadraticCurveTo(0, -0.6, 0.02, -0.56);
      ctx.lineTo(0.22, 0);
      ctx.quadraticCurveTo(0, 0.05, -0.22, 0);
      ctx.closePath();
    };
    shape(ctx, cone, '#ff5fa2', () => {
      for (let i = -3; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(-0.4, -0.06 - i * 0.12);
        ctx.lineTo(0.4, -0.2 - i * 0.12);
        ctx.lineTo(0.4, -0.26 - i * 0.12);
        ctx.lineTo(-0.4, -0.12 - i * 0.12);
        ctx.fillStyle = '#4fd1e8';
        ctx.fill();
      }
      dark(ctx, -0.2, -0.2, 0.08, 0.4, 0.2);
    });
    puffs(
      ctx,
      [
        [0, -0.6, 0.06],
        [0.05, -0.62, 0.05],
        [-0.04, -0.64, 0.05],
      ],
      '#f5d90a',
    );
    ctx.restore();
  },

  crown(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.3, -1.1);
      ctx.lineTo(-0.33, -1.42);
      ctx.lineTo(-0.17, -1.28);
      ctx.lineTo(-0.06, -1.48);
      ctx.lineTo(0.05, -1.29);
      ctx.lineTo(0.17, -1.5);
      ctx.lineTo(0.26, -1.29);
      ctx.lineTo(0.38, -1.43);
      ctx.lineTo(0.35, -1.1);
      ctx.quadraticCurveTo(0.02, -1.05, -0.3, -1.1);
      ctx.closePath();
    };
    shape(ctx, path, '#f5c542', () => {
      dark(ctx, -0.3, -1.25, 0.12, 0.3, 0.2);
      ctx.fillStyle = '#d9a12b';
      ctx.fillRect(-0.4, -1.18, 0.8, 0.1);
    });
    for (const [x, y] of [
      [-0.33, -1.44],
      [-0.06, -1.5],
      [0.17, -1.52],
      [0.38, -1.45],
    ])
      disc(ctx, x, y, 0.03, '#fff3b0', 0.03);
    oval(ctx, 0.03, -1.15, 0.05, 0.035, '#e0344a', 0.03);
    oval(ctx, -0.17, -1.14, 0.035, 0.03, '#3f7fe0', 0.03);
    oval(ctx, 0.22, -1.14, 0.035, 0.03, '#3fbf6a', 0.03);
    shine(ctx, 0.08, -1.36, 0.025, 0.06, 0.4, 0.5);
  },

  halo(ctx, layer) {
    const ring = () => {
      ctx.beginPath();
      ctx.ellipse(0.02, -1.5, 0.27, 0.07, 0, layer === 'back' ? Math.PI : 0, layer === 'back' ? TAU : Math.PI);
    };
    ring();
    ctx.strokeStyle = 'rgba(255,236,140,0.35)';
    ctx.lineWidth = 0.16;
    ctx.stroke();
    cord(ctx, ring, '#ffe066', 0.055);
  },

  horns(ctx, layer) {
    if (layer !== 'front') return;
    const horn = (bx, by, tx, ty) => {
      shape(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(bx - 0.08, by);
          ctx.quadraticCurveTo(bx - 0.08, by - 0.2, tx, ty);
          ctx.quadraticCurveTo(bx + 0.06, by - 0.14, bx + 0.08, by);
          ctx.quadraticCurveTo(bx, by + 0.03, bx - 0.08, by);
          ctx.closePath();
        },
        '#d8322f',
        () => dark(ctx, bx - 0.08, by - 0.1, 0.05, 0.16, 0.25),
      );
      shine(ctx, bx + 0.01, by - 0.12, 0.015, 0.05, 0.2, 0.5);
    };
    horn(-0.16, -1.12, -0.24, -1.44);
    horn(0.2, -1.12, 0.3, -1.46);
  },

  pirate(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.52, -1.1);
      ctx.quadraticCurveTo(-0.48, -1.46, -0.16, -1.42);
      ctx.quadraticCurveTo(0.03, -1.6, 0.2, -1.42);
      ctx.quadraticCurveTo(0.52, -1.46, 0.58, -1.1);
      ctx.quadraticCurveTo(0.03, -1.22, -0.52, -1.1);
      ctx.closePath();
    };
    shape(ctx, path, '#26262c', () => {
      dark(ctx, -0.4, -1.25, 0.16, 0.2, 0.3);
      ctx.beginPath();
      ctx.moveTo(-0.52, -1.1);
      ctx.quadraticCurveTo(0.03, -1.22, 0.58, -1.1);
      ctx.strokeStyle = '#e0b445';
      ctx.lineWidth = 0.06;
      ctx.stroke();
    });
    disc(ctx, 0.03, -1.36, 0.065, '#f3efe2', 0.035);
    disc(ctx, 0.01, -1.37, 0.014, INK, 0);
    disc(ctx, 0.05, -1.37, 0.014, INK, 0);
    line(ctx, [-0.06, -1.27, 0.12, -1.21], '#f3efe2', 0.03);
    line(ctx, [-0.06, -1.21, 0.12, -1.27], '#f3efe2', 0.03);
  },

  police(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.3, -1.1);
      ctx.lineTo(-0.38, -1.33);
      ctx.quadraticCurveTo(0.02, -1.44, 0.44, -1.35);
      ctx.lineTo(0.35, -1.1);
      ctx.closePath();
    };
    shape(ctx, path, '#22356a', () => dark(ctx, -0.34, -1.25, 0.12, 0.2, 0.25));
    rr(ctx, -0.31, -1.2, 0.67, 0.1, 0.02, '#17181d', 0.045);
    line(ctx, [-0.25, -1.17, 0.32, -1.17], '#e0b445', 0.022);
    star(ctx, 0.08, -1.3, 0.065, '#f5c542');
    ctx.beginPath();
    ctx.moveTo(0.26, -1.1);
    ctx.quadraticCurveTo(0.5, -1.13, 0.64, -1.06);
    ctx.quadraticCurveTo(0.6, -1.02, 0.5, -1.02);
    ctx.quadraticCurveTo(0.38, -1.03, 0.26, -1.02);
    ctx.closePath();
    finish(ctx, '#17181d');
    shine(ctx, 0.46, -1.08, 0.06, 0.012, -0.1, 0.4);
  },

  wizard(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.27, -1.14);
      ctx.quadraticCurveTo(-0.08, -1.58, -0.4, -1.88);
      ctx.quadraticCurveTo(0.12, -1.72, 0.32, -1.14);
      ctx.closePath();
    };
    shape(ctx, path, '#5b3fb8', () => dark(ctx, -0.22, -1.4, 0.12, 0.3, 0.25));
    star(ctx, 0.08, -1.36, 0.06, '#f5d90a');
    star(ctx, -0.08, -1.6, 0.04, '#f5d90a');
    disc(ctx, 0.17, -1.22, 0.02, '#f5d90a', 0);
    disc(ctx, -0.15, -1.25, 0.018, '#f5d90a', 0);
    oval(ctx, 0.03, -1.13, 0.43, 0.075, '#4a2f9a');
    disc(ctx, -0.4, -1.88, 0.045, '#f5d90a', 0.035);
  },

  sprout(ctx, layer) {
    if (layer !== 'front') return;
    line(ctx, [0.02, -1.2, 0.0, -1.32, 0.03, -1.42], INK, 0.065);
    line(ctx, [0.02, -1.2, 0.0, -1.32, 0.03, -1.42], '#4f9a3a', 0.035);
    const leaf = (x, y, rot) => {
      oval(ctx, x, y, 0.12, 0.055, '#6cc04a', LW, rot);
      line(
        ctx,
        [x - Math.cos(rot) * 0.09, y - Math.sin(rot) * 0.09, x + Math.cos(rot) * 0.08, y + Math.sin(rot) * 0.08],
        'rgba(0,0,0,0.2)',
        0.018,
      );
    };
    leaf(-0.09, -1.46, 0.45);
    leaf(0.14, -1.49, -0.45);
  },

  egg(ctx, layer) {
    if (layer !== 'front') return;
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const wob = 1 + 0.12 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 5);
      const x = 0.0 + Math.cos(a) * 0.36 * wob;
      const y = -1.24 + Math.sin(a) * 0.09 * wob;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    finish(ctx, '#fbfbf5');
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0.05, -1.31, 0.13, 0.1, 0, 0, TAU);
      },
      '#ffb21a',
      () => dark(ctx, 0.0, -1.24, 0.1, 0.05, 0.15),
    );
    shine(ctx, 0.01, -1.35, 0.04, 0.02, -0.3, 0.85);
  },

  bandana(ctx, layer) {
    if (layer === 'back') {
      for (const [ty, tx] of [
        [-0.9, -0.62],
        [-1.16, -0.64],
      ]) {
        ctx.beginPath();
        ctx.moveTo(-0.34, -1.06);
        ctx.quadraticCurveTo(-0.5, -1.04 + (ty + 1.04) * 0.3, tx, ty);
        ctx.lineTo(tx + 0.06, ty + 0.07);
        ctx.quadraticCurveTo(-0.46, -1.0, -0.32, -0.98);
        ctx.closePath();
        finish(ctx, '#c42f2f');
      }
      return;
    }
    shape(ctx, crownPath(ctx, -1.02, -1.3, -0.36, 0.38), '#d93b3b', () => {
      dark(ctx, -0.3, -1.15, 0.2, 0.2, 0.2);
      for (const [x, y] of [
        [-0.2, -1.2],
        [0.0, -1.24],
        [0.2, -1.2],
        [-0.08, -1.1],
        [0.12, -1.1],
        [0.3, -1.1],
        [-0.28, -1.08],
      ])
        disc(ctx, x, y, 0.025, '#ffffff', 0);
    });
    disc(ctx, -0.35, -1.05, 0.055, '#c42f2f', 0.045);
  },

  captain(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.3, -1.1);
      ctx.lineTo(-0.39, -1.3);
      ctx.quadraticCurveTo(0.02, -1.45, 0.45, -1.33);
      ctx.lineTo(0.35, -1.1);
      ctx.closePath();
    };
    shape(ctx, path, '#f2f4f7', () => dark(ctx, -0.36, -1.24, 0.14, 0.18, 0.15));
    rr(ctx, -0.31, -1.21, 0.67, 0.11, 0.02, '#23252c', 0.045);
    line(ctx, [-0.28, -1.16, 0.33, -1.16], '#e0b445', 0.022);
    oval(ctx, 0.1, -1.27, 0.06, 0.045, '#e0b445', 0.035);
    oval(ctx, 0.0, -1.27, 0.045, 0.02, '#e0b445', 0.03, -0.4);
    oval(ctx, 0.2, -1.27, 0.045, 0.02, '#e0b445', 0.03, 0.4);
    ctx.beginPath();
    ctx.moveTo(0.26, -1.1);
    ctx.quadraticCurveTo(0.52, -1.13, 0.66, -1.06);
    ctx.quadraticCurveTo(0.62, -1.02, 0.52, -1.02);
    ctx.quadraticCurveTo(0.38, -1.03, 0.26, -1.02);
    ctx.closePath();
    finish(ctx, '#17181d');
  },

  viking(ctx, layer) {
    if (layer !== 'front') return;
    const horn = (sign) => {
      const bx = sign < 0 ? -0.3 : 0.33;
      shape(
        ctx,
        () => {
          ctx.beginPath();
          ctx.moveTo(bx, -1.08);
          ctx.quadraticCurveTo(bx + sign * 0.24, -1.12, bx + sign * 0.27, -1.48);
          ctx.quadraticCurveTo(bx + sign * 0.14, -1.26, bx - sign * 0.02, -1.24);
          ctx.closePath();
        },
        '#f1ead6',
        () => dark(ctx, bx + sign * 0.1, -1.12, 0.12, 0.05, 0.15),
      );
    };
    horn(-1);
    horn(1);
    shape(ctx, crownPath(ctx, -1.06, -1.42, -0.34, 0.37), '#a3adb8', () => {
      dark(ctx, -0.3, -1.2, 0.18, 0.3, 0.25);
      rr(ctx, -0.02, -1.44, 0.08, 0.4, 0.03, 'rgba(0,0,0,0.15)', 0);
    });
    rr(ctx, -0.37, -1.14, 0.78, 0.1, 0.04, '#8a6a3a', 0.05);
    for (let x = -0.28; x < 0.38; x += 0.16) disc(ctx, x, -1.09, 0.018, '#e0c070', 0);
    shine(ctx, -0.14, -1.33, 0.08, 0.03);
  },

  antenna(ctx, layer) {
    if (layer !== 'front') return;
    const pts = [0.02, -1.2];
    for (let i = 1; i <= 8; i++) pts.push(0.02 + (i % 2 ? 0.05 : -0.05), -1.2 - i * 0.045);
    pts.push(0.02, -1.6);
    line(ctx, pts, INK, 0.06);
    line(ctx, pts, '#c3ccd5', 0.03);
    oval(ctx, 0.02, -1.2, 0.07, 0.03, '#59636f', 0.04);
    disc(ctx, 0.02, -1.65, 0.075, '#ff4b4b');
    shine(ctx, -0.005, -1.675, 0.025, 0.015, -0.4, 0.8);
  },

  bubble(ctx, layer) {
    if (layer !== 'front') return;
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0.02, -1.26, 0.22, 0.24, 0, Math.PI, TAU);
        ctx.closePath();
      },
      'rgba(170,225,245,0.55)',
      () => {
        star(ctx, 0.04, -1.36, 0.05, '#f5d90a', 0.025);
        disc(ctx, -0.07, -1.3, 0.018, '#ffffff', 0);
      },
    );
    shine(ctx, -0.07, -1.4, 0.06, 0.03, -0.6, 0.75);
    rr(ctx, -0.23, -1.29, 0.5, 0.08, 0.03, '#9aa5b1', 0.05);
    line(ctx, [0.18, -1.44, 0.26, -1.56], INK, 0.04);
    disc(ctx, 0.27, -1.58, 0.03, '#ff4b4b', 0.03);
  },

  roll(ctx, layer) {
    if (layer === 'back') {
      ctx.beginPath();
      ctx.moveTo(-0.2, -1.4);
      ctx.quadraticCurveTo(-0.48, -1.3, -0.5, -0.92);
      ctx.lineTo(-0.38, -0.9);
      ctx.quadraticCurveTo(-0.38, -1.22, -0.18, -1.3);
      ctx.closePath();
      finish(ctx, '#f6f7f2');
      line(ctx, [-0.47, -1.06, -0.37, -1.06], 'rgba(0,0,0,0.15)', 0.015);
      return;
    }
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.roundRect(-0.2, -1.56, 0.44, 0.38, 0.06);
      },
      '#f6f7f2',
      () => {
        dark(ctx, -0.22, -1.38, 0.08, 0.25, 0.12);
        line(ctx, [-0.2, -1.45, 0.24, -1.45], 'rgba(0,0,0,0.08)', 0.015);
        line(ctx, [-0.2, -1.32, 0.24, -1.32], 'rgba(0,0,0,0.08)', 0.015);
      },
    );
    oval(ctx, 0.02, -1.56, 0.22, 0.05, '#e9ebe4', 0.05);
    oval(ctx, 0.02, -1.56, 0.07, 0.022, '#b08a5a', 0.03);
  },

  plunger(ctx, layer) {
    if (layer !== 'front') return;
    line(ctx, [0.06, -1.32, 0.26, -1.86], INK, 0.11);
    line(ctx, [0.06, -1.32, 0.26, -1.86], '#c08a4f', 0.06);
    disc(ctx, 0.265, -1.88, 0.04, '#9a6a35', 0.035);
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.moveTo(-0.24, -1.12);
        ctx.quadraticCurveTo(-0.22, -1.38, 0.04, -1.38);
        ctx.quadraticCurveTo(0.3, -1.38, 0.3, -1.12);
        ctx.quadraticCurveTo(0.03, -1.07, -0.24, -1.12);
        ctx.closePath();
      },
      '#d6382f',
      () => dark(ctx, -0.22, -1.22, 0.1, 0.15, 0.25),
    );
    shine(ctx, -0.08, -1.3, 0.06, 0.025);
  },

  cone(ctx, layer) {
    if (layer !== 'front') return;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.22, -1.17);
      ctx.lineTo(-0.03, -1.7);
      ctx.quadraticCurveTo(0.02, -1.74, 0.07, -1.7);
      ctx.lineTo(0.26, -1.17);
      ctx.closePath();
    };
    shape(ctx, path, '#ff7a1a', () => {
      ctx.fillStyle = '#f7f7f2';
      ctx.fillRect(-0.4, -1.5, 0.8, 0.08);
      ctx.fillRect(-0.4, -1.34, 0.8, 0.08);
      dark(ctx, -0.18, -1.4, 0.08, 0.3, 0.2);
    });
    rr(ctx, -0.33, -1.19, 0.7, 0.08, 0.03, '#e2600f', 0.05);
  },

  catears(ctx, layer) {
    if (layer !== 'front') return;
    const ear = (bx, tilt) => {
      ctx.save();
      ctx.translate(bx, -1.1);
      ctx.rotate(tilt);
      poly(ctx, [-0.12, 0.02, -0.02, -0.3, 0.12, 0.02], '#2e2f36');
      poly(ctx, [-0.06, -0.02, -0.02, -0.2, 0.06, -0.02], '#f29bbb', 0);
      ctx.restore();
    };
    ear(-0.17, -0.25);
    ear(0.2, 0.25);
    rr(ctx, -0.33, -1.15, 0.7, 0.06, 0.03, '#2e2f36', 0.045);
  },
};

/** A hat. layer 'back' is drawn behind the body, 'front' after the body and visor. */
export function drawHat(ctx, id, layer) {
  const art = HAT_ART[id];
  if (!art) return;
  ctx.save();
  art(ctx, layer);
  ctx.restore();
}

// ---------- skins ----------

/** Soft shading over clothes, matching the crewmate's own (lower back, rear edge). */
function clothShade(ctx, a = 0.22) {
  ctx.beginPath();
  ctx.ellipse(-0.3, -0.28, 0.48, 0.42, 0, 0, TAU);
  ctx.ellipse(-0.48, -0.75, 0.2, 0.6, 0, 0, TAU);
  ctx.fillStyle = `rgba(0,0,0,${a})`;
  ctx.fill('nonzero');
}

/** Clothes covering the body from a gently curved collar line at y0 down. */
function garment(ctx, y0, fill) {
  ctx.beginPath();
  ctx.moveTo(-0.5, y0 + 0.03);
  ctx.quadraticCurveTo(0, y0 + 0.07, 0.5, y0 - 0.02);
  ctx.lineTo(0.5, -0.1);
  ctx.lineTo(-0.5, -0.1);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function collarLine(ctx, y0, w = 0.04) {
  ctx.beginPath();
  ctx.moveTo(-0.5, y0 + 0.03);
  ctx.quadraticCurveTo(0, y0 + 0.07, 0.5, y0 - 0.02);
  ctx.strokeStyle = INK;
  ctx.lineWidth = w;
  ctx.stroke();
}

// Camo blotches, fixed so every frame matches.
const CAMO = [
  [-0.3, -0.7, 0.12, 0.07, '#3f5426'],
  [0.05, -0.62, 0.14, 0.06, '#8a9a5b'],
  [0.28, -0.72, 0.1, 0.05, '#2f3b1d'],
  [-0.12, -0.5, 0.1, 0.06, '#2f3b1d'],
  [0.22, -0.45, 0.13, 0.06, '#3f5426'],
  [-0.32, -0.38, 0.1, 0.06, '#8a9a5b'],
  [0.0, -0.32, 0.12, 0.05, '#3f5426'],
  [0.34, -0.3, 0.08, 0.05, '#8a9a5b'],
  [-0.2, -0.25, 0.08, 0.04, '#2f3b1d'],
];

const SKIN_ART = {
  labcoat: {
    torso(ctx) {
      garment(ctx, -0.74, '#eef2f5');
      poly(ctx, [0.12, -0.75, 0.42, -0.77, 0.29, -0.5], '#9fd0e6', 0);
      clothShade(ctx, 0.16);
      line(ctx, [0.12, -0.75, 0.25, -0.52, 0.25, -0.2], INK, 0.035);
      line(ctx, [0.42, -0.77, 0.3, -0.52], INK, 0.035);
      rr(ctx, -0.14, -0.55, 0.16, 0.12, 0.02, '#e2e8ed', 0.03);
      line(ctx, [-0.1, -0.6, -0.1, -0.5], '#3f7fe0', 0.025);
      disc(ctx, 0.31, -0.42, 0.018, '#c9d2da', 0.02);
      disc(ctx, 0.31, -0.32, 0.018, '#c9d2da', 0.02);
      collarLine(ctx, -0.74);
    },
    leg: { fill: '#4a505c', boot: '#2a2d33' },
  },
  overalls: {
    torso(ctx) {
      ctx.fillStyle = '#3f6fb5';
      ctx.beginPath();
      ctx.moveTo(0.0, -0.72);
      ctx.lineTo(0.5, -0.74);
      ctx.lineTo(0.5, -0.1);
      ctx.lineTo(-0.5, -0.1);
      ctx.lineTo(-0.5, -0.5);
      ctx.lineTo(0.0, -0.5);
      ctx.closePath();
      ctx.fill();
      clothShade(ctx, 0.2);
      line(ctx, [0.0, -0.72, 0.5, -0.74], INK, 0.035);
      line(ctx, [0.0, -0.72, 0.0, -0.5, -0.5, -0.5], INK, 0.035);
      line(ctx, [0.03, -0.71, -0.2, -0.66, -0.42, -0.58], INK, 0.09);
      line(ctx, [0.03, -0.71, -0.2, -0.66, -0.42, -0.58], '#3f6fb5', 0.05);
      disc(ctx, 0.05, -0.68, 0.03, '#e0b445', 0.025);
      disc(ctx, 0.35, -0.69, 0.03, '#e0b445', 0.025);
      rr(ctx, 0.12, -0.62, 0.18, 0.12, 0.02, '#2d5590', 0.03);
      oval(ctx, -0.18, -0.34, 0.06, 0.03, 'rgba(20,20,20,0.35)', 0, 0.4);
    },
    leg: { fill: '#3f6fb5', boot: '#5a3a1f', cuff: '#2d5590' },
  },
  police: {
    torso(ctx) {
      garment(ctx, -0.76, '#2b3f73');
      clothShade(ctx, 0.22);
      rr(ctx, -0.5, -0.39, 1.0, 0.08, 0, '#17181d', 0);
      rr(ctx, 0.2, -0.4, 0.1, 0.1, 0.015, '#c9d2da', 0.03);
      star(ctx, 0.22, -0.6, 0.06, '#f5c542', 0.03);
      rr(ctx, -0.18, -0.66, 0.16, 0.07, 0.02, '#22335f', 0.03);
      line(ctx, [0.32, -0.74, 0.32, -0.42], 'rgba(0,0,0,0.3)', 0.02);
      collarLine(ctx, -0.76);
    },
    leg: { fill: '#22325c', boot: '#17181d' },
  },
  suit: {
    torso(ctx) {
      garment(ctx, -0.74, '#26282f');
      poly(ctx, [0.1, -0.78, 0.46, -0.8, 0.28, -0.42], '#f4f6f8', 0);
      clothShade(ctx, 0.25);
      poly(ctx, [0.26, -0.74, 0.31, -0.74, 0.33, -0.5, 0.285, -0.44, 0.24, -0.5], '#d8322f', 0.025);
      line(ctx, [0.1, -0.76, 0.27, -0.42, 0.27, -0.2], INK, 0.035);
      line(ctx, [0.46, -0.79, 0.3, -0.44], INK, 0.035);
      disc(ctx, 0.22, -0.33, 0.02, '#4a4d57', 0.02);
      line(ctx, [-0.18, -0.6, -0.04, -0.6], 'rgba(255,255,255,0.15)', 0.03);
      collarLine(ctx, -0.74);
    },
    leg: { fill: '#26282f', boot: '#111216' },
  },
  camo: {
    torso(ctx) {
      garment(ctx, -0.78, '#5f7a3a');
      for (const [x, y, rx, ry, c] of CAMO) oval(ctx, x, y, rx, ry, c, 0, x * 3);
      clothShade(ctx, 0.2);
      rr(ctx, -0.5, -0.4, 1.0, 0.06, 0, '#3a2a1a', 0);
      collarLine(ctx, -0.78);
    },
    leg: { fill: '#5f7a3a', boot: '#3a2a1a', camo: true },
  },
  scrubs: {
    torso(ctx) {
      garment(ctx, -0.75, '#3fb7a8');
      clothShade(ctx, 0.2);
      line(ctx, [0.12, -0.75, 0.27, -0.58, 0.42, -0.77], INK, 0.035);
      rr(ctx, -0.16, -0.62, 0.15, 0.13, 0.02, '#36a093', 0.03);
      line(ctx, [-0.12, -0.67, -0.12, -0.6], '#f4f6f8', 0.02);
      collarLine(ctx, -0.75);
    },
    leg: { fill: '#3fb7a8', boot: '#eef1f4' },
  },
  captain: {
    torso(ctx) {
      garment(ctx, -0.76, '#1f2d55');
      clothShade(ctx, 0.25);
      for (const y of [-0.62, -0.5, -0.38]) {
        disc(ctx, 0.2, y, 0.025, '#e0b445', 0.02);
        disc(ctx, 0.33, y, 0.025, '#e0b445', 0.02);
      }
      rr(ctx, -0.34, -0.8, 0.34, 0.08, 0.03, '#e0b445', 0.035);
      for (let x = -0.3; x < 0; x += 0.06) line(ctx, [x, -0.72, x, -0.66], '#e0b445', 0.02);
      line(ctx, [-0.5, -0.27, 0.5, -0.27], '#e0b445', 0.03);
      collarLine(ctx, -0.76);
    },
    leg: { fill: '#eef0f4', boot: '#17181d' },
  },
  hazmat: {
    torso(ctx) {
      garment(ctx, -0.77, '#f2c230');
      ctx.save();
      ctx.beginPath();
      ctx.rect(-0.5, -0.52, 1.0, 0.1);
      ctx.clip();
      ctx.fillStyle = '#1c1d22';
      for (let x = -0.6; x < 0.6; x += 0.12) {
        ctx.beginPath();
        ctx.moveTo(x, -0.42);
        ctx.lineTo(x + 0.06, -0.42);
        ctx.lineTo(x + 0.16, -0.52);
        ctx.lineTo(x + 0.1, -0.52);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      line(ctx, [-0.5, -0.52, 0.5, -0.52], INK, 0.025);
      line(ctx, [-0.5, -0.42, 0.5, -0.42], INK, 0.025);
      clothShade(ctx, 0.18);
      disc(ctx, 0.2, -0.32, 0.06, '#1c1d22', 0);
      disc(ctx, 0.2, -0.32, 0.015, '#f2c230', 0);
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * TAU) / 3;
        ctx.beginPath();
        ctx.moveTo(0.2, -0.32);
        ctx.arc(0.2, -0.32, 0.05, a - 0.45, a + 0.45);
        ctx.closePath();
        ctx.fillStyle = '#f2c230';
        ctx.fill();
      }
      collarLine(ctx, -0.77);
    },
    leg: { fill: '#f2c230', boot: '#1c1d22' },
  },
  sweater: {
    torso(ctx) {
      garment(ctx, -0.78, '#c8423a');
      ctx.save();
      ctx.beginPath();
      ctx.rect(-0.5, -0.62, 1.0, 0.12);
      ctx.fillStyle = '#f4f1e8';
      ctx.fill();
      const zig = [];
      for (let x = -0.5, i = 0; x <= 0.52; x += 0.06, i++) zig.push(x, i % 2 ? -0.53 : -0.59);
      line(ctx, zig, '#3f9a45', 0.03);
      ctx.restore();
      rr(ctx, -0.5, -0.33, 1.0, 0.1, 0, '#a8342d', 0);
      for (let x = -0.46; x < 0.5; x += 0.05) line(ctx, [x, -0.32, x, -0.24], 'rgba(0,0,0,0.18)', 0.015);
      clothShade(ctx, 0.2);
      rr(ctx, -0.5, -0.82, 1.0, 0.07, 0.03, '#a8342d', 0);
      collarLine(ctx, -0.78);
    },
    leg: null,
  },
  astro: {
    torso(ctx) {
      garment(ctx, -0.78, '#eef1f4');
      line(ctx, [-0.5, -0.36, 0.5, -0.36], '#ef7d0d', 0.06);
      line(ctx, [-0.3, -0.78, -0.3, -0.36], '#ef7d0d', 0.04);
      clothShade(ctx, 0.15);
      rr(ctx, 0.12, -0.68, 0.22, 0.14, 0.03, '#59636f', 0.03);
      disc(ctx, 0.18, -0.61, 0.022, '#ff4b4b', 0);
      disc(ctx, 0.24, -0.61, 0.022, '#5bd36b', 0);
      disc(ctx, 0.3, -0.61, 0.022, '#4fb7ff', 0);
      collarLine(ctx, -0.78);
    },
    leg: { fill: '#eef1f4', boot: '#8d98a4', stripe: '#ef7d0d' },
  },
};

/** Outfit over the torso. ctx is clipped to the body shape; called before the body's outline. */
export function drawSkinTorso(ctx, id, color, shadow) {
  const art = SKIN_ART[id];
  if (!art) return;
  ctx.save();
  art.torso(ctx);
  ctx.restore();
}

/**
 * Outfit over one leg, in leg space: hip at (0, 0), leg from x -0.14..0.14 down to y = len.
 * ctx is clipped to the leg; front = the near leg.
 */
export function drawSkinLeg(ctx, id, color, shadow, front, len) {
  const leg = SKIN_ART[id]?.leg;
  if (!leg) return;
  ctx.save();
  ctx.fillStyle = leg.fill;
  ctx.fillRect(-0.2, -0.12, 0.4, len + 0.2);
  if (leg.camo) {
    oval(ctx, -0.05, 0.05, 0.08, 0.05, '#3f5426', 0, 0.5);
    oval(ctx, 0.07, 0.17, 0.07, 0.04, '#8a9a5b', 0, -0.3);
  }
  if (leg.stripe) ctx.fillStyle = leg.stripe;
  if (leg.stripe) ctx.fillRect(-0.2, len * 0.42, 0.4, 0.04);
  if (leg.cuff) {
    ctx.fillStyle = leg.cuff;
    ctx.fillRect(-0.2, len - 0.13, 0.4, 0.05);
  }
  if (leg.boot) {
    ctx.fillStyle = leg.boot;
    ctx.fillRect(-0.2, len - 0.08, 0.4, 0.2);
    line(ctx, [-0.2, len - 0.08, 0.2, len - 0.08], INK, 0.03);
  }
  ctx.fillStyle = front ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.3)';
  ctx.fillRect(-0.2, -0.12, 0.4, len + 0.2);
  ctx.restore();
}

// ---------- visor accessories ----------

/** The glass visor's box for a turn (matches drawVisor in sprites.js). */
function glass(fwd, up) {
  const w = 0.5 + 0.02 * fwd;
  const h = 0.31 * (1 - 0.2 * Math.abs(up));
  return { w, h, cx: -0.03 + 0.29 * fwd, cy: -0.865 + up * 0.13 };
}

/** A temple arm from the lens back to the side of the helmet, clipped to the head. */
function templeArm(ctx, x0, y0, cy, color = '#1c1d22', w = 0.045) {
  ctx.save();
  bodyClip(ctx);
  line(ctx, [x0, y0, -0.36, cy - 0.05], INK, w + 0.04);
  line(ctx, [x0, y0, -0.36, cy - 0.05], color, w);
  ctx.restore();
}

const VISOR_ART = {
  shades(ctx, g) {
    const x = g.cx - g.w * 0.48;
    templeArm(ctx, x + 0.02, g.cy - g.h * 0.2, g.cy);
    rr(ctx, x, g.cy - g.h * 0.52, g.w * 0.96, g.h * 0.82, g.h * 0.35, '#15181d', LW);
    line(ctx, [x + g.w * 0.55, g.cy - g.h * 0.32, x + g.w * 0.72, g.cy - g.h * 0.32], 'rgba(255,255,255,0.55)', 0.03);
    line(ctx, [x + g.w * 0.78, g.cy - g.h * 0.32, x + g.w * 0.82, g.cy - g.h * 0.32], 'rgba(255,255,255,0.55)', 0.03);
  },
  nerd(ctx, g) {
    const near = { x: g.cx + g.w * 0.03, w: g.w * 0.44 };
    const far = { x: g.cx - g.w * 0.45, w: g.w * 0.36 };
    templeArm(ctx, far.x + 0.02, g.cy - g.h * 0.2, g.cy);
    for (const l of [far, near]) {
      ctx.beginPath();
      ctx.roundRect(l.x, g.cy - g.h * 0.45, l.w, g.h * 0.85, 0.06);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.1;
      ctx.stroke();
      ctx.strokeStyle = '#3a2a22';
      ctx.lineWidth = 0.045;
      ctx.stroke();
    }
    line(ctx, [far.x + far.w, g.cy - g.h * 0.15, near.x, g.cy - g.h * 0.15], INK, 0.05);
  },
  monocle(ctx, g) {
    const x = g.cx + g.w * 0.2;
    const r = g.h * 0.42;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.3, g.cy + r * 0.95);
    ctx.bezierCurveTo(x - 0.12, g.cy + 0.25, x - 0.02, g.cy + 0.35, x - 0.2, g.cy + 0.42);
    ctx.strokeStyle = '#e0b445';
    ctx.lineWidth = 0.02;
    ctx.stroke();
    disc(ctx, x, g.cy, r, 'rgba(255,255,255,0.22)', 0);
    ctx.beginPath();
    ctx.arc(x, g.cy, r, 0, TAU);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.075;
    ctx.stroke();
    ctx.strokeStyle = '#e0b445';
    ctx.lineWidth = 0.035;
    ctx.stroke();
  },
  eyepatch(ctx, g) {
    const x = g.cx + g.w * 0.12;
    ctx.save();
    bodyClip(ctx);
    line(ctx, [x, g.cy - 0.02, -0.38, g.cy - 0.17], INK, 0.04);
    ctx.restore();
    line(ctx, [x, g.cy - 0.02, g.cx + g.w * 0.5, g.cy - g.h * 0.45], INK, 0.04);
    oval(ctx, x, g.cy + 0.01, g.w * 0.2, g.h * 0.46, '#1c1d22', LW);
    shine(ctx, x - 0.03, g.cy - 0.04, 0.03, 0.015, -0.3, 0.3);
  },
  mustache(ctx, g) {
    const mx = g.cx + g.w * 0.1;
    const my = g.cy + g.h * 0.5 + 0.06;
    ctx.save();
    ctx.translate(mx, my);
    ctx.scale(1.35, 1.35);
    ctx.translate(-mx, -my);
    ctx.beginPath();
    ctx.moveTo(mx, my - 0.02);
    ctx.bezierCurveTo(mx + 0.06, my - 0.07, mx + 0.16, my - 0.04, mx + 0.19, my - 0.09);
    ctx.bezierCurveTo(mx + 0.2, my + 0.02, mx + 0.08, my + 0.05, mx, my + 0.025);
    ctx.bezierCurveTo(mx - 0.08, my + 0.05, mx - 0.2, my + 0.02, mx - 0.19, my - 0.09);
    ctx.bezierCurveTo(mx - 0.16, my - 0.04, mx - 0.06, my - 0.07, mx, my - 0.02);
    ctx.closePath();
    finish(ctx, '#5a3a22', 0.045);
    shine(ctx, mx + 0.06, my - 0.03, 0.04, 0.012, -0.3, 0.3);
    ctx.restore();
  },
  goggles(ctx, g) {
    ctx.save();
    bodyClip(ctx);
    line(ctx, [g.cx - g.w * 0.45, g.cy, -0.4, g.cy - 0.04], INK, 0.15);
    line(ctx, [g.cx - g.w * 0.45, g.cy, -0.4, g.cy - 0.04], '#ef7d0d', 0.09);
    ctx.restore();
    ctx.beginPath();
    ctx.roundRect(g.cx - g.w * 0.54, g.cy - g.h * 0.64, g.w * 1.08, g.h * 1.28, g.h * 0.62);
    ctx.fillStyle = 'rgba(255,186,70,0.85)';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.13;
    ctx.stroke();
    ctx.strokeStyle = '#3a3f4a';
    ctx.lineWidth = 0.07;
    ctx.stroke();
    line(ctx, [g.cx - g.w * 0.3, g.cy + g.h * 0.2, g.cx + g.w * 0.3, g.cy + g.h * 0.2], 'rgba(200,90,20,0.45)', 0.08);
    line(ctx, [g.cx - g.w * 0.05, g.cy - g.h * 0.3, g.cx + g.w * 0.25, g.cy - g.h * 0.3], 'rgba(255,255,255,0.8)', 0.03);
  },
  hearts(ctx, g) {
    const heart = (x, y, s) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.9);
      ctx.bezierCurveTo(x - s * 1.4, y + s * 0.1, x - s * 0.9, y - s * 0.9, x, y - s * 0.35);
      ctx.bezierCurveTo(x + s * 0.9, y - s * 0.9, x + s * 1.4, y + s * 0.1, x, y + s * 0.9);
      ctx.closePath();
      finish(ctx, '#ff4f8b', 0.05);
      shine(ctx, x - s * 0.4, y - s * 0.25, s * 0.18, s * 0.1, -0.5, 0.7);
    };
    const s = g.h * 0.5;
    const far = g.cx - g.w * 0.24;
    templeArm(ctx, far, g.cy - g.h * 0.1, g.cy, '#ff4f8b', 0.035);
    heart(far, g.cy, s * (0.6 + 0.2 * (1 - g.w)));
    line(ctx, [far + s * 0.6, g.cy - s * 0.2, g.cx + g.w * 0.08, g.cy - s * 0.2], INK, 0.04);
    heart(g.cx + g.w * 0.22, g.cy, s);
  },
  threed(ctx, g) {
    const x = g.cx - g.w * 0.48;
    templeArm(ctx, x + 0.02, g.cy - g.h * 0.2, g.cy, '#f4f6f8', 0.04);
    rr(ctx, x, g.cy - g.h * 0.5, g.w * 0.96, g.h * 0.85, 0.05, '#f4f6f8', LW);
    rr(ctx, x + g.w * 0.06, g.cy - g.h * 0.36, g.w * 0.36, g.h * 0.58, 0.03, 'rgba(60,200,255,0.85)', 0.03);
    rr(ctx, x + g.w * 0.52, g.cy - g.h * 0.36, g.w * 0.38, g.h * 0.58, 0.03, 'rgba(255,60,60,0.85)', 0.03);
  },
};

/** Accessory over the glass visor; fwd and up as in drawVisor (sprites.js). */
export function drawVisorAcc(ctx, id, fwd, up) {
  const art = VISOR_ART[id];
  if (!art) return;
  ctx.save();
  art(ctx, glass(fwd, up));
  ctx.restore();
}

// ---------- pets ----------

/** Walk phase for a pet frame: [phase 0..2pi, moving]. */
function petPhase(frame) {
  return frame < 0 ? [0, false] : [(frame / PET_FRAMES) * TAU, true];
}

const PET_ART = {
  mini(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const s = 0.46;
    const bob = moving ? -Math.abs(Math.cos(ph)) * 0.04 : 0;
    ctx.save();
    ctx.scale(s, s);
    const lw = 0.075;
    const color = '#d6e0f0';
    const dk = '#8394bf';
    const legOff = moving ? Math.sin(ph) * 0.12 : 0;
    rr(ctx, -0.3 - legOff, -0.34 + (moving ? Math.max(0, Math.sin(ph)) * -0.08 : 0), 0.28, 0.34, [0.04, 0.04, 0.12, 0.12], dk, lw);
    rr(ctx, 0.06 + legOff, -0.34 + (moving ? Math.max(0, -Math.sin(ph)) * -0.08 : 0), 0.28, 0.34, [0.04, 0.04, 0.12, 0.12], color, lw);
    ctx.translate(0, bob / s);
    rr(ctx, -0.53, -0.98, 0.26, 0.56, 0.1, dk, lw);
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.roundRect(-0.37, -1.22, 0.76, 0.98, [0.38, 0.38, 0.13, 0.13]);
      },
      color,
      () => {
        oval(ctx, -0.3, -0.28, 0.48, 0.42, dk, 0);
        oval(ctx, -0.48, -0.75, 0.2, 0.6, dk, 0);
      },
      lw,
    );
    rr(ctx, 0.0, -1.02, 0.52, 0.31, 0.155, '#93c8db', lw);
    oval(ctx, 0.28, -0.96, 0.09, 0.035, 'rgba(255,255,255,0.85)', 0);
    ctx.restore();
  },

  pup(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const c = '#c4874f';
    const dk = '#8a5a30';
    const step = (o) => (moving ? Math.sin(ph + o) * 0.05 : 0);
    const lift = (o) => (moving ? Math.max(0, Math.cos(ph + o)) * 0.05 : 0);
    const bob = moving ? -Math.abs(Math.sin(ph)) * 0.025 : 0;
    // Far legs, then body, then near legs.
    rr(ctx, -0.17 + step(Math.PI), -0.18 - lift(Math.PI), 0.08, 0.18, [0.02, 0.02, 0.04, 0.04], dk);
    rr(ctx, 0.11 + step(0), -0.18 - lift(0), 0.08, 0.18, [0.02, 0.02, 0.04, 0.04], dk);
    ctx.save();
    ctx.translate(0, bob);
    const wag = moving ? Math.sin(ph * 2) * 0.5 : 0.3;
    ctx.save();
    ctx.translate(-0.2, -0.3);
    ctx.rotate(-0.9 + wag);
    rr(ctx, -0.03, -0.18, 0.06, 0.2, 0.03, c);
    ctx.restore();
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, -0.28, 0.24, 0.13, 0, 0, TAU);
      },
      c,
      () => {
        oval(ctx, -0.05, -0.18, 0.25, 0.08, dk, 0);
        oval(ctx, 0.05, -0.24, 0.1, 0.06, '#f1dcc0', 0);
      },
    );
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.arc(0.22, -0.43, 0.14, 0, TAU);
      },
      c,
      () => oval(ctx, 0.14, -0.38, 0.08, 0.1, dk, 0),
    );
    oval(ctx, 0.35, -0.39, 0.08, 0.06, '#f1dcc0');
    disc(ctx, 0.42, -0.41, 0.028, INK, 0);
    disc(ctx, 0.26, -0.47, 0.022, INK, 0);
    disc(ctx, 0.255, -0.477, 0.008, '#ffffff', 0);
    oval(ctx, 0.15, -0.42, 0.06, 0.11, dk, LW, 0.35);
    rr(ctx, 0.04, -0.33, 0.16, 0.035, 0.015, '#d8322f', 0.03);
    ctx.restore();
    rr(ctx, -0.13 + step(0), -0.18 - lift(0), 0.08, 0.18, [0.02, 0.02, 0.04, 0.04], c);
    rr(ctx, 0.15 + step(Math.PI), -0.18 - lift(Math.PI), 0.08, 0.18, [0.02, 0.02, 0.04, 0.04], c);
  },

  bot(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const bob = moving ? Math.sin(ph * 2) * 0.012 : 0;
    // Wheel, with spokes that turn.
    disc(ctx, 0, -0.1, 0.1, '#3a3f48');
    disc(ctx, 0, -0.1, 0.045, '#8d98a4', 0.03);
    for (let i = 0; i < 4; i++) {
      const a = (moving ? ph : 0) + (i * Math.PI) / 2;
      line(ctx, [Math.cos(a) * 0.05, -0.1 + Math.sin(a) * 0.05, Math.cos(a) * 0.09, -0.1 + Math.sin(a) * 0.09], '#8d98a4', 0.02);
    }
    ctx.save();
    ctx.translate(0, bob);
    rr(ctx, -0.18, -0.46, 0.36, 0.3, 0.06, '#b9c3cc');
    rr(ctx, -0.18, -0.46, 0.08, 0.3, [0.06, 0, 0, 0.06], 'rgba(0,0,0,0.15)', 0);
    rr(ctx, -0.05, -0.38, 0.17, 0.08, 0.02, '#59636f', 0.03);
    disc(ctx, -0.01, -0.34, 0.015, moving && Math.floor(ph * 2) % 2 ? '#ff4b4b' : '#5bd36b', 0);
    rr(ctx, -0.15, -0.7, 0.32, 0.22, 0.07, '#d0d8df');
    rr(ctx, -0.03, -0.65, 0.17, 0.11, 0.04, '#1f2a36', 0.035);
    disc(ctx, 0.03, -0.6, 0.022, '#4fe0ff', 0);
    disc(ctx, 0.1, -0.6, 0.022, '#4fe0ff', 0);
    line(ctx, [0.0, -0.7, -0.02, -0.82], INK, 0.03);
    disc(ctx, -0.02, -0.84, 0.03, '#ff4b4b', 0.03);
    ctx.restore();
  },

  blob(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const hop = moving ? Math.max(0, Math.sin(ph)) : 0;
    const sq = moving ? 1 + 0.16 * Math.cos(ph * 2) : 1;
    ctx.save();
    ctx.translate(0, -hop * 0.12);
    ctx.scale(1 / sq, sq);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(-0.24, 0);
      ctx.bezierCurveTo(-0.26, -0.3, -0.12, -0.42, 0.02, -0.42);
      ctx.bezierCurveTo(0.18, -0.42, 0.28, -0.3, 0.26, 0);
      ctx.quadraticCurveTo(0.01, 0.03, -0.24, 0);
      ctx.closePath();
    };
    shape(ctx, path, 'rgba(126,217,87,0.92)', () => {
      oval(ctx, -0.2, -0.08, 0.16, 0.2, 'rgba(40,120,40,0.45)', 0);
      disc(ctx, -0.08, -0.12, 0.03, 'rgba(255,255,255,0.35)', 0);
      disc(ctx, 0.0, -0.06, 0.02, 'rgba(255,255,255,0.35)', 0);
    });
    disc(ctx, 0.1, -0.25, 0.085, '#ffffff', 0.04);
    disc(ctx, 0.13, -0.25, 0.04, INK, 0);
    disc(ctx, 0.115, -0.265, 0.013, '#ffffff', 0);
    shine(ctx, -0.07, -0.33, 0.06, 0.025, -0.5, 0.7);
    ctx.restore();
  },

  hamster(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const bob = moving ? -Math.abs(Math.sin(ph)) * 0.03 : 0;
    const f = (o) => (moving ? Math.sin(ph + o) * 0.04 : 0);
    oval(ctx, -0.06 + f(Math.PI), -0.02, 0.045, 0.025, '#f29bbb', 0.03);
    ctx.save();
    ctx.translate(0, bob);
    disc(ctx, -0.07, -0.42, 0.05, '#e0904a');
    disc(ctx, -0.07, -0.42, 0.025, '#f29bbb', 0);
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, -0.22, 0.22, 0.2, 0, 0, TAU);
      },
      '#efa45b',
      () => {
        oval(ctx, 0.12, -0.15, 0.13, 0.12, '#fbe7cc', 0);
        oval(ctx, -0.18, -0.12, 0.12, 0.16, 'rgba(0,0,0,0.15)', 0);
      },
    );
    disc(ctx, 0.04, -0.4, 0.05, '#efa45b');
    disc(ctx, 0.04, -0.4, 0.025, '#f29bbb', 0);
    disc(ctx, 0.14, -0.27, 0.024, INK, 0);
    disc(ctx, 0.135, -0.277, 0.008, '#ffffff', 0);
    disc(ctx, 0.215, -0.22, 0.017, '#f27a9a', 0);
    oval(ctx, 0.1, -0.2, 0.04, 0.025, 'rgba(255,120,140,0.4)', 0);
    shine(ctx, -0.06, -0.34, 0.06, 0.025, -0.4, 0.5);
    ctx.restore();
    oval(ctx, 0.08 + f(0), -0.02, 0.045, 0.025, '#f29bbb', 0.03);
  },

  ufo(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const y = -0.42 + (moving ? Math.sin(ph) * 0.03 : 0);
    const tilt = moving ? 0.1 : 0;
    ctx.save();
    ctx.translate(0, y);
    ctx.rotate(tilt);
    ctx.beginPath();
    ctx.moveTo(-0.08, 0.05);
    ctx.lineTo(-0.16, 0.4);
    ctx.lineTo(0.16, 0.4);
    ctx.lineTo(0.08, 0.05);
    ctx.closePath();
    ctx.fillStyle = 'rgba(150,255,200,0.18)';
    ctx.fill();
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, -0.05, 0.14, 0.13, 0, Math.PI, TAU);
        ctx.closePath();
      },
      'rgba(160,225,250,0.75)',
      () => {
        disc(ctx, 0.01, -0.06, 0.05, '#6fd36b', 0.03);
        disc(ctx, 0.03, -0.07, 0.013, INK, 0);
      },
    );
    shine(ctx, -0.06, -0.12, 0.035, 0.018, -0.6, 0.8);
    oval(ctx, 0, -0.02, 0.29, 0.075, '#b9c3cc');
    oval(ctx, 0, 0.0, 0.29, 0.04, 'rgba(0,0,0,0.12)', 0);
    const on = moving ? Math.floor(ph / (TAU / 4)) : 0;
    [-0.18, -0.06, 0.06, 0.18].forEach((x, i) => disc(ctx, x, -0.01, 0.022, i === on ? '#ffe066' : '#ff6b6b', 0.02));
    ctx.restore();
  },

  crab(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    ctx.scale(1.3, 1.3);
    const bob = moving ? Math.abs(Math.sin(ph * 2)) * -0.02 : 0;
    for (let i = 0; i < 3; i++) {
      const x = -0.12 + i * 0.12;
      const k = moving ? Math.sin(ph + i * 2) * 0.04 : 0;
      line(ctx, [x, -0.14, x - 0.05 + k, -0.06, x - 0.08 + k, 0], INK, 0.05);
      line(ctx, [x, -0.14, x - 0.05 + k, -0.06, x - 0.08 + k, 0], '#c43d2c', 0.025);
    }
    ctx.save();
    ctx.translate(0, bob);
    for (const x of [0.03, 0.12]) {
      line(ctx, [x, -0.26, x + 0.01, -0.38], INK, 0.03);
      disc(ctx, x + 0.01, -0.4, 0.035, '#ffffff', 0.03);
      disc(ctx, x + 0.02, -0.4, 0.015, INK, 0);
    }
    shape(
      ctx,
      () => {
        ctx.beginPath();
        ctx.ellipse(0, -0.2, 0.22, 0.12, 0, 0, TAU);
      },
      '#e2553f',
      () => oval(ctx, -0.12, -0.13, 0.18, 0.08, 'rgba(0,0,0,0.18)', 0),
    );
    const snip = moving ? Math.abs(Math.sin(ph * 2)) * 0.25 : 0.1;
    ctx.save();
    ctx.translate(0.25, -0.24);
    oval(ctx, 0, 0, 0.08, 0.06, '#e2553f');
    ctx.rotate(-snip);
    oval(ctx, 0.07, -0.03, 0.05, 0.025, '#e2553f', 0.04);
    ctx.restore();
    shine(ctx, -0.05, -0.27, 0.06, 0.02, -0.2, 0.45);
    ctx.restore();
  },

  dino(ctx, frame) {
    const [ph, moving] = petPhase(frame);
    const step = (o) => (moving ? Math.sin(ph + o) * 0.06 : 0);
    const lift = (o) => (moving ? Math.max(0, Math.cos(ph + o)) * 0.05 : 0);
    const bob = moving ? -Math.abs(Math.sin(ph)) * 0.025 : 0;
    const c = '#59b34a';
    const dk = '#3f8a34';
    rr(ctx, -0.12 + step(Math.PI), -0.2 - lift(Math.PI), 0.09, 0.2, [0.02, 0.02, 0.05, 0.05], dk);
    ctx.save();
    ctx.translate(0, bob);
    const body = () => {
      ctx.beginPath();
      ctx.moveTo(-0.44, -0.3);
      ctx.quadraticCurveTo(-0.2, -0.36, -0.14, -0.42);
      ctx.quadraticCurveTo(0.0, -0.52, 0.12, -0.44);
      ctx.quadraticCurveTo(0.14, -0.6, 0.24, -0.66);
      ctx.quadraticCurveTo(0.42, -0.7, 0.44, -0.56);
      ctx.quadraticCurveTo(0.44, -0.48, 0.3, -0.48);
      ctx.quadraticCurveTo(0.22, -0.46, 0.22, -0.36);
      ctx.quadraticCurveTo(0.22, -0.16, 0.0, -0.16);
      ctx.quadraticCurveTo(-0.16, -0.16, -0.22, -0.24);
      ctx.closePath();
    };
    for (const [x, y] of [
      [-0.18, -0.42],
      [-0.06, -0.49],
      [0.07, -0.49],
    ])
      poly(ctx, [x - 0.05, y + 0.03, x, y - 0.07, x + 0.05, y + 0.03], '#f5c542', 0.035);
    shape(ctx, body, c, () => {
      oval(ctx, 0.0, -0.2, 0.2, 0.06, '#c8e8a0', 0);
      oval(ctx, -0.25, -0.26, 0.2, 0.05, dk, 0);
    });
    disc(ctx, 0.31, -0.6, 0.025, INK, 0);
    disc(ctx, 0.305, -0.607, 0.009, '#ffffff', 0);
    line(ctx, [0.36, -0.52, 0.42, -0.53], INK, 0.02);
    line(ctx, [0.2, -0.36, 0.27, -0.33], INK, 0.05);
    line(ctx, [0.2, -0.36, 0.27, -0.33], c, 0.025);
    ctx.restore();
    rr(ctx, 0.02 + step(0), -0.2 - lift(0), 0.09, 0.2, [0.02, 0.02, 0.05, 0.05], c);
  },
};

/** A pet with its feet at (0, 0), facing right, about 0.6 tall. frame: 0..PET_FRAMES-1 walking, -1 idle. */
export function drawPet(ctx, id, frame) {
  const art = PET_ART[id];
  if (!art) return;
  ctx.save();
  art(ctx, frame);
  ctx.restore();
}
