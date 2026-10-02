package dev.skintotems;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import java.util.Set;
import net.minecraft.client.model.ModelData;
import net.minecraft.client.model.ModelPartBuilder;
import net.minecraft.client.model.ModelPartData;
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

    /** The figure, built from single-texel strips of the 64x64 skin sheet; see {@link TotemLayout}. */
    private static TexturedModelData totemModel(boolean slim) {
        TotemLayout.Layout layout = TotemLayout.build(slim);
        Set<Direction> north = Set.of(Direction.NORTH);
        ModelData data = new ModelData();
        ModelPartData root = data.getRoot();

        ModelPartBuilder front = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.front()) {
            front.uv(s.u(), s.v()).cuboid(s.x(), s.y(), TotemLayout.FACE_Z, s.w(), 1F, 0F, north);
        }
        root.addChild("front", front, ModelTransform.NONE);

        // The same plane again at the back, so the slab is closed when seen from behind.
        ModelPartBuilder back = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.front()) {
            back.uv(s.u(), s.v()).cuboid(s.x(), s.y(), TotemLayout.BACK_Z, s.w(), 1F, 0F, north);
        }
        root.addChild("back", back, ModelTransform.NONE);

        ModelPartBuilder overlay = ModelPartBuilder.create();
        for (TotemLayout.Strip s : layout.overlay()) {
            overlay.uv(s.u(), s.v()).cuboid(s.x(), s.y(), TotemLayout.OVERLAY_Z, s.w(), 1F, 0F, north);
        }
        root.addChild("overlay", overlay, ModelTransform.NONE);

        // Each edge is a 1x1 plane turned to span the thickness of the slab. Planes show from both sides, so
        // the turn direction does not matter; only the pivot does.
        float quarter = (float) (Math.PI / 2);
        int n = 0;
        for (TotemLayout.Edge e : layout.edges()) {
            ModelTransform at = switch (e.side()) {
                case 0 -> ModelTransform.of(e.x(), e.y() + 0.5F, 0F, 0F, quarter, 0F);
                case 1 -> ModelTransform.of(e.x() + 1F, e.y() + 0.5F, 0F, 0F, quarter, 0F);
                case 2 -> ModelTransform.of(e.x() + 0.5F, e.y(), 0F, quarter, 0F, 0F);
                default -> ModelTransform.of(e.x() + 0.5F, e.y() + 1F, 0F, quarter, 0F, 0F);
            };
            ModelPartBuilder plane = ModelPartBuilder.create();
            plane.uv(e.u(), e.v()).cuboid(-0.5F, -0.5F, 0F, 1F, 1F, 0F, north);
            root.addChild("edge" + n++, plane, at);
        }
        return TexturedModelData.of(data, 64, 64);
    }
}
