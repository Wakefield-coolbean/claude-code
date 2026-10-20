// Bot-only soak test: plays many headless games and prints pacing stats.
// usage: node scripts/soak.mjs [games=40] [players=10] [impostors=2]
import { Game } from '../src/game.js';
import { Bots } from '../src/bots.js';
import { defaultSettings } from '../src/config.js';

const games = Number(process.argv[2]) || 40;
const players = Number(process.argv[3]) || 10;
const impostors = Number(process.argv[4]) || 2;
const DT = 1 / 30;
let pending = [];
const setTimeout0 = (f) => pending.push(f);
const flush = () => {
  const p = pending;
  pending = [];
  p.forEach((f) => f());
};
const results = [];

for (let i = 0; i < games; i++) {
  const settings = { ...defaultSettings(), players, impostors };
  const game = new Game({ settings, seed: 1000 + i, local: null });
  const bots = new Bots(game);
  let meetings = 0;
  let ejectedImps = 0;
  let ejectedCrew = 0;
  let kills = 0;
  let sabotages = 0;
  let witnessed = 0;
  game.on('meeting', () => meetings++);
  game.on('kill', ({ victim }) => {
    kills++;
    setTimeout0(() => {
      if ([...bots.brains.values()].some((b) => b.evidence.some((e) => e.kind === 'kill' && e.victim === victim.id))) witnessed++;
    });
  });
  game.on('sabotage', () => sabotages++);
  game.on('eject', (e) => {
    if (e.player?.role === 'impostor') ejectedImps++;
    else if (e.player) ejectedCrew++;
  });
  let playTime = 0;
  while (game.phase !== 'over' && game.t < 1800) {
    bots.tick(DT);
    game.tick(DT);
    flush();
    if (game.phase === 'play') playTime += DT;
  }
  bots.destroy();
  results.push({
    winner: game.result?.winner || 'timeout',
    reason: game.result?.reason || 'timeout',
    minutes: game.t / 60,
    playMinutes: playTime / 60,
    meetings,
    kills,
    sabotages,
    witnessed,
    ejectedImps,
    ejectedCrew,
    tasks: game.taskProgress(),
  });
}

const avg = (k) => results.reduce((s, r) => s + r[k], 0) / results.length;
const count = (f) => results.filter(f).length;
console.log(`${games} games, ${players} players, ${impostors} impostors`);
console.log(
  `impostor wins: ${count((r) => r.winner === 'impostor')}  crew wins: ${count((r) => r.winner === 'crew')}  timeouts: ${count((r) => r.winner === 'timeout')}`,
);
for (const reason of ['tasks', 'vote', 'kills', 'sabotage', 'timeout']) console.log(`  ${reason}: ${count((r) => r.reason === reason)}`);
console.log(
  `avg length ${avg('minutes').toFixed(1)} min (${avg('playMinutes').toFixed(1)} min roaming), meetings ${avg('meetings').toFixed(1)}, kills ${avg('kills').toFixed(1)} (${avg('witnessed').toFixed(1)} witnessed), sabotages ${avg('sabotages').toFixed(1)}`,
);
console.log(
  `ejections per game: impostors ${avg('ejectedImps').toFixed(2)}, crew ${avg('ejectedCrew').toFixed(2)}; task progress at end ${(avg('tasks') * 100).toFixed(0)}%`,
);
