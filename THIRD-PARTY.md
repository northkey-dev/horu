# Third-party software and data

Horu is GPL-3.0-or-later. It uses the following. Versions as of 1.0.0; the in-app list is under *Settings → About*.

## Data

| Name | Licence | Used for |
|---|---|---|
| [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified) | CC BY-SA 4.0, © Electronic Dictionary Research and Development Group ([licence](https://www.edrdg.org/edrdg/licence.html)) | Word lookups. Downloaded at first start, shipped in the app build. |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) via jmdict-simplified | CC BY-SA 4.0, © EDRDG | Kanji meanings and readings. |
| IPA dictionary (in kuromoji.js) | NAIST/ICOT permissive licence | Word splitting. |
| [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) | MIT | JLPT word lists (downloaded when needed). |
| [Pepper&Carrot](https://www.peppercarrot.com) by David Revoy | CC BY 4.0 | Demo manga in the README screenshots only. |

## JavaScript (production dependencies, with their dependencies)

| Package | Licence |
|---|---|
| react, react-dom 18.3 | MIT |
| kuromoji 0.1 (and doublearray, zlibjs) | Apache-2.0 / MIT |
| sql.js 1.14 | MIT |
| fflate 0.8 | MIT |
| jsqr 1.4 | Apache-2.0 |
| express 4.22 and its dependencies | MIT / ISC / BSD-3-Clause |
| ws 8.22, qrcode 1.5 | MIT |
| web-push 3.6 (and http_ece, jws, asn1.js, …) | MPL-2.0 / MIT / Apache-2.0 |

Build tools (not shipped): vite, esbuild, typescript, @vitejs/plugin-react (MIT / Apache-2.0).
`npm ls --omit=dev --all` lists the exact tree; every entry is MIT, ISC, BSD, Apache-2.0 or MPL-2.0.

## Python and programs (optional laptop modules, installed by `scripts/install.ps1`)

| Name | Licence | Module |
|---|---|---|
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) 1.2 and OpenAI Whisper models | MIT | whisper |
| [mokuro](https://github.com/kha-white/mokuro) 0.2.5 (manga-ocr, comic-text-detector) | GPL-3.0 | manga |
| [EasyOCR](https://github.com/JaidedAI/EasyOCR) 1.7 | Apache-2.0 | photo text |
| [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), Kokoro model, misaki | MIT / Apache-2.0 | tts |
| [edge-tts](https://github.com/rany2/edge-tts) 7.3 | LGPL-3.0 | tts (calls Microsoft's speech service) |
| [Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server) | MPL-2.0 | manga sources (downloaded at install, not part of this repository) |
| ffmpeg | LGPL/GPL (installed by winget, not shipped) | audio |

## Services you connect yourself

Jimaku, AniList, jpdb, WaniKani, Gemini, Anthropic, OpenAI, Anki with AnkiConnect, Tailscale, Claude Code, Ollama. Horu ships no credentials for any of them; their terms apply to your use.

## Ideas, no code

[Yomitan](https://github.com/yomidevs/yomitan) (dictionary format), [asbplayer](https://github.com/killergerbah/asbplayer), [mpvacious](https://github.com/Ajatt-Tools/mpvacious), [Sluka](https://www.sluka.app).
