package com.totemdestroypop;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;
import net.minecraft.core.BlockPos;
import net.minecraft.core.component.DataComponents;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.tags.BlockTags;
import net.minecraft.tags.FluidTags;
import net.minecraft.util.Mth;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.LightningBolt;
import net.minecraft.world.entity.item.ItemEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;

/**
 * Works out, on the client, whether a totem item that just disappeared was destroyed.
 *
 * <p>The server only tells the client that an item entity is gone, not why, so a totem counts as destroyed when it
 * vanished while something that kills items was acting on it: fire, lava, cactus, lightning, the void, or an explosion
 * that went off next to it. Pickups, despawning, hoppers and walking out of range are ignored.
 */
public final class TotemDestroyTracker {
	/**
	 * How long a removed totem waits for an explosion to explain it, and how long an explosion stays around to explain
	 * removals. The server sends an item's removal before the explosion that destroyed it.
	 */
	private static final int EXPLOSION_WINDOW_TICKS = 3;
	/** The server kills items 64 blocks below the world; anything this far down is on its way there. */
	private static final int VOID_DEPTH = 32;

	private static final List<PendingTotem> pending = new ArrayList<>();
	private static final List<RecentExplosion> recentExplosions = new ArrayList<>();
	private static long tick;
	private static int soundsThisTick;

	private TotemDestroyTracker() {
	}

	public static void onEntityUnload(Entity entity, ClientLevel level) {
		// Removal packets use DISCARDED; chunk and world unloads use other reasons.
		if (!(entity instanceof ItemEntity item) || entity.getRemovalReason() != Entity.RemovalReason.DISCARDED) {
			return;
		}
		// A pickup shrinks the item's stack to nothing before removing it, so pickups stop here.
		ItemStack stack = item.getItem();
		if (stack.isEmpty() || !(stack.is(Items.TOTEM_OF_UNDYING) || stack.has(DataComponents.DEATH_PROTECTION))) {
			return;
		}

		TotemDestroyPopConfig config = TotemDestroyPopConfig.get();
		if (wasBeingDestroyed(item, level, config)) {
			pop(item, level, config);
			return;
		}

		if (config.explosions) {
			Vec3 pos = item.position();
			for (RecentExplosion explosion : recentExplosions) {
				if (explosion.level == level && explosion.reaches(pos)) {
					pop(item, level, config);
					return;
				}
			}
			pending.add(new PendingTotem(item, level, tick));
		}
	}

	public static void onExplosion(Vec3 center, float radius) {
		Minecraft client = Minecraft.getInstance();
		ClientLevel level = client.level;
		TotemDestroyPopConfig config = TotemDestroyPopConfig.get();
		if (level == null || !client.isSameThread() || !config.explosions) {
			return;
		}

		RecentExplosion explosion = new RecentExplosion(level, center, radius, tick);
		recentExplosions.add(explosion);

		Iterator<PendingTotem> iterator = pending.iterator();
		while (iterator.hasNext()) {
			PendingTotem totem = iterator.next();
			if (totem.level == level && explosion.reaches(totem.item.position())) {
				iterator.remove();
				pop(totem.item, level, config);
			}
		}
	}

	public static void tick() {
		tick++;
		soundsThisTick = 0;
		pending.removeIf(totem -> tick - totem.removedTick > EXPLOSION_WINDOW_TICKS);
		recentExplosions.removeIf(explosion -> tick - explosion.tick > EXPLOSION_WINDOW_TICKS);
	}

	private static boolean wasBeingDestroyed(ItemEntity item, ClientLevel level, TotemDestroyPopConfig config) {
		if (config.fire && (item.isOnFire() || item.isInLava())) {
			return true;
		}
		if (config.voidDamage && item.getY() < level.getMinY() - VOID_DEPTH) {
			return true;
		}

		if (config.fire || config.cactus) {
			// The client's copy of the item can trail the server's a little, so look just past it and ahead along its motion.
			AABB area = item.getBoundingBox().inflate(0.5).expandTowards(item.getDeltaMovement().scale(2.0));
			for (BlockPos pos : BlockPos.betweenClosed(
					Mth.floor(area.minX), Mth.floor(area.minY), Mth.floor(area.minZ),
					Mth.floor(area.maxX), Mth.floor(area.maxY), Mth.floor(area.maxZ))) {
				BlockState state = level.getBlockState(pos);
				if (config.fire && (state.is(BlockTags.FIRE) || state.is(Blocks.LAVA_CAULDRON) || state.getFluidState().is(FluidTags.LAVA))) {
					return true;
				}
				if (config.cactus && state.is(Blocks.CACTUS)) {
					return true;
				}
			}
		}

		// Lightning kills an item in the same tick it sets it alight, before the fire reaches the client.
		return config.lightning && !level.getEntitiesOfClass(LightningBolt.class, item.getBoundingBox().inflate(4.0, 10.0, 4.0)).isEmpty();
	}

	private static void pop(ItemEntity item, ClientLevel level, TotemDestroyPopConfig config) {
		Minecraft client = Minecraft.getInstance();
		if (config.particleTicks > 0) {
			// Same emitter a real totem pop uses; it keeps working from the removed item's last position.
			client.particleEngine.createTrackingEmitter(item, ParticleTypes.TOTEM_OF_UNDYING, config.particleTicks);
		}
		if (config.volume > 0.0F && soundsThisTick < config.maxSoundsPerTick) {
			soundsThisTick++;
			float pitch = config.pitch * (0.95F + level.getRandom().nextFloat() * 0.1F);
			level.playLocalSound(item.getX(), item.getY(), item.getZ(), SoundEvents.TOTEM_USE, SoundSource.PLAYERS, config.volume, pitch, false);
		}
	}

	private record PendingTotem(ItemEntity item, ClientLevel level, long removedTick) {
	}

	private record RecentExplosion(ClientLevel level, Vec3 center, float radius, long tick) {
		/** Explosions hurt entities up to twice their radius away; the extra covers the item's size and client lag. */
		boolean reaches(Vec3 pos) {
			double reach = radius * 2.0 + 1.5;
			return center.distanceToSqr(pos) <= reach * reach;
		}
	}
}
