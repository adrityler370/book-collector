"""Draws the app icons (three book spines on a shelf). Run from the repo root: python3 icons/make_icons.py"""
from PIL import Image, ImageDraw

GREEN = (30, 90, 72)
PAPER = (236, 239, 233)
SPINES = [(236, 239, 233), (224, 176, 74), (236, 239, 233)]


def draw(size, safe):
    """safe = fraction of the canvas the artwork may use (maskable icons need a margin)."""
    scale = 4
    s = size * scale
    img = Image.new("RGB", (s, s), GREEN)
    d = ImageDraw.Draw(img)
    pad = s * (1 - safe) / 2
    u = (s - 2 * pad) / 100  # artwork drawn on a 100-unit grid

    def box(x0, y0, x1, y1, fill, r=0):
        d.rounded_rectangle([pad + x0 * u, pad + y0 * u, pad + x1 * u, pad + y1 * u], radius=r * u, fill=fill)

    box(22, 24, 36, 76, SPINES[0], 2)
    box(40, 30, 54, 76, SPINES[1], 2)
    # leaning book
    lean = Image.new("RGBA", (int(14 * u), int(50 * u)), (0, 0, 0, 0))
    ImageDraw.Draw(lean).rounded_rectangle([0, 0, 14 * u - 1, 50 * u - 1], radius=2 * u, fill=SPINES[2])
    lean = lean.rotate(-14, expand=True, resample=Image.BICUBIC)
    img.paste(lean, (int(pad + 58 * u), int(pad + 76 * u - lean.size[1])), lean)
    box(16, 77, 84, 81, PAPER, 1)  # shelf
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    draw(192, 0.86).save("icons/icon-192.png")
    draw(512, 0.86).save("icons/icon-512.png")
    draw(512, 0.66).save("icons/icon-maskable-512.png")
    draw(180, 0.86).save("icons/apple-touch-icon.png")
