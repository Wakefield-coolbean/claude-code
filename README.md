# Sus Station

A social deduction game built to match *Among Us* in gameplay, look and pacing, with original art, map and names.
4–15 crewmates on a spaceship; most do tasks, 1–3 secret Impostors kill, vent and sabotage. Find bodies, call
meetings, argue, vote, eject. Play online with friends or offline against bots, on desktop or phone.

- [docs/PLAN.md](docs/PLAN.md): goals, rules, pacing numbers, visual style, architecture, milestones, risks
- [docs/FEATURES.md](docs/FEATURES.md): every feature by area, with priority and status

## Play

```bash
npm install
npm start        # http://localhost:8080
```

The title menu offers **Online**, **How To Play** and **Freeplay**.

- **Freeplay**: you and bots. Walk around the dropship lobby, use the laptop to change your color or pick
  your role, then press Start.
- **Online**: enter a name, then **Host** a game (you get a 6-letter code), browse **Public** games, or type a
  **Private** code. Empty seats fill with bots unless the host turns off "Fill With Bots".

### Playing with friends

`npm start` runs one server that serves the game and hosts the online rooms.

- **Same Wi-Fi:** friends open `http://<your computer's IP>:8080`.
- **Over the internet:** deploy the `Dockerfile` to any host that supports WebSockets (Render, Fly.io,
  Railway, a small VPS) and share its URL. Or run `npm start` and expose port 8080 with a tunnel such as
  `cloudflared tunnel --url http://localhost:8080`.
- If you open the game some other way (for example the single-file build), set the server address under
  Settings (gear icon on the title screen), e.g. `wss://your-host.example/ws`.

`npm run build` writes `dist/sus-station.html`, a single file that plays Freeplay with no server.

| Action | Keyboard | Touch |
| --- | --- | --- |
| Move | WASD / arrows, or hold the mouse button | Drag anywhere |
| Use / tasks / emergency button / laptop | E or Space | USE |
| Report body | R | REPORT |
| Kill (Impostor) | Q | KILL |
| Vent (Impostor) | V, then click the arrows | VENT |
| Sabotage (Impostor) | F | SABOTAGE |
| Map | Tab or M | Map button |
| Close / pause | Esc | ✕ / gear |

## What's in it

- **The Kestrel**: 14 rooms, 5 vent networks, doors, emergency button, admin table; crewmates in proportion to the ship
- **Dropship lobby**: walk around before the game, customize at the laptop, room code, settings list, host Start with countdown
- Line-of-sight vision with hard shadows; lights sabotage shrinks crew vision
- 17 task minigames, 4 sabotage panels (Lights, Comms, O2, Reactor) and door locks
- Kills, bodies, reports, emergency meetings, discussion and voting timers, chat with quick chat,
  vote reveal, ejection cutscene, confirm ejects, ghosts, all four win conditions
- Bots that do tasks, remember who they saw with whom, hunt, vent, sabotage, fix sabotage,
  argue in meetings, react to your chat, and vote
- Online rooms for up to 15 players: authoritative server, players only receive what they can see,
  movement and actions checked on the server, bots take over dropped seats
- Synthesized sound: layered effects with reverb, footsteps, ship hum, menu and lobby music, volume sliders
- Every sprite drawn in code; no image or audio files

## Project layout

```
src/
  config.js       pacing numbers and settings
  map.js          ship and dropship layouts as data
  grid.js         collision, wall segments, line of sight, vision polygon
  path.js         A* for bots
  game.js         the rules (no DOM): roles, kills, tasks, sabotage, meetings, votes, wins
  bots.js         bot behavior
  session.js      freeplay session (you + bots, in the browser)
  net.js          online session (mirrors the server's game, sends actions)
  render.js       map chunks, characters, fog of war, effects
  sprites.js      procedural crewmate / ghost / body art
  menu.js         title, online, how to play, settings screens
  lobby.js        dropship lobby overlay
  hud.js          task list, task bar, buttons, map overlay
  meeting.js      meeting screen
  screens.js      role reveal, splashes, ejection, game over, pause
  input.js        keyboard, touch joystick, mouse
  audio.js        synthesized sound and music
  tasks/          task definitions, minigame host and kit, one file per minigame
server/           room server (npm start)
tests/            rule, map and server tests (npm test)
scripts/          dev server, single-file build, bot soak test
dev/              minigame bench, sound bench, map overview pages
```

## Checks

```bash
npm test                          # 25 rule, map and server tests
node scripts/soak.mjs 100 10 2    # 100 bot-only games: win rates, game length, meetings
```

With the default 10 players and 2 impostors, bot-only games split close to 50/50 between impostors and
crew, last about 6.5 minutes and have about 3 meetings.
