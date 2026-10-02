package dev.skintotems;

import java.util.ArrayList;
import java.util.List;

/**
 * Pixel layout of the totem sprite, in the style of the custom totem maker: a 14x15 pixel figure
 * (arms out) whose pixels are copied straight from the holder's skin. Every entry is a one-pixel-tall
 * strip of skin texels; there is no texture to generate at runtime, the skin itself is the texture.
 *
 * <p>The figure is one pixel thick like a normal item: {@code front} is the face of the sprite (repeated at the back), and
 * {@code edges} are one-texel planes closing every silhouette edge, each coloured with the texel it borders
 * (like the sides of an extruded item). {@code overlay} holds the hat/jacket/sleeve/pants layer as thin
 * planes just in front of the face.
 */
final class TotemLayout {
    /** Sprite columns 0..13 map to model x -7..+6, rows 0..14 map to model y 0..14 (y down). */
    static final int COLS = 14;
    static final int ROWS = 15;
    /** The face sits at the front of a 1-pixel-thick slab spanning z -0.5..+0.5; front is -z. */
    static final float FACE_Z = -0.5f;
    static final float BACK_Z = 0.5f;
    /** Depth (in pixels) of the overlay planes: just in front of the face. */
    static final float OVERLAY_Z = -0.6f;

    /** Draws {@code w}x1 texels starting at skin ({@code u}, {@code v}) at model position ({@code x}, {@code y}). */
    record Strip(float x, float y, int w, int u, int v) {}

    /** A one-texel edge plane. {@code side}: 0 left, 1 right, 2 top, 3 bottom of the texel at ({@code x}, {@code y}). */
    record Edge(float x, float y, int side, int u, int v) {}

    record Layout(List<Strip> front, List<Edge> edges, List<Strip> overlay) {}

    private TotemLayout() {}

    static Layout build(boolean slim) {
        List<Strip> front = new ArrayList<>();
        List<Strip> overlay = new ArrayList<>();
        add(front, slim, false);
        add(overlay, slim, true);

        // Expand to texels, then close every side that has no neighbour.
        java.util.Map<Long, int[]> texels = new java.util.HashMap<>();
        for (Strip s : front) {
            for (int i = 0; i < s.w(); i++) {
                texels.put(key((int) s.x() + i, (int) s.y()), new int[] {s.u() + i, s.v()});
            }
        }
        List<Edge> edges = new ArrayList<>();
        for (var e : texels.entrySet()) {
            int x = (int) (e.getKey() >> 32), y = (int) (long) e.getKey();
            int[] t = e.getValue();
            if (!texels.containsKey(key(x - 1, y))) edges.add(new Edge(x, y, 0, t[0], t[1]));
            if (!texels.containsKey(key(x + 1, y))) edges.add(new Edge(x, y, 1, t[0], t[1]));
            if (!texels.containsKey(key(x, y - 1))) edges.add(new Edge(x, y, 2, t[0], t[1]));
            if (!texels.containsKey(key(x, y + 1))) edges.add(new Edge(x, y, 3, t[0], t[1]));
        }
        return new Layout(front, edges, overlay);
    }

    private static long key(int x, int y) {
        return ((long) x << 32) | (y & 0xFFFFFFFFL);
    }

    private static void add(List<Strip> out, boolean slim, boolean overlay) {
        int armW = slim ? 3 : 4;

        // Head: the 8x8 face (plus hat layer) at 1:1, top corners rounded off.
        int headU = overlay ? 40 : 8;
        for (int r = 0; r < 8; r++) {
            int c0 = r == 0 ? 4 : 3;
            int c1 = r == 0 ? 9 : 10;
            put(out, c0, r, c1 - c0 + 1, headU + (c0 - 3), 8 + r);
        }

        // Torso: 12 skin rows squashed into 4 sprite rows.
        int[] torsoRows = {0, 4, 7, 11};
        for (int i = 0; i < torsoRows.length; i++) {
            put(out, 3, 8 + i, 8, 20, (overlay ? 36 : 20) + torsoRows[i]);
        }

        // Arms: stretched out sideways. Sprite columns run shoulder -> hand, sprite rows run across the arm.
        int[] armAlong = {9, 3, 1}; // hand, sleeve, shoulder (skin rows) for sprite cols outer, middle, inner
        int rightU = 44, rightV = overlay ? 36 : 20;
        int leftU = overlay ? 52 : 36, leftV = 52;
        int[] rightAcross = {0, 1, armW - 1};
        int[] leftAcross = {armW - 1, armW == 4 ? 2 : 1, 0};
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                // The hand is only two texels tall, like the original sprite.
                if (i == 0 && j == 2) continue;
                put(out, i, 7 + j, 1, rightU + rightAcross[j], rightV + armAlong[i]);
                put(out, 13 - i, 7 + j, 1, leftU + leftAcross[j], leftV + armAlong[i]);
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
                put(out, 4 + i, 12 + j, 1, rLegU + rLegX[i], rLegV + legRows[j]);
                put(out, 7 + i, 12 + j, 1, lLegU + lLegX[i], lLegV + legRows[j]);
            }
        }
        put(out, 5, 14, 2, rLegU + 1, rLegV + 11);
        put(out, 7, 14, 2, lLegU + 1, lLegV + 11);
    }

    private static void put(List<Strip> out, int col, int row, int w, int u, int v) {
        out.add(new Strip(col - 7, row, w, u, v));
    }
}
