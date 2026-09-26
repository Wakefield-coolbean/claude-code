package com.totemdestroypop;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientEntityEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class TotemDestroyPopClient implements ClientModInitializer {
	public static final String MOD_ID = "totemdestroypop";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	@Override
	public void onInitializeClient() {
		TotemDestroyPopConfig.load();
		ClientEntityEvents.ENTITY_UNLOAD.register(TotemDestroyTracker::onEntityUnload);
		ClientTickEvents.END_CLIENT_TICK.register(client -> TotemDestroyTracker.tick());
	}
}
