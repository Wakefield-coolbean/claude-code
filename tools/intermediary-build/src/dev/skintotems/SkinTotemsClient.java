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

    /** Half the depth of the (pre-scaled) slab cuboids; the renderer stretches them 100x to one pixel. */
    static final float SLAB_Z = -0.005f;
    static final float SLAB_DEPTH = 0.01f;

    /**
     * The figure, built from single-texel strips of the 64x64 skin sheet. The slab cuboids are almost
     * depth-less so that every face samples the strip's own texels; see {@link TotemLayout}.
     */
    private static class_5607 totemModel(boolean slim) {
        TotemLayout.Layout layout = TotemLayout.build(slim);
        class_5606 front = class_5606.method_32108();
        for (TotemLayout.Strip s : layout.front()) {
            front.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), SLAB_Z, s.w(), 1f, SLAB_DEPTH,
                    Set.of(class_2350.field_11043, class_2350.field_11039, class_2350.field_11033));
        }
        class_5606 back = class_5606.method_32108();
        for (TotemLayout.Strip s : layout.back()) {
            back.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), SLAB_Z, 1f, 1f, SLAB_DEPTH,
                    Set.of(class_2350.field_11039, class_2350.field_11033));
        }
        class_5606 overlay = class_5606.method_32108();
        for (TotemLayout.Strip s : layout.overlay()) {
            overlay.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), TotemLayout.OVERLAY_Z, s.w(), 1f, 0f,
                    Set.of(class_2350.field_11043));
        }
        class_5609 data = new class_5609();
        data.method_32111().method_32117("front", front, class_5603.field_27701);
        data.method_32111().method_32117("back", back, class_5603.field_27701);
        data.method_32111().method_32117("overlay", overlay, class_5603.field_27701);
        return class_5607.method_32110(data, 64, 64);
    }
}
