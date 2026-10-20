// Task definitions for The Kestrel and how they are dealt to players.
// A task is a list of steps; each step happens at a station and opens a minigame.
// `bot` is how long a bot stands at the console for that step (seconds).

import { TIMING } from '../config.js';

const WIRE_PANELS = ['wires_el', 'wires_st', 'wires_ad', 'wires_ca', 'wires_se', 'wires_br'];
const DATA_SOURCES = ['data_co', 'data_we', 'data_br', 'data_el', 'data_ca'];
const DIVERT_TARGETS = [
  ['accept_we', 'Weapons'],
  ['accept_o2', 'O2'],
  ['accept_br', 'Bridge'],
  ['accept_sh', 'Shields'],
  ['accept_co', 'Comms'],
  ['accept_se', 'Security'],
];

export const TASK_DEFS = [
  {
    id: 'wiring',
    name: 'Fix Wiring',
    kind: 'common',
    make: (rng) => {
      const order = WIRE_PANELS.slice()
        .sort(() => rng() - 0.5)
        .slice(0, 3);
      order.sort((a, b) => WIRE_PANELS.indexOf(a) - WIRE_PANELS.indexOf(b));
      return order.map((station) => ({ station, game: 'wiring', bot: 4 }));
    },
  },
  { id: 'swipe', name: 'Swipe Card', kind: 'common', make: () => [{ station: 'swipe_ad', game: 'swipe', bot: 3.5 }] },
  {
    id: 'fuel',
    name: 'Fuel Engines',
    kind: 'long',
    make: () => [
      { station: 'fuel_st', game: 'fuel', data: { mode: 'fill' }, bot: 3.5 },
      { station: 'fuel_pe', game: 'fuel', data: { mode: 'empty' }, bot: 3.5 },
      { station: 'fuel_st', game: 'fuel', data: { mode: 'fill' }, bot: 3.5 },
      { station: 'fuel_sb', game: 'fuel', data: { mode: 'empty' }, bot: 3.5 },
    ],
  },
  {
    id: 'sample',
    name: 'Inspect Sample',
    kind: 'long',
    make: () => [
      { station: 'sample_mb', game: 'sample', data: { phase: 'start' }, bot: 2, waitAfter: TIMING.sampleWait },
      { station: 'sample_mb', game: 'sample', data: { phase: 'pick' }, bot: 2.5 },
    ],
  },
  { id: 'reactor', name: 'Start Reactor', kind: 'long', make: () => [{ station: 'simon_re', game: 'simon', bot: 12 }] },
  {
    id: 'scan',
    name: 'Submit Scan',
    kind: 'long',
    visual: true,
    make: () => [{ station: 'scan_mb', game: 'scan', bot: TIMING.scan + 0.5 }],
  },
  {
    id: 'upload',
    name: 'Upload Data',
    kind: 'long',
    make: (rng) => {
      const src = DATA_SOURCES[Math.floor(rng() * DATA_SOURCES.length)];
      return [
        { station: src, game: 'data', data: { mode: 'download' }, bot: TIMING.dataTransfer + 1 },
        { station: 'upload_ad', game: 'data', data: { mode: 'upload' }, bot: TIMING.dataTransfer + 1 },
      ];
    },
  },
  {
    id: 'asteroids',
    name: 'Clear Asteroids',
    kind: 'long',
    visual: true,
    make: () => [{ station: 'asteroids_we', game: 'asteroids', bot: 14 }],
  },
  {
    id: 'align',
    name: 'Align Engine Output',
    kind: 'short',
    make: () => [
      { station: 'align_pe', game: 'align', bot: 2.5 },
      { station: 'align_sb', game: 'align', bot: 2.5 },
    ],
  },
  {
    id: 'distributor',
    name: 'Calibrate Distributor',
    kind: 'short',
    make: () => [{ station: 'distributor_el', game: 'distributor', bot: 5 }],
  },
  { id: 'chart', name: 'Chart Course', kind: 'short', make: () => [{ station: 'chart_br', game: 'chart', bot: 4 }] },
  { id: 'filter', name: 'Clean O2 Filter', kind: 'short', make: () => [{ station: 'filter_o2', game: 'filter', bot: 5 }] },
  {
    id: 'divert',
    name: 'Divert Power',
    kind: 'short',
    make: (rng) => {
      const [station, room] = DIVERT_TARGETS[Math.floor(rng() * DIVERT_TARGETS.length)];
      return [
        { station: 'divert_el', game: 'divert', data: { mode: 'divert', room }, bot: 3 },
        { station, game: 'divert', data: { mode: 'accept', room }, bot: 2 },
      ];
    },
  },
  { id: 'shields', name: 'Prime Shields', kind: 'short', visual: true, make: () => [{ station: 'shields_sh', game: 'shields', bot: 3.5 }] },
  { id: 'steering', name: 'Stabilize Steering', kind: 'short', make: () => [{ station: 'steering_br', game: 'steering', bot: 2.5 }] },
  { id: 'manifolds', name: 'Unlock Manifolds', kind: 'short', make: () => [{ station: 'manifolds_re', game: 'manifolds', bot: 5 }] },
  {
    id: 'garbage',
    name: 'Empty Garbage',
    kind: 'short',
    visual: true,
    make: () => [
      { station: 'garbage_ca', game: 'garbage', bot: 3.5 },
      { station: 'garbage_st', game: 'garbage', bot: 3.5 },
    ],
  },
];

/** Bot time at a sabotage fix point. */
export const FIX_TIME = { lights: 3, o2: 4, comms: 4 };

function pick(list, n, rng) {
  const a = list.slice();
  const out = [];
  while (out.length < n && a.length) out.push(a.splice(Math.floor(rng() * a.length), 1)[0]);
  return out;
}

/**
 * Deal tasks. Common tasks are the same for every crewmate (as in the original);
 * long and short tasks are drawn per player.
 */
export function dealTasks(settings, rng) {
  const byKind = (k) => TASK_DEFS.filter((t) => t.kind === k);
  const common = pick(byKind('common'), settings.commonTasks, rng);
  const commonSteps = common.map((def) => [def, def.make(rng)]);
  return () => {
    const defs = [
      ...commonSteps.map(([def, steps]) => [def, steps]),
      ...pick(byKind('long'), settings.longTasks, rng).map((def) => [def, def.make(rng)]),
      ...pick(byKind('short'), settings.shortTasks, rng).map((def) => [def, def.make(rng)]),
    ];
    return defs.map(([def, steps]) => ({
      id: def.id,
      name: def.name,
      kind: def.kind,
      visual: !!def.visual && settings.visualTasks,
      steps: steps.map((s) => ({ ...s, data: s.data ? { ...s.data } : undefined })),
      step: 0,
      done: false,
      readyAt: 0, // game time when the current step unlocks (Inspect Sample wait)
    }));
  };
}
