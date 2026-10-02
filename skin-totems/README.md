# Skin Totems — Minecraft Java 1.21.11

A client-only Fabric API mod that turns a held Totem of Undying into a flat, custom-totem-style figure (arms out, 14x15 pixels, copied straight from the skin) wearing **the holder's Minecraft skin**. Each visible player gets their own skin, including slim arms and hat/jacket/sleeve/pants layers.

## Install

1. Install **Fabric Loader 0.18.4 or newer** for **Minecraft Java 1.21.11** using https://fabricmc.net/use/installer/.
2. Put **Fabric API 0.141.6+1.21.11** and `skin-totems-1.0.0.jar` into that profile's `mods` folder. Fabric API downloads: https://modrinth.com/mod/fabric-api/versions?g=1.21.11.
3. Launch the Fabric profile and hold a Totem of Undying in either hand.

Fabric API is used for model registration. Fabric Loader is still required to load any Fabric API mod; the two are complementary, not alternatives. No server mod or resource pack is required. Other players only see the effect if they also install the mod.

## Behavior

- Works in main hand and offhand, in first and third person.
- Uses each holder's skin already loaded by Minecraft. Until a skin loads, Minecraft's default skin is used automatically.
- Skin overlay layers are included; no extra web requests are made by this mod.
- Inventory icons, dropped items, item frames, non-player holders, and the totem activation animation retain their normal appearance. This mod targets held totems only.
- It is an original 3D mini-player implementation inspired by the linked generator, not a copy of that site's downloadable art or its six styles.
- Mods that also replace held-totem rendering may conflict.

## Build

Use JDK 21 (recommended), then run:

```sh
./gradlew build
```

Windows:

```bat
gradlew.bat build
```

The installable file is `build/libs/skin-totems-1.0.0.jar`. The `-sources.jar` is for developers, not for the mods folder.

Run the isolated Fabric client integration test (requires a graphical desktop):

```sh
./gradlew runClientGameTest
```

The test creates a temporary singleplayer world, checks all four hand contexts with distinct local/remote skins, checks vanilla fallback contexts, captures first/third-person screenshots, and reloads resources. Tests are in a separate test mod and are not included in the release JAR.

## Implementation

Fabric API registers the classic and slim model layers. A client mixin selects the renderer only for player-held totems. Minecraft's special item renderer queues the model with an immutable skin snapshot for that holder. The renderer caches only two model roots and replaces them when the loaded model set changes on resource reload.

References: https://www.minecraftmaps.com/tools/custom-totem-maker and https://maven.fabricmc.net/docs/yarn-1.21.11+build.6/.

## 1.1.0 layout
`TotemLayout` maps skin texels onto the sprite (head 1:1, torso/arms/legs squashed). `tools/intermediary-build` is a Gradle-free build of the same code using intermediary names, used to produce `skin-totems-1.1.0.jar` without Mojang access; build with `./gradlew build` for a normal remapped jar.
