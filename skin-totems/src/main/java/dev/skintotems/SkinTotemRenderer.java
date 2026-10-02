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
            classic = prepare(current.getModelPart(SkinTotemsClient.CLASSIC));
            slim = prepare(current.getModelPart(SkinTotemsClient.SLIM));
            modelSet = current;
        }
        return thin ? slim : classic;
    }

    /** Stretches the near-depthless slab cuboids to one pixel and flips the back copy; see TotemLayout. */
    private static ModelPart prepare(ModelPart root) {
        ModelPart front = root.getChild("front");
        front.zScale = 100F;
        ModelPart back = root.getChild("back");
        back.zScale = 100F;
        back.roll = (float) Math.PI;
        return root;
    }

    @Override
    public void render(SkinTextures skin, ItemDisplayContext context, MatrixStack matrices,
                       OrderedRenderCommandQueue queue, int light, int overlay, boolean glint, int outline) {
        if (skin == null) return;
        matrices.push();
        // One sprite pixel = 1/16 block, like a vanilla item; the 15-row figure hangs down from the top of the cell.
        matrices.translate(0.50F, 0.96875F, 0.50F);
        matrices.scale(1F, -1F, -1F);
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
