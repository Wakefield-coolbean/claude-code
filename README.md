# Sus Station

A social deduction game built to match *Among Us* in gameplay, look and pacing, with original art, map and names.
4–15 crewmates on a spaceship; most do tasks, 1–3 secret Impostors kill, vent and sabotage. Find bodies, call
meetings, argue, vote, eject.

This repository holds the **plan**, the **feature list**, and a **playable offline prototype** (Milestone 1):
you against bots, in the browser, on desktop or phone.

- [docs/PLAN.md](docs/PLAN.md): goals, rules, pacing numbers, visual style, architecture, milestones, risks
- [docs/FEATURES.md](docs/FEATURES.md): every feature by area, with priority and prototype status

## Play

```bash
npm install      # esbuild, only for the single-file build
npm run dev      # http://localhost:8080
```

Or run `npm run build` and open `dist/sus-station.html` directly, with no server.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | WASD / arrows, or hold the mouse button | Drag anywhere |
| Use / tasks / emergency button | E or Space | USE |
| Report body | R | REPORT |
| Kill (Impostor) | Q | KILL |
| Vent (Impostor) | V, then click the arrows | VENT |
| Sabotage (Impostor) | F | SABOTAGE |
| Map | Tab or M | Map button |
| Close / pause | Esc | ✕ / gear |

Pick **Crewmate** or **Impostor** on the menu to force your role, or leave it on Random.

## What's in the prototype

- **The Kestrel**: 14 rooms, 5 vent networks, doors, emergency button, admin table
- Line-of-sight vision with hard shadows; lights sabotage shrinks crew vision
- 17 task minigames, 4 sabotage panels (Lights, Comms, O2, Reactor) and door locks
- Kills, bodies, reports, emergency meetings, discussion and voting timers, chat with quick chat,
  vote reveal, ejection cutscene, confirm ejects, ghosts, all four win conditions
- Bots that do tasks, remember who they saw with whom, hunt, vent, sabotage, fix sabotage,
  argue in meetings, react to your chat, and vote
- The original's core lobby settings (player count, kill cooldown, vision, timers, task counts, and more)
- Sound effects synthesized in the browser; every sprite drawn in code (no asset files)

## Project layout

```
src/
  config.js       pacing numbers and settings
  map.js          ship layout data
  grid.js         collision, wall segments, line of sight, vision polygon
  path.js         A* for bots
  game.js         the rules (no DOM): roles, kills, tasks, sabotage, meetings, votes, wins
  bots.js         bot behavior
  render.js       map chunks, characters, fog of war, effects
  sprites.js      procedural crewmate / ghost / body art
  hud.js          task list, task bar, buttons, map overlay
  meeting.js      meeting screen
  screens.js      menu, role reveal, splashes, ejection, game over
  input.js        keyboard, touch joystick, mouse
  audio.js        synthesized sound effects
  tasks/          task definitions, minigame host and kit, one file per minigame
tests/            rule and map tests (npm test)
scripts/          dev server, single-file build, bot soak test
dev/              minigame bench and map overview pages
```

## Checks

```bash
npm test                          # 18 rule and map tests
node scripts/soak.mjs 100 10 2    # 100 bot-only games: win rates, game length, meetings
```

With the default 10 players and 2 impostors, bot-only games split 48 % impostor / 52 % crew,
last 6.5 minutes on average and have 2.7 meetings.

## Next

Milestone 2 is online multiplayer: an authoritative Node.js room server that runs the same
`game.js` rules, room codes, lobby and reconnects. See [docs/PLAN.md](docs/PLAN.md#6-milestones).
