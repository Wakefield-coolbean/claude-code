package com.totemdestroypop;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Files;
import java.nio.file.Path;
import net.fabricmc.loader.api.FabricLoader;

/**
 * Settings read from {@code config/totemdestroypop.json}. Missing options keep their defaults and are written back.
 */
public final class TotemDestroyPopConfig {
	private static final Gson GSON = new GsonBuilder().setPrettyPrinting().create();
	private static final Path PATH = FabricLoader.getInstance().getConfigDir().resolve(TotemDestroyPopClient.MOD_ID + ".json");

	private static final int CURRENT_VERSION = 2;

	private static TotemDestroyPopConfig instance = new TotemDestroyPopConfig();

	/** Bumped when defaults change, so files written by older versions can be upgraded. */
	public int configVersion = CURRENT_VERSION;

	/** Volume of the pop sound. A real totem pop plays at 1.0. */
	public float volume = 0.4F;
	/** Pitch of the pop sound. A real totem pop plays at 1.0; Minecraft caps pitch at 2.0. */
	public float pitch = 1.6F;
	/** How many ticks particles keep spraying for. A real totem pop sprays for 30; 0 turns particles off. */
	public int particleTicks = 12;
	/** Particles spawned each tick. A real totem pop spawns about 8. */
	public int particlesPerTick = 3;
	/** Particle size, where 1.0 is the size of a real totem pop's particles. */
	public float particleSize = 0.5F;
	/** Cap on pop sounds per tick, so a pile of totems blown up at once isn't deafening. Particles are not capped. */
	public int maxSoundsPerTick = 3;

	/** Burning in fire or lava. */
	public boolean fire = true;
	public boolean explosions = true;
	public boolean cactus = true;
	public boolean lightning = true;
	/** Falling out of the world. */
	public boolean voidDamage = true;

	public static TotemDestroyPopConfig get() {
		return instance;
	}

	public static void load() {
		if (Files.exists(PATH)) {
			try (Reader reader = Files.newBufferedReader(PATH)) {
				JsonObject json = JsonParser.parseReader(reader).getAsJsonObject();
				TotemDestroyPopConfig loaded = GSON.fromJson(json, TotemDestroyPopConfig.class);
				if (!json.has("configVersion")) {
					loaded.upgradeFromVersion1();
				}
				instance = loaded;
			} catch (IOException | JsonParseException | IllegalStateException e) {
				// Leave the broken file alone so the user can fix it.
				TotemDestroyPopClient.LOGGER.warn("Could not read {}, using default settings", PATH, e);
				return;
			}
		}

		instance.volume = Math.max(0.0F, instance.volume);
		instance.pitch = Math.max(0.0F, instance.pitch);
		instance.particleTicks = Math.max(0, instance.particleTicks);
		instance.particlesPerTick = Math.max(0, instance.particlesPerTick);
		instance.particleSize = Math.max(0.0F, instance.particleSize);
		instance.maxSoundsPerTick = Math.max(0, instance.maxSoundsPerTick);
		save();
	}

	/** Version 1 files have the old defaults written out; move them to the new ones unless the user changed them. */
	private void upgradeFromVersion1() {
		if (pitch == 1.0F) {
			pitch = 1.6F;
		}
		if (particleTicks == 30) {
			particleTicks = 12;
		}
		configVersion = CURRENT_VERSION;
	}

	private static void save() {
		try {
			Files.createDirectories(PATH.getParent());
			try (Writer writer = Files.newBufferedWriter(PATH)) {
				GSON.toJson(instance, writer);
			}
		} catch (IOException e) {
			TotemDestroyPopClient.LOGGER.warn("Could not write {}", PATH, e);
		}
	}
}
