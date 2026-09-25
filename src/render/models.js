// Entity models: part trees of boxes in pixel units (Y up, model faces -Z, mob's right side = +X).
// Box UVs follow the Minecraft cuboid unwrap used by src/textures/entityTextures.js.

const PI = Math.PI;

function box(from, size, uv, opts = {}) { return { from, size, uv, inflate: opts.inflate ?? 0, mirror: !!opts.mirror }; }
function part(pivot, boxes, children = {}) { return { pivot, boxes, children, rx: 0, ry: 0, rz: 0, visible: true, scale: 1 }; }

// ---------- humanoid (player / zombie / skeleton / armor) ----------
function humanoid(tex, { armW = 4, legW = 4, texW = 64, texH = 64, hat = true, limbs64 = true, armUV = [40, 16], legUV = [0, 16], leftArmUV = null, leftLegUV = null } = {}) {
  const aw = armW, lw = legW;
  const lArm = leftArmUV ?? (limbs64 ? [32, 48] : armUV);
  const lLeg = leftLegUV ?? (limbs64 ? [16, 48] : legUV);
  const mirrorLeft = !leftArmUV && !limbs64;
  return {
    texture: tex, texW, texH,
    root: part([0, 0, 0], [], {
      body: part([0, 24, 0], [box([-4, 12, -2], [8, 12, 4], [16, 16])]),
      head: part([0, 24, 0], [box([-4, 24, -4], [8, 8, 8], [0, 0])].concat(hat ? [box([-4, 24, -4], [8, 8, 8], [32, 0], { inflate: 0.5 })] : [])),
      rightArm: part([5, 22, 0], [box([4, 12, -aw / 2], [aw, 12, aw], armUV)]),
      leftArm: part([-5, 22, 0], [box([-4 - aw, 12, -aw / 2], [aw, 12, aw], lArm, { mirror: mirrorLeft })]),
      rightLeg: part([1.9, 12, 0], [box([1.9 - lw / 2, 0, -lw / 2], [lw, 12, lw], legUV)]),
      leftLeg: part([-1.9, 12, 0], [box([-1.9 - lw / 2, 0, -lw / 2], [lw, 12, lw], lLeg, { mirror: mirrorLeft })]),
    }),
  };
}

function quadruped(tex, { legH, bodyFrom, bodySize, bodyUV, headPivot, headBoxes, legUV = [0, 16], legW = 4, legPos, texW = 64, texH = 64 }) {
  const legs = {};
  legPos.forEach(([x, z], i) => {
    legs['leg' + i] = part([x, legH, z], [box([x - legW / 2, 0, z - legW / 2], [legW, legH, legW], legUV, { mirror: x < 0 })]);
  });
  return {
    texture: tex, texW, texH,
    root: part([0, 0, 0], [], {
      body: part([0, 0, 0], [box(bodyFrom, bodySize, bodyUV)]),
      head: part(headPivot, headBoxes),
      ...legs,
    }),
  };
}

export const MODELS = {
  player: () => humanoid('player'),
  zombie: () => humanoid('zombie'),
  skeleton: () => humanoid('skeleton', { armW: 2, legW: 2, texH: 32, hat: false, limbs64: false }),
  creeper: () => {
    const m = quadruped('creeper', {
      legH: 6, bodyFrom: [-4, 6, -2], bodySize: [8, 12, 4], bodyUV: [16, 16], headPivot: [0, 18, 0],
      headBoxes: [box([-4, 18, -4], [8, 8, 8], [0, 0])], legPos: [[2, -4], [-2, -4], [2, 4], [-2, 4]], texH: 32,
    });
    // creeper legs are placed under the body (front pair at -Z)
    return m;
  },
  pig: () => {
    const m = quadruped('pig', {
      legH: 6, bodyFrom: [-5, 6, -8], bodySize: [10, 8, 16], bodyUV: [0, 32], headPivot: [0, 12, -6],
      headBoxes: [box([-4, 8, -14], [8, 8, 8], [0, 0]), box([-2, 9, -15], [4, 3, 1], [16, 16])],
      legPos: [[3, -5], [-3, -5], [3, 7], [-3, 7]],
    });
    return m;
  },
  cow: () => {
    const m = quadruped('cow', {
      legH: 12, bodyFrom: [-6, 12, -9], bodySize: [12, 10, 18], bodyUV: [0, 32], headPivot: [0, 20, -8],
      headBoxes: [box([-4, 16, -14], [8, 8, 6], [0, 0]), box([4, 22, -12], [1, 3, 1], [22, 0]), box([-5, 22, -12], [1, 3, 1], [22, 0], { mirror: true })],
      legPos: [[4, -6], [-4, -6], [4, 7], [-4, 7]],
    });
    m.root.children.body.boxes.push(box([-2, 11, 2], [4, 1, 6], [40, 0]));
    return m;
  },
  sheep: () => {
    const m = quadruped('sheep', {
      legH: 12, bodyFrom: [-4, 12, -8], bodySize: [8, 6, 16], bodyUV: [0, 32], headPivot: [0, 18, -7],
      headBoxes: [box([-3, 16, -14], [6, 6, 8], [0, 0])], legPos: [[3, -5], [-3, -5], [3, 7], [-3, 7]],
    });
    return m;
  },
  sheep_fur: () => {
    const legs = {};
    [[3, -5], [-3, -5], [3, 7], [-3, 7]].forEach(([x, z], i) => {
      legs['leg' + i] = part([x, 12, z], [box([x - 2, 6, z - 2], [4, 6, 4], [0, 16], { inflate: 0.5, mirror: x < 0 })]);
    });
    return {
      texture: 'sheep_fur', texW: 64, texH: 64,
      root: part([0, 0, 0], [], {
        body: part([0, 0, 0], [box([-4, 12, -8], [8, 6, 16], [0, 32], { inflate: 1.75 })]),
        head: part([0, 18, -7], [box([-3, 17, -12], [6, 6, 6], [0, 0], { inflate: 0.6 })]),
        ...legs,
      }),
    };
  },
  chicken: () => ({
    texture: 'chicken', texW: 64, texH: 32,
    root: part([0, 0, 0], [], {
      body: part([0, 0, 0], [box([-3, 5, -4], [6, 6, 8], [0, 9])]),
      head: part([0, 9, -4], [box([-2, 9, -6], [4, 6, 3], [0, 0]), box([-2, 11, -8], [4, 2, 2], [14, 0]), box([-1, 9, -7], [2, 2, 2], [14, 4])]),
      rightLeg: part([1.5, 5, 1], [box([0, 0, -0.5], [3, 5, 3], [26, 0])]),
      leftLeg: part([-1.5, 5, 1], [box([-3, 0, -0.5], [3, 5, 3], [26, 0], { mirror: true })]),
      rightWing: part([3, 11, -3], [box([3, 7, -3], [1, 4, 6], [38, 0])]),
      leftWing: part([-3, 11, -3], [box([-4, 7, -3], [1, 4, 6], [38, 0], { mirror: true })]),
    }),
  }),
  spider: () => {
    const legs = {};
    for (let i = 0; i < 8; i++) {
      const right = i % 2 === 0;
      const z = [-1, 0, 1, 2][Math.floor(i / 2)];
      legs['leg' + i] = part([right ? 4 : -4, 9, z], [box(right ? [4, 8, z - 1] : [-20, 8, z - 1], [16, 2, 2], [18, 0], { mirror: !right })]);
    }
    return {
      texture: 'spider', texW: 64, texH: 32,
      root: part([0, 0, 0], [], {
        neck: part([0, 9, 0], [box([-3, 6, -3], [6, 6, 6], [0, 0])]),
        abdomen: part([0, 9, 3], [box([-5, 5, 3], [10, 8, 12], [0, 12])]),
        head: part([0, 9, -3], [box([-4, 5, -11], [8, 8, 8], [32, 4])]),
        ...legs,
      }),
    };
  },
  enderman: () => ({
    texture: 'enderman', texW: 64, texH: 32,
    root: part([0, 0, 0], [], {
      body: part([0, 38, 0], [box([-4, 26, -2], [8, 12, 4], [32, 16])]),
      head: part([0, 38, 0], [box([-4, 38, -4], [8, 8, 8], [0, 0])]),
      rightArm: part([5, 36, 0], [box([4, 6, -1], [2, 30, 2], [56, 0])]),
      leftArm: part([-5, 36, 0], [box([-6, 6, -1], [2, 30, 2], [56, 0], { mirror: true })]),
      rightLeg: part([2, 30, 0], [box([1, 0, -1], [2, 30, 2], [56, 0])]),
      leftLeg: part([-2, 30, 0], [box([-3, 0, -1], [2, 30, 2], [56, 0], { mirror: true })]),
    }),
  }),
  zombified_piglin: () => {
    const m = humanoid('zombified_piglin', { hat: false });
    const head = m.root.children.head;
    head.boxes = [box([-5, 24, -4], [10, 8, 8], [0, 0]), box([-2, 24, -5], [4, 4, 1], [31, 1])];
    head.children = {
      rightEar: part([4.5, 30, 0], [box([4.5, 25, -2], [1, 5, 4], [39, 6])]),
      leftEar: part([-4.5, 30, 0], [box([-5.5, 25, -2], [1, 5, 4], [51, 6])]),
    };
    head.children.rightEar.rz = Math.PI / 6; head.children.leftEar.rz = -Math.PI / 6;
    return m;
  },
  ghast: () => {
    const tentacles = {};
    for (let i = 0; i < 9; i++) {
      const fx = ((i % 3) - (Math.floor(i / 3) % 2) * 0.5 + 0.25) / 2 * 2 - 1;
      const fz = (Math.floor(i / 3) / 2 * 2 - 1);
      const len = 7 + ((i * 7919 + 13) % 7);
      tentacles['t' + i] = part([fx * 5, 0, fz * 5], [box([fx * 5 - 1, -len, fz * 5 - 1], [2, len, 2], [0, 32])]);
    }
    return { texture: 'ghast', texW: 64, texH: 64, root: part([0, 0, 0], [], { body: part([0, 0, 0], [box([-8, 0, -8], [16, 16, 16], [0, 0])]), ...tentacles }) };
  },
  blaze: () => {
    const rods = {};
    for (let i = 0; i < 12; i++) rods['r' + i] = part([0, 0, 0], [box([-1, -4, -1], [2, 8, 2], [0, 16])]);
    return { texture: 'blaze', texW: 64, texH: 32, root: part([0, 0, 0], [], { head: part([0, 20, 0], [box([-4, 20, -4], [8, 8, 8], [0, 0])]), ...rods }) };
  },
  // Enchanting-table book, in unflipped block-entity space (spine along Y, closed pages extend +X).
  enchanting_table_book: () => ({
    texture: 'enchanting_table_book', texW: 64, texH: 32,
    root: part([0, 0, 0], [], {
      leftLid: part([0, 0, -1], [box([-6, -5, -1.005], [6, 10, 0.005], [0, 0])]),
      rightLid: part([0, 0, 1], [box([0, -5, 1], [6, 10, 0.005], [16, 0])]),
      seam: part([0, 0, 0], [box([-1, -5, 0], [2, 10, 0.005], [12, 0])]),
      leftPages: part([0, 0, 0], [box([0, -4, -0.99], [5, 8, 1], [0, 10])]),
      rightPages: part([0, 0, 0], [box([0, -4, -0.01], [5, 8, 1], [12, 10])]),
      flip1: part([0, 0, 0], [box([0, -4, 0], [5, 8, 0.005], [24, 10])]),
      flip2: part([0, 0, 0], [box([0, -4, 0], [5, 8, 0.005], [24, 10])]),
    }),
  }),
  magma_cube: () => ({
    texture: 'magma_cube', texW: 64, texH: 32,
    root: part([0, 0, 0], [], { core: part([0, 0, 0], [box([-2, 2, -2], [4, 4, 4], [32, 0])]), body: part([0, 0, 0], [box([-4, 0, -4], [8, 8, 8], [0, 0])]) }),
  }),
  armor1: (tex) => {
    const m = humanoid(tex, { texH: 32, hat: false, limbs64: false });
    // armor layer 1 is inflated by 1
    for (const p of Object.values(m.root.children)) for (const b of p.boxes) b.inflate = 1;
    m.root.children.leftArm.boxes[0].uv = [40, 16]; m.root.children.leftArm.boxes[0].mirror = true;
    m.root.children.leftLeg.boxes[0].uv = [0, 16]; m.root.children.leftLeg.boxes[0].mirror = true;
    return m;
  },
  armor2: (tex) => {
    const m = humanoid(tex, { texH: 32, hat: false, limbs64: false });
    for (const p of Object.values(m.root.children)) for (const b of p.boxes) b.inflate = 0.5;
    m.root.children.head.visible = false;
    m.root.children.rightArm.visible = false; m.root.children.leftArm.visible = false;
    m.root.children.leftLeg.boxes[0].uv = [0, 16]; m.root.children.leftLeg.boxes[0].mirror = true;
    return m;
  },
};

// ---------- animation (modelled on vanilla setupAnim) ----------
// Conventions: rx = vanilla xRot, ry = -(vanilla yRot), rz = vanilla zRot (our model space is vanilla's rotated 180deg about Z).
// state: { limbSwing, limbAmount, ageInTicks, headYaw (relative, ccw rad), headPitch (up positive), attackAnim, ... }
function bobArms(c, age) {
  c.rightArm.rz += Math.cos(age * 0.09) * 0.05 + 0.05;
  c.rightArm.rx += Math.sin(age * 0.067) * 0.05;
  c.leftArm.rz -= Math.cos(age * 0.09) * 0.05 + 0.05;
  c.leftArm.rx -= Math.sin(age * 0.067) * 0.05;
}
function resetPart(p) { p.rx = 0; p.ry = 0; p.rz = 0; if (p.basePivot) p.pivot = p.basePivot.slice(); else p.basePivot = p.pivot.slice(); }

export function animate(type, m, s) {
  const c = m.root.children;
  for (const p of Object.values(c)) resetPart(p);
  const ls = s.limbSwing, la = s.limbAmount;
  const headX = -s.headPitch; // vanilla xRot (down positive)
  if (c.head) { c.head.ry = s.headYaw; c.head.rx = headX; }
  switch (type) {
    case 'player': case 'zombie': case 'skeleton': case 'armor1': case 'armor2': {
      c.rightArm.rx = Math.cos(ls * 0.6662 + PI) * 2 * la * 0.5;
      c.leftArm.rx = Math.cos(ls * 0.6662) * 2 * la * 0.5;
      c.rightLeg.rx = Math.cos(ls * 0.6662) * 1.4 * la;
      c.leftLeg.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * la;
      if (s.riding) { c.rightArm.rx -= PI / 5; c.leftArm.rx -= PI / 5; c.rightLeg.rx = -1.4137; c.rightLeg.ry = -PI / 10; c.leftLeg.rx = -1.4137; c.leftLeg.ry = PI / 10; }
      if (s.holding) c.rightArm.rx = c.rightArm.rx * 0.5 - PI / 10;
      if (s.blocking) { c.leftArm.rx = c.leftArm.rx * 0.5 - 0.9424779; c.leftArm.ry = -0.5235988; }
      if (s.bowPose) {
        c.rightArm.ry = -(-0.1 - s.headYaw * -1) ; c.leftArm.ry = -(0.1 - s.headYaw + 0.4);
        c.rightArm.ry = 0.1 + s.headYaw; c.leftArm.ry = -0.5 + s.headYaw;
        c.rightArm.rx = -PI / 2 + headX; c.leftArm.rx = -PI / 2 + headX;
      }
      if (s.attackAnim > 0 && !s.zombieArms) {
        const f = s.attackAnim;
        const bodyY = Math.sin(Math.sqrt(f) * PI * 2) * 0.2;
        c.body.ry = -bodyY;
        c.rightArm.ry += -bodyY; c.leftArm.ry += -bodyY; c.leftArm.rx += bodyY;
        let g = 1 - f; g *= g; g *= g; g = 1 - g;
        const f1 = Math.sin(g * PI);
        const f2 = Math.sin(f * PI) * -(headX - 0.7) * 0.75;
        c.rightArm.rx -= f1 * 1.2 + f2;
        c.rightArm.ry += -bodyY * 2;
        c.rightArm.rz += Math.sin(f * PI) * -0.4;
      }
      if (s.sneaking) {
        c.body.rx = 0.5;
        c.rightArm.rx += 0.4; c.leftArm.rx += 0.4;
        c.rightLeg.pivot = [1.9, 11.8, 4]; c.leftLeg.pivot = [-1.9, 11.8, 4];
        c.rightLeg.boxOffset = [0, -0.2, 4];
      }
      if (s.zombieArms) {
        const f = Math.sin(s.attackAnim * PI), f1 = Math.sin((1 - (1 - s.attackAnim) * (1 - s.attackAnim)) * PI);
        c.rightArm.rz = 0; c.leftArm.rz = 0;
        c.rightArm.ry = (0.1 - f * 0.6); c.leftArm.ry = -(0.1 - f * 0.6);
        const f2 = -PI / (s.aggressive ? 1.5 : 2.25);
        c.rightArm.rx = f2 + f * 1.2 - f1 * 0.4; c.leftArm.rx = f2 + f * 1.2 - f1 * 0.4;
      }
      bobArms(c, s.ageInTicks);
      break;
    }
    case 'zombified_piglin': {
      animate('zombie', m, { ...s, zombieArms: s.aggressive });
      if (!s.aggressive) { const c2 = m.root.children; c2.rightArm.rx = Math.cos(ls * 0.6662 + PI) * 2 * la * 0.5 * 0.5 - PI / 10; c2.leftArm.rx = Math.cos(ls * 0.6662) * la * 0.5; }
      const ears = c.head.children;
      if (ears.rightEar) { ears.rightEar.rz = PI / 6 + Math.sin(s.ageInTicks * 0.1) * 0.05 + la * 0.3; ears.leftEar.rz = -(PI / 6 + Math.sin(s.ageInTicks * 0.1) * 0.05 + la * 0.3); }
      return;
    }
    case 'ghast': {
      for (let i = 0; i < 9; i++) c['t' + i].rx = 0.2 * Math.sin(s.ageInTicks * 0.3 + i) + 0.4;
      break;
    }
    case 'blaze': {
      const a = s.ageInTicks;
      let f = a * PI * -0.1;
      for (let i = 0; i < 4; i++) { const r = c['r' + i]; r.pivot = [Math.cos(f) * 9, 24 - 2 + Math.cos((i * 2 + a) * 0.25) - 8, Math.sin(f) * 9]; f += PI / 2; }
      f = PI / 4 + a * PI * 0.03;
      for (let i = 4; i < 8; i++) { const r = c['r' + i]; r.pivot = [Math.cos(f) * 7, 24 - 2 - Math.cos((i * 2 + a) * 0.25) - 12, Math.sin(f) * 7]; f += PI / 2; }
      f = 0.47123894 + a * PI * -0.05;
      for (let i = 8; i < 12; i++) { const r = c['r' + i]; r.pivot = [Math.cos(f) * 5, 24 - 11 - Math.cos((i * 1.5 + a) * 0.5) - 6, Math.sin(f) * 5]; f += PI / 2; }
      for (let i = 0; i < 12; i++) { const r = c['r' + i]; r.boxes[0].from = [r.pivot[0] - 1, r.pivot[1] - 4, r.pivot[2] - 1]; }
      break;
    }
    case 'magma_cube': break;
    case 'enchanting_table_book': {
      // s.ageInTicks = time, s.flip1/flip2 = page flips, s.open = 0..1 (vanilla BookModel.setupAnim)
      const f = (Math.sin(s.ageInTicks * 0.02) * 0.1 + 1.25) * s.open;
      c.leftLid.ry = PI + f; c.rightLid.ry = -f;
      c.seam.ry = PI / 2;
      c.leftPages.ry = f; c.rightPages.ry = -f;
      c.flip1.ry = f - f * 2 * s.flip1; c.flip2.ry = f - f * 2 * s.flip2;
      const sx = Math.sin(f);
      for (const k of ['leftPages', 'rightPages', 'flip1', 'flip2']) { c[k].pivot = [sx, 0, 0]; c[k].boxes[0].from[0] = sx; }
      break;
    }
    case 'creeper': case 'pig': case 'cow': case 'sheep': case 'sheep_fur': {
      // leg0 right-front, leg1 left-front, leg2 right-hind, leg3 left-hind
      c.leg0.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * la;
      c.leg1.rx = Math.cos(ls * 0.6662) * 1.4 * la;
      c.leg2.rx = Math.cos(ls * 0.6662) * 1.4 * la;
      c.leg3.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * la;
      if ((type === 'sheep' || type === 'sheep_fur') && s.eatAnim > 0) {
        const t = s.eatAnim;
        const drop = t > 4 && t <= 36 ? 1 : t <= 4 ? t / 4 : (40 - t) / 4;
        c.head.pivot = [c.head.basePivot[0], c.head.basePivot[1] - drop * 9, c.head.basePivot[2]];
        c.head.rx = t > 4 && t <= 36 ? PI / 5 + 0.2199 * Math.sin((t - 4) / 32 * 28.7) : drop * PI / 5;
      }
      break;
    }
    case 'chicken': {
      c.rightLeg.rx = Math.cos(ls * 0.6662) * 1.4 * la;
      c.leftLeg.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * la;
      c.rightWing.rz = s.flap; c.leftWing.rz = -s.flap;
      break;
    }
    case 'spider': {
      const f = PI / 4, f1 = PI / 8;
      // k: 0 front, 1 middle-front, 2 middle-hind, 3 hind (vanilla yRot for the RIGHT leg)
      const yR = [-f1 * 2, -f1, f1, f1 * 2];
      const zR = [-f, -f * 0.74, -f * 0.74, -f];
      const phY = [PI * 1.5, PI / 2, PI, 0];
      const phZ = [PI * 1.5, PI / 2, PI, 0];
      for (let i = 0; i < 8; i++) {
        const k = Math.floor(i / 2), right = i % 2 === 0;
        const l = c['leg' + i];
        const oy = -(Math.cos(ls * 0.6662 * 2 + phY[k]) * 0.4) * la;
        const oz = Math.abs(Math.sin(ls * 0.6662 + phZ[k]) * 0.4) * la;
        const yRot = right ? yR[k] + oy : -yR[k] - oy;
        const zRot = right ? zR[k] + oz : -zR[k] - oz;
        l.ry = -yRot; l.rz = zRot;
      }
      break;
    }
    case 'enderman': {
      c.rightArm.rx = Math.cos(ls * 0.6662 + PI) * 2 * la * 0.5 * 0.5;
      c.leftArm.rx = Math.cos(ls * 0.6662) * 2 * la * 0.5 * 0.5;
      c.rightLeg.rx = Math.cos(ls * 0.6662) * 1.4 * la * 0.5;
      c.leftLeg.rx = Math.cos(ls * 0.6662 + PI) * 1.4 * la * 0.5;
      c.rightArm.rx = Math.max(-1, Math.min(1, c.rightArm.rx)); c.leftArm.rx = Math.max(-1, Math.min(1, c.leftArm.rx));
      if (s.attackAnim > 0) c.rightArm.rx -= Math.sin(s.attackAnim * PI) * 1.2;
      if (s.angry) c.head.pivot = [0, 43, 0];
      break;
    }
    default: break;
  }
}

// ---------- geometry ----------
// Builds triangles for the model into the vertex writer.
// writer(x,y,z,u,v,nx,ny,nz) where coordinates are in model space (pixels) after part transforms.
export function buildModel(m, writer) {
  const stack = [];
  walk(m.root, identity3(), [0, 0, 0]);
  void stack;
  function walk(p, parentRot, parentOrigin) {
    if (!p.visible) return;
    // world transform of this part: rotate around pivot (applied after parent)
    const R = mul3(parentRot, rotZYX(p.rx, p.ry, p.rz));
    const pivotW = add3(parentOrigin, apply3(parentRot, p.pivot));
    const toWorld = (x, y, z) => {
      const l = apply3(R, [x - p.pivot[0], y - p.pivot[1], z - p.pivot[2]]);
      return [pivotW[0] + l[0], pivotW[1] + l[1], pivotW[2] + l[2]];
    };
    for (const b of p.boxes) emitBox(b, m.texW, m.texH, toWorld, R, writer);
    for (const c of Object.values(p.children)) {
      // children pivots are expressed in the same model coordinates; convert via this part's transform
      walkChild(c, R, toWorld);
    }
  }
  function walkChild(c, R, toWorld) {
    if (!c.visible) return;
    const Rc = mul3(R, rotZYX(c.rx, c.ry, c.rz));
    const pw = toWorld(c.pivot[0], c.pivot[1], c.pivot[2]);
    const tw = (x, y, z) => {
      const l = apply3(Rc, [x - c.pivot[0], y - c.pivot[1], z - c.pivot[2]]);
      return [pw[0] + l[0], pw[1] + l[1], pw[2] + l[2]];
    };
    for (const b of c.boxes) emitBox(b, m.texW, m.texH, tw, Rc, writer);
    for (const cc of Object.values(c.children)) walkChild(cc, Rc, tw);
  }
}

// Face UV rectangles for a box (Minecraft unwrap), in pixels: returns per face {u0,v0,u1,v1} with orientation info
function emitBox(b, texW, texH, toWorld, R, writer) {
  const [W, H, D] = b.size;
  const [u, v] = b.uv;
  const g = b.inflate;
  let x0 = b.from[0] - g, y0 = b.from[1] - g, z0 = b.from[2] - g;
  let x1 = b.from[0] + W + g, y1 = b.from[1] + H + g, z1 = b.from[2] + D + g;
  const U = (px) => px / texW, V = (py) => py / texH;
  // regions
  const right = [u, v + D, u + D, v + D + H];            // +X face
  const front = [u + D, v + D, u + D + W, v + D + H];    // -Z face
  const left = [u + D + W, v + D, u + 2 * D + W, v + D + H]; // -X face
  const back = [u + 2 * D + W, v + D, u + 2 * D + 2 * W, v + D + H]; // +Z face
  const top = [u + D, v, u + D + W, v + D];
  const bottom = [u + D + W, v, u + D + 2 * W, v + D];
  const mir = b.mirror;
  // quad helper: corners in order TL, BL, BR, TR as seen from outside, with (u,v) rect mapped left->right, top->bottom
  const quad = (pts, rect, flipU, n) => {
    let [a0, b0, a1, b1] = rect;
    if (flipU) { const t = a0; a0 = a1; a1 = t; }
    const uvs = [[a0, b0], [a0, b1], [a1, b1], [a1, b0]];
    const wn = apply3(R, n);
    const w = pts.map((p) => toWorld(p[0], p[1], p[2]));
    for (const k of [0, 1, 2, 0, 2, 3]) writer(w[k][0], w[k][1], w[k][2], U(uvs[k][0]), V(uvs[k][1]), wn[0], wn[1], wn[2]);
  };
  // -Z (front): viewer's left is +X
  quad([[x1, y1, z0], [x1, y0, z0], [x0, y0, z0], [x0, y1, z0]], front, mir, [0, 0, -1]);
  // +Z (back): viewer's left is -X
  quad([[x0, y1, z1], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1]], back, mir, [0, 0, 1]);
  // +X face (right side of the mob unless mirrored): viewer's left is back (+Z)
  quad([[x1, y1, z1], [x1, y0, z1], [x1, y0, z0], [x1, y1, z0]], mir ? left : right, mir, [1, 0, 0]);
  // -X face: viewer's left is front (-Z)
  quad([[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]], mir ? right : left, mir, [-1, 0, 0]);
  // top: texture left = +X, top row = back (+Z)
  quad([[x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [x0, y1, z1]], top, mir, [0, 1, 0]);
  // bottom: texture left = +X, top row = front (-Z)
  quad([[x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y0, z0]], bottom, mir, [0, -1, 0]);
}

// ---------- tiny 3x3 matrix helpers (row-major) ----------
function identity3() { return [1, 0, 0, 0, 1, 0, 0, 0, 1]; }
function mul3(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function apply3(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function add3(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
// rotation = Rz * Ry * Rx (Minecraft ModelPart order), rx positive tips the part's bottom toward -Z (forward swing)
function rotZYX(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return mul3(Rz, mul3(Ry, Rx));
}
export { rotZYX, apply3, mul3 };
