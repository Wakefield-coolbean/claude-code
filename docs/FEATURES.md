# Sus Station: Feature List

Every feature needed to match *Among Us* gameplay, visuals and pacing, grouped by area.
See [PLAN.md](PLAN.md) for the milestones and the pacing numbers.

**Priority:** **P0** = vertical slice (Milestone 1) · **P1** = needed for launch · **P2** = after launch
**Prototype:** ✅ done in this repo · 🟡 partly done · ⬜ not started

---

## 1. Roles and rules

| Feature | Priority | Prototype |
| --- | --- | --- |
| Crewmate role: do tasks, report bodies, call meetings, vote | P0 | ✅ |
| Impostor role: kill, vent, sabotage, close doors, fake tasks | P0 | ✅ |
| 1–3 impostors chosen at random; impostors see each other (red names) | P0 | ✅ |
| Impostors cannot kill each other or be assigned real tasks | P0 | ✅ |
| Crew win: all tasks done (alive and dead crew) | P0 | ✅ |
| Crew win: all impostors ejected | P0 | ✅ |
| Impostor win: impostors ≥ crewmates alive | P0 | ✅ |
| Impostor win: Reactor or O2 timer runs out | P0 | ✅ |
| Ghosts: walk through walls, see everything, keep doing tasks | P0 | ✅ |
| Impostor ghosts can still sabotage | P1 | ✅ |
| Ghost-only chat during meetings | P1 | ⬜ |
| Extra crew roles: Engineer (vents), Scientist (portable vitals), Guardian Angel (shield), Tracker, Noisemaker | P2 | ⬜ |
| Extra impostor roles: Shapeshifter, Phantom (invisible) | P2 | ⬜ |
| Hide and Seek mode | P2 | ⬜ |

## 2. Movement, camera and vision

| Feature | Priority | Prototype |
| --- | --- | --- |
| 8-direction movement with wall sliding, speed setting | P0 | ✅ |
| Keyboard (WASD / arrows) | P0 | ✅ |
| Touch joystick (drag on the left half of the screen) | P0 | ✅ |
| Mouse click-and-hold to move toward the cursor | P1 | ✅ |
| Camera locked on the player, 3/4 top-down view | P0 | ✅ |
| Walk cycle like the original: legs swing from the hips, body bounces and leans | P0 | ✅ |
| Visor follows the mouse (rests after 2 s of a still mouse); standing still, you turn toward it | P1 | ✅ |
| Bots glance at nearby crewmates or their console; look direction synced online | P1 | ✅ |
| Line-of-sight vision polygon with hard shadows; map stays faintly visible outside it | P0 | ✅ |
| Players and bodies hidden outside your vision | P0 | ✅ |
| Separate crew and impostor vision radius settings | P0 | ✅ |
| Lights sabotage shrinks crew vision, not impostor vision | P0 | ✅ |
| Gamepad support | P2 | ⬜ |

## 3. Tasks

| Feature | Priority | Prototype |
| --- | --- | --- |
| Task list (top-left) with room names and step counters; done tasks turn green | P0 | ✅ |
| Total task bar; "update always / at meetings / never" setting | P0 | ✅ |
| Common, long and short task counts from settings | P0 | ✅ |
| Yellow outline on consoles where you have a task | P0 | ✅ |
| Arrow to the next location for multi-step tasks | P0 | ✅ |
| Impostor "fake tasks" list | P0 | ✅ |
| Visual tasks show an effect others can see (Submit Scan, Clear Asteroids, Prime Shields, Empty Garbage) | P0 | ✅ |
| "Visual tasks" setting | P1 | ✅ |
| Closing a minigame cancels its progress | P0 | ✅ |

**Task minigames on The Kestrel**

| Task | Type | Where | Priority | Prototype |
| --- | --- | --- | --- | --- |
| Fix Wiring (3 panels) | Common | Electrical, Storage, Admin, Cafeteria, Security, Bridge | P0 | ✅ |
| Swipe Card | Common | Admin | P0 | ✅ |
| Fuel Engines (fill can, fuel both engines) | Long | Storage → Port Engine → Storage → Starboard Engine | P0 | ✅ |
| Inspect Sample (60 s wait) | Long | MedBay | P0 | ✅ |
| Start Reactor (memory sequence) | Long | Reactor | P0 | ✅ |
| Submit Scan (10 s, visual) | Long | MedBay | P0 | ✅ |
| Download / Upload Data | Long | Comms, Weapons, Bridge, Electrical, Cafeteria → Admin | P0 | ✅ |
| Clear Asteroids (visual) | Long | Weapons | P0 | ✅ |
| Align Engine Output | Short | Port Engine → Starboard Engine | P0 | ✅ |
| Calibrate Distributor | Short | Electrical | P0 | ✅ |
| Chart Course | Short | Bridge | P0 | ✅ |
| Clean O2 Filter | Short | O2 | P0 | ✅ |
| Divert Power | Short | Electrical → a room | P0 | ✅ |
| Prime Shields (visual) | Short | Shields | P0 | ✅ |
| Stabilize Steering | Short | Bridge | P0 | ✅ |
| Unlock Manifolds | Short | Reactor | P0 | ✅ |
| Empty Garbage (visual) | Short | Cafeteria → Storage | P0 | ✅ |

## 4. Impostor tools

| Feature | Priority | Prototype |
| --- | --- | --- |
| Kill button with cooldown (10 s at round start, full after meetings) and range setting | P0 | ✅ |
| Killer snaps to the victim; body left behind | P0 | ✅ |
| Victim sees a kill animation | P0 | ✅ |
| Unique kill animations per weapon (knife, tongue, gun, neck snap) | P1 | ✅ |
| In-world kill: killer lunges, victim's top half pops off, body drops; victim's ghost rises | P1 | ✅ |
| Vents: enter, exit, hop along a network with arrows; hidden while inside | P0 | ✅ |
| Vent animation visible to nearby players | P0 | ✅ |
| Sabotage map with cooldowns | P0 | ✅ |
| Fix Lights (5 switches in Electrical) | P0 | ✅ |
| Comms (dial in Comms; hides task list and admin map) | P0 | ✅ |
| O2 (two keypads, code note, 30 s) | P0 | ✅ |
| Reactor (two hand scanners held together, 30 s) | P0 | ✅ |
| Doors: lock a room for 10 s, per-room cooldown | P0 | ✅ |
| Red screen flash, alarm and arrows to the fix points during critical sabotage | P0 | ✅ |

## 5. Meetings and voting

| Feature | Priority | Prototype |
| --- | --- | --- |
| Report a body in range with line of sight | P0 | ✅ |
| Emergency button with per-player uses and cooldown; blocked during sabotage | P0 | ✅ |
| "Emergency Meeting!" / "Dead Body Reported" splash | P0 | ✅ |
| Meeting screen: player plates, dead players crossed out, reporter megaphone icon | P0 | ✅ |
| Discussion timer, then voting timer; voting ends early when everyone has voted | P0 | ✅ |
| Vote on a plate with confirm / cancel; skip vote | P0 | ✅ |
| "I voted" stickers during voting | P0 | ✅ |
| Results: voter icons on each plate (grey if anonymous votes) | P0 | ✅ |
| Ties and skip majorities eject no one | P0 | ✅ |
| Text chat with quick-chat buttons | P0 | ✅ |
| Free-text chat filter, rate limit | P1 | ⬜ |
| Everyone respawns around the cafeteria table after a meeting | P0 | ✅ |

## 6. Ejection and game over

| Feature | Priority | Prototype |
| --- | --- | --- |
| Ejection cutscene: crewmate tumbling through stars, typed-out text | P0 | ✅ |
| Confirm ejects on/off ("X was The Impostor." / "X was ejected.") and "N Impostors remain." | P0 | ✅ |
| "No one was ejected. (Skipped / Tie)" | P0 | ✅ |
| Victory / Defeat screen with the winning team lined up | P0 | ✅ |
| Play again / back to lobby | P0 | ✅ |
| End-of-game stats (kills, tasks, correct votes) | P2 | ⬜ |

## 7. Maps

| Feature | Priority | Prototype |
| --- | --- | --- |
| The Kestrel: 14 rooms, corridors, props, 5 vent networks | P0 | ✅ |
| Distinct floor art and props per room; dark hull outside | P0 | ✅ |
| Decor in every room and corridor: wall fittings, room signs, lamps, floor markings and direction signs, furniture, animated lights | P1 | ✅ |
| Doors on Cafeteria, MedBay, Security, Electrical, Storage and both engines | P0 | ✅ |
| Map overlay (Tab) with your position, task markers and sabotage markers | P0 | ✅ |
| Admin table: live player counts per room | P1 | ✅ |
| Security cameras (4 feeds) with blinking light when in use | P1 | ✅ |
| Door logs / vitals style info tools on later maps | P2 | ⬜ |
| Second map (larger, outdoor, vitals, seismic sabotage) | P2 | ⬜ |
| Third map (multi-floor with ladders, choose spawn) | P2 | ⬜ |

## 8. Lobby and settings

| Feature | Priority | Prototype |
| --- | --- | --- |
| Player count, impostor count | P0 | ✅ |
| Kill cooldown, kill distance, player speed, crew and impostor vision | P0 | ✅ |
| Emergency meetings and cooldown, discussion and voting time | P0 | ✅ |
| Confirm ejects, anonymous votes, task bar updates, visual tasks | P0 | ✅ |
| Common / long / short task counts | P0 | ✅ |
| Choose name and color | P0 | ✅ |
| Walkable pre-game lobby ship with laptop for cosmetics | P1 | ✅ |
| Host controls: kick, ban, start countdown | P1 | 🟡 (kick and countdown; no ban list) |
| Recommended settings presets per player count | P1 | ⬜ |

## 9. Online multiplayer

| Feature | Priority | Prototype |
| --- | --- | --- |
| Peer-to-peer play: the host's browser runs the room, others join by code over WebRTC | P1 | ✅ |
| Authoritative room server sharing the simulation code | P1 | ✅ (optional dedicated server) |
| Create room with 6-letter code, join by code | P1 | ✅ |
| Public lobby browser with filters (map, impostors, language) | P1 | 🟡 (dedicated server only, no filters) |
| Client prediction for own movement, interpolation for others | P1 | ✅ |
| Server-side vision culling and action validation (anti-cheat) | P1 | ✅ |
| Reconnect within 60 s, host migration | P1 | 🟡 (a bot takes over a dropped seat; dedicated server migrates the host; peer-to-peer games end if the host leaves) |
| Bots fill empty seats ("Fill With Bots" setting) | P2 | ✅ |
| Regions and matchmaking | P1 | ⬜ |

## 10. Customization

| Feature | Priority | Prototype |
| --- | --- | --- |
| 18 colors, one per player | P0 | ✅ |
| Hats (26), visors (8), skins (10), pets (8); synced online, bots dress at random | P1 | ✅ |
| Nameplates | P2 | ⬜ |
| Cosmetic preview on the lobby laptop (walking in place, with pet) | P1 | ✅ |
| Cosmetics shop / unlocks | P2 | ⬜ |

## 11. HUD and UI

| Feature | Priority | Prototype |
| --- | --- | --- |
| USE / REPORT / KILL / VENT / SABOTAGE buttons that light up when available | P0 | ✅ |
| Cooldown numbers on the kill and sabotage buttons | P0 | ✅ |
| Task bar, task list, map button, settings button | P0 | ✅ |
| Name tags above players (impostor teammates in red) | P0 | ✅ |
| Title menu in the original's layout: logo, drifting crewmates, Online / How To Play / Freeplay | P0 | ✅ |
| Online screen: enter name, Host / Public / Private with code entry | P1 | ✅ |
| How To Play pages | P1 | ✅ |
| Pause / settings menu (volume, controls, leave game) | P1 | ✅ |

## 12. Audio

| Feature | Priority | Prototype |
| --- | --- | --- |
| Kill, report, emergency alarm, vote, eject, task complete, vent, sabotage alarm SFX | P0 | ✅ (synthesized, with reverb) |
| Footsteps per floor type | P1 | 🟡 (footsteps, same on every floor) |
| Menu and meeting music, ambient ship hum | P1 | 🟡 (menu and lobby music, ship hum; no meeting music) |
| Volume sliders | P1 | ✅ (master, music, effects) |

## 13. Bots and freeplay

| Feature | Priority | Prototype |
| --- | --- | --- |
| Freeplay: you plus bots in every other seat | P0 | ✅ |
| Crew bots do tasks, report bodies, fix sabotage, call meetings on strong evidence | P0 | ✅ |
| Bots remember who they saw, where and when; witness kills and vents | P0 | ✅ |
| Impostor bots fake tasks, isolate targets, kill without witnesses, vent away, self-report | P0 | ✅ |
| Impostor bots sabotage (lights before hunting, critical sabotage to split the crew, doors to trap) | P0 | ✅ |
| Bots chat in meetings (alibis, accusations, defenses) and react to your chat | P0 | ✅ |
| Bots vote by suspicion with skip threshold | P0 | ✅ |
| Bot difficulty levels | P2 | ⬜ |
| Interactive tutorial | P2 | ⬜ |

## 14. Safety, accessibility, platform

| Feature | Priority | Prototype |
| --- | --- | --- |
| Chat filter, quick-chat-only accounts, report/mute/ban | P1 | ⬜ |
| Accounts, friends list, party invites | P1 | ⬜ |
| Colorblind aids (color names on plates, patterns), text size, reduced motion | P1 | 🟡 (color names in quick chat, reduced motion) |
| Remappable keys | P2 | ⬜ |
| Desktop and phone browsers | P0 | ✅ |
| iOS / Android (Capacitor), Steam (Electron or Tauri) | P1 | ⬜ |
| Localization | P2 | ⬜ |
| Telemetry: game length, win rates, quits | P1 | ⬜ |

## 15. Tooling

| Feature | Priority | Prototype |
| --- | --- | --- |
| Unit tests for rules and map (`npm test`) | P0 | ✅ |
| Headless bot soak test with pacing stats (`node scripts/soak.mjs`) | P0 | ✅ |
| Single-file build that runs from disk (`npm run build`) | P0 | ✅ |
| Minigame test bench (`dev/minigames.html`) and map overview (`dev/map.html`) | P1 | ✅ |
| CI running tests and soak on every push | P1 | ⬜ |
