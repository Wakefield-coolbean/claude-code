# Totem Destroy Pop

A client-side Fabric mod for Minecraft Java **1.21.11**. When a Totem of Undying lying on the ground burns up or is
destroyed, you hear a quieter, higher-pitched totem pop and see a small burst of totem particles.

It triggers when a totem item is destroyed by:

- fire or lava
- an explosion (TNT, end crystals, creepers, beds, respawn anchors, ...)
- a cactus
- lightning
- falling into the void

Picking a totem up, despawning, hoppers and walking out of range do not trigger it. Any item with the
`death_protection` component (custom totems) counts as a totem too.

It only runs on your client, so it works on any server, including vanilla ones.

## Install

1. Install [Fabric Loader](https://fabricmc.net/use/) for 1.21.11.
2. Put [Fabric API](https://modrinth.com/mod/fabric-api) for 1.21.11 in your `mods` folder.
3. Put `totem-destroy-pop-1.1.0.jar` in your `mods` folder.

## Config

`config/totemdestroypop.json` is created on first launch:

| Option | Default | What it does |
| --- | --- | --- |
| `volume` | `0.4` | Pop volume. A real totem pop is `1.0`. Uses the Players volume slider. |
| `pitch` | `1.6` | Pop pitch. A real totem pop is `1.0`; Minecraft caps it at `2.0`. |
| `particleTicks` | `12` | How many ticks particles spray for. A real pop sprays for `30`; `0` turns them off. |
| `particlesPerTick` | `3` | Particles per tick. A real pop does about `8`. |
| `particleSize` | `0.5` | Particle size, where `1.0` is a real pop's particle size. |
| `maxSoundsPerTick` | `3` | Most pops heard at once, so a whole pile of totems blowing up isn't deafening. |
| `fire`, `explosions`, `cactus`, `lightning`, `voidDamage` | `true` | Which kinds of destruction trigger the effect. |

Restart the game after editing it. Config files from version 1.0.0 are upgraded to the new pitch and particle
defaults automatically, unless you had changed those values.

## How it works

The server only tells the client that an item is gone, not why. So when a totem item disappears, the mod checks what
was happening to it: whether it was on fire, in or touching lava, fire or cactus, below the world, next to a
lightning bolt, or inside the blast radius of an explosion that arrived at the same moment. If one of those explains
it, the totem was destroyed and the effect plays at its last position.

## Building

```sh
./gradlew build
```

The jar ends up in `build/libs/`. Building needs Java 21 or newer. Every push also builds on GitHub Actions, which
uploads the jar as an artifact.
