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
import net.minecraft.class_5610;

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

    /** The figure, built from single-texel strips of the 64x64 skin sheet; see {@link TotemLayout}. */
    private static class_5607 totemModel(boolean slim) {
        TotemLayout.Layout layout = TotemLayout.build(slim);
        Set<class_2350> north = Set.of(class_2350.field_11043);
        class_5609 data = new class_5609();
        class_5610 root = data.method_32111();

        class_5606 front = class_5606.method_32108();
        for (TotemLayout.Strip s : layout.front()) {
            front.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), TotemLayout.FACE_Z, s.w(), 1f, 0f, north);
        }
        root.method_32117("front", front, class_5603.field_27701);

        class_5606 overlay = class_5606.method_32108();
        for (TotemLayout.Strip s : layout.overlay()) {
            overlay.method_32101(s.u(), s.v()).method_49304(s.x(), s.y(), TotemLayout.OVERLAY_Z, s.w(), 1f, 0f, north);
        }
        root.method_32117("overlay", overlay, class_5603.field_27701);

        // Each edge is a 1x1 plane turned to span the thickness of the slab. Planes show from both sides, so
        // the turn direction does not matter; only the pivot does.
        float quarter = (float) (Math.PI / 2);
        int n = 0;
        for (TotemLayout.Edge e : layout.edges()) {
            class_5603 at = switch (e.side()) {
                case 0 -> class_5603.method_32091(e.x(), e.y() + 0.5f, 0f, 0f, quarter, 0f);
                case 1 -> class_5603.method_32091(e.x() + 1f, e.y() + 0.5f, 0f, 0f, quarter, 0f);
                case 2 -> class_5603.method_32091(e.x() + 0.5f, e.y(), 0f, quarter, 0f, 0f);
                default -> class_5603.method_32091(e.x() + 0.5f, e.y() + 1f, 0f, quarter, 0f, 0f);
            };
            class_5606 plane = class_5606.method_32108();
            plane.method_32101(e.u(), e.v()).method_49304(-0.5f, -0.5f, 0f, 1f, 1f, 0f, north);
            root.method_32117("edge" + n++, plane, at);
        }
        return class_5607.method_32110(data, 64, 64);
    }
}
