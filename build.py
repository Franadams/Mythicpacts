#!/usr/bin/env python3
"""Pack the game (index.html plus src/) and your art into one self-contained file: dist/mythic-pacts.html

Run from Terminal:  python3 build.py

It first runs prepare_art.py (which cuts your sheets into cards, crystals and
portraits), then puts every image inside the page itself, so the finished file
works anywhere: as an email attachment or opened straight from a USB stick.
It also writes dist/publish.html, the same page without its <head> lines,
for hosting services that add their own, and refreshes nn/seer-weights.js
(the computer opponent's neural network) from nn/v5.json.
"""
import base64
import json
import pathlib
import subprocess
import sys
import tempfile

import prepare_art

ROOT = pathlib.Path(__file__).resolve().parent
OUT = ROOT / "dist" / "mythic-pacts.html"
PUBLISH = ROOT / "dist" / "publish.html"
PREAMBLE_END = "<!-- /local-preamble -->"
SEER_NET = ROOT / "nn" / "v5.json"            # the network the Seer plays with
SEER_SCRIPT = ROOT / "nn" / "seer-weights.js"
ART_TAG = '<script src="assets/art.js"></script>'
MIME = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
INLINE = [
    ('<link rel="stylesheet" href="src/styles.css">', "src/styles.css", "style"),
    ('<script src="src/engine.js"></script>', "src/engine.js", "script"),
    ('<script src="nn/net.js"></script>', "nn/net.js", "script"),
    ('<script src="nn/seer-weights.js"></script>', "nn/seer-weights.js", "script"),
    ('<script src="src/online.js"></script>', "src/online.js", "script"),
    ('<script src="src/sound.js"></script>', "src/sound.js", "script"),
    ('<script src="src/ui.js"></script>', "src/ui.js", "script"),
]


def data_uri(path, key, tmp):
    # Single images straight from art/ (a card back or table picture) can be huge; shrink them first.
    if path.parent.name == "art":
        size = 1600 if key == "table" else 640
        out = tmp / f"{key}.jpg"
        subprocess.run(["sips", "-Z", str(size), "-s", "format", "jpeg", "-s", "formatOptions", "82", str(path), "--out", str(out)],
                       check=True, capture_output=True)
        path = out
    return f"data:{MIME.get(path.suffix.lower(), 'image/jpeg')};base64,{base64.b64encode(path.read_bytes()).decode()}"


def write_seer_weights():
    # The page can't read a .json file when opened straight from disk, so the network goes in a script.
    weights = json.dumps(json.loads(SEER_NET.read_text(encoding="utf-8")), separators=(",", ":"))
    SEER_SCRIPT.write_text(
        f"/* The Seer's neural network: a copy of {SEER_NET.relative_to(ROOT)}, written by build.py so the game can load it\n"
        "   straight from a file. After training a new network, point SEER_NET in build.py at it and run the build. */\n"
        f"const SEER_WEIGHTS = {weights};\n", encoding="utf-8")


def main():
    write_seer_weights()
    manifest = prepare_art.main()
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    if ART_TAG not in html:
        sys.exit("index.html no longer contains the art.js script tag, so the art can't be embedded.")

    embedded = {}
    with tempfile.TemporaryDirectory() as t:
        for key, rel in manifest.items():
            embedded[key] = data_uri(ROOT / rel, key, pathlib.Path(t))
    html = html.replace(ART_TAG, f"<script>window.ART_FILES = {json.dumps(embedded)};</script>", 1)

    # Put the stylesheet and scripts from src/ inside the page too.
    for tag, path, wrap in INLINE:
        if tag not in html:
            sys.exit(f"index.html no longer contains {tag}")
        code = (ROOT / path).read_text(encoding="utf-8")
        if wrap == "script" and "</script" in code:
            sys.exit(f"{path} contains '</script', which would end the inlined script early.")
        html = html.replace(tag, f"<{wrap}>\n{code}</{wrap}>", 1)

    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    # A host that supplies its own <head> gets the page without the standalone preamble.
    PUBLISH.write_text(html.split(PREAMBLE_END, 1)[-1].lstrip(), encoding="utf-8")

    mb = OUT.stat().st_size / 1_048_576
    print(f"\nWrote {OUT.relative_to(ROOT)} ({mb:.1f} MB, {len(embedded)} images) and {PUBLISH.relative_to(ROOT)}")
    if mb > 15:
        sys.exit("Warning: the file is over 15 MB. Use fewer or smaller images.")


if __name__ == "__main__":
    main()
