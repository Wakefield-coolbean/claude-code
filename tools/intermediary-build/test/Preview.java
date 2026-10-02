package dev.skintotems;

import java.awt.image.BufferedImage;
import java.io.File;
import javax.imageio.ImageIO;

/** Composites the totem layout from a skin PNG, to eyeball it without launching Minecraft. */
public final class Preview {
    public static void main(String[] a) throws Exception {
        BufferedImage skin = ImageIO.read(new File(a[0]));
        boolean slim = a.length > 2 && a[2].equals("slim");
        int scale = 16;
        BufferedImage out = new BufferedImage(TotemLayout.COLS * scale, TotemLayout.ROWS * scale, BufferedImage.TYPE_INT_ARGB);
        for (TotemLayout.Strip s : TotemLayout.build(slim)) {
            for (int i = 0; i < s.w(); i++) {
                int argb = skin.getRGB(s.u() + i, s.v());
                if ((argb >>> 24) == 0) continue;
                int px = (int) s.x() + 7 + i, py = (int) s.y();
                for (int dy = 0; dy < scale; dy++)
                    for (int dx = 0; dx < scale; dx++)
                        out.setRGB(px * scale + dx, py * scale + dy, argb | 0xFF000000);
            }
        }
        ImageIO.write(out, "png", new File(a[1]));
    }
}
