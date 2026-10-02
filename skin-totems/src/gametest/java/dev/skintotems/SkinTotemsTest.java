package dev.skintotems;

import com.mojang.authlib.GameProfile;
import java.lang.reflect.Field;
import java.util.UUID;
import net.fabricmc.fabric.api.client.gametest.v1.FabricClientGameTest;
import net.fabricmc.fabric.api.client.gametest.v1.context.ClientGameTestContext;
import net.minecraft.client.network.OtherClientPlayerEntity;
import net.minecraft.client.option.Perspective;
import net.minecraft.client.render.item.ItemRenderState;
import net.minecraft.entity.player.PlayerSkinType;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.item.ItemDisplayContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.AssetInfo;
import net.minecraft.util.Identifier;

public final class SkinTotemsTest implements FabricClientGameTest {
    @Override
    public void runTest(ClientGameTestContext context) {
        try (var world = context.worldBuilder().create()) {
            world.getServer().runCommand("item replace entity @p weapon.mainhand with minecraft:totem_of_undying");
            world.getServer().runCommand("item replace entity @p weapon.offhand with minecraft:totem_of_undying");
            context.waitTicks(25);
            context.runOnClient(client -> {
                var state = new ItemRenderState();
                var totem = new ItemStack(Items.TOTEM_OF_UNDYING);
                var customSkin = SkinTextures.create(new AssetInfo.TextureAssetInfo(
                        Identifier.ofVanilla("entity/player/slim/alex")), null, null, PlayerSkinType.SLIM);
                var remote = new OtherClientPlayerEntity(client.world, new GameProfile(UUID.randomUUID(), "TestHolder")) {
                    @Override public SkinTextures getSkin() { return customSkin; }
                };
                for (var hand : new ItemDisplayContext[]{ItemDisplayContext.FIRST_PERSON_LEFT_HAND,
                        ItemDisplayContext.FIRST_PERSON_RIGHT_HAND, ItemDisplayContext.THIRD_PERSON_LEFT_HAND,
                        ItemDisplayContext.THIRD_PERSON_RIGHT_HAND}) {
                    client.getItemModelManager().updateForLivingEntity(state, totem, hand, client.player);
                    check(special(state) == SkinTotemRenderer.INSTANCE, "Local hand must use custom renderer: " + hand);
                    check(data(state).equals(client.player.getSkin()), "Local skin mismatch");
                    client.getItemModelManager().updateForLivingEntity(state, totem, hand, remote);
                    check(data(state).equals(customSkin), "Must use remote holder's skin");
                    check(state.getModelBoundingBox().getLengthX() > 0, "Bounds must be nonempty");
                }
                for (var mode : new ItemDisplayContext[]{ItemDisplayContext.GUI, ItemDisplayContext.GROUND,
                        ItemDisplayContext.FIXED, ItemDisplayContext.HEAD, ItemDisplayContext.NONE}) {
                    client.getItemModelManager().updateForLivingEntity(state, totem, mode, client.player);
                    check(special(state) != SkinTotemRenderer.INSTANCE, "Non-hand context overridden: " + mode);
                }
                client.getItemModelManager().clearAndUpdate(state, totem, ItemDisplayContext.FIRST_PERSON_RIGHT_HAND,
                        client.world, null, 0);
                check(special(state) != SkinTotemRenderer.INSTANCE, "Null holder should keep vanilla");
                client.getItemModelManager().updateForLivingEntity(state, new ItemStack(Items.STONE),
                        ItemDisplayContext.FIRST_PERSON_RIGHT_HAND, client.player);
                check(special(state) != SkinTotemRenderer.INSTANCE, "Other items should keep vanilla");
                client.options.setPerspective(Perspective.FIRST_PERSON);
            });
            world.getClientWorld().waitForChunksRender();
            context.takeScreenshot("skin-totems-first-person");
            context.runOnClient(client -> {
                client.options.setPerspective(Perspective.THIRD_PERSON_FRONT);
                client.options.getFov().setValue(50);
            });
            context.waitTicks(5);
            context.takeScreenshot("skin-totems-third-person");
            var reload = context.computeOnClient(client -> client.reloadResources());
            context.waitFor(client -> reload.isDone() && client.getOverlay() == null, 1200);
            if (reload.isCompletedExceptionally()) throw new AssertionError("Resource reload failed");
            context.waitTicks(5);
            context.takeScreenshot("skin-totems-after-reload");
        }
    }

    private static Object read(Object object, String name) {
        try {
            Field field = object.getClass().getDeclaredField(name);
            field.setAccessible(true);
            return field.get(object);
        } catch (ReflectiveOperationException e) { throw new AssertionError(e); }
    }
    private static Object layer(ItemRenderState state) { return ((Object[]) read(state, "layers"))[0]; }
    private static Object special(ItemRenderState state) { return read(layer(state), "specialModelType"); }
    private static Object data(ItemRenderState state) { return read(layer(state), "data"); }
    private static void check(boolean value, String message) { if (!value) throw new AssertionError(message); }
}
