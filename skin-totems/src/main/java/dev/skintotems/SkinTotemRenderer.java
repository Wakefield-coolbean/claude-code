package dev.skintotems;

import java.util.function.Consumer;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.model.ModelPart;
import net.minecraft.client.render.RenderLayers;
import net.minecraft.client.render.command.OrderedRenderCommandQueue;
import net.minecraft.client.render.entity.model.LoadedEntityModels;
import net.minecraft.client.render.item.model.special.SpecialModelRenderer;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.entity.player.PlayerSkinType;
import net.minecraft.entity.player.SkinTextures;
import net.minecraft.item.ItemDisplayContext;
import net.minecraft.item.ItemStack;
import org.joml.Vector3f;
import org.joml.Vector3fc;

/** A fixed, private model; never mutates the actual player renderer's model. */
public final class SkinTotemRenderer implements SpecialModelRenderer<SkinTextures> {
    public static final SkinTotemRenderer INSTANCE = new SkinTotemRenderer();
    private LoadedEntityModels modelSet;
    private ModelPart classic;
    private ModelPart slim;
    private SkinTotemRenderer() {}

    private ModelPart model(boolean thin) {
        LoadedEntityModels current = MinecraftClient.getInstance().getLoadedEntityModels();
        // A resource reload replaces this set, so stale model parts are discarded.
        if (current != modelSet) {
            classic = current.getModelPart(SkinTotemsClient.CLASSIC);
            slim = current.getModelPart(SkinTotemsClient.SLIM);
            modelSet = current;
        }
        return thin ? slim : classic;
    }

    @Override
    public void render(SkinTextures skin, ItemDisplayContext context, MatrixStack matrices,
                       OrderedRenderCommandQueue queue, int light, int overlay, boolean glint, int outline) {
        if (skin == null) return;
        matrices.push();
        // The sprite is 15 pixels tall and hangs down from y=0; size it to ~0.8 blocks, centred in the item cell.
        matrices.translate(0.50F, 0.90F, 0.50F);
        matrices.scale(0.85F, -0.85F, -0.85F);
        queue.submitModelPart(model(skin.model() == PlayerSkinType.SLIM), matrices,
                RenderLayers.entityTranslucent(skin.body().texturePath()),
                light, overlay, null, false, glint, -1, null, outline);
        matrices.pop();
    }

    @Override
    public void collectVertices(Consumer<Vector3fc> consumer) {
        // Bounds include the arms and outer skin layers, in the renderer's local coordinates.
        for (float x : new float[]{0.07F, 0.93F})
            for (float y : new float[]{0.08F, 0.92F})
                for (float z : new float[]{0.38F, 0.62F})
                    consumer.accept(new Vector3f(x, y, z));
    }

    @Override
    public SkinTextures getData(ItemStack stack) {
        // The mixin supplies the actual holder's skin, never a global/local-player fallback.
        return null;
    }
}
