package dev.skintotems;

import java.util.ArrayList;
import java.util.List;

/**
 * Pixel layout of the totem sprite, in the style of the custom totem maker: a 14x15 pixel figure
 * (arms out) whose pixels are copied straight from the holder's skin. Every entry is a one-pixel-tall
 * strip of skin texels; there is no texture to generate at runtime, the skin itself is the texture.
 */
final class TotemLayout {
    /** Sprite columns 0..13 map to model x -7..+6, rows 0..14 map to model y 0..14 (y down). */
    static final int COLS = 14;
    static final int ROWS = 15;
    /** How far the overlay (hat, jacket, sleeves, pants) sits in front of the base layer, in pixels. */
    static final float OVERLAY_OFFSET = -0.1f;

    /** One strip: draws {@code w}x1 texels starting at skin ({@code u}, {@code v}) at sprite ({@code col}, {@code row}). */
    record Strip(float x, float y, float z, int w, int u, int v) {}

    private TotemLayout() {}

    static List<Strip> build(boolean slim) {
        List<Strip> out = new ArrayList<>();
        add(out, slim, false);
        add(out, slim, true);
        return out;
    }

    private static void add(List<Strip> out, boolean slim, boolean overlay) {
        int armW = slim ? 3 : 4;

        // Head: the 8x8 face (plus hat layer) at 1:1, top corners rounded off.
        int headU = overlay ? 40 : 8;
        for (int r = 0; r < 8; r++) {
            int c0 = r == 0 ? 4 : 3;
            int c1 = r == 0 ? 9 : 10;
            put(out, overlay, c0, r, c1 - c0 + 1, headU + (c0 - 3), 8 + r);
        }

        // Torso: 12 skin rows squashed into 4 sprite rows.
        int[] torsoRows = {0, 4, 7, 11};
        for (int i = 0; i < torsoRows.length; i++) {
            put(out, overlay, 3, 8 + i, 8, 20, (overlay ? 36 : 20) + torsoRows[i]);
        }

        // Arms: stretched out sideways. Sprite columns run shoulder -> hand, sprite rows run across the arm.
        int[] armAlong = {9, 3, 1}; // hand, sleeve, shoulder (skin rows) for sprite cols outer, middle, inner
        int rightU = overlay ? 44 : 44, rightV = overlay ? 36 : 20;
        int leftU = overlay ? 52 : 36, leftV = overlay ? 52 : 52;
        int[] rightAcross = {0, 1, armW - 1};
        int[] leftAcross = {armW - 1, armW == 4 ? 2 : 1, 0};
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                // The hand is only two texels tall, like the original sprite.
                if (i == 0 && j == 2) continue;
                put(out, overlay, i, 7 + j, 1, rightU + rightAcross[j], rightV + armAlong[i]);
                put(out, overlay, 13 - i, 7 + j, 1, leftU + leftAcross[j], leftV + armAlong[i]);
            }
        }

        // Legs: 4 skin columns squashed into 3 sprite columns each, then a row of feet.
        int rLegU = 4, rLegV = overlay ? 36 : 20;
        int lLegU = overlay ? 4 : 20, lLegV = 52;
        int[] rLegX = {0, 1, 3};
        int[] lLegX = {0, 2, 3};
        int[] legRows = {2, 7};
        for (int j = 0; j < 2; j++) {
            for (int i = 0; i < 3; i++) {
                put(out, overlay, 4 + i, 12 + j, 1, rLegU + rLegX[i], rLegV + legRows[j]);
                put(out, overlay, 7 + i, 12 + j, 1, lLegU + lLegX[i], lLegV + legRows[j]);
            }
        }
        put(out, overlay, 5, 14, 2, rLegU + 1, rLegV + 11);
        put(out, overlay, 7, 14, 2, lLegU + 1, lLegV + 11);
    }

    private static void put(List<Strip> out, boolean overlay, int col, int row, int w, int u, int v) {
        out.add(new Strip(col - 7, row, overlay ? OVERLAY_OFFSET : 0f, w, u, v));
    }
}
