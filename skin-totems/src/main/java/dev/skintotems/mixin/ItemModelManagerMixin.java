package dev.skintotems.mixin;

import dev.skintotems.SkinTotemRenderer;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.item.ItemModelManager;
import net.minecraft.client.network.AbstractClientPlayerEntity;
import net.minecraft.client.render.item.ItemRenderState;
import net.minecraft.client.render.model.json.Transformation;
import net.minecraft.item.ItemDisplayContext;
import net.minecraft.item.ItemStack;
import net.minecraft.item.Items;
import net.minecraft.util.HeldItemContext;
import net.minecraft.world.World;
import org.joml.Vector3f;
import org.joml.Vector3fc;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Unique;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ItemModelManager.class)
public abstract class ItemModelManagerMixin {
    @Unique
    private static final Vector3fc[] SKIN_TOTEMS_BOUNDS;
    @Unique
    private static final Transformation SKIN_TOTEMS_FIRST_PERSON = new Transformation(
            new Vector3f(0, 0, 0), new Vector3f(0, 0.30F, 0), new Vector3f(0.60F));
    @Unique
    private static final Transformation SKIN_TOTEMS_THIRD_PERSON = new Transformation(
            new Vector3f(90, 180, 0), new Vector3f(0, 0.12F, 0), new Vector3f(0.65F));

    static {
        List<Vector3fc> bounds = new ArrayList<>();
        SkinTotemRenderer.INSTANCE.collectVertices(bounds::add);
        SKIN_TOTEMS_BOUNDS = bounds.toArray(Vector3fc[]::new);
    }

    @Inject(method = "update", at = @At("HEAD"), cancellable = true)
    private void skinTotems$heldSkin(ItemRenderState state, ItemStack stack, ItemDisplayContext context,
                                    World world, HeldItemContext holder, int seed, CallbackInfo ci) {
        boolean firstPerson = context == ItemDisplayContext.FIRST_PERSON_LEFT_HAND
                || context == ItemDisplayContext.FIRST_PERSON_RIGHT_HAND;
        boolean thirdPerson = context == ItemDisplayContext.THIRD_PERSON_LEFT_HAND
                || context == ItemDisplayContext.THIRD_PERSON_RIGHT_HAND;
        if ((!firstPerson && !thirdPerson) || !stack.isOf(Items.TOTEM_OF_UNDYING)
                || holder == null || !(holder.getEntity() instanceof AbstractClientPlayerEntity player)) return;

        // clearAndUpdate has already reset the state and set its display context.
        // Do not clear here: that would erase which hand is being rendered.
        var skin = player.getSkin();
        var layer = state.newLayer();
        layer.setSpecialModel(SkinTotemRenderer.INSTANCE, skin);
        layer.setUseLight(true);
        layer.setVertices(() -> SKIN_TOTEMS_BOUNDS);
        layer.setTransform(firstPerson ? SKIN_TOTEMS_FIRST_PERSON : SKIN_TOTEMS_THIRD_PERSON);
        layer.setGlint(stack.hasGlint() ? ItemRenderState.Glint.SPECIAL : ItemRenderState.Glint.NONE);
        state.addModelKey(skin);
        ci.cancel();
    }
}
