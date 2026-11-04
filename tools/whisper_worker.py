"""Long-running Whisper worker for Horu.

Reads one JSON request per line from stdin:  {"id": "...", "file": "C:/.../x.wav"}
Writes one JSON response per line to stdout: {"id": "...", "segments": [{"start", "end", "text"}]}
The model is loaded once and kept in memory while the server keeps this process alive.
"""

import json
import re
import sys
import wave

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.vad import VadOptions, get_speech_timestamps

SAMPLE_RATE = 16000


def load_wav(path):
    """16 kHz mono 16-bit WAV (the server converts with ffmpeg) -> float32 array.

    Decoding ourselves avoids faster-whisper's PyAV path, which breaks with some PyAV versions.
    """
    with wave.open(path, "rb") as w:
        frames = w.readframes(w.getnframes())
    return np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0

# Whisper tends to glue a quick reply of another speaker onto the previous sentence. So the voice-activity
# detector first cuts the audio at pauses (a turn change is usually longer than a pause inside a sentence),
# every chunk is transcribed on its own, and chunks are split again at sentence-final punctuation.
MIN_PAUSE_MS = 450
MIN_CHUNK_S = 0.4
SENTENCE = re.compile(r"[^。？！?!]+[。？！?!]*")


def speech_chunks(audio):
    options = VadOptions(min_silence_duration_ms=MIN_PAUSE_MS, speech_pad_ms=100)
    chunks = [(c["start"] / SAMPLE_RATE, c["end"] / SAMPLE_RATE) for c in get_speech_timestamps(audio, options)]
    return [c for c in chunks if c[1] - c[0] >= MIN_CHUNK_S]


def split_sentences(start, end, text):
    """Splits one transcribed chunk at 。？！ and shares its time by text length."""
    parts = [p.strip() for p in SENTENCE.findall(text) if p.strip()]
    if len(parts) < 2:
        return [{"start": start, "end": end, "text": text}]
    total = sum(len(p) for p in parts)
    out, at = [], start
    for part in parts:
        length = (end - start) * len(part) / total
        out.append({"start": at, "end": at + length, "text": part})
        at += length
    return out


model_name = sys.argv[1] if len(sys.argv) > 1 else "medium"
model = WhisperModel(model_name, device="cpu", compute_type="int8")

sys.stdout.reconfigure(encoding="utf-8")
print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        audio = load_wav(req["file"])
        chunks = speech_chunks(audio)
        out = []
        if chunks:
            segments, _info = model.transcribe(
                audio,
                language="ja",
                clip_timestamps=[t for chunk in chunks for t in chunk],
                vad_filter=False,
                beam_size=5,
                condition_on_previous_text=False,
            )
            # Whisper's own end times are loose inside a clip; the detected speech bounds are more exact.
            per_chunk = {}
            for seg in segments:
                text = seg.text.strip()
                if text:
                    index = min(range(len(chunks)), key=lambda i: abs(chunks[i][0] - seg.start))
                    per_chunk.setdefault(index, []).append((seg, text))
            for index, found in sorted(per_chunk.items()):
                start, end = chunks[index]
                if len(found) == 1:
                    out.extend(split_sentences(start, end, found[0][1]))
                else:
                    for seg, text in found:
                        out.extend(split_sentences(max(start, seg.start), min(end, seg.end), text))
        print(json.dumps({"id": req["id"], "segments": out}, ensure_ascii=False), flush=True)
    except Exception as exc:  # noqa: BLE001 - report every failure back to the server
        print(json.dumps({"id": req["id"], "error": str(exc)}), flush=True)
