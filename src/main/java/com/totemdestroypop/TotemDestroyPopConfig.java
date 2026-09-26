package com.totemdestroypop;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonParseException;
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

	private static TotemDestroyPopConfig instance = new TotemDestroyPopConfig();

	/** Volume of the pop sound. A real totem pop plays at 1.0. */
	public float volume = 0.4F;
	public float pitch = 1.0F;
	/** How many ticks the particle emitter runs for. A real totem pop uses 30; 0 turns particles off. */
	public int particleTicks = 30;
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
				TotemDestroyPopConfig loaded = GSON.fromJson(reader, TotemDestroyPopConfig.class);
				if (loaded != null) {
					instance = loaded;
				}
			} catch (IOException | JsonParseException e) {
				// Leave the broken file alone so the user can fix it.
				TotemDestroyPopClient.LOGGER.warn("Could not read {}, using default settings", PATH, e);
				return;
			}
		}

		instance.volume = Math.max(0.0F, instance.volume);
		instance.pitch = Math.max(0.0F, instance.pitch);
		instance.particleTicks = Math.max(0, instance.particleTicks);
		instance.maxSoundsPerTick = Math.max(0, instance.maxSoundsPerTick);
		save();
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
