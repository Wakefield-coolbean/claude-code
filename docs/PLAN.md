# Sus Station: Game Plan

**Sus Station** (working title) is a social deduction game that plays, looks and paces like *Among Us*.
4–15 crewmates share a spaceship. Most are **Crewmates** who finish tasks; 1–3 are secret **Impostors**
who kill, vent and sabotage. Bodies trigger meetings, the crew argues, votes, and ejects someone.

This document is the production plan. The full feature list lives in [FEATURES.md](FEATURES.md).
A playable offline prototype (Milestone 1) is in this repository; see [Running the prototype](#9-running-the-prototype).

---

## 1. Goals

| Goal | What it means in practice |
| --- | --- |
| **Same gameplay** | Identical rules, roles, win conditions, meeting/vote flow, task and sabotage mechanics, and lobby settings. |
| **Same visuals** | 2D top-down ship in 3/4 view, thick-outlined bean astronauts in 18 flat colors, hard line-of-sight shadows, chunky outlined UI text, big square action buttons. |
| **Same pacing** | Same timers and cooldowns (Section 3), so a 10-player game lasts about 6–12 minutes. |
| **Plays everywhere** | Desktop and phone browsers first (keyboard and touch), app stores later. |

### Originality guardrail

*Among Us*, its map layouts, character designs, art, sounds and name belong to Innersloth. Game rules and
mechanics are not protected, but assets and specific expression are. So we copy the **rules, numbers and
feel**, and make our **own** art, map layouts, names, text and audio. Concretely:

- Original title, ship ("The Kestrel"), room layout, prop art and sound effects.
- Our character is a generic "astronaut bean"; before any public release, the art pass gives it a
  distinct silhouette (helmet shape, backpack, visor) so it reads as ours.
- No ripped sprites, fonts, audio or map art, ever, even as placeholders.

---

## 2. The core loop

```
 Lobby ──► Role reveal ──► Free roam ──────────────────────────────► Game over
 (settings,  ("Shhh!" then      │  Crew: tasks, watch, report            ▲
  colors)    Crewmate/Impostor) │  Impostor: fake tasks, kill,           │ win check after every
                                │  vent, sabotage, doors                 │ kill, ejection, task
                                ▼                                        │ and sabotage timeout
                       Meeting called (body report or emergency button)  │
                                │                                        │
                    Discussion ─► Voting ─► Results ─► Ejection ─────────┘
                                                        │
                                            back to Free roam (all players
                                            respawn around the meeting table)
```

**Win conditions**

| Side | Wins when |
| --- | --- |
| Crewmates | Every task of every crewmate (alive or dead) is done, **or** every impostor is ejected. |
| Impostors | Living impostors ≥ living crewmates, **or** a critical sabotage (Reactor / O2) timer runs out. |

**Key rules**

- Dead crewmates become ghosts: they walk through walls, still finish their tasks, and cannot talk to the living.
- Dead impostors become ghosts that can still sabotage (not close doors or kill).
- Meetings clear all bodies, cancel Reactor/O2, open doors, and reset everyone's kill cooldown.
- The emergency button is blocked during any sabotage except doors.
- Only one major sabotage can run at a time; doors are per room and run in parallel.
- Impostors see each other (red names) and cannot kill each other.

---

## 3. Pacing reference

These are the numbers that make the game *feel* right. Every one is a constant in `src/config.js`.

### Lobby settings (host-adjustable)

| Setting | Range | Our default |
| --- | --- | --- |
| Players | 4–15 | 10 |
| Impostors | 1–3 | 2 (1 when ≤ 6 players) |
| Confirm ejects | on / off | on |
| Emergency meetings per player | 0–9 | 1 |
| Emergency cooldown | 0–60 s | 15 s |
| Discussion time | 0–120 s | 15 s |
| Voting time | 0–300 s | 120 s (ends early when everyone has voted) |
| Anonymous votes | on / off | off |
| Player speed | 0.5–3× | 1× |
| Crewmate vision | 0.25–5× | 1× |
| Impostor vision | 0.25–5× | 1.5× |
| Kill cooldown | 10–60 s | 30 s |
| Kill distance | short / normal / long | normal |
| Visual tasks | on / off | on |
| Task bar updates | always / meetings / never | always |
| Common / long / short tasks | 0–2 / 0–3 / 0–5 | 1 / 1 / 2 |

### Fixed timings

| Event | Duration |
| --- | --- |
| "Shhhhh!" splash, then role reveal | ~1.5 s + ~3.5 s |
| First kill cooldown after the round starts | 10 s |
| Kill cooldown after every meeting | full setting |
| Meeting splash ("Emergency Meeting!" / "Dead Body Reported") | ~2.5 s |
| Vote results shown | ~5 s |
| Ejection cutscene | ~7 s |
| Reactor meltdown countdown | 30 s, two hand scanners held at the same time |
| O2 depletion countdown | 30 s, two keypads (O2 and Admin) |
| Lights | no timer; crew vision fades to ~25 % over ~1.5 s |
| Comms | no timer; hides task list, task arrows and the admin map |
| Doors | locked 10 s; per-room re-lock cooldown ~17 s |
| Major sabotage cooldown | 30 s after the previous one is fixed (first one available 10 s into a round) |
| Inspect Sample wait | 60 s |
| Download / Upload | ~8 s each |
| Submit Scan | 10 s |

### Distances (in map cells; a crewmate is about 1.1 cells wide)

| Distance | Value |
| --- | --- |
| Player speed at 1× | 4.5 cells/s (crossing the cafeteria takes ~4 s) |
| Crew vision radius at 1× | 6.8 cells; screen shows ~16 cells vertically |
| Kill distance short / normal / long | 1.4 / 2.1 / 2.9 cells |
| Use (tasks, button, vents) | 1.6 cells |
| Report | 3 cells, needs line of sight |

### Pacing targets for tuning

- A 10-player game lasts 6–12 minutes and has 2–4 meetings.
- Impostor win rate between 45 % and 55 % with default settings (measured with bot soak tests).
- A crewmate with 4 tasks finishes in about 2–3 minutes of uninterrupted play.

---

## 4. Visual style guide

| Element | Rule |
| --- | --- |
| Camera | Locked on your character, top-down with a 3/4 tilt: floors seen from above, north walls show their front face. |
| Characters | Bean body, backpack, glass visor, two stubby legs. Flat body color plus one shadow tone, thick black outline. 18 colors (red, blue, green, pink, orange, yellow, black, white, purple, brown, cyan, lime, maroon, rose, banana, gray, tan, coral). |
| Animation | Snappy, low-frame walk cycle; idle has no bob. Ghosts float with a wavy tail at ~50 % opacity. Bodies are the lower half of the bean with a bone. |
| Vision | Hard-edged shadow polygon from walls. Outside your vision the map is darkened but visible; players outside it are hidden. Ghosts see everything. |
| Map | Readable room silhouettes with distinct floor colors per room; dark void outside the hull; props (tables, beds, engines) block movement but not sight. Task consoles get a yellow outline when you have a task there. |
| UI | White text with heavy black outline. Task list top-left, green task bar on top, map and settings top-right, big square USE / REPORT / KILL / VENT / SABOTAGE buttons bottom-right with cooldown numbers. |
| Big moments | Full-screen splashes for role reveal, meetings, ejection (character tumbling through stars with typed-out text) and victory/defeat. Kill shows a short animation to the victim. Reactor/O2 flash the screen red. |

Production art is drawn as vector or 2× raster sprites in this style. The prototype draws everything procedurally
in code so it needs no asset files.

---

## 5. Technical architecture

### Stack

| Layer | Choice | Why |
| --- | --- | --- |
| Client | TypeScript, HTML5 Canvas 2D (prototype), PixiJS (WebGL) for production | Instant play from a link on desktop and mobile; the prototype already runs this way. |
| Server | Node.js with an authoritative room server (Colyseus or plain `ws`) | Same language as the client, so game rules are shared code. |
| Shared | `sim` package: pure game rules with no DOM | Runs on the server for real games and on the client for freeplay, prediction and tests. |
| Packaging | Capacitor (iOS/Android), Electron or Tauri (Steam) | One codebase for every store. |
| Hosting | Room servers in containers in 3–4 regions, behind a matchmaking service | Low latency for a game that is mostly walking. |

The prototype is plain JavaScript ES modules (no framework) so it runs with a static file server.
It moves to TypeScript when the simulation is shared with the server (Milestone 2).

### Module layout

```
src/
  config.js        settings, timings, colors, distances (the pacing table)
  map.js           ship layout as data: rooms, corridors, props, doors, vents, task stations
  grid.js          walkability grid, wall segments, collision, line of sight, vision polygon
  path.js          A* over the grid for bots
  game.js          the simulation: players, roles, kills, bodies, tasks, sabotage, meetings, votes, wins
  bots.js          bot brains: tasks, perception, suspicion, hunting, sabotage, chat and voting
  render.js        camera, cached map chunks, y-sorted entities, fog of war, effects
  sprites.js       procedural character, ghost and body art
  hud.js           task list, task bar, action buttons, minimap, arrows
  meeting.js       meeting screen: chat, quick chat, vote, results
  screens.js       menu, role reveal, meeting splash, kill animation, ejection, game over
  input.js         keyboard and touch joystick
  audio.js         synthesized sound effects
  tasks/           task definitions and one module per minigame
  main.js          wires it together, runs the frame loop
```

### Rules for the simulation

- All state changes go through action functions (`move`, `kill`, `report`, `vote`, `sabotage`, ...).
  Freeplay calls them directly; online play sends them as messages and the server calls the same functions.
- The simulation emits events (`kill`, `meetingStart`, `taskDone`, ...) that the renderer, HUD, audio and bots consume.
- Randomness comes from a seeded RNG so games are reproducible in tests.

### Networking model (Milestone 2, core built)

- **Authoritative server** (`server/`). It runs the same `game.js` and `bots.js` as freeplay. Clients send
  actions; the server validates every kill (role, cooldown, distance, line of sight), task step (standing at
  the console), vent, report, sabotage fix and vote with the same rule functions.
- **Movement.** Each client moves its own crewmate immediately and reports its position 15 times a second;
  the server rejects moves that are too fast or pass through walls and snaps the player back. Other players
  are shown ~120 ms behind, interpolated between snapshots. Server ticks at 30 Hz, snapshots at 15 Hz.
- **Vision culling.** Each snapshot only contains the players and bodies that client can see (ghosts see
  everyone), and kill news only reaches the victim, the killer, impostors, ghosts and witnesses.
- **Rooms.** 6-letter codes, public game list, host settings and kick, host migration, a bot takes over a
  dropped seat, bots fill empty seats. Still to do: rejoin after a disconnect, regions, chat filter.

---

## 6. Milestones

Durations assume one or two developers plus part-time art and audio.

| # | Milestone | Deliverable | Exit criteria | Est. |
| --- | --- | --- | --- | --- |
| 0 | Pre-production | This plan, feature list, pacing table, map blockout | Team agrees on scope and art direction | 1 wk |
| 1 | **Offline vertical slice** (this repo) | One full ship, full round loop vs bots in the browser | A full game against bots is fun and finishes in 6–12 min | 2–3 wks |
| 2 | Online multiplayer core (core built) | Room server, room codes, lobby, sync, meetings and votes online, reconnect | 10 players across regions finish games with no desyncs | 4–6 wks |
| 3 | Map 1 content complete | Every task and sabotage, admin map, security cameras, door logic, all visual tasks | Every feature in FEATURES.md marked P0/P1 for Map 1 works online | 3–4 wks |
| 4 | Art and audio pass | Final character, map art, animations, kill animations, music, SFX | Matches the style guide; 60 fps on mid-range phones | 4–6 wks (parallel to 2–3) |
| 5 | Lobby, cosmetics, safety | Customization, quick chat, chat filter, report/ban, accounts, settings, accessibility | Ready for strangers to play together | 3–4 wks |
| 6 | Beta and launch | Closed beta, metrics, balance pass, store builds | Crash-free > 99.5 %, impostor win rate 45–55 % | 3–4 wks |
| 7 | Post-launch | New maps, roles, Hide and Seek mode | Ongoing | — |

### Milestone 1 scope (built in this repo)

- The Kestrel: 14 rooms, corridors, doors, 5 vent networks, emergency button.
- Movement with collision, keyboard and touch joystick, camera follow, line-of-sight fog.
- Roles, role reveal, fake tasks for impostors, task list, task bar, multi-step tasks with arrows.
- 17 task minigames plus the 4 sabotage fix panels.
- Kill with cooldown and range, bodies, kill animation, vents with network hopping.
- Sabotage: Lights, Comms, O2, Reactor, Doors, with countdowns and red alarms.
- Report and emergency meetings, discussion and voting timers, chat with quick chat, skip, vote reveal, ejection, confirm ejects.
- Ghosts (walk through walls, keep doing tasks), all four win conditions, victory/defeat screens.
- Bots for every other seat: do tasks, notice bodies, remember sightings, hunt when impostor, sabotage, fix sabotage, chat, accuse and vote.
- Lobby settings screen covering the main settings.

### Milestone 2 progress (built in this repo)

- Node.js server (`npm start`) serving the game and running rooms over WebSockets.
- Title menu laid out like the original (Online / How To Play / Freeplay), online screen with
  Host / Public / Private, walkable dropship lobby with customize laptop, room code, settings list,
  host-only Start with countdown.
- Online games for up to 15 players with bots in empty seats; everything from freeplay works online.
- Server tests for lobby rules, vision culling, movement checks, kill visibility and bot takeover.
- Remaining: rejoin after disconnect, regions/matchmaking, chat filter, load testing with 15 real clients.

---

## 7. Testing and tuning

- **Unit tests** (`npm test`) for the simulation: vote counting and ties, win conditions, kill validation,
  sabotage timers, grid connectivity (every task, vent and spawn reachable).
- **Bot soak tests:** run hundreds of headless bot-only games at high speed and record game length,
  meetings per game and win rates. Tune kill cooldown, task counts and bot skill against the pacing targets.
- **Playtests** every week from Milestone 2, with a short survey: was it fun, did meetings feel fair, how long did it feel.
- **Telemetry** in beta: game length, win rates by role and player count, quit rate during meetings, time to first meeting.

### Current soak results (Milestone 1 bots, default settings)

| Lobby | Impostor wins | Avg game | Meetings |
| --- | --- | --- | --- |
| 10 players, 2 impostors | 48 % (100 games) | 6.5 min | 2.7 |
| 15 players, 3 impostors | 38 % | 7.6 min | 3.5 |
| 6 players, 1 impostor | 25 % | 5.7 min | 1.9 |
| 8 players, 2 impostors | 88 % | 4.2 min | 1.6 |

10/2 hits the targets. The other sizes are why "recommended settings per player count" (longer kill
cooldown for small lobbies, shorter for big ones) is on the P1 list. Bots rarely witness kills, so most
crew wins come from tasks; smarter crew deduction is the main bot improvement for Milestone 2.

---

## 8. Risks

| Risk | Mitigation |
| --- | --- |
| Too close to the original's IP | Original art, map layout, names and audio from day one (Section 1). Legal review before launch. |
| Cheating (wallhacks, speed, fake kills) | Authoritative server, vision culling, server-side validation of every action. |
| Toxic chat | Quick chat mode, filter, report/mute/ban, age-appropriate defaults. |
| Empty lobbies at launch | Bots fill seats in public lobbies; freeplay mode; easy invite links. |
| Phone performance | Cached map chunks, sprite atlases, WebGL renderer, 30 fps fallback. |
| Netcode on mobile networks | Input-light design (walking), interpolation buffer, reconnect within 60 s. |
| Scope creep | Map 1 and the base roles only until launch; everything else is P2 in FEATURES.md. |

---

## 9. Running the prototype

```bash
npm install        # ws (server) and esbuild (build)
npm start          # game + online server at http://localhost:8080
npm test           # rule, map and server tests
npm run build      # bundles everything into dist/sus-station.html (single file, freeplay offline)
node scripts/soak.mjs 100 10 2   # 100 bot-only games: win rates, length, meetings
```

Friends on the same network open `http://<your computer's IP>:8080`. To play over the internet, deploy the
included `Dockerfile` to any host that supports WebSockets (Render, Fly.io, Railway, a VPS) and share that URL.

Controls: **WASD / arrows** move, **E** use, **R** report, **Q** kill, **V** vent, **F** sabotage,
**Tab** map, **Esc** close. On touch screens, drag anywhere on the left half to move and tap the buttons.
