"""Render the PWA icons and iOS launch images from the app's own SVG mark (public/icons/icon.svg).

Run from the repo root:  python frontend/scripts/make_pwa_assets.py
Writes PNGs into frontend/public/icons and frontend/public/splash. Pure Pillow: the mark is a rounded
square plus one SVG path made of cubic curves, flattened here at 4x and downsampled for smooth edges.
"""
from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
GOLD = (255, 198, 41, 255)
INK = (11, 11, 11, 255)
BLACK = (0, 0, 0, 255)

# heart path from icon.svg, in a 512x512 box
HEART = ("M256 398c-9 0-17-3-24-9-58-50-110-96-110-158 0-47 35-83 80-83 21 0 40 8 54 23 14-15 33-23 54-23 "
         "45 0 80 36 80 83 0 62-52 108-110 158-7 6-15 9-24 9Z")


def heart_points(steps: int = 24) -> list:
    tokens = re.findall(r"[MmCcZz]|-?\d+(?:\.\d+)?", HEART)
    pts, i, cmd, cur = [], 0, None, (0.0, 0.0)
    while i < len(tokens):
        t = tokens[i]
        if t in "MmCcZz":
            cmd = t
            i += 1
            if cmd in "Zz":
                break
            continue
        if cmd in "Mm":
            cur = (float(tokens[i]), float(tokens[i + 1]))
            pts.append(cur)
            i += 2
        elif cmd in "Cc":
            nums = [float(x) for x in tokens[i:i + 6]]
            i += 6
            ox, oy = cur if cmd == "c" else (0.0, 0.0)
            p1 = (ox + nums[0], oy + nums[1])
            p2 = (ox + nums[2], oy + nums[3])
            p3 = (ox + nums[4], oy + nums[5])
            for s in range(1, steps + 1):
                u = s / steps
                a, b, c, d = (1 - u) ** 3, 3 * (1 - u) ** 2 * u, 3 * (1 - u) * u ** 2, u ** 3
                pts.append((a * cur[0] + b * p1[0] + c * p2[0] + d * p3[0], a * cur[1] + b * p1[1] + c * p2[1] + d * p3[1]))
            cur = p3
    return pts


def mark(size: int, *, radius: float = 112 / 512, scale: float = 1.0, background=None) -> Image.Image:
    """The app mark at `size` px. `scale` shrinks the whole mark (maskable safe zone); `radius`=0 fills edge to edge."""
    k = 4
    big = size * k
    img = Image.new("RGBA", (big, big), background or (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    inner = big * scale
    off = (big - inner) / 2
    if radius:
        draw.rounded_rectangle([off, off, off + inner - 1, off + inner - 1], radius=inner * radius, fill=GOLD)
    else:
        draw.rectangle([0, 0, big, big], fill=GOLD)
    f = inner / 512
    draw.polygon([(off + x * f, off + y * f) for x, y in heart_points()], fill=INK)
    return img.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: Path, rgb: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    (img.convert("RGB") if rgb else img).save(path, "PNG", optimize=True)
    print(f"{path.relative_to(ROOT)}  {img.size[0]}x{img.size[1]}  {path.stat().st_size // 1024} KB")


# iOS launch images: device pixels (portrait) and the CSS size + pixel ratio used in the media query
LAUNCH = [
    (1320, 2868, 440, 956, 3), (1290, 2796, 430, 932, 3), (1206, 2622, 402, 874, 3), (1179, 2556, 393, 852, 3),
    (1284, 2778, 428, 926, 3), (1170, 2532, 390, 844, 3), (1080, 2340, 360, 780, 3), (1125, 2436, 375, 812, 3),
    (1242, 2688, 414, 896, 3), (828, 1792, 414, 896, 2), (1242, 2208, 414, 736, 3), (750, 1334, 375, 667, 2),
    (640, 1136, 320, 568, 2), (1668, 2388, 834, 1194, 2), (1640, 2360, 820, 1180, 2), (2048, 2732, 1024, 1366, 2),
    (1620, 2160, 810, 1080, 2), (1488, 2266, 744, 1133, 2),
]


def main() -> None:
    icons = PUBLIC / "icons"
    save(mark(192), icons / "icon-192.png")
    save(mark(512), icons / "icon-512.png")
    # maskable: full-bleed gold, mark kept inside the 80% safe circle
    full = Image.new("RGBA", (512, 512), GOLD)
    full.alpha_composite(mark(512, radius=0, scale=0.72))
    save(full, icons / "maskable-512.png", rgb=True)
    # iOS home screen: opaque square, iOS applies its own corner mask
    apple = Image.new("RGBA", (180, 180), GOLD)
    apple.alpha_composite(mark(180, radius=0, scale=1.0))
    save(apple, icons / "apple-touch-icon.png", rgb=True)
    save(mark(32), icons / "favicon-32.png")

    lines = []
    for w, h, cw, ch, dpr in LAUNCH:
        img = Image.new("RGBA", (w, h), BLACK)
        side = round(min(w, h) * 0.26)
        img.alpha_composite(mark(side), ((w - side) // 2, (h - side) // 2 - round(h * 0.02)))
        name = f"launch-{w}x{h}.png"
        save(img, PUBLIC / "splash" / name, rgb=True)
        lines.append(f'  <link rel="apple-touch-startup-image" href="/splash/{name}" media="(device-width: {cw}px) and '
                     f'(device-height: {ch}px) and (-webkit-device-pixel-ratio: {dpr}) and (orientation: portrait)">')
    # the <link> tags to paste into index.html (kept out of public/, which is served as-is)
    (ROOT / "scripts" / "launch-links.html").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
