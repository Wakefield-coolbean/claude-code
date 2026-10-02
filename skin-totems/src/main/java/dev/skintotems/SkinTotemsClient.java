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

    /** A flat, front-facing sprite built from single-texel strips of the 64x64 skin sheet. */
    private static TexturedModelData totemModel(boolean slim) {
        ModelData data = new ModelData();
        ModelPartBuilder builder = ModelPartBuilder.create();
        Set<Direction> front = Set.of(Direction.NORTH);
        for (TotemLayout.Strip s : TotemLayout.build(slim)) {
            builder.uv(s.u(), s.v()).cuboid(s.x(), s.y(), s.z(), s.w(), 1f, 0f, front);
        }
        data.getRoot().addChild("totem", builder, ModelTransform.NONE);
        return TexturedModelData.of(data, 64, 64);
    }
}
