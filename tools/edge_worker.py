"""Long-running speech worker for Horu: the neural Japanese voice of Microsoft Edge (edge-tts), for the Listen buttons.

Needs internet: the text is sent to Microsoft's speech service (server/src/tts.ts falls back to Kokoro without it).
Reads one JSON request per line from stdin:  {"id": "...", "text": "...", "file": "C:/.../x.mp3"}
Writes one JSON response per line to stdout: {"id": "...", "ok": true}
"""

import asyncio
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")

import edge_tts  # noqa: E402  (after stdout setup)

VOICE = "ja-JP-NanamiNeural"


async def speak(text, file):
    await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate="-10%").save(file), timeout=20)


print(json.dumps({"ready": True}), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    try:
        asyncio.run(speak(req["text"], req["file"]))
        print(json.dumps({"id": req["id"], "ok": True}), flush=True)
    except Exception as exc:  # noqa: BLE001 - report every failure back to the server
        print(json.dumps({"id": req["id"], "error": str(exc) or type(exc).__name__}), flush=True)
