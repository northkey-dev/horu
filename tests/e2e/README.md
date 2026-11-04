# Horu end-to-end test

Simulates a full evening: phone (emulated iPhone) + laptop Chrome with the real extension,
real Whisper, Claude Code, Anki (deck "Horu E2E Test"), Suwayomi + OCR. 31 steps, ~5 min
(most of it is the first manga chapter's download + OCR).

## One-off setup

Copy this folder somewhere outside the repo (e.g. a scratch folder) and install puppeteer there;
`e2e.mjs` reads its media and writes screenshots relative to its own location.

```sh
cp -r tests/e2e <scratch>/e2e && cd <scratch>/e2e
npm init -y && npm i puppeteer-core@24
cd media
# Test video: 60 s test pattern with the three lines at 2 s / 6 s / 12 s.
# Must be longer than 30 s, the extension ignores shorter videos (previews, ads).
ffmpeg -y -f lavfi -i testsrc2=size=640x360:rate=25:duration=60 -i l0.mp3 -i l1.mp3 -i l2.mp3 \
  -filter_complex "[1]adelay=2000|2000[a];[2]adelay=6000|6000[b];[3]adelay=12000|12000[c];[a][b][c]amix=inputs=3:normalize=0,apad=whole_dur=60[out]" \
  -map 0:v -map "[out]" -c:v libx264 -pix_fmt yuv420p -c:a aac -t 60 ep.mp4
```

## Each run

1. Anki running, `npm run build` done, the normal Horu stopped (`tools\launcher\Horu.exe --stop`).
2. `tests\e2e\reset-e2e.ps1` (stops a test server, wipes `data-e2e` except dictionary + Suwayomi, deletes the test deck).
3. Test server: `HORU_DATA=data-e2e node server/src/main.ts`
4. In `<scratch>/e2e/media`: `python -m http.server 8098` and `python -m http.server 8099`
   (the anime site and its cross-origin player).
5. `node e2e.mjs` in `<scratch>/e2e`. Screenshots and `results.json` land in `e2e-shots/`.

Set `HORU_ROOT` to the repo folder before step 5.
