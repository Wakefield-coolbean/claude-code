# Validation

Target: Minecraft Java 1.21.11, Fabric Loader 0.18.4, Fabric API 0.141.6+1.21.11, JDK 21.

The release was compiled and remapped with Fabric Loom 1.14.10 and Gradle 9.2.1. A graphical Fabric client integration test was run on macOS.

Checked in the running client:
- Local and synthetic remote holders supply distinct skin data in all four hand display contexts.
- GUI, ground, fixed, head, and no-context totems retain their normal renderer.
- Missing holders and non-totem items retain their normal renderer.
- Model bounds are nonempty.
- First-person and third-person rendering were inspected from actual game screenshots.
- Resource reload completes and the held figures render afterward.

Not tested: connecting two authenticated clients to a public server, third-party rendering mods, or custom resource-pack conflicts. The remote-holder check uses a separate client player entity with a different skin.
