#!/usr/bin/env bash
# Builds skin-totems-<version>.jar. Minecraft/Fabric classes are only stubbed for compilation (see stubs/);
# the real ones are supplied by the game at runtime. The mixin class is carried over unchanged from 1.0.0.
set -euo pipefail
cd "$(dirname "$0")"
out=$(mktemp -d)
javac --release 21 -d "$out/stubs" $(find stubs -name '*.java')
javac --release 21 -cp "$out/stubs" -d "$out/classes" src/dev/skintotems/*.java
cp -r mod-resources/. "$out/classes/"
jar --create --file skin-totems-1.1.0.jar -C "$out/classes" .
rm -rf "$out"
