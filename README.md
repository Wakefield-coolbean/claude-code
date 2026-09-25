# BlockCraft

A Minecraft-style voxel sandbox that runs entirely in the browser (WebGL2), modelled on **Java Edition 1.18**
("Caves & Cliffs Part II") gameplay, including the **1.9 combat system** (attack cooldown, sweeping, crits, shields).

All textures, the pixel font, sounds and music are **original procedurally-generated assets** made to closely evoke the
vanilla look and feel. BlockCraft is a fan project and is not affiliated with or endorsed by Mojang or Microsoft.

## Play

* **Easiest:** download [`BlockCraft.html`](BlockCraft.html) and open it in Chrome, Edge, Firefox or Safari. It is a single self-contained file.
* **From source:** `npx http-server -c-1 .` and open `http://localhost:8080` (ES modules need an HTTP server).
* **Rebuild the single file:** `npm install && npm run build`.

Worlds are saved automatically in your browser (IndexedDB).

### Controls (vanilla defaults, rebindable in Options → Controls)

| Action | Key |
| --- | --- |
| Move / jump / sneak / sprint | W A S D / Space / Shift / Ctrl or double-tap W |
| Attack, mine | Left mouse (hold to mine) |
| Use, place, eat, draw bow, block with shield | Right mouse (hold) |
| Pick block | Middle mouse |
| Inventory | E |
| Drop item (Ctrl = whole stack) | Q |
| Swap item to off hand | F |
| Hotbar | 1–9 / mouse wheel |
| Chat / command | T / `/` |
| Toggle perspective / debug screen / hide HUD | F5 / F3 / F1 |
| Fly (Creative) | Double-tap Space |

## Features

**World**
* 1.18 world height (Y −64 to 320), multi-noise terrain: oceans, rivers, beaches, plains, forests, birch/dark forests, taiga,
  snowy biomes, deserts, savannas, jungles, swamps, meadows, groves and jagged/frozen/stony peaks.
* Cheese, spaghetti and noodle caves, ravines, aquifers, lava below Y −54, deepslate below Y 0, 1.18 ore distributions
  (copper, iron, gold, diamond, lapis, redstone, coal, emerald) with deepslate variants, dungeons with spawners and loot chests.
* 12 tree types, flowers, grass, ferns, sugar cane, cacti, pumpkins, melons, berry bushes, lily pads, seagrass.
* Superflat, Amplified and Large Biomes world types.
* Sky light + block light flood-fill lighting, smooth lighting with ambient occlusion, biome-blended grass/foliage/water colours.
* Day/night cycle, sun, moon phases, stars, sunrise glow, 3D clouds, fog, rain/thunder weather state.
* Flowing water and lava (vanilla spread rules, infinite water sources, obsidian/cobblestone/stone generation),
  falling sand and gravel, fire spread, leaf decay, grass spread, crop/sapling/cactus/sugar-cane growth, farmland hydration.

**Survival**
* Health, hunger & saturation (vanilla regeneration and exhaustion rules), air/drowning, fall damage, lava, fire, cactus,
  suffocation, void; death screen, respawn, beds (set spawn, sleep through the night), Hardcore mode.
* Experience orbs and levels, mob loot, ore XP, furnace XP.
* Mining with vanilla break-time formula (tool tiers, efficiency, haste, underwater/airborne penalties), correct drops,
  tool durability.
* 2×2 and 3×3 crafting with ~200 recipes (shaped & shapeless, mirroring), furnace smelting and fuels, chests.
* Vanilla container click logic: shift-click, drag-splitting, double-click collecting, number-key swaps, Q to drop.
* Creative inventory with tabs, search and survival inventory tab; Survival, Creative, Adventure and Spectator modes.

**Combat (1.9+)**
* Attack cooldown indicator with damage scaling, critical hits, sweeping edge attacks, sprint knockback, invulnerability
  frames, armor & toughness formula, shields (blocking, axe disabling), bows with draw strength and critical arrows.

**Mobs**
* Zombies (burn in sunlight, babies), skeletons (strafing archers), creepers (swell & explode), spiders (climb walls,
  daylight-neutral), endermen (stare aggro, teleport), pigs, cows (milking), sheep (shearing, dyeing, eating grass,
  regrowing wool), chickens (eggs, flapping). A* pathfinding, 1.18 light-level-0 spawning rules, despawning, breeding.

**Interface**
* Title screen with live world panorama, world list, world creation, options (video, sound, controls, accessibility),
  pause menu, statistics, chat with commands and tab-completion, F3 debug screen, HUD with hearts, hunger, armour, air,
  XP bar and attack indicator, first-person hand/item animations, F5 third person.

**Commands:** `/gamemode`, `/time`, `/give`, `/tp`, `/summon`, `/kill`, `/weather`, `/difficulty`, `/effect`,
`/enchant`, `/xp`, `/gamerule`, `/setblock`, `/fill`, `/spawnpoint`, `/seed`, `/clear`, `/help`.

## Project layout

```
src/
  registry/   blocks, items, biomes, recipes, block shapes
  world/      chunks, world manager, lighting, storage, generation workers
  world/worldgen/  1.18-style terrain, caves, ores, surface rules, trees
  render/     WebGL2 renderer, chunk mesher, sky, entity/item/particle renderer, GUI icons
  entity/     physics, player, mobs & AI, items/xp/arrows/TNT
  game/       game loop, interaction (mining/placing/combat), block logic, inventory, commands
  ui/         canvas GUI toolkit, screens, containers, HUD
  textures/   procedural pixel-art generators (blocks, items, GUI, font, logo, mobs, particles, sky)
  audio/      synthesized sound effects and generative music
tools/        preview/verification scripts for textures, audio and world generation
```
