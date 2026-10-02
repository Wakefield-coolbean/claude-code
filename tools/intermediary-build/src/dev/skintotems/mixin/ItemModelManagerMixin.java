package dev.skintotems.mixin;

import java.util.ArrayList;
import java.util.List;

import org.joml.Vector3f;
import org.joml.Vector3fc;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

import dev.skintotems.SkinTotemRenderer;
import net.minecraft.class_10442;
import net.minecraft.class_10444;
import net.minecraft.class_11566;
import net.minecraft.class_1309;
import net.minecraft.class_1799;
import net.minecraft.class_1802;
import net.minecraft.class_1937;
import net.minecraft.class_742;
import net.minecraft.class_804;
import net.minecraft.class_811;

/** Intermediary-named build of ItemModelManagerMixin; see src/main/java for the yarn-named source. */
@Mixin(class_10442.class)
public abstract class ItemModelManagerMixin {
    @Unique private static final Vector3fc[] SKIN_TOTEMS_BOUNDS;
    // The vanilla display transforms of the totem (item/generated, JSON translations / 16), so the figure is held like a normal item.
    @Unique private static final class_804 FIRST_PERSON_RIGHT = new class_804(
            new Vector3f(0, -90, 25), new Vector3f(0.0706F, 0.2F, 0.0706F), new Vector3f(0.68F));
    @Unique private static final class_804 FIRST_PERSON_LEFT = new class_804(
            new Vector3f(0, 90, -25), new Vector3f(0.0706F, 0.2F, 0.0706F), new Vector3f(0.68F));
    @Unique private static final class_804 THIRD_PERSON = new class_804(
            new Vector3f(0, 0, 0), new Vector3f(0, 0.1875F, 0.0625F), new Vector3f(0.55F));

    static {
        List<Vector3fc> bounds = new ArrayList<>();
        SkinTotemRenderer.INSTANCE.method_72175(bounds::add);
        SKIN_TOTEMS_BOUNDS = bounds.toArray(Vector3fc[]::new);
    }

    @Inject(method = {"method_65596"}, at = {@At("HEAD")}, cancellable = true)
    private void skinTotems$heldSkin(class_10444 state, class_1799 stack, class_811 context, class_1937 world,
            class_11566 holder, int seed, CallbackInfo ci) {
        boolean firstLeft = context == class_811.field_4321;
        boolean firstRight = context == class_811.field_4322;
        boolean third = context == class_811.field_4323 || context == class_811.field_4320;
        if ((!firstLeft && !firstRight && !third) || !stack.method_31574(class_1802.field_8288) || holder == null) return;
        class_1309 entity = holder.method_72393();
        if (!(entity instanceof class_742 player)) return;

        var skin = player.method_52814();
        var layer = state.method_65601();
        layer.method_65617(SkinTotemRenderer.INSTANCE, skin);
        layer.method_67996(true);
        layer.method_67995(() -> SKIN_TOTEMS_BOUNDS);
        layer.method_67993(third ? THIRD_PERSON : firstLeft ? FIRST_PERSON_LEFT : FIRST_PERSON_RIGHT);
        layer.method_65615(stack.method_7958() ? class_10444.class_10445.field_55343 : class_10444.class_10445.field_55341);
        state.method_70946(skin);
        ci.cancel();
    }
}
