// Every tunable number lives here. Values follow the pacing table in docs/PLAN.md.

export const GAME_TITLE = 'Sus Station';

// Lobby settings the host can change. `range` drives the settings screen.
export const SETTINGS = {
  players: { label: 'Players', def: 10, min: 4, max: 15, step: 1 },
  impostors: { label: 'Impostors', def: 2, min: 1, max: 3, step: 1 },
  confirmEjects: { label: 'Confirm Ejects', def: true },
  emergencyMeetings: { label: 'Emergency Meetings', def: 1, min: 0, max: 9, step: 1 },
  emergencyCooldown: { label: 'Emergency Cooldown', def: 15, min: 0, max: 60, step: 5, unit: 's' },
  discussionTime: { label: 'Discussion Time', def: 15, min: 0, max: 120, step: 15, unit: 's' },
  votingTime: { label: 'Voting Time', def: 120, min: 15, max: 300, step: 15, unit: 's' },
  anonymousVotes: { label: 'Anonymous Votes', def: false },
  playerSpeed: { label: 'Player Speed', def: 1, min: 0.5, max: 3, step: 0.25, unit: 'x' },
  crewVision: { label: 'Crewmate Vision', def: 1, min: 0.25, max: 5, step: 0.25, unit: 'x' },
  impostorVision: { label: 'Impostor Vision', def: 1.5, min: 0.25, max: 5, step: 0.25, unit: 'x' },
  killCooldown: { label: 'Kill Cooldown', def: 30, min: 10, max: 60, step: 2.5, unit: 's' },
  killDistance: { label: 'Kill Distance', def: 'normal', options: ['short', 'normal', 'long'] },
  visualTasks: { label: 'Visual Tasks', def: true },
  taskBarUpdates: { label: 'Task Bar Updates', def: 'always', options: ['always', 'meetings', 'never'] },
  commonTasks: { label: 'Common Tasks', def: 1, min: 0, max: 2, step: 1 },
  longTasks: { label: 'Long Tasks', def: 1, min: 0, max: 3, step: 1 },
  shortTasks: { label: 'Short Tasks', def: 2, min: 0, max: 5, step: 1 },
};

export function defaultSettings() {
  const s = {};
  for (const [k, v] of Object.entries(SETTINGS)) s[k] = v.def;
  return s;
}

// Fixed timings (seconds).
export const TIMING = {
  shhh: 1.6,
  roleReveal: 3.6,
  firstKillCooldown: 10,
  meetingSplash: 2.6,
  voteResults: 5,
  ejection: 7.5,
  killAnimation: 1.6,
  reactorMeltdown: 30,
  o2Depletion: 30,
  doorsClosed: 10,
  doorCooldown: 17,
  sabotageCooldown: 30,
  firstSabotageCooldown: 10,
  lightsFade: 1.5,
  sampleWait: 60,
  dataTransfer: 8,
  scan: 10,
  ventAnim: 0.35,
  gameOverMin: 5,
};

// Distances in map cells.
export const DIST = {
  speed: 4.5, // cells per second at 1x
  vision: 6, // crew vision radius at 1x
  lightsOutFactor: 0.25,
  kill: { short: 1.2, normal: 1.8, long: 2.5 },
  use: 1.4,
  report: 2.6,
  playerRadius: 0.3,
  viewHeight: 14, // cells visible vertically (landscape)
};

// Character colors: [name, body, shadow]
export const COLORS = [
  ['Red', '#c51111', '#7a0838'],
  ['Blue', '#132ed1', '#09158e'],
  ['Green', '#117f2d', '#0a4d2e'],
  ['Pink', '#ed54ba', '#ab2bad'],
  ['Orange', '#ef7d0d', '#b33e15'],
  ['Yellow', '#f5f557', '#c38823'],
  ['Black', '#3f474e', '#1e1f26'],
  ['White', '#d6e0f0', '#8394bf'],
  ['Purple', '#6b2fbb', '#3b177c'],
  ['Brown', '#71491e', '#5e2615'],
  ['Cyan', '#38fedc', '#24a8be'],
  ['Lime', '#50ef39', '#15a742'],
  ['Maroon', '#6b2b3c', '#41131f'],
  ['Rose', '#ecc0d3', '#de92b3'],
  ['Banana', '#f0e7a8', '#d2bc89'],
  ['Gray', '#758593', '#46565f'],
  ['Tan', '#918877', '#51413e'],
  ['Coral', '#d76464', '#b4434e'],
];

export const BOT_NAMES = [
  'Nova',
  'Pip',
  'Juno',
  'Rook',
  'Mika',
  'Zed',
  'Lumi',
  'Otto',
  'Kit',
  'Bram',
  'Suki',
  'Rex',
  'Ivy',
  'Taro',
  'Wren',
  'Fizz',
  'Dax',
  'Momo',
  'Quill',
  'Sol',
];
