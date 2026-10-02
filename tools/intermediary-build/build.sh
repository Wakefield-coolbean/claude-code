#!/usr/bin/env bash
# Builds skin-totems-<version>.jar. Minecraft/Fabric classes are only stubbed for compilation (see stubs/);
# the real ones are supplied by the game at runtime.
set -euo pipefail
cd "$(dirname "$0")"
out=$(mktemp -d)
javac --release 21 -d "$out/stubs" $(find stubs -name '*.java')
javac --release 21 -cp "$out/stubs" -d "$out/classes" $(find src -name '*.java')
cp mod-resources/fabric.mod.json mod-resources/skin_totems.mixins.json "$out/classes/"
jar --create --file skin-totems-1.1.0.jar -C "$out/classes" .
rm -rf "$out"
