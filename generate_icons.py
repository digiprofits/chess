"""Generate icons/icon-192.png and icons/icon-512.png.

Tries cairosvg first (faithful render of icon.svg); falls back to Pillow, which
draws the board algorithmically (a green rounded card with an 8x8 board and a
knight glyph). Run: python generate_icons.py
"""

import os

HERE = os.path.dirname(os.path.abspath(__file__))
SVG = os.path.join(HERE, "icons", "icon.svg")
SIZES = [192, 512]

GREEN = (93, 122, 67)
EDGE = (63, 85, 48)
LIGHT = (240, 217, 181)
DARK = (181, 136, 99)
WHITE = (250, 250, 250)
INK = (43, 43, 43)


def via_cairosvg():
    import cairosvg

    for size in SIZES:
        out = os.path.join(HERE, "icons", f"icon-{size}.png")
        cairosvg.svg2png(url=SVG, write_to=out, output_width=size, output_height=size)
        print("wrote", out)


def via_pillow():
    from PIL import Image, ImageDraw, ImageFont

    for size in SIZES:
        s = size / 512.0
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)

        # Rounded green card
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(72 * s), fill=GREEN)

        # Board area
        x0 = int(56 * s)
        span = int(400 * s)
        cell = span / 8.0
        d.rectangle([x0, x0, x0 + span, x0 + span], fill=LIGHT)
        for r in range(8):
            for c in range(8):
                if (r + c) % 2 == 1:
                    cx = x0 + int(c * cell)
                    cy = x0 + int(r * cell)
                    d.rectangle([cx, cy, cx + int(cell) + 1, cy + int(cell) + 1], fill=DARK)
        d.rectangle([x0, x0, x0 + span, x0 + span], outline=EDGE, width=max(1, int(10 * s)))

        # Knight glyph (best-effort; skipped if no font resolves)
        glyph = "♞"
        try:
            font = None
            for name in ("seguisym.ttf", "DejaVuSans.ttf", "arialuni.ttf", "Arial.ttf"):
                try:
                    font = ImageFont.truetype(name, int(240 * s))
                    break
                except Exception:
                    continue
            if font:
                bbox = d.textbbox((0, 0), glyph, font=font)
                w = bbox[2] - bbox[0]
                h = bbox[3] - bbox[1]
                pos = (size / 2 - w / 2 - bbox[0], size / 2 - h / 2 - bbox[1])
                d.text(pos, glyph, font=font, fill=WHITE, stroke_width=max(1, int(4 * s)), stroke_fill=INK)
        except Exception as e:
            print("glyph skipped:", e)

        out = os.path.join(HERE, "icons", f"icon-{size}.png")
        img.save(out)
        print("wrote", out)


if __name__ == "__main__":
    try:
        via_cairosvg()
    except Exception as e:
        print("cairosvg unavailable (", e, ") — falling back to Pillow")
        via_pillow()
