package dev.skintotems;

import java.util.Set;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.EntityModelLayerRegistry;
import net.minecraft.class_2350;
import net.minecraft.class_2960;
import net.minecraft.class_5601;
import net.minecraft.class_5603;
import net.minecraft.class_5606;
import net.minecraft.class_5607;
import net.minecraft.class_5609;

public final class SkinTotemsClient implements ClientModInitializer {
    public static final class_5601 CLASSIC = layer("classic");
    public static final class_5601 SLIM = layer("slim");

    private static class_5601 layer(String name) {
        return new class_5601(class_2960.method_60655("skin_totems", name), "main");
    }

    @Override
    public void onInitializeClient() {
        EntityModelLayerRegistry.registerModelLayer(CLASSIC, () -> totemModel(false));
        EntityModelLayerRegistry.registerModelLayer(SLIM, () -> totemModel(true));
    }

    /** A flat, front-facing sprite built from single-texel strips of the 64x64 skin sheet. */
    private static class_5607 totemModel(boolean slim) {
        class_5609 data = new class_5609();
        class_5606 builder = class_5606.method_32108();
        Set<class_2350> front = Set.of(class_2350.field_11043);
        for (TotemLayout.Strip s : TotemLayout.build(slim)) {
            builder.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), s.z(), s.w(), 1f, 0f, front);
        }
        data.method_32111().method_32117("totem", builder, class_5603.field_27701);
        return class_5607.method_32110(data, 64, 64);
    }
}
