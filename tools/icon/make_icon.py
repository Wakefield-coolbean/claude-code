"""Builds skin-totems/icon.png. Needs Pillow; inputs are rendered totem previews (see tools/intermediary-build/test)."""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter

S = sys.argv[1]           # folder with steve_t.png, alex_t.png, custom.png
OUT = sys.argv[2]
random.seed(11)
N = 256; P = 64           # drawn on a 64x64 pixel grid, scaled 4x
def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

# Stepped (pixel) rounded corners: how many grid pixels each corner row is inset.
CORNER = [5, 3, 2, 1, 1]
def inside(x, y, inset=0):
    x -= inset; y -= inset; w = P - 2 * inset
    if not (0 <= x < w and 0 <= y < w): return False
    cx = min(x, w - 1 - x); cy = min(y, w - 1 - y)
    return not (cy < len(CORNER) and cx < CORNER[cy])

# ---- background scene
px = Image.new('RGBA', (P, P), (0, 0, 0, 0)); p = px.load()
top, mid, hor = (22, 16, 58), (64, 42, 110), (236, 146, 92)
gcx, gcy = 32, 27
for y in range(P):
    for x in range(P):
        t = y / 46
        c = lerp(top, mid, min(1, t * 1.6)) if t < 0.62 else lerp(mid, hor, min(1, (t - 0.62) / 0.38))
        d = math.hypot(x - gcx, (y - gcy) * 1.1)
        for r, col, a in [(26, (255, 196, 90), 0.18), (19, (255, 210, 110), 0.32), (12, (255, 232, 150), 0.5)]:
            if d < r: c = lerp(c, col, a)
        if (x + y) % 2 == 0 and y < 46: c = lerp(c, top, 0.06)
        p[x, y] = c + (255,)
for _ in range(40):
    x, y = random.randrange(P), random.randrange(0, 30)
    if math.hypot(x - gcx, y - gcy) > 20: p[x, y] = random.choice([(255, 255, 255), (200, 210, 255), (255, 240, 190)]) + (255,)
for y in range(7, 13):
    for x in range(48, 54):
        if not (x in (48, 53) and y in (7, 12)): p[x, y] = (236, 236, 210, 255)
p[50, 9] = p[51, 10] = (205, 205, 180, 255)
for x in range(P):
    h = int(41 + 3 * math.sin(x * 0.21) + 2 * math.sin(x * 0.53 + 1))
    for y in range(h, P): p[x, y] = lerp((44, 70, 74), (30, 48, 56), (y - h) / 8) + (255,)
for x in range(P):
    h = int(46 + 2 * math.sin(x * 0.17 + 2) + 1.5 * math.sin(x * 0.41))
    for y in range(h, P): p[x, y] = ((36, 92, 52) if y - h < 1 else (28, 72, 44)) + (255,)
g0 = 53
for y in range(g0, P):
    for x in range(P):
        r = random.random()
        if y < g0 + 2: c = random.choice([(98, 160, 58), (84, 140, 48), (112, 176, 66)])
        elif y == g0 + 2: c = (98, 160, 58) if r < 0.45 else random.choice([(121, 85, 58), (104, 72, 48)])
        else: c = random.choice([(121, 85, 58), (104, 72, 48), (134, 96, 66), (93, 64, 43)]) if r > 0.1 else (150, 150, 150)
        p[x, y] = c + (255,)
for x in range(3, P, 8):
    for y in range(g0, P): p[x, y] = lerp(p[x, y], (0, 0, 0), 0.25) + (255,)

# ---- pixel frame: black outline, 2px gold bevel, dark inner line, emerald corner gems
GOLD_HI, GOLD, GOLD_LO, GOLD_DK = (255, 236, 130), (232, 182, 58), (186, 128, 30), (120, 76, 18)
for y in range(P):
    for x in range(P):
        if not inside(x, y): p[x, y] = (0, 0, 0, 0); continue
        if not inside(x, y, 1): p[x, y] = (24, 16, 6, 255); continue          # outer outline
        if not inside(x, y, 3):                                                # gold band
            ring_outer = not inside(x, y, 2)
            light = (x + y) < P - 1                                            # top-left lit
            if ring_outer: c = GOLD_HI if light else GOLD_LO
            else: c = GOLD if light else GOLD_DK
            p[x, y] = c + (255,); continue
        if not inside(x, y, 4): p[x, y] = (40, 26, 10, 255)                  # inner line
# rivets along the edges
for i in range(12, P - 12, 10):
    for (x, y) in [(i, 2), (i, P - 3), (2, i), (P - 3, i)]:
        p[x, y] = GOLD_HI + (255,)
# emerald gems on the corners (the totem's eyes)
for gx, gy in [(4, 4), (P - 6, 4), (4, P - 6), (P - 6, P - 6)]:
    for dx in range(2):
        for dy in range(2):
            p[gx + dx, gy + dy] = [(120, 255, 140), (40, 200, 90), (40, 200, 90), (16, 120, 56)][dy * 2 + dx] + (255,)
    for (ox, oy) in [(-1, 0), (2, 0), (0, -1), (0, 2), (-1, 1), (2, 1), (1, -1), (1, 2)]:
        p[gx + ox, gy + oy] = (24, 16, 6, 255)
bg = px.resize((N, N), Image.NEAREST)
frame_only = bg.copy()   # redrawn on top so figures never cover the frame

# ---- figures and effects
def sprite(path, crop=False):
    im = Image.open(path).convert('RGBA')
    return im.crop(im.getbbox()) if crop else im.resize((14, 15), Image.NEAREST)
steve = sprite(S + '/steve_t.png'); alex = sprite(S + '/alex_t.png'); custom = sprite(S + '/custom.png', True)
def place(spr, scale, angle, cx, cy):
    im = spr.resize((spr.size[0] * scale, spr.size[1] * scale), Image.NEAREST).rotate(angle, resample=Image.NEAREST, expand=True)
    sh = Image.new('RGBA', im.size, (0, 0, 0, 0)); sh.putalpha(im.getchannel('A').point(lambda a: 120 if a else 0))
    x = int(cx - im.size[0] / 2); y = int(cy - im.size[1] / 2)
    bg.alpha_composite(sh.filter(ImageFilter.GaussianBlur(2)), (x + 6, y + 8)); bg.alpha_composite(im, (x, y))
cx, cy = 128, 108
cols = [(140, 230, 60), (200, 240, 70), (250, 220, 60), (255, 245, 140), (90, 200, 70)]
def particles(n, rmin, rmax):
    d = ImageDraw.Draw(bg)
    for _ in range(n):
        a = random.uniform(0, 2 * math.pi); r = random.uniform(rmin, rmax)
        x = cx + r * math.cos(a); y = cy + r * math.sin(a) * 0.85
        if not (22 < x < N - 30 and 22 < y < 196): continue
        s = random.choice([4, 4, 8]); x, y = int(x) // 4 * 4, int(y) // 4 * 4
        d.rectangle((x, y, x + s - 1, y + s - 1), fill=random.choice(cols) + (255,))
particles(36, 40, 120)
place(alex, 7, 14, 62, 148); place(custom, 7, -14, 196, 148); place(steve, 9, 0, 128, 106)
particles(12, 70, 120)
d = ImageDraw.Draw(bg)
def star(x, y, r, c=(255, 250, 210, 255)):
    d.polygon([(x, y - r), (x + r * .25, y - r * .25), (x + r, y), (x + r * .25, y + r * .25), (x, y + r), (x - r * .25, y + r * .25), (x - r, y), (x - r * .25, y - r * .25)], fill=c)
for x, y, r in [(46, 54, 9), (208, 64, 8), (32, 118, 6), (226, 124, 6)]: star(x, y, r)
# frame on top
fm = Image.new('L', (N, N), 0); fpx = fm.load()
for y in range(N):
    for x in range(N):
        gx, gy = x // 4, y // 4
        if inside(gx, gy) and not inside(gx, gy, 5): fpx[x, y] = 255
bg.paste(frame_only, (0, 0), fm)
bg.save(OUT)
