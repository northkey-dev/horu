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
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

from mokuro.manga_page_ocr import MangaPageOcr  # noqa: E402  (slow import, after stdout setup)

from PIL import Image  # noqa: E402  (comes with mokuro)

import cv2  # noqa: E402  (comes with mokuro)
import numpy as np  # noqa: E402

ocr = MangaPageOcr(force_cpu=True)
mocr = ocr.mocr  # the model itself; ocr.mocr is replaced below


# ---- furigana ----
# The detector's box around a column is sometimes too wide and takes the small reading next to it along, and the
# model reads that too: 月収まん for 月収. Furigana is a thin band beside the main text, so thin bands are painted
# over and the line is read again. That answer only counts when nothing but kana went missing: a band that was
# part of the text changes more than that, and the first reading stays.

KANA = re.compile(r"[぀-ヿ]")
split_line = MangaPageOcr.split_into_chunks
line_is_vertical = False


def split_noting_direction(img, mask_refined, blk, line_idx, **kwargs):
    global line_is_vertical
    line_is_vertical = bool(blk.vertical)
    return split_line(img, mask_refined, blk, line_idx, **kwargs)


def ink_bands(ink):
    """Runs of rows with ink, as (start, end)."""
    rows = ink.sum(axis=1) > max(1, ink.shape[1] * 0.01)
    bands = []
    start = None
    for i, on in enumerate(rows):
        if on and start is None:
            start = i
        elif not on and start is not None:
            bands.append((start, i))
            start = None
    if start is not None:
        bands.append((start, len(rows)))
    return bands


def without_furigana(im, vertical):
    """The line with thin bands painted over, or None when it has none. Vertical lines come upright, so furigana
    is left and right of the text there: the picture is turned to look at rows either way."""
    gray = np.array(im.convert("L"))
    if vertical:
        gray = np.rot90(gray)
    _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ink = binary == 0
    if ink.mean() > 0.5:  # white text on a dark background
        ink = ~ink
    bands = ink_bands(ink)
    if len(bands) < 2:
        return None
    main = max(bands, key=lambda b: b[1] - b[0])
    size = main[1] - main[0]
    if size < (bands[-1][1] - bands[0][0]) * 0.33:  # no clear main text
        return None
    thin = [b for b in bands if b != main and 0.15 * size <= b[1] - b[0] <= 0.65 * size]
    if not thin:
        return None
    background = int(np.median(gray[~ink])) if (~ink).any() else 255
    painted = gray.copy()
    for top, bottom in thin:
        painted[top:bottom, :] = background
    if vertical:
        painted = np.rot90(painted, -1)
    return Image.fromarray(np.ascontiguousarray(painted)).convert("RGB")


def only_kana_gone(before, after):
    """True when `after` is `before` with some kana taken out and nothing else changed."""
    i = 0
    for ch in before:
        if i < len(after) and after[i] == ch:
            i += 1
        elif not KANA.match(ch):
            return False
    return i == len(after) and 0 < len(after) < len(before)


def read_line(im):
    text = mocr(im)
    clean = without_furigana(im, line_is_vertical)
    if clean is None:
        return text
    other = mocr(clean)
    return other if only_kana_gone(text, other) else text


ocr.split_into_chunks = split_noting_direction
ocr.mocr = read_line


# ---- reading the furigana itself ----
# The reading the page prints beats every dictionary. In a vertical block furigana are small marks to the right of
# a column, and the column is measured on the picture (the detector's font size can be twice the real one). What is
# read here is only a candidate: the server keeps it if it really is a reading of that kanji (shared/readings.ts).

KANJI_RUN = re.compile(r"[㐀-鿿々]+")


def runs_of(on):
    """Runs of True, as (start, end)."""
    out = []
    start = None
    for i, value in enumerate(on):
        if value and start is None:
            start = i
        elif not value and start is not None:
            out.append((start, i))
            start = None
    if start is not None:
        out.append((start, len(on)))
    return out


def columns_of(block, clean, left, top):
    """Where the text of each line really is: the band with the most ink inside its box."""
    columns = []
    for text, quad in zip(block["lines"], block["lines_coords"]):
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        x1, x2 = max(0, int(min(xs)) - left), int(max(xs)) - left
        y1, y2 = max(0, int(min(ys)) - top), int(max(ys)) - top
        part = clean[y1:y2, x1:x2]
        if part.size == 0:
            continue
        ink_per_column = part.sum(axis=0)
        bands = runs_of(ink_per_column > 0)
        if not bands:
            continue
        s, e = max(bands, key=lambda band: ink_per_column[band[0] : band[1]].sum())
        rows = runs_of(clean[y1:y2, x1 + s : x1 + e].sum(axis=1) > 0)
        if rows:
            columns.append({"text": text, "left": x1 + s + left, "right": x1 + e + left, "top": rows[0][0] + y1 + top, "bottom": rows[-1][1] + y1 + top})
    return sorted(columns, key=lambda c: c["left"])


def groups_of(marks, gap):
    """Marks above each other that belong together, as boxes."""
    groups = []
    for m in sorted(marks, key=lambda m: m[1]):
        if groups and m[1] - groups[-1][3] < gap:
            g = groups[-1]
            g[0], g[1], g[2], g[3] = min(g[0], m[0]), min(g[1], m[1]), max(g[2], m[2]), max(g[3], m[3])
        else:
            groups.append(list(m))
    return groups


def furigana_of(image, gray, block):
    """Pairs of kanji and the marks beside them in a vertical block."""
    font = int(block.get("font_size") or 30)
    x1, y1, x2, y2 = [int(v) for v in block["box"]]
    left, right = max(0, x1 - font), min(gray.shape[1], x2 + font)
    top, bottom = max(0, y1 - 8), min(gray.shape[0], y2 + 8)
    region = gray[top:bottom, left:right]
    _, binary = cv2.threshold(region, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ink = (binary == 0).astype(np.uint8)
    if ink.mean() > 0.5:  # a dark background
        return []
    count, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    marks = []
    for i in range(1, count):
        x, y, w, h, area = stats[i]
        if area >= 3 and max(w, h) <= font * 2:  # not specks, not the bubble's outline
            keep[i] = True
            marks.append((x + left, y + top, x + w + left, y + h + top))
    columns = columns_of(block, keep[labels], left, top)
    found = []
    for i, column in enumerate(columns):
        width = column["right"] - column["left"]
        limit = columns[i + 1]["left"] if i + 1 < len(columns) else column["right"] + width
        beside = [
            m
            for m in marks
            if column["right"] <= (m[0] + m[2]) / 2 < limit
            and max(m[2] - m[0], m[3] - m[1]) < width * 0.8
            and column["top"] - 4 <= (m[1] + m[3]) / 2 <= column["bottom"] + 4
        ]
        spans = list(KANJI_RUN.finditer(column["text"]))
        if not beside or not spans:
            continue
        cell = (column["bottom"] - column["top"]) / max(1, len(column["text"]))
        parts = {}
        for g in groups_of(beside, width * 0.45):
            if g[3] - g[1] < width * 0.25:
                continue
            crop = image.crop((g[0] - 3, g[1] - 3, g[2] + 3, g[3] + 3))
            text = mocr(crop.resize((crop.width * 4, crop.height * 4), Image.LANCZOS).convert("RGB"))
            at = ((g[1] + g[3]) / 2 - column["top"]) / cell
            run = min(spans, key=lambda m: 0 if m.start() <= at <= m.end() else min(abs(at - m.start()), abs(at - m.end())))
            parts.setdefault((run.start(), run.group()), []).append(text)
        found += [{"base": base, "ruby": "".join(texts)} for (_, base), texts in sorted(parts.items())]
    return found


def page_furigana(file, blocks):
    """The candidates of each block; a page that cannot be read this way simply has none."""
    try:
        with Image.open(file) as im:
            image = im.convert("L")
        gray = np.array(image)
        return [furigana_of(image, gray, b) if b.get("vertical") else [] for b in blocks]
    except Exception:  # noqa: BLE001 - the text itself is fine without this
        return [[] for _ in blocks]


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
    return mocr(crop)


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
        furigana = page_furigana(req["file"], page.get("blocks", []))
        blocks = [
            {
                "box": [int(v) for v in b["box"]],
                "vertical": bool(b.get("vertical", False)),
                "lines": b.get("lines", []),
                "furigana": found,
            }
            for b, found in zip(page.get("blocks", []), furigana)
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
