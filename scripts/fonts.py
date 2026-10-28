#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["fonttools==4.67.0", "brotli==1.2.0"]
# ///
"""The five faces the page inlines, cut to what the page draws with each.

The masters are the faces as they were published, in fonts-src/, which neither vite nor the build reads. Each face of the
page is cut from its master and written to web/public/fonts/, where the page and the build take it from:

    uv run scripts/fonts.py

Every character a face keeps keeps its outline, its advance, its kerning and its tabular figures, and the vertical
metrics (head, hhea, OS/2) are the master's. So are the names, with the copyright of each typeface, but for those of the
weights of Spline Sans Mono's variable master, which its one weight no longer has. The masters carry no licence of their
own: the three typefaces are under the SIL Open Font License 1.1, as the License section of the README says. What a
face drops is what the page never asks of it:

- Montserrat 300 draws numbers only: the twin's number in the window (.twin b), the times in the ring of the arithmetic
  (.ring .times, ≈4.1×) and the amounts of its ledger (.ledger .amt, ≈61). Figures, the point and the comma, ≈ and ×,
  and the signs a number is written with when a record makes it negative, very large or very small: -, + and e.
- Montserrat 400 draws DEVCON over the city, and the twin's number when it has four to seven figures.
- Montserrat 500 draws the small capitals of the page, all of them uppercase but one: the units over the chart of a
  cycle, °C and Pa. It keeps every character of its master but the lowercase letters from b to z: the a stays, for Pa.
- Fira Sans Condensed keeps every character, Latin-1 and Latin Extended-A, since a record or a description may name
  anything, and every feature but `case`, the capitals' punctuation, which nothing asks for.
- Spline Sans Mono is drawn at 400 alone, and is cut from its variable master as the instance at that weight.

Montserrat keeps only `kern` and `tnum`: its `liga` joins f with i and with l, letters none of its cuts keeps, and its
`case` nothing asks for. A text set in Montserrat that its cut does not have falls to the next font of the stack, and
test/fonts.test.mjs says so: it reads each face against the rules that use it.
"""
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parent.parent
MASTERS = ROOT / "fonts-src"
OUT = ROOT / "web" / "public" / "fonts"

NUMBERS = " .,0123456789≈×"
# what JavaScript writes a number with besides its figures: -5.2, 6.1e+24, 1e-7
SIGNS = "-+e"
LOWER_B_TO_Z = "bcdefghijklmnopqrstuvwxyz"

# The vertical metrics a face keeps from its master: the size of its em, its box and the lines a browser sets text on.
METRICS = {
    "head": ["unitsPerEm", "yMin", "yMax"],
    "hhea": ["ascent", "descent", "lineGap"],
    "OS/2": ["sTypoAscender", "sTypoDescender", "sTypoLineGap", "usWinAscent", "usWinDescent", "fsSelection", "sxHeight", "sCapHeight"],
}


def master(name):
    # the head and hhea of the master as they were published, its box and its date too: the same masters give the same files
    return TTFont(MASTERS / name, recalcBBoxes=False, recalcTimestamp=False)


def cmap(font):
    return set(font.getBestCmap())


def cut(font, unicodes, features, name):
    options = subset.Options()
    options.layout_features = features
    # every name record the master has, as it has it: the copyright travels with the face
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.name_legacy = True
    options.notdef_outline = True
    options.flavor = "woff2"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=sorted(unicodes))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(OUT / name)
    return TTFont(OUT / name)


def features(font):
    tags = set()
    for table in ("GSUB", "GPOS"):
        if table in font and font[table].table.FeatureList:
            tags |= {record.FeatureTag for record in font[table].table.FeatureList.FeatureRecord}
    return sorted(tags)


def check(face, source, kept):
    for table, fields in METRICS.items():
        for field in fields:
            if getattr(face[table], field) != getattr(source[table], field):
                raise SystemExit(f"{table}.{field} is not the master's")
    if cmap(face) != kept:
        raise SystemExit("the face does not hold the characters it was cut to")


OUT.mkdir(parents=True, exist_ok=True)
faces = []

m500 = cmap(master("montserrat-500.woff2"))
for weight, chars in ((300, set(map(ord, NUMBERS + SIGNS))), (400, set(map(ord, NUMBERS + "DEVCON"))), (500, m500 - set(map(ord, LOWER_B_TO_Z)))):
    name = f"montserrat-{weight}.woff2"
    faces.append((name, master(name), chars, ["kern", "tnum"], name))

fira = master("fira-sans-condensed-400.woff2")
faces.append(("fira-sans-condensed-400.woff2", fira, cmap(fira), ["kern", "liga", "calt", "tnum"], "fira-sans-condensed-400.woff2"))

spline = master("spline-sans-mono-var.woff2")
chars = cmap(spline)
faces.append(("spline-sans-mono-var.woff2", instancer.instantiateVariableFont(spline, {"wght": 400}), chars, ["*"], "spline-sans-mono-400.woff2"))

for source, font, chars, kept_features, name in faces:
    face = cut(font, chars, kept_features, name)
    check(face, master(source), chars)
    size = (OUT / name).stat().st_size
    print(f"{name:32} {(MASTERS / source).stat().st_size:6} → {size:6} B  {len(chars):3} characters  {face['maxp'].numGlyphs:3} glyphs  {' '.join(features(face)) or '-'}")
