"""Long-running manga OCR worker for Horu (mokuro: comic-text-detector + manga-ocr).

Reads one JSON request per line from stdin:  {"id": "...", "file": "C:/.../001.jpg", "shrink": true}
for a photo (a sign, a menu, a pullover): the text is found with EasyOCR's CRAFT detector, which is made for photos,
and each found line is read by manga-ocr (without EasyOCR installed the manga detector is used instead):
                                              {"id": "...", "file": "C:/.../photo.jpg", "photo": true}
or, for a region the user framed on a photo (no text detection, the model just reads it):
                                              {"id": "...", "file": "C:/.../photo.jpg", "region": [x1, y1, x2, y2]}
Writes one JSON response per line to stdout: {"id": "...", "page": {img_width, img_height, blocks: [...]}}
Models are loaded once and stay in memory while the server keeps this process alive.
"""

import io
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")

from mokuro.manga_page_ocr import MangaPageOcr  # noqa: E402  (slow import, after stdout setup)

from PIL import Image  # noqa: E402  (comes with mokuro)

ocr = MangaPageOcr(force_cpu=True)


def shrink(file):
    """Re-encodes a JPEG at quality 80 when that saves at least a quarter (same size in pixels, so the
    text boxes still fit). Colour scans often halve; black and white pages rarely change."""
    if not file.lower().endswith((".jpg", ".jpeg")):
        return
    with Image.open(file) as im:
        im.load()
        mode = "L" if im.mode in ("L", "LA", "1") else "RGB"
        out = io.BytesIO()
        im.convert(mode).save(out, "JPEG", quality=80, optimize=True, progressive=True)
    if out.tell() < os.path.getsize(file) * 0.75:
        tmp = file + ".tmp"
        with open(tmp, "wb") as f:
            f.write(out.getvalue())
        os.replace(tmp, file)



def read_crop(im, box):
    """Reads one line of text (a word, a single character, handwriting) from a region of an image."""
    width, height = im.size
    x1, y1, x2, y2 = [int(v) for v in box]
    pad = int(max(x2 - x1, y2 - y1) * 0.06) + 4
    crop = im.crop((max(0, x1 - pad), max(0, y1 - pad), min(width, x2 + pad), min(height, y2 + pad)))
    w, h = crop.size
    if h > w * 1.4:  # vertical writing: the model reads horizontal lines, so turn it like mokuro does
        crop = crop.rotate(-90, expand=True)
    return ocr.mocr(crop)


def read_region(file, box):
    with Image.open(file) as im:
        return read_crop(im.convert("RGB"), box)


_craft = None


def craft():
    """EasyOCR's text detector (CRAFT), loaded on first use: ~80 MB model, downloaded once. None when not installed."""
    global _craft
    if _craft is None:
        try:
            import easyocr

            _craft = easyocr.Reader(["en"], gpu=False, recognizer=False, verbose=False)
        except Exception:  # noqa: BLE001 - not installed or no download: the manga detector is used instead
            _craft = False
    return _craft or None


def read_photo(file):
    """Finds the lines of text on a photo with CRAFT and reads each with manga-ocr; None without EasyOCR."""
    reader = craft()
    if reader is None:
        return None
    with Image.open(file) as im:
        im = im.convert("RGB")
    width, height = im.size
    horizontal, free = reader.detect(file, min_size=12, text_threshold=0.6, low_text=0.3, link_threshold=0.4, canvas_size=2560, mag_ratio=1.0)
    boxes = [tuple(int(v) for v in b) for b in horizontal[0]]
    for quad in free[0]:  # slanted lines: their bounding rectangle
        xs = [int(p[0]) for p in quad]
        ys = [int(p[1]) for p in quad]
        boxes.append((min(xs), max(xs), min(ys), max(ys)))
    blocks = []
    for x1, x2, y1, y2 in boxes[:40]:
        box = [max(0, x1), max(0, y1), min(width, x2), min(height, y2)]
        if box[2] - box[0] < 10 or box[3] - box[1] < 10:
            continue
        text = read_crop(im, box).strip()
        if text:
            blocks.append({"box": box, "vertical": (box[3] - box[1]) > (box[2] - box[0]) * 1.4, "lines": [text]})
    return {"img_width": width, "img_height": height, "blocks": blocks}



print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        if "region" in req:
            print(json.dumps({"id": req["id"], "text": read_region(req["file"], req["region"])}, ensure_ascii=False), flush=True)
            continue
        if req.get("photo"):
            photo = read_photo(req["file"])
            if photo is not None:
                print(json.dumps({"id": req["id"], "page": photo}, ensure_ascii=False), flush=True)
                continue
        page = ocr(req["file"])
        blocks = [
            {
                "box": [int(v) for v in b["box"]],
                "vertical": bool(b.get("vertical", False)),
                "lines": b.get("lines", []),
            }
            for b in page.get("blocks", [])
        ]
        out = {"img_width": page["img_width"], "img_height": page["img_height"], "blocks": blocks}
        if req.get("shrink"):
            try:
                shrink(req["file"])
            except Exception:  # noqa: BLE001 - the original page is fine too
                pass
        print(json.dumps({"id": req["id"], "page": out}, ensure_ascii=False), flush=True)
    except Exception as exc:  # noqa: BLE001 - report every failure back to the server
        print(json.dumps({"id": req["id"], "error": str(exc)}), flush=True)
