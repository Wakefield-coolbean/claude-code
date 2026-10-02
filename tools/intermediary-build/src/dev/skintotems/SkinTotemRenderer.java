package dev.skintotems;

import java.util.function.Consumer;

import org.joml.Vector3f;
import org.joml.Vector3fc;

import net.minecraft.class_10515;
import net.minecraft.class_11659;
import net.minecraft.class_12249;
import net.minecraft.class_1799;
import net.minecraft.class_310;
import net.minecraft.class_4587;
import net.minecraft.class_5599;
import net.minecraft.class_630;
import net.minecraft.class_7920;
import net.minecraft.class_811;
import net.minecraft.class_8685;

public final class SkinTotemRenderer implements class_10515<class_8685> {
    public static final SkinTotemRenderer INSTANCE = new SkinTotemRenderer();

    private class_5599 modelSet;
    private class_630 classic;
    private class_630 slim;

    private SkinTotemRenderer() {}

    private class_630 model(boolean slimArms) {
        class_5599 set = class_310.method_1551().method_31974();
        if (set != modelSet) {
            classic = set.method_32072(SkinTotemsClient.CLASSIC);
            slim = set.method_32072(SkinTotemsClient.SLIM);
            modelSet = set;
        }
        return slimArms ? slim : classic;
    }

    @Override
    public void method_65694(class_8685 skin, class_811 context, class_4587 matrices, class_11659 queue,
            int light, int overlay, boolean glint, int outline) {
        if (skin == null) return;
        matrices.method_22903();
        // One sprite pixel = 1/16 block, like a vanilla item; the 15-row figure hangs down from the top of the cell.
        matrices.method_46416(0.5f, 0.96875f, 0.5f);
        matrices.method_22905(1f, -1f, -1f);
        queue.method_73494(model(skin.comp_1629() == class_7920.field_41122), matrices,
                class_12249.method_76000(skin.comp_1626().comp_3627()),
                light, overlay, null, false, glint, -1, null, outline);
        matrices.method_22909();
    }

    @Override
    public void method_72175(Consumer<Vector3fc> consumer) {
        for (float x : new float[] {0.07f, 0.93f}) {
            for (float y : new float[] {0.08f, 0.92f}) {
                for (float z : new float[] {0.38f, 0.62f}) {
                    consumer.accept(new Vector3f(x, y, z));
                }
            }
        }
    }

    @Override
    public class_8685 method_65695(class_1799 stack) {
        return null;
    }
}
