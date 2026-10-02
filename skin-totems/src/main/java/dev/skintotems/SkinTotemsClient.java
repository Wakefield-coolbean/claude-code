package dev.skintotems;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import java.util.Set;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelTransform;
import net.minecraft.client.model.TexturedModelData;
import net.minecraft.client.render.entity.model.EntityModelLayer;
import net.minecraft.util.Identifier;
import net.minecraft.util.math.Direction;

public final class SkinTotemsClient implements ClientModInitializer {
    public static final EntityModelLayer CLASSIC = layer("classic");
    public static final EntityModelLayer SLIM = layer("slim");

    private static EntityModelLayer layer(String name) {
        return new EntityModelLayer(Identifier.of("skin_totems", name), "main");
    }

    @Override
    public void onInitializeClient() {
        EntityModelLayerRegistry.registerModelLayer(CLASSIC, () -> totemModel(false));
        EntityModelLayerRegistry.registerModelLayer(SLIM, () -> totemModel(true));
    }

    /** Half the depth of the (pre-scaled) slab cuboids; the renderer stretches them 100x to one pixel. */
    static final float SLAB_Z = -0.005F;
    static final float SLAB_DEPTH = 0.01F;

    /**
     * The figure, built from single-texel strips of the 64x64 skin sheet. The slab cuboids are almost
     * depth-less so that every face samples the strip's own texels; see {@link TotemLayout}.
     */
    private static TexturedModelData totemModel(boolean slim) {
        TotemLayout.Layout layout = TotemLayout.build(slim);
        ModelPartBuilder front = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.front()) {
            front.uv(s.u(), s.v()).cuboid(s.x(), s.y(), SLAB_Z, s.w(), 1F, SLAB_DEPTH,
                    Set.of(Direction.NORTH, Direction.WEST, Direction.DOWN));
        }
        ModelPartBuilder back = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.back()) {
            back.uv(s.u(), s.v()).cuboid(s.x(), s.y(), SLAB_Z, 1F, 1F, SLAB_DEPTH,
                    Set.of(Direction.WEST, Direction.DOWN));
        }
        ModelPartBuilder overlay = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.overlay()) {
            overlay.uv(s.u(), s.v()).cuboid(s.x(), s.y(), TotemLayout.OVERLAY_Z, s.w(), 1F, 0F,
                    Set.of(Direction.NORTH));
        }
        ModelData data = new ModelData();
        data.getRoot().addChild("front", front, ModelTransform.NONE);
        data.getRoot().addChild("back", back, ModelTransform.NONE);
        data.getRoot().addChild("overlay", overlay, ModelTransform.NONE);
        return TexturedModelData.of(data, 64, 64);
    }
}
