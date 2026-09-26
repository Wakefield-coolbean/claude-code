package com.totemdestroypop.mixin;

import com.totemdestroypop.TotemDestroyTracker;
import net.minecraft.client.multiplayer.ClientPacketListener;
import net.minecraft.network.protocol.game.ClientboundExplodePacket;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ClientPacketListener.class)
public abstract class ClientPacketListenerMixin {
	// TAIL is only reached on the client thread: on the network thread the handler re-queues itself and bails out early.
	@Inject(method = "handleExplosion", at = @At("TAIL"))
	private void totemdestroypop$onExplosion(ClientboundExplodePacket packet, CallbackInfo ci) {
		TotemDestroyTracker.onExplosion(packet.center(), packet.radius());
	}
}
