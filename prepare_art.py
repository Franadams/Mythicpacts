#!/usr/bin/env python3
"""Cut the artwork in art/ into the pieces the game uses, and write them to assets/.

Run from Terminal:  python3 prepare_art.py   (build.py runs it for you too)

It understands three kinds of image:
  * A realm sheet, e.g. Sirens.png: 11 cards on a plain background,
    cards 1-6 on the top row and 7, 8, 9, 10 and the x (Pact) card below.
    Cards 2-10 become the number cards and the x card becomes the Pact.
  * A crystal sheet (Crystals.png): five crystals side by side, each with
    its realm's name underneath. The background is made transparent.
  * A board (GameBoard.png): five realm portraits side by side.
    They become the empty discard spaces in the middle of the table.

Only Python's standard library and macOS's built-in `sips` are used.
"""
import json
import os
import struct
import subprocess
import sys
import tempfile
import zlib
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ART = ROOT / "art"
ASSETS = ROOT / "assets"

REALMS = ["siren", "fairy", "dryad", "nymph", "angel"]
SHEET_NAMES = {"siren": ["sirens", "siren"], "fairy": ["fairies", "fairy"], "dryad": ["dryads", "dryad"],
               "nymph": ["nymphs", "nymph"], "angel": ["angels", "angel"]}
CRYSTAL_NAMES = ["crystals", "crystal", "cystals", "cystal"]
BOARD_NAMES = ["gameboard", "game-board", "game_board", "board"]
# Left-to-right order of the realms in your crystal sheet and your board image.
CRYSTAL_ORDER = ["fairy", "siren", "dryad", "nymph", "angel"]
BOARD_ORDER = ["fairy", "siren", "dryad", "angel", "nymph"]
# The Angel and Nymph cards were redone in gold and lavender, but GameBoard.png still frames those two
# portraits in purple and teal. Until it is redone too, recolour just the frame and the name banner:
# realm -> (hue range to change, in degrees, new hue, saturation factor, brightness factor).
# Delete an entry to keep the original.
PORTRAIT_RECOLOR = {"angel": ((250, 325), 40, 0.95, 1.45), "nymph": ((145, 205), 266, 0.62, 1.12)}

CARD_W, CARD_H = 320, 560        # every card is resized to this shape (height = 1.75 x width)
PORTRAIT_W = 320                 # board portraits keep their own proportions
CRYSTAL_H = 300


# ---------- reading and writing pixels ----------
def load(path):
    """Return (width, height, rows) where each row is a bytearray of RGB values."""
    with tempfile.TemporaryDirectory() as t:
        bmp = Path(t) / "x.bmp"
        subprocess.run(["sips", "-s", "format", "bmp", str(path), "--out", str(bmp)], check=True, capture_output=True)
        b = bmp.read_bytes()
    off = struct.unpack_from("<I", b, 10)[0]
    w, h = struct.unpack_from("<ii", b, 18)
    bp = struct.unpack_from("<H", b, 28)[0] // 8
    bottom_up, h = h > 0, abs(h)
    stride = (w * bp + 3) & ~3
    rows = []
    for y in range(h):
        sy = h - 1 - y if bottom_up else y
        r = b[off + sy * stride: off + sy * stride + w * bp]
        rgb = bytearray(w * 3)
        rgb[0::3], rgb[1::3], rgb[2::3] = r[2::bp], r[1::bp], r[0::bp]
        rows.append(rgb)
    return w, h, rows


def save_png(path, w, h, rows, channels=3):
    raw = b"".join(b"\x00" + bytes(r) for r in rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    colour = 6 if channels == 4 else 2
    Path(path).write_bytes(b"\x89PNG\r\n\x1a\n"
                           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, colour, 0, 0, 0))
                           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))


def crop(rows, x0, y0, x1, y1):
    return [r[x0 * 3:x1 * 3] for r in rows[y0:y1]]


def export_jpeg(rows, w, h, out, size):
    """Save a crop, resized to exactly `size` (width, height), as a JPEG."""
    with tempfile.TemporaryDirectory() as t:
        png = Path(t) / "c.png"
        save_png(png, w, h, rows)
        subprocess.run(["sips", "-z", str(size[1]), str(size[0]), "-s", "format", "jpeg", "-s", "formatOptions", "82",
                        str(png), "--out", str(out)], check=True, capture_output=True)


# ---------- finding cards on a sheet ----------
def background(w, h, rows):
    sample = [tuple(rows[y][x * 3:x * 3 + 3]) for y in range(h // 3, 2 * h // 3, 7) for x in range(0, 6)]
    sample.sort(key=sum)
    return sample[len(sample) // 2]


def find_cards(w, h, rows, step=2, threshold=60):
    """Flood-fill the background in from the edges; what it can't reach is a card.
    Card frames are closed borders, so pale art inside a card is never mistaken for background."""
    bg = background(w, h, rows)
    W, H = w // step, h // step
    is_bg = bytearray(W * H)
    for Y in range(H):
        r = rows[Y * step]
        for X in range(W):
            i = X * step * 3
            if abs(r[i] - bg[0]) + abs(r[i + 1] - bg[1]) + abs(r[i + 2] - bg[2]) < threshold:
                is_bg[Y * W + X] = 1
    outside = bytearray(W * H)
    q = deque([Y * W for Y in range(H)] + [Y * W + W - 1 for Y in range(H)] + list(range(W)) + [(H - 1) * W + X for X in range(W)])
    while q:
        p = q.popleft()
        if outside[p] or not is_bg[p]:
            continue
        outside[p] = 1
        X, Y = p % W, p // W
        if X > 0: q.append(p - 1)
        if X < W - 1: q.append(p + 1)
        if Y > 0: q.append(p - W)
        if Y < H - 1: q.append(p + W)

    label = bytearray(W * H)
    boxes = []
    for s in range(W * H):
        if outside[s] or label[s]:
            continue
        q = deque([s]); label[s] = 1
        x0 = y0 = 10 ** 9; x1 = y1 = -1
        while q:
            p = q.popleft(); X, Y = p % W, p // W
            x0, x1, y0, y1 = min(x0, X), max(x1, X), min(y0, Y), max(y1, Y)
            for d in ((p - 1) if X > 0 else -1, (p + 1) if X < W - 1 else -1, (p - W) if Y > 0 else -1, (p + W) if Y < H - 1 else -1):
                if d >= 0 and not outside[d] and not label[d]:
                    label[d] = 1; q.append(d)
        if (x1 - x0) * step > 100 and (y1 - y0) * step > 160:
            boxes.append([x0, y0, x1 + 1, y1 + 1])

    def solid(X, Y):
        return not outside[Y * W + X]

    # Two cards touching come out as one wide box: split it at its emptiest column.
    widths = sorted(b[2] - b[0] for b in boxes)
    typical = widths[len(widths) // 2] if widths else 1
    split = []
    for b in boxes:
        n = round((b[2] - b[0]) / typical)
        if n < 2:
            split.append(b); continue
        cuts = [b[0]]
        for k in range(1, n):
            guess = b[0] + (b[2] - b[0]) * k // n
            span = range(guess - typical // 4, guess + typical // 4)
            density = lambda X: sum(solid(X, Y) for Y in range(b[1], b[3], 2))
            cuts.append(min(span, key=density))
        cuts.append(b[2])
        split += [[cuts[i], b[1], cuts[i + 1], b[3]] for i in range(n)]

    # Trim decorative flourishes that stick out of the corners: measure each edge across the middle only.
    cards = []
    for x0, y0, x1, y1 in split:
        mid_rows = range(y0 + (y1 - y0) * 3 // 10, y0 + (y1 - y0) * 7 // 10)
        mid_cols = range(x0 + (x1 - x0) * 3 // 10, x0 + (x1 - x0) * 7 // 10)
        lefts = sorted(next((X for X in range(x0, x1) if solid(X, Y)), x0) for Y in mid_rows)
        rights = sorted(next((X for X in range(x1 - 1, x0, -1) if solid(X, Y)), x1) for Y in mid_rows)
        tops = sorted(next((Y for Y in range(y0, y1) if solid(X, Y)), y0) for X in mid_cols)
        bottoms = sorted(next((Y for Y in range(y1 - 1, y0, -1) if solid(X, Y)), y1) for X in mid_cols)
        med = lambda a: a[len(a) // 2]
        cards.append((med(lefts) * step, med(tops) * step, (med(rights) + 1) * step, (med(bottoms) + 1) * step))
    # Reading order: top row left to right, then the next row.
    cards.sort(key=lambda c: (c[1] // 150, c[0]))
    return cards


# ---------- the three kinds of art ----------
def find_file(names):
    for p in sorted(ART.glob("*")):
        if p.stem.lower().replace(" ", "") in names and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".heic"):
            return p
    return None


def slice_sheet(realm, path, manifest):
    w, h, rows = load(path)
    cards = find_cards(w, h, rows)
    if len(cards) != 11:
        print(f"  {path.name}: found {len(cards)} cards, expected 11 (1-10 and the x card). Skipped; placeholders will be used.")
        return
    out = ASSETS / "cards"
    out.mkdir(parents=True, exist_ok=True)
    for i, (x0, y0, x1, y1) in enumerate(cards):
        if i == 0:
            continue    # the game's numbers start at 2
        key = f"{realm}-pact" if i == 10 else f"{realm}-{i + 1}"
        dest = out / f"{key}.jpg"
        # Inset by 1% so no background shows past the rounded corners.
        dx, dy = (x1 - x0) // 100, (y1 - y0) // 100
        export_jpeg(crop(rows, x0 + dx, y0 + dy, x1 - dx, y1 - dy), x1 - x0 - 2 * dx, y1 - y0 - 2 * dy, dest, (CARD_W, CARD_H))
        manifest[key] = f"assets/cards/{key}.jpg"
    print(f"  {path.name}: 10 cards for the {realm} realm")


def slice_board(path, manifest):
    w, h, rows = load(path)
    found = find_cards(w, h, rows)
    # The ornate border around a board shows up as extra shapes; the portraits are the tall ones.
    tallest = max((c[3] - c[1] for c in found), default=0)
    cards = [c for c in found if c[3] - c[1] >= 0.75 * tallest]
    if len(cards) != 5:
        print(f"  {path.name}: found {len(cards)} portraits, expected 5. Skipped.")
        return
    out = ASSETS / "realms"
    out.mkdir(parents=True, exist_ok=True)
    for realm, (x0, y0, x1, y1) in zip(BOARD_ORDER, sorted(cards)):
        dx, dy = (x1 - x0) // 100, (y1 - y0) // 100
        cw, ch = x1 - x0 - 2 * dx, y1 - y0 - 2 * dy
        dest = out / f"{realm}.jpg"
        export_jpeg(crop(rows, x0 + dx, y0 + dy, x1 - dx, y1 - dy), cw, ch, dest, (PORTRAIT_W, round(PORTRAIT_W * ch / cw)))
        if realm in PORTRAIT_RECOLOR:
            recolor_frame(dest, *PORTRAIT_RECOLOR[realm])
        manifest[f"realm-{realm}"] = f"assets/realms/{realm}.jpg"
    print(f"  {path.name}: 5 realm portraits")


def recolor_frame(path, hues, new_hue, sat_factor, val_factor):
    """Change the colour of a portrait's frame (the outer band) and its name banner (the bottom strip),
    leaving the painting inside alone. Only strongly coloured pixels in the chosen hue range change."""
    import colorsys
    w, h, rows = load(path)
    side, top, banner = max(6, w * 55 // 1000), max(10, w * 95 // 1000), h * 925 // 1000
    lo, hi = hues
    for y in range(h):
        r = rows[y]
        for x in range(w):
            if not (x < side or x >= w - side or y < top or y >= banner):
                continue
            i = x * 3
            hh, ss, vv = colorsys.rgb_to_hsv(r[i] / 255, r[i + 1] / 255, r[i + 2] / 255)
            if ss < 0.2 or not lo <= hh * 360 <= hi:
                continue
            nr, ng, nb = colorsys.hsv_to_rgb(new_hue / 360, min(1, ss * sat_factor), min(1, vv * val_factor))
            r[i], r[i + 1], r[i + 2] = int(nr * 255), int(ng * 255), int(nb * 255)
    with tempfile.TemporaryDirectory() as t:
        png = Path(t) / "r.png"
        save_png(png, w, h, rows)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "82", str(png), "--out", str(path)],
                       check=True, capture_output=True)


def slice_crystals(path, manifest):
    """Cut out each crystal and turn the plain background transparent (soft edges, no pale fringe)."""
    w, h, rows = load(path)
    bg = background(w, h, rows)
    lo, hi = 18, 56     # colour distance from the background: fully clear below lo, fully solid above hi
    alpha = []
    for r in rows:
        a = bytearray(w)
        for x in range(w):
            i = x * 3
            d = abs(r[i] - bg[0]) + abs(r[i + 1] - bg[1]) + abs(r[i + 2] - bg[2])
            a[x] = 0 if d <= lo else 255 if d >= hi else (d - lo) * 255 // (hi - lo)
        alpha.append(a)

    out = ASSETS / "crystals"
    out.mkdir(parents=True, exist_ok=True)
    # Neighbouring crystals' wings and swirls can touch, so there may be no clear gap between them.
    # Cut each boundary at the column with the least drawing in it, near where it should be.
    seg = w / 5
    density = [sum(1 for y in range(0, h, 2) if alpha[y][x] > 120) for x in range(w)]
    cuts = [0]
    for k in range(1, 5):
        guess = int(seg * k)
        window = range(guess - int(seg * 0.3), guess + int(seg * 0.3))
        cuts.append(min(window, key=lambda x: (density[x], abs(x - guess))))
    cuts.append(w)
    for k, realm in enumerate(CRYSTAL_ORDER):
        xs0, xs1 = cuts[k], cuts[k + 1]
        # Rows with any solid pixels. The realm's name sits below a gap, so keep only the first tall run.
        filled = [sum(1 for x in range(xs0, xs1, 2) if alpha[y][x] > 160) > 2 for y in range(h)]
        runs, start = [], None
        for y, f in enumerate(filled + [False]):
            if f and start is None: start = y
            if not f and start is not None:
                runs.append((start, y)); start = None
        runs = [r for r in runs if r[1] - r[0] > 4]
        if not runs:
            print(f"  {path.name}: no crystal found for {realm}. Skipped.")
            continue
        # Join runs separated by small gaps (thin stems), stop at the first big gap (above the label).
        y0, y1 = runs[0]
        for a, b in runs[1:]:
            if a - y1 > 18: break
            y1 = b
        cols = [x for x in range(xs0, xs1) if any(alpha[y][x] > 120 for y in range(y0, y1, 3))]
        x0, x1 = (min(cols), max(cols) + 1) if cols else (xs0, xs1)
        pad = 6
        x0, x1, y0, y1 = max(xs0, x0 - pad), min(xs1, x1 + pad), max(0, y0 - pad), min(h, y1 + pad)
        rgba = []
        for y in range(y0, y1):
            r, a = rows[y], alpha[y]
            line = bytearray((x1 - x0) * 4)
            for j, x in enumerate(range(x0, x1)):
                al = a[x]
                if al:
                    f = al / 255
                    for c in range(3):   # remove the background's tint from soft edges
                        v = (r[x * 3 + c] - (1 - f) * bg[c]) / f
                        line[j * 4 + c] = 0 if v < 0 else 255 if v > 255 else int(v)
                line[j * 4 + 3] = al
            rgba.append(line)
        with tempfile.TemporaryDirectory() as t:
            png = Path(t) / "c.png"
            save_png(png, x1 - x0, y1 - y0, rgba, channels=4)
            dest = out / f"{realm}.png"
            subprocess.run(["sips", "--resampleHeight", str(CRYSTAL_H), str(png), "--out", str(dest)], check=True, capture_output=True)
        manifest[f"crystal-{realm}"] = f"assets/crystals/{realm}.png"
    print(f"  {path.name}: 5 crystals with transparent backgrounds")


def single_images(manifest):
    """Plain single images named after a key (e.g. card-back.png, table.png) are used as they are."""
    for key in ["card-back", "table"]:
        for p in ART.glob("*"):
            if p.stem.lower().replace("_", "-").replace(" ", "-") in (key, key.replace("-", "")):
                manifest[key] = f"art/{p.name}"


# The page backdrop. Two options were made; backdrop2 (dark linen, gold moons and stars) suits the
# game's dark table and gold card back, so it wins unless a file called simply "backdrop" exists.
BACKDROP_NAMES = ["backdrop", "backdrop2"]


def backdrop(manifest):
    p = next((f for name in BACKDROP_NAMES for f in sorted(ART.glob("*")) if f.stem.lower() == name), None)
    if not p:
        return
    ASSETS.mkdir(exist_ok=True)
    dest = ASSETS / "backdrop.jpg"
    subprocess.run(["sips", "-Z", "1920", "-s", "format", "jpeg", "-s", "formatOptions", "80", str(p), "--out", str(dest)],
                   check=True, capture_output=True)
    manifest["backdrop"] = "assets/backdrop.jpg"
    print(f"  {p.name}: page backdrop")


def main():
    if not ART.exists():
        print("No art/ folder yet.")
        return {}
    print("Preparing art:")
    manifest = {}
    for realm in REALMS:
        p = find_file(SHEET_NAMES[realm])
        if p: slice_sheet(realm, p, manifest)
    p = find_file(CRYSTAL_NAMES)
    if p: slice_crystals(p, manifest)
    p = find_file(BOARD_NAMES)
    if p: slice_board(p, manifest)
    single_images(manifest)
    backdrop(manifest)
    ASSETS.mkdir(exist_ok=True)
    (ASSETS / "art.js").write_text("// Written by prepare_art.py. Lists the artwork the game should use.\n"
                                   f"window.ART_FILES = {json.dumps(manifest, indent=1)};\n", encoding="utf-8")
    print(f"  wrote assets/art.js ({len(manifest)} images)")
    return manifest


if __name__ == "__main__":
    main()
