"""Photobooth asset library: original SVG sticker illustrations + PNG textures.

Run from the repo root:  python frontend/scripts/make_booth_assets.py
Writes frontend/public/booth/stickers/*.svg and frontend/public/booth/textures/*.png.

Every illustration is drawn here (no third-party art, no copyrighted characters), in one consistent
"die-cut sticker" style: pastel fills, a warm dark-brown outline and a white cut border around the whole
shape. To add a sticker, add an entry to STICKERS and register it in src/lib/boothAssets.js.
"""
from __future__ import annotations

import math
import random
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "booth"
INK = "#5b3a36"          # outline
EYE = "#3a2724"
BLUSH = "#ff9eb5"
O = f'stroke="{INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"'


def svg(w: int, h: int, body: str, cut: int = 14, tape: bool = False) -> str:
    """Wrap a drawing: a white die-cut border (the body's silhouette, stroked wide) under the art."""
    border = ""
    if cut:
        sil = re.sub(r'\s(fill|stroke|stroke-width|stroke-linejoin|stroke-linecap|opacity|fill-opacity|stroke-dasharray)="[^"]*"', "", body)
        sil = re.sub(r'<(linearGradient|radialGradient)[\s\S]*?</\1>', "", sil)
        border = (f'<g fill="#ffffff" stroke="#ffffff" stroke-width="{cut}" stroke-linejoin="round" stroke-linecap="round">{sil}</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'{border}{body}</svg>\n')


def eyes(lx, rx, y, r=6):
    return (f'<circle cx="{lx}" cy="{y}" r="{r}" fill="{EYE}"/><circle cx="{rx}" cy="{y}" r="{r}" fill="{EYE}"/>'
            f'<circle cx="{lx + r * .35}" cy="{y - r * .4}" r="{r * .35}" fill="#fff"/><circle cx="{rx + r * .35}" cy="{y - r * .4}" r="{r * .35}" fill="#fff"/>')


def blush(lx, rx, y, rx_=8, ry=5):
    return (f'<ellipse cx="{lx}" cy="{y}" rx="{rx_}" ry="{ry}" fill="{BLUSH}" opacity=".75"/>'
            f'<ellipse cx="{rx}" cy="{y}" rx="{rx_}" ry="{ry}" fill="{BLUSH}" opacity=".75"/>')


def smile(x, y, s=1.0):
    return (f'<path d="M{x - 8 * s} {y} Q{x - 4 * s} {y + 6 * s} {x} {y} Q{x + 4 * s} {y + 6 * s} {x + 8 * s} {y}" '
            f'fill="none" stroke="{EYE}" stroke-width="3" stroke-linecap="round"/>')


def heart_path(cx, cy, s):
    """Heart centred on (cx, cy) with half-width s."""
    return (f"M{cx} {cy + s * .95} C{cx - s * .2} {cy + s * .75} {cx - s} {cy + s * .2} {cx - s} {cy - s * .25} "
            f"C{cx - s} {cy - s * .8} {cx - s * .3} {cy - s} {cx} {cy - s * .55} "
            f"C{cx + s * .3} {cy - s} {cx + s} {cy - s * .8} {cx + s} {cy - s * .25} "
            f"C{cx + s} {cy + s * .2} {cx + s * .2} {cy + s * .75} {cx} {cy + s * .95} Z")


def star_path(cx, cy, r, inner=.48, points=5, rot=-90):
    pts = []
    for i in range(points * 2):
        a = math.radians(rot + i * 180 / points)
        rr = r if i % 2 == 0 else r * inner
        pts.append(f"{cx + math.cos(a) * rr:.1f} {cy + math.sin(a) * rr:.1f}")
    return "M" + " L".join(pts) + " Z"


def gloss(cx, cy, rx, ry, rot=-30):
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="#fff" opacity=".7" transform="rotate({rot} {cx} {cy})"/>'


STICKERS: dict = {}

# ---------------------------------------------------------------- animals
STICKERS["dog"] = svg(170, 160, f"""
<path d="M42 62 L32 22 Q34 14 43 19 L72 44 Z" fill="#f2a65a" {O}/>
<path d="M128 62 L138 22 Q136 14 127 19 L98 44 Z" fill="#f2a65a" {O}/>
<path d="M44 52 L39 29 L62 44 Z" fill="#ffd7b5"/><path d="M126 52 L131 29 L108 44 Z" fill="#ffd7b5"/>
<ellipse cx="85" cy="92" rx="60" ry="54" fill="#f2a65a" {O}/>
<path d="M45 108 Q48 140 85 142 Q122 140 125 108 Q118 92 85 94 Q52 92 45 108 Z" fill="#fff4e3"/>
<ellipse cx="66" cy="74" rx="6" ry="4" fill="#fff4e3"/><ellipse cx="104" cy="74" rx="6" ry="4" fill="#fff4e3"/>
{eyes(66, 104, 92)}
<ellipse cx="85" cy="106" rx="8" ry="6" fill="{EYE}"/>{smile(85, 114)}
{blush(52, 118, 110)}""")

STICKERS["dog-peek"] = svg(230, 140, f"""
<ellipse cx="62" cy="58" rx="20" ry="36" fill="#a8744f" transform="rotate(25 62 58)" {O}/>
<ellipse cx="168" cy="58" rx="20" ry="36" fill="#a8744f" transform="rotate(-25 168 58)" {O}/>
<path d="M60 128 Q58 30 115 28 Q172 30 170 128 Z" fill="#fffaf2" {O}/>
<path d="M78 46 Q96 34 104 58 Q100 78 82 74 Q70 62 78 46 Z" fill="#c98b5e"/>
{eyes(92, 138, 74)}
<ellipse cx="115" cy="92" rx="9" ry="7" fill="{EYE}"/>{smile(115, 100)}
{blush(80, 150, 96)}
<path d="M36 128 Q36 104 60 104 Q84 104 84 128 Z" fill="#fffaf2" {O}/>
<path d="M146 128 Q146 104 170 104 Q194 104 194 128 Z" fill="#fffaf2" {O}/>
<path d="M52 118 v8 M60 116 v10 M68 118 v8 M162 118 v8 M170 116 v10 M178 118 v8" stroke="{INK}" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M30 128 H200" stroke="{INK}" stroke-width="4" stroke-linecap="round" fill="none"/>""", cut=12)

STICKERS["cat"] = svg(170, 160, f"""
<path d="M36 70 L34 18 Q36 12 43 16 L76 48 Z" fill="#c9ced8" {O}/>
<path d="M134 70 L136 18 Q134 12 127 16 L94 48 Z" fill="#c9ced8" {O}/>
<path d="M42 56 L41 28 L62 46 Z" fill="#ffc7d4"/><path d="M128 56 L129 28 L108 46 Z" fill="#ffc7d4"/>
<ellipse cx="85" cy="94" rx="62" ry="52" fill="#c9ced8" {O}/>
<path d="M76 46 q4 12 0 20 M85 44 q3 13 0 22 M94 46 q-4 12 0 20" stroke="#9aa1ae" stroke-width="5" stroke-linecap="round" fill="none"/>
<ellipse cx="85" cy="114" rx="30" ry="22" fill="#ffffff"/>
{eyes(62, 108, 94, 6.5)}
<path d="M80 106 L90 106 L85 112 Z" fill="#ff8fab" stroke="#ff8fab" stroke-width="2" stroke-linejoin="round"/>{smile(85, 114, .8)}
<path d="M30 104 L54 108 M30 116 L54 114 M140 104 L116 108 M140 116 L116 114" stroke="{INK}" stroke-width="2.5" stroke-linecap="round" fill="none"/>
{blush(52, 118, 112, 7, 4.5)}""")

STICKERS["cat-peek"] = svg(230, 140, f"""
<path d="M62 70 L58 22 Q60 16 67 20 L96 46 Z" fill="#ffb45e" {O}/>
<path d="M168 70 L172 22 Q170 16 163 20 L134 46 Z" fill="#ffb45e" {O}/>
<path d="M66 58 L64 32 L84 46 Z" fill="#ffd8b0"/><path d="M164 58 L166 32 L146 46 Z" fill="#ffd8b0"/>
<path d="M56 128 Q54 40 115 38 Q176 40 174 128 Z" fill="#ffb45e" {O}/>
<path d="M104 42 q4 10 0 18 M115 40 q3 11 0 20 M126 42 q-4 10 0 18" stroke="#e8893a" stroke-width="5" stroke-linecap="round" fill="none"/>
<ellipse cx="115" cy="104" rx="30" ry="18" fill="#fff4e3"/>
{eyes(94, 136, 84, 6.5)}
<path d="M110 96 L120 96 L115 102 Z" fill="#ff8fab" stroke="#ff8fab" stroke-width="2" stroke-linejoin="round"/>{smile(115, 104, .8)}
{blush(80, 150, 100, 7, 4.5)}
<path d="M36 128 Q36 104 60 104 Q84 104 84 128 Z" fill="#ffb45e" {O}/>
<path d="M146 128 Q146 104 170 104 Q194 104 194 128 Z" fill="#ffb45e" {O}/>
<path d="M52 118 v8 M60 116 v10 M68 118 v8 M162 118 v8 M170 116 v10 M178 118 v8" stroke="{INK}" stroke-width="3" stroke-linecap="round" fill="none"/>
<path d="M30 128 H200" stroke="{INK}" stroke-width="4" stroke-linecap="round" fill="none"/>""", cut=12)

STICKERS["bunny"] = svg(150, 200, f"""
<ellipse cx="54" cy="52" rx="15" ry="42" fill="#ffffff" transform="rotate(-10 54 52)" {O}/>
<ellipse cx="96" cy="52" rx="15" ry="42" fill="#ffffff" transform="rotate(10 96 52)" {O}/>
<ellipse cx="54" cy="56" rx="7" ry="30" fill="#ffc7d4" transform="rotate(-10 54 56)"/>
<ellipse cx="96" cy="56" rx="7" ry="30" fill="#ffc7d4" transform="rotate(10 96 56)"/>
<ellipse cx="75" cy="158" rx="46" ry="34" fill="#ffffff" {O}/>
<circle cx="118" cy="168" r="11" fill="#ffffff" {O}/>
<ellipse cx="75" cy="112" rx="44" ry="38" fill="#ffffff" {O}/>
{eyes(58, 92, 112, 5.5)}
<path d="M71 122 L79 122 L75 127 Z" fill="#ff8fab" stroke="#ff8fab" stroke-width="2" stroke-linejoin="round"/>{smile(75, 128, .7)}
{blush(46, 104, 126, 7, 4.5)}
<ellipse cx="56" cy="186" rx="14" ry="8" fill="#ffffff" {O}/><ellipse cx="94" cy="186" rx="14" ry="8" fill="#ffffff" {O}/>""")

STICKERS["bear"] = svg(170, 160, f"""
<circle cx="42" cy="44" r="22" fill="#b07a4f" {O}/><circle cx="128" cy="44" r="22" fill="#b07a4f" {O}/>
<circle cx="42" cy="44" r="11" fill="#e8c09a"/><circle cx="128" cy="44" r="11" fill="#e8c09a"/>
<ellipse cx="85" cy="92" rx="62" ry="56" fill="#b07a4f" {O}/>
<ellipse cx="85" cy="112" rx="28" ry="22" fill="#f0d4b4" {O}/>
{eyes(60, 110, 88, 6.5)}
<ellipse cx="85" cy="104" rx="9" ry="7" fill="{EYE}"/>{smile(85, 114, .9)}
{blush(48, 122, 108)}""")

STICKERS["teddy"] = svg(170, 210, f"""
<circle cx="44" cy="40" r="20" fill="#c99668" {O}/><circle cx="126" cy="40" r="20" fill="#c99668" {O}/>
<circle cx="44" cy="40" r="10" fill="#f0d4b4"/><circle cx="126" cy="40" r="10" fill="#f0d4b4"/>
<ellipse cx="85" cy="152" rx="50" ry="46" fill="#c99668" {O}/>
<ellipse cx="85" cy="160" rx="28" ry="26" fill="#f0d4b4"/>
<ellipse cx="36" cy="140" rx="15" ry="24" fill="#c99668" transform="rotate(25 36 140)" {O}/>
<ellipse cx="134" cy="140" rx="15" ry="24" fill="#c99668" transform="rotate(-25 134 140)" {O}/>
<ellipse cx="52" cy="194" rx="20" ry="13" fill="#c99668" {O}/><ellipse cx="118" cy="194" rx="20" ry="13" fill="#c99668" {O}/>
<ellipse cx="52" cy="194" rx="9" ry="6" fill="#f0d4b4"/><ellipse cx="118" cy="194" rx="9" ry="6" fill="#f0d4b4"/>
<ellipse cx="85" cy="76" rx="54" ry="48" fill="#c99668" {O}/>
<ellipse cx="85" cy="94" rx="24" ry="18" fill="#f0d4b4" {O}/>
{eyes(64, 106, 74, 6)}
<ellipse cx="85" cy="88" rx="8" ry="6" fill="{EYE}"/>{smile(85, 97, .8)}
{blush(52, 118, 92, 7, 4.5)}
<path d="M85 122 L60 110 Q54 122 60 134 Z" fill="#ff7a9a" {O}/>
<path d="M85 122 L110 110 Q116 122 110 134 Z" fill="#ff7a9a" {O}/>
<circle cx="85" cy="122" r="8" fill="#ff5c86" {O}/>""")

STICKERS["chick"] = svg(150, 150, f"""
<path d="M70 26 Q72 12 80 18 Q84 8 88 22" fill="none" {O}/>
<ellipse cx="75" cy="84" rx="56" ry="54" fill="#ffe27a" {O}/>
<ellipse cx="22" cy="96" rx="12" ry="20" fill="#ffd34d" transform="rotate(30 22 96)" {O}/>
<ellipse cx="128" cy="96" rx="12" ry="20" fill="#ffd34d" transform="rotate(-30 128 96)" {O}/>
{eyes(56, 94, 78, 6)}
<path d="M66 92 L84 92 L75 104 Z" fill="#ff9a3c" {O}/>
{blush(44, 106, 96, 8, 5)}
<path d="M58 136 v8 M92 136 v8" stroke="#ff9a3c" stroke-width="5" stroke-linecap="round"/>""")

# an original round mascot (not based on any existing character)
STICKERS["mochi"] = svg(180, 160, f"""
<ellipse cx="44" cy="70" rx="18" ry="30" fill="#ffffff" transform="rotate(35 44 70)" {O}/>
<ellipse cx="136" cy="70" rx="18" ry="30" fill="#ffffff" transform="rotate(-35 136 70)" {O}/>
<path d="M22 112 Q20 54 90 50 Q160 54 158 112 Q156 146 90 148 Q24 146 22 112 Z" fill="#ffffff" {O}/>
{eyes(70, 110, 98, 5.5)}
<ellipse cx="90" cy="108" rx="5" ry="3.5" fill="#ff8fab"/>{smile(90, 112, .6)}
{blush(56, 124, 112, 9, 5.5)}
<path d="M132 46 L114 34 Q108 46 114 58 Z" fill="#ff9ec4" {O}/>
<path d="M132 46 L150 34 Q156 46 150 58 Z" fill="#ff9ec4" {O}/>
<circle cx="132" cy="46" r="7" fill="#ff7ab0" {O}/>""")

# ---------------------------------------------------------------- hearts, bows, flowers, stars
STICKERS["heart"] = svg(140, 130, f"""<path d="{heart_path(70, 66, 54)}" fill="#ff7da0" {O}/>{gloss(48, 46, 12, 7)}""")
STICKERS["hearts"] = svg(170, 140, f"""
<path d="{heart_path(56, 76, 40)}" fill="#ff9ab5" {O}/>{gloss(40, 62, 8, 5)}
<path d="{heart_path(120, 54, 30)}" fill="#ff6f96" {O}/>{gloss(110, 44, 6, 4)}
<path d="{heart_path(128, 112, 18)}" fill="#ffc2d4" {O}/>""")
STICKERS["chrome-heart"] = svg(150, 140, f"""
<defs><linearGradient id="ch" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".35" stop-color="#c9c6ff"/><stop offset=".6" stop-color="#8ea2ff"/><stop offset=".8" stop-color="#e6dcff"/><stop offset="1" stop-color="#ffb8ec"/></linearGradient></defs>
<path d="{heart_path(75, 72, 58)}" fill="url(#ch)" stroke="#6b5bd6" stroke-width="4" stroke-linejoin="round"/>
{gloss(52, 48, 14, 7)}<path d="{star_path(108, 46, 12, .3, 4, 0)}" fill="#ffffff"/>""")
STICKERS["bow"] = svg(180, 130, f"""
<path d="M90 56 Q60 18 28 30 Q12 50 28 74 Q58 86 90 64 Z" fill="#ff9ec4" {O}/>
<path d="M90 56 Q120 18 152 30 Q168 50 152 74 Q122 86 90 64 Z" fill="#ff9ec4" {O}/>
<path d="M82 66 L62 116 L76 110 L84 122 L90 70 Z" fill="#ff7ab0" {O}/>
<path d="M98 66 L118 116 L104 110 L96 122 L90 70 Z" fill="#ff7ab0" {O}/>
<ellipse cx="90" cy="60" rx="14" ry="16" fill="#ff6aa6" {O}/>
<path d="M40 44 Q56 46 70 56" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/>""")
_petals = "".join(f'<ellipse cx="80" cy="44" rx="15" ry="27" fill="#ffffff" transform="rotate({a} 80 80)" {O}/>' for a in range(0, 360, 45))
STICKERS["daisy"] = svg(160, 160, f"""{_petals}<circle cx="80" cy="80" r="20" fill="#ffd34d" {O}/>
<circle cx="74" cy="76" r="3" fill="#f5a623"/><circle cx="86" cy="82" r="3" fill="#f5a623"/><circle cx="78" cy="88" r="3" fill="#f5a623"/>""")
_sak = "".join(f'<path d="M80 80 C64 62 62 38 74 28 L80 36 L86 28 C98 38 96 62 80 80 Z" fill="#ffc2d6" transform="rotate({a} 80 80)" {O}/>' for a in range(0, 360, 72))
STICKERS["sakura"] = svg(160, 160, f"""{_sak}<circle cx="80" cy="80" r="10" fill="#ff8fb3" {O}/>
<path d="M80 72 v-6 M86 76 l5 -3 M74 76 l-5 -3" stroke="#ff6f9e" stroke-width="3" stroke-linecap="round"/>""")
STICKERS["tulip"] = svg(120, 190, f"""
<path d="M60 100 Q58 150 60 180" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>
<path d="M60 150 Q30 140 24 112 Q50 116 60 146 Z" fill="#9ed99a" {O}/>
<path d="M60 160 Q92 150 98 124 Q72 126 60 156 Z" fill="#9ed99a" {O}/>
<path d="M28 44 Q30 100 60 104 Q90 100 92 44 L76 60 L60 36 L44 60 Z" fill="#ff6f8f" {O}/>
<path d="M44 60 Q50 84 60 96" stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".55"/>""")
STICKERS["star"] = svg(160, 160, f"""<path d="{star_path(80, 84, 66, .5)}" fill="#ffd95e" {O}/>
{eyes(66, 94, 86, 5)}{smile(80, 96, .6)}{blush(56, 104, 98, 6, 4)}""")
STICKERS["sparkle"] = svg(130, 130, f"""<path d="M65 8 Q72 58 122 65 Q72 72 65 122 Q58 72 8 65 Q58 58 65 8 Z" fill="#fff3a8" {O}/>""")
STICKERS["sparkles"] = svg(170, 150, f"""
<path d="M60 14 Q66 58 106 64 Q66 70 60 114 Q54 70 14 64 Q54 58 60 14 Z" fill="#ffffff" {O}/>
<path d="M130 70 Q134 96 156 100 Q134 104 130 130 Q126 104 104 100 Q126 96 130 70 Z" fill="#fff3a8" {O}/>
<path d="M130 14 Q132 30 146 32 Q132 34 130 50 Q128 34 114 32 Q128 30 130 14 Z" fill="#ffc6e5" {O}/>""")

# ---------------------------------------------------------------- food, nature, deco
STICKERS["strawberry"] = svg(140, 160, f"""
<path d="M70 150 Q20 120 22 74 Q26 46 70 48 Q114 46 118 74 Q120 120 70 150 Z" fill="#ff5d73" {O}/>
<path d="M70 52 L48 34 L62 36 L70 22 L78 36 L92 34 Z" fill="#7ccf7a" {O}/>
""" + "".join(f'<ellipse cx="{x}" cy="{y}" rx="2.6" ry="4" fill="#ffe7a0"/>' for x, y in [(48, 76), (70, 72), (92, 76), (40, 98), (60, 96), (82, 96), (100, 98), (52, 118), (72, 118), (90, 118), (70, 136)])
 + gloss(46, 70, 9, 5))
STICKERS["cherry"] = svg(160, 160, f"""
<path d="M54 104 Q60 54 96 24 M112 100 Q106 60 96 24" fill="none" stroke="#5f8f4e" stroke-width="5" stroke-linecap="round"/>
<path d="M96 24 Q126 18 134 40 Q110 46 96 24 Z" fill="#8bd27e" {O}/>
<circle cx="52" cy="118" r="28" fill="#ff4d6a" {O}/><circle cx="112" cy="114" r="28" fill="#ff4d6a" {O}/>
{gloss(42, 106, 8, 5)}{gloss(102, 102, 8, 5)}""")
STICKERS["cloud"] = svg(190, 130, f"""
<path d="M40 112 Q10 110 14 82 Q18 58 46 62 Q50 26 88 28 Q118 26 128 54 Q168 46 176 80 Q182 112 148 112 Z" fill="#ffffff" {O}/>
{eyes(80, 116, 80, 5)}{smile(98, 90, .6)}{blush(68, 128, 92, 7, 4)}""")
STICKERS["moon"] = svg(150, 160, f"""
<path d="M98 16 Q40 28 40 84 Q42 140 104 146 Q60 120 62 82 Q64 40 98 16 Z" fill="#ffe08a" {O}/>
<path d="M62 74 q6 6 12 0" fill="none" stroke="{EYE}" stroke-width="3" stroke-linecap="round"/>
<ellipse cx="60" cy="92" rx="6" ry="4" fill="{BLUSH}" opacity=".75"/>
<path d="{star_path(118, 60, 10, .45)}" fill="#fff3a8" {O}/>""")
STICKERS["rainbow"] = svg(200, 130, f"""
<path d="M20 112 A80 80 0 0 1 180 112" fill="none" stroke="#ff9aa8" stroke-width="18" stroke-linecap="round"/>
<path d="M40 112 A60 60 0 0 1 160 112" fill="none" stroke="#ffd98a" stroke-width="18" stroke-linecap="round"/>
<path d="M60 112 A40 40 0 0 1 140 112" fill="none" stroke="#a8e3c4" stroke-width="18" stroke-linecap="round"/>
<path d="M14 116 Q6 100 22 96 Q28 80 46 88 Q60 84 62 102 Q66 118 50 120 L22 120 Q12 120 14 116 Z" fill="#fff" {O}/>
<path d="M186 116 Q194 100 178 96 Q172 80 154 88 Q140 84 138 102 Q134 118 150 120 L178 120 Q188 120 186 116 Z" fill="#fff" {O}/>""", cut=12)
STICKERS["butterfly"] = svg(170, 150, f"""
<path d="M85 74 Q60 14 26 26 Q8 44 30 74 Q50 86 85 74 Z" fill="#d9c8ff" {O}/>
<path d="M85 74 Q110 14 144 26 Q162 44 140 74 Q120 86 85 74 Z" fill="#d9c8ff" {O}/>
<path d="M85 78 Q60 90 44 116 Q58 130 85 98 Z" fill="#ffc6e5" {O}/>
<path d="M85 78 Q110 90 126 116 Q112 130 85 98 Z" fill="#ffc6e5" {O}/>
<circle cx="46" cy="46" r="7" fill="#fff"/><circle cx="124" cy="46" r="7" fill="#fff"/>
<ellipse cx="85" cy="80" rx="7" ry="28" fill="{INK}"/>
<path d="M82 54 Q74 36 66 32 M88 54 Q96 36 104 32" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>""")
STICKERS["paw"] = svg(140, 140, f"""
<ellipse cx="70" cy="90" rx="30" ry="26" fill="#ffb3c6" {O}/>
<ellipse cx="34" cy="58" rx="12" ry="15" fill="#ffb3c6" {O}/><ellipse cx="56" cy="36" rx="12" ry="15" fill="#ffb3c6" {O}/>
<ellipse cx="84" cy="36" rx="12" ry="15" fill="#ffb3c6" {O}/><ellipse cx="106" cy="58" rx="12" ry="15" fill="#ffb3c6" {O}/>""")
STICKERS["bone"] = svg(180, 100, f"""
<path d="M46 38 Q30 14 18 30 Q8 44 24 50 Q8 56 18 70 Q30 86 46 62 L134 62 Q150 86 162 70 Q172 56 156 50 Q172 44 162 30 Q150 14 134 38 Z" fill="#fff6e6" {O}/>""")
STICKERS["fish"] = svg(180, 110, f"""
<path d="M132 55 L170 26 L164 55 L170 84 Z" fill="#7cc4ff" {O}/>
<ellipse cx="80" cy="55" rx="62" ry="38" fill="#a9d6ff" {O}/>
<path d="M104 30 Q116 55 104 80" fill="none" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>
<circle cx="46" cy="48" r="6" fill="{EYE}"/><circle cx="48" cy="46" r="2" fill="#fff"/>
<ellipse cx="44" cy="66" rx="6" ry="3.5" fill="{BLUSH}" opacity=".7"/>""")
STICKERS["carrot"] = svg(120, 180, f"""
<path d="M60 52 Q40 30 30 14 Q48 18 60 40 Q72 18 90 14 Q80 30 60 52 Z" fill="#7ccf7a" {O}/>
<path d="M36 60 Q60 44 84 60 Q78 120 60 168 Q42 120 36 60 Z" fill="#ff9a3c" {O}/>
<path d="M46 84 h12 M62 106 h12 M50 128 h10" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>""")
STICKERS["camera"] = svg(180, 140, f"""
<path d="M56 34 L68 16 H112 L124 34 Z" fill="#ffb3c6" {O}/>
<rect x="14" y="32" width="152" height="94" rx="20" fill="#ffd6e2" {O}/>
<circle cx="90" cy="80" r="34" fill="#ffffff" {O}/><circle cx="90" cy="80" r="22" fill="#6c7bd9" {O}/>
<circle cx="82" cy="72" r="7" fill="#fff" opacity=".85"/>
<rect x="132" y="44" width="20" height="12" rx="5" fill="#fff3a8" {O}/>
<path d="M30 52 h18" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>""")

# ---------------------------------------------------------------- paper goods (no die-cut: tape is translucent)
STICKERS["tape-pink"] = svg(220, 70, """
<path d="M8 8 L16 18 L8 28 L16 38 L8 48 L16 58 L8 64 L212 62 L204 52 L212 42 L204 32 L212 22 L204 12 L212 6 Z" fill="#ffc2d4" fill-opacity=".85"/>
""" + "".join(f'<rect x="{x}" y="6" width="12" height="58" fill="#ffffff" fill-opacity=".45"/>' for x in range(28, 200, 30)), cut=0)
STICKERS["tape-mint"] = svg(220, 70, """
<path d="M8 8 L16 18 L8 28 L16 38 L8 48 L16 58 L8 64 L212 62 L204 52 L212 42 L204 32 L212 22 L204 12 L212 6 Z" fill="#bfe9d4" fill-opacity=".85"/>
""" + "".join(f'<circle cx="{x}" cy="{y}" r="5" fill="#ffffff" fill-opacity=".6"/>' for x in range(30, 200, 24) for y in (22, 46)), cut=0)
_scallop = "".join(f'<circle cx="{x}" cy="{y}" r="7" fill="#fdf6ec"/>' for x in range(14, 128, 14) for y in (8, 152)) + \
           "".join(f'<circle cx="{x}" cy="{y}" r="7" fill="#fdf6ec"/>' for y in range(22, 150, 14) for x in (8, 128))
STICKERS["stamp"] = svg(136, 160, f"""{_scallop}<rect x="8" y="8" width="120" height="144" fill="#fdf6ec"/>
<rect x="20" y="20" width="96" height="120" fill="#ffd1dc" stroke="#e9a3b4" stroke-width="3"/>
<path d="{heart_path(68, 76, 26)}" fill="#ff6f96" {O}/>
<path d="M28 124 h80" stroke="#e9a3b4" stroke-width="3" stroke-dasharray="6 6"/>""", cut=8)
STICKERS["banner"] = svg(300, 90, f"""
<path d="M14 30 L48 30 L48 74 L14 74 L28 52 Z" fill="#ff8fb3" {O}/>
<path d="M286 30 L252 30 L252 74 L286 74 L272 52 Z" fill="#ff8fb3" {O}/>
<path d="M40 18 Q150 4 260 18 L260 64 Q150 50 40 64 Z" fill="#ffc2d6" {O}/>""", cut=10)
STICKERS["frame-flower"] = svg(160, 160, f"""
<path d="M80 18 C92 18 94 34 106 30 C118 26 128 38 122 50 C116 60 130 68 126 80 C122 94 106 90 102 102 C98 116 86 126 76 118 C66 110 54 120 44 110 C34 100 44 88 36 78 C28 68 32 54 44 52 C56 50 54 34 66 28 C70 22 74 18 80 18 Z" fill="#ffe3ec" {O}/>
<circle cx="80" cy="70" r="14" fill="#ffd34d" {O}/>""")

# ---------------------------------------------------------------- textures (PNG)

def textures(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    rnd = random.Random(42)
    # paper: fibres and specks (transparent overlay, multiply-friendly)
    img = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for _ in range(9000):
        x, y = rnd.random() * 512, rnd.random() * 512
        a = rnd.randint(8, 34)
        d.point((x, y), fill=(110, 80, 50, a))
    for _ in range(260):
        x, y = rnd.random() * 512, rnd.random() * 512
        ang = rnd.random() * math.pi
        ln = 6 + rnd.random() * 22
        d.line((x, y, x + math.cos(ang) * ln, y + math.sin(ang) * ln), fill=(120, 90, 60, rnd.randint(18, 40)), width=1)
    img.filter(ImageFilter.GaussianBlur(.4)).save(out / "paper.png", optimize=True)
    # kraft: opaque brown paper tile
    img = Image.new("RGB", (256, 256), (201, 166, 122))
    px = img.load()
    for y in range(256):
        for x in range(256):
            n = rnd.randint(-14, 14)
            r, g, b = px[x, y]
            px[x, y] = (max(0, min(255, r + n)), max(0, min(255, g + n)), max(0, min(255, b + n - 2)))
    d = ImageDraw.Draw(img)
    for _ in range(160):
        x, y = rnd.random() * 256, rnd.random() * 256
        ang = rnd.random() * math.pi
        ln = 8 + rnd.random() * 30
        c = rnd.randint(150, 190)
        d.line((x, y, x + math.cos(ang) * ln, y + math.sin(ang) * ln), fill=(c, int(c * .78), int(c * .55)), width=1)
    img.filter(ImageFilter.GaussianBlur(.6)).save(out / "kraft.png", optimize=True)
    # film grain: neutral noise with alpha (overlay on dark or light)
    # (few distinct values so the tile stays small)
    img = Image.new("LA", (256, 256), (0, 0))
    px = img.load()
    for y in range(256):
        for x in range(256):
            v = rnd.choice((30, 90, 160, 230))
            px[x, y] = (v, rnd.choice((12, 20, 28)))
    img.save(out / "grain.png", optimize=True)
    # linen: cross-hatch weave
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for i in range(0, 256, 3):
        d.line((i, 0, i, 256), fill=(255, 255, 255, rnd.randint(14, 30)))
        d.line((0, i, 256, i), fill=(90, 70, 60, rnd.randint(8, 20)))
    img.save(out / "linen.png", optimize=True)
    # gingham tiles (opaque)
    for name, col in (("gingham-pink", (255, 182, 200)), ("gingham-blue", (170, 205, 255)), ("gingham-mint", (172, 226, 200))):
        t = Image.new("RGB", (64, 64), (255, 255, 255))
        d = ImageDraw.Draw(t, "RGBA")
        d.rectangle((0, 0, 31, 63), fill=col + (110,))
        d.rectangle((0, 0, 63, 31), fill=col + (110,))
        t.save(out / f"{name}.png", optimize=True)
    # polka dots (transparent tile)
    t = Image.new("RGBA", (60, 60), (0, 0, 0, 0))
    d = ImageDraw.Draw(t)
    for cx, cy in ((15, 15), (45, 45)):
        d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=(255, 255, 255, 200))
    t.save(out / "dots.png", optimize=True)


def main() -> None:
    sd = OUT / "stickers"
    sd.mkdir(parents=True, exist_ok=True)
    for name, data in STICKERS.items():
        (sd / f"{name}.svg").write_text(data, encoding="utf-8")
    textures(OUT / "textures")
    print(f"{len(STICKERS)} stickers, textures ->", OUT)


if __name__ == "__main__":
    main()
