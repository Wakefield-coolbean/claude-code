package net.fabricmc.fabric.api.client.rendering.v1;
import net.minecraft.class_5601; import net.minecraft.class_5607;
public final class EntityModelLayerRegistry {
 public interface TexturedModelDataProvider { class_5607 createModelData(); }
 public static void registerModelLayer(class_5601 l, TexturedModelDataProvider p) {}
}
