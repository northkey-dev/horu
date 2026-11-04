"""Long-running speech worker for Horu: a computer voice for cards without sound (Kokoro-82M, runs locally).

Started with the model and voice files: tts_worker.py <model.onnx> <voices.bin>
Reads one JSON request per line from stdin:  {"id": "...", "text": "...", "file": "C:/.../x.wav"}
The text is already in kana (server/src/tts.ts works out the pronunciation).
Writes one JSON response per line to stdout: {"id": "...", "ok": true}
The model is loaded once and kept in memory while the server keeps this process alive.
"""

import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

import soundfile  # noqa: E402  (slow imports, after stdout setup)
from kokoro_onnx import Kokoro  # noqa: E402
from misaki import ja  # noqa: E402

VOICE = "jf_alpha"
kokoro = Kokoro(sys.argv[1], sys.argv[2])
g2p = ja.JAG2P()


def speak(text, file):
    phonemes = g2p(text)
    if isinstance(phonemes, tuple):
        phonemes = phonemes[0]
    samples, rate = kokoro.create(phonemes, voice=VOICE, speed=1.0, is_phonemes=True)
    soundfile.write(file, samples, rate)


print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        speak(req["text"], req["file"])
        print(json.dumps({"id": req["id"], "ok": True}), flush=True)
    except Exception as exc:  # noqa: BLE001 - report every failure back to the server
        print(json.dumps({"id": req["id"], "error": str(exc)}), flush=True)
