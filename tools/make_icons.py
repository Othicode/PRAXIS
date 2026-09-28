"""Generate the PW Budget / PRAXIS icon set (pure stdlib: zlib + struct, no PIL).

The mark is the faceted gold pyramid from public/logo.svg (the front page),
drawn on the app's onyx -> bronze tile, so the PWA icon, the apple touch
icon, the browser tab and the landing page are one single identity.

Usage:  python tools/make_icons.py
Writes: public/app/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon}.png
        public/favicon.ico   (32px, same mark - legacy browsers)
"""
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "app" / "icons"
OUT.mkdir(parents=True, exist_ok=True)

# ---- palette (public/logo.svg mark + public/app/styles.css theme) ----------
BG_TOP = (20, 20, 26)        # #14141a onyx
BG_BOT = (36, 28, 8)         # #241c08 warm bronze-black
LITE_TOP = (247, 231, 168)   # #f7e7a8 champagne (lit face)
LITE_BOT = (201, 162, 51)    # #c9a233
DARK_TOP = (42, 34, 16)      # #2a2210 shadowed face
DARK_BOT = (18, 16, 10)      # #12100a
GOLD_0 = (247, 231, 168)     # #f7e7a8
GOLD_1 = (212, 175, 55)      # #d4af37 gold leaf
GOLD_2 = (168, 132, 42)      # #a8842a

DARK_MIX = 0.55              # opacity of the shadowed face in logo.svg
SS = 4                       # supersampling factor (antialiasing)

# mark proportions, taken from logo.svg's <g> (52 x 52 box):
#   triangle apex y=0, base y=44, base spans x=2..50, bar y=47..52 full width
TRI_H = 44 / 52
TRI_HALF = 24 / 52
BAR_TOP = 47 / 52


def chunk(tag, data):
    c = struct.pack(">I", len(data)) + tag + data
    return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)


def write_png(path, size, pixel_fn):
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)  # filter: none
        for x in range(size):
            raw.extend(pixel_fn(x, y))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    idat = zlib.compress(bytes(raw), 9)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", idat))
        f.write(chunk(b"IEND", b""))


def lerp(a, b, t):
    return a + (b - a) * t


def make_pixel_fn(size, margin, radius):
    lo = size * margin
    side = size - 2 * lo          # mark bounding box (square)
    cx = size / 2.0
    apex = lo
    tri_h = side * TRI_H
    base = apex + tri_h
    tri_half = side * TRI_HALF
    bar_top = lo + side * BAR_TOP
    bar_bot = lo + side
    bar_hw = side / 2.0
    bar_r = (bar_bot - bar_top) / 2.0
    bar_mx = bar_hw - bar_r
    bar_my = (bar_top + bar_bot) / 2.0
    last = size - 1
    step = 1.0 / SS
    n = float(SS * SS)
    gold_span = (2 * bar_hw) + (bar_bot - bar_top)

    def sample(x, y):
        # rounded-corner mask (transparent outside for the "any" purpose icons)
        if radius:
            mx = min(x, last - x)
            my = min(y, last - y)
            if mx < radius and my < radius:
                if (mx - radius) ** 2 + (my - radius) ** 2 > radius ** 2:
                    return 0.0, 0.0, 0.0, 0.0

        # onyx -> bronze background
        t = y / size
        r = lerp(BG_TOP[0], BG_BOT[0], t)
        g = lerp(BG_TOP[1], BG_BOT[1], t)
        b = lerp(BG_TOP[2], BG_BOT[2], t)

        # pyramid: lit face on the left, shadowed facet on the right
        if apex <= y < base:
            u = (y - apex) / tri_h
            if abs(x - cx) <= tri_half * u:
                lr = lerp(LITE_TOP[0], LITE_BOT[0], u)
                lg = lerp(LITE_TOP[1], LITE_BOT[1], u)
                lb = lerp(LITE_TOP[2], LITE_BOT[2], u)
                if x > cx:
                    dr = lerp(DARK_TOP[0], DARK_BOT[0], u)
                    dg = lerp(DARK_TOP[1], DARK_BOT[1], u)
                    db = lerp(DARK_TOP[2], DARK_BOT[2], u)
                    r = DARK_MIX * dr + (1 - DARK_MIX) * lr
                    g = DARK_MIX * dg + (1 - DARK_MIX) * lg
                    b = DARK_MIX * db + (1 - DARK_MIX) * lb
                else:
                    r, g, b = lr, lg, lb
                return r, g, b, 255.0

        # gold base bar (stadium shape, diagonal gold-leaf gradient)
        if bar_top <= y <= bar_bot:
            dx = abs(x - cx)
            if dx <= bar_hw:
                if dx > bar_mx:
                    if (dx - bar_mx) ** 2 + (y - bar_my) ** 2 > bar_r ** 2:
                        return r, g, b, 255.0
                gt = ((x - (cx - bar_hw)) + (y - bar_top)) / gold_span
                if gt <= 0.5:
                    k = gt * 2
                    gr = lerp(GOLD_0[0], GOLD_1[0], k)
                    gg = lerp(GOLD_0[1], GOLD_1[1], k)
                    gb = lerp(GOLD_0[2], GOLD_1[2], k)
                else:
                    k = (gt - 0.5) * 2
                    gr = lerp(GOLD_1[0], GOLD_2[0], k)
                    gg = lerp(GOLD_1[1], GOLD_2[1], k)
                    gb = lerp(GOLD_1[2], GOLD_2[2], k)
                return gr, gg, gb, 255.0

        return r, g, b, 255.0

    def pixel_fn(x, y):
        ar = ag = ab = aa = 0.0
        for sy in range(SS):
            yy = y + (sy + 0.5) * step
            for sx in range(SS):
                sr, sg, sb, sa = sample(x + (sx + 0.5) * step, yy)
                ar += sr * sa
                ag += sg * sa
                ab += sb * sa
                aa += sa
        if aa <= 0:
            return (0, 0, 0, 0)
        return (int(round(ar / aa)), int(round(ag / aa)), int(round(ab / aa)),
                int(round(aa / n)))

    return pixel_fn


def write_ico(path, size, pixel_fn):
    """ICO container with a PNG payload (supported by every modern browser)."""
    stride = size * 4
    raw = bytearray()
    for y in range(size):
        raw.append(0)
        for x in range(size):
            raw.extend(pixel_fn(x, y))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
           + chunk(b"IEND", b""))
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32,
                        len(png), 6 + 16)
    with open(path, "wb") as f:
        f.write(header + entry + png)


if __name__ == "__main__":
    write_png(OUT / "icon-512.png", 512,
              make_pixel_fn(512, 0.10, int(512 * 0.20)))
    print("wrote", OUT / "icon-512.png")
    write_png(OUT / "icon-maskable-512.png", 512,
              make_pixel_fn(512, 0.18, 0))
    print("wrote", OUT / "icon-maskable-512.png")
    write_png(OUT / "icon-192.png", 192,
              make_pixel_fn(192, 0.10, int(192 * 0.22)))
    print("wrote", OUT / "icon-192.png")
    write_png(OUT / "apple-touch-icon.png", 180,
              make_pixel_fn(180, 0.10, 0))
    print("wrote", OUT / "apple-touch-icon.png")
    write_ico(ROOT / "public" / "favicon.ico", 32, make_pixel_fn(32, 0.12, int(32 * 0.22)))
    print("wrote", ROOT / "public" / "favicon.ico")
    print("icons written to", OUT)
