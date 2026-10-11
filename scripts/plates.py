#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["numpy", "pillow"]
# ///
"""The art of the pouch, made into the plates of the page.

A plate is the flat illustration of a panel with its ground turned to alpha, so that it sits on the page's own ground in
any colourway. On a front, the window of the hexagon at the heart of the crystal is cut clear: the page shows the twin
there, not the fruit the pouch prints in it.

    uv run scripts/plates.py <folder of the flat art> jackfruit

The flat art is the `_build/source/` folder of the pouch's print files, which is not in this repository: one PNG per panel,
3392 x 5056, `<fruit>-front.png` and `<fruit>-back.png`. The plates are written to products/<fruit>/, under the names a
packing record gives them among its documents: the front is cover.webp and the back is background.webp.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "products"
NAMES = {"front": "cover.webp", "back": "background.webp"}

# The window of each front, measured on its art: the six corners of the fruit inside the hexagon, in pixels of the flat
# art, from the top one clockwise. A fruit that is not here has no plate yet.
WINDOWS = {
    "jackfruit": [(1696, 2287), (1981, 2492), (1979, 2852), (1697, 3012), (1404, 2852), (1404, 2492)],
    "pineapple": [(1720, 2305), (2037, 2528), (2037, 2890), (1720, 3100), (1400, 2880), (1400, 2525)],
}
WIDTHS = {"front": 820, "back": 680}
# Every front sits in one frame, so that the page draws one window for all of them: the frame of the jackfruit plate, and
# where its window is in it (left, top, right, bottom). The front of another fruit is scaled and placed so that its own
# window lands there.
FRAME = (820, 1065)
FRAME_WINDOW = (330.9, 347.7, 489.9, 547.4)
EDGE = 36  # px over which a front that reaches the edge of the frame fades out


def to_alpha(rgb, ground, floor=0.045):
    """What differs from the ground stays, as much as it differs. Darker counts on every channel; lighter only where the
    ground leaves room for it, past a few levels of noise: a ground near white has almost none on its red."""
    p = rgb.astype(np.float32)
    g = np.asarray(ground, np.float32)
    below = ((g - p) / g).max(axis=2)
    dead = 6.0
    room = (255.0 - g) > 16
    above = ((p - g - dead) / np.maximum(255.0 - g - dead, 1))[..., room].max(axis=2) if room.any() else np.zeros(p.shape[:2], np.float32)
    a = np.maximum(below, above).clip(0, 1)
    colour = (g + (p - g) / np.maximum(a, 1e-4)[..., None]).clip(0, 255)
    a = ((a - floor) / (1 - floor)).clip(0, 1)
    return np.dstack([colour, a[..., None] * 255]).astype(np.uint8)


def grow(points, by):
    cx = sum(x for x, _ in points) / len(points)
    cy = sum(y for _, y in points) / len(points)
    return [(x + (x - cx) / max(1.0, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) * by, y + (y - cy) / max(1.0, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5) * by) for x, y in points]


def plate(source, fruit, side):
    rgb = np.asarray(Image.open(source / f"{fruit}-{side}.png").convert("RGB"))
    h, w, _ = rgb.shape
    ground = np.median(rgb[: int(h * 0.04)].reshape(-1, 3), axis=0)
    rgba = to_alpha(rgb, ground)
    window = WINDOWS[fruit] if side == "front" else None
    if window:
        hole = Image.new("L", (w, h), 255)
        ImageDraw.Draw(hole).polygon(grow(window, 10), fill=0)
        hole = hole.filter(ImageFilter.GaussianBlur(2.2))
        rgba[..., 3] = (rgba[..., 3].astype(np.float32) * np.asarray(hole) / 255).astype(np.uint8)
    target = OUT / fruit / NAMES[side]
    if window and fruit != "jackfruit":
        placed(rgba, window, target)
        return
    seen = rgba[..., 3] > 20
    ys, xs = np.where(seen.any(axis=1))[0], np.where(seen.any(axis=0))[0]
    pad = int(w * 0.012)
    box = (max(xs[0] - pad, 0), max(ys[0] - pad, 0), min(xs[-1] + pad, w), min(ys[-1] + pad, h))
    cut = Image.fromarray(rgba, "RGBA").crop(box)
    cut = cut.resize((WIDTHS[side], round(cut.height * WIDTHS[side] / cut.width)), Image.LANCZOS)
    cut.save(target, "WEBP", quality=68, method=6, alpha_quality=70)
    print(f"{target.name}: {cut.width} x {cut.height}, {target.stat().st_size // 1024} kB, ground {'#%02x%02x%02x' % tuple(int(v) for v in ground)}")
    if window:
        # where the window is on the plate, for the frame the page draws around it (the viewBox of the crystal in devcon8.html)
        print("  window:", " ".join(f"{(x - box[0]) * cut.width / (box[2] - box[0]):.1f},{(y - box[1]) * cut.height / (box[3] - box[1]):.1f}" for x, y in window))


def placed(rgba, window, target):
    """A front in the frame of the jackfruit plate, its window on the window the page draws."""
    h, w, _ = rgba.shape
    left, top = min(x for x, _ in window), min(y for _, y in window)
    right, bottom = max(x for x, _ in window), max(y for _, y in window)
    sx = (FRAME_WINDOW[2] - FRAME_WINDOW[0]) / (right - left)
    sy = (FRAME_WINDOW[3] - FRAME_WINDOW[1]) / (bottom - top)
    scaled = Image.fromarray(rgba, "RGBA").resize((round(w * sx), round(h * sy)), Image.LANCZOS)
    frame = Image.new("RGBA", FRAME, (0, 0, 0, 0))
    frame.paste(scaled, (round(FRAME_WINDOW[0] - left * sx), round(FRAME_WINDOW[1] - top * sy)))
    # what reaches the edge of the frame fades into it, so that the page shows no cut
    a = np.asarray(frame).copy()
    reach = max(a[0, :, 3].max(), a[-1, :, 3].max(), a[:, 0, 3].max(), a[:, -1, 3].max())
    ramp = lambda n: np.minimum(1, np.minimum(np.arange(n), np.arange(n)[::-1]) / EDGE)
    a[..., 3] = (a[..., 3] * np.outer(ramp(FRAME[1]), ramp(FRAME[0]))).astype(np.uint8)
    Image.fromarray(a, "RGBA").save(target, "WEBP", quality=68, method=6, alpha_quality=70)
    print(f"{target.name}: {FRAME[0]} x {FRAME[1]}, {target.stat().st_size // 1024} kB, scaled {sx:.4f} x {sy:.4f}, alpha {reach} at the edge of the frame")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    source = Path(sys.argv[1])
    for fruit in sys.argv[2:]:
        if fruit not in WINDOWS:
            sys.exit(f"{fruit}: the window of its front is not measured yet (WINDOWS)")
        (OUT / fruit).mkdir(parents=True, exist_ok=True)
        for side in ("front", "back"):
            plate(source, fruit, side)
