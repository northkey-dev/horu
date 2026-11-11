# Changelog

Release numbers follow `package.json`. The app, the laptop service and the Chrome extension share one number.

## 1.0.2 (2026-11-11)

README: trailer link.

## 1.0.1 (2026-11-11)

README: *Known limits* (Netflix on the iPhone, the phone clock, Back Tap needs a running episode, tested devices). Neutral example in the known-words search.

## 1.0.0 (2026-11-11)

First public release.

- **Phone backup:** Settings → Phone → *Backup of this phone* saves marks, sessions, texts, word status, kanji progress, waiting cards and preferences to one file (no keys, no laptop pairing) and restores it by merging.
- **Settings in six tabs** (Phone, Laptop, Cards, Words, Services, About) and a **welcome sheet** on the first start of a phone-only copy.
- **About:** version, licence and the licences of everything Horu is built on (JMdict and KANJIDIC2 notice). `THIRD-PARTY.md` lists them with versions.
- **Subtitles:** YouTube's automatic captions are no longer taken as lines (Whisper listens instead); when no subtitle line is close to what was said (Netflix's translated Japanese track), the heard line is added and preselected.
- Repository: README screenshots, troubleshooting table, full privacy table, issue templates, `SECURITY.md`, `CHANGELOG.md`.

## 0.22 (2026-11-06)

Kanji stamp collection with an in-app quiz (stamps come from the quiz only), chapter end screen with understanding curve, Study tab with Practice, Kanji and Progress.

## 0.16 – 0.21 (2026-11-05/06)

Connection hints, configurable AI fallback chain with an answer log, practice drills, system check ("Check everything"), share and search, tiered backups, cards that wait for an AI, batch cards.

## 0.12 – 0.15 (2026-11-05)

Inbox swipe view and *Edit*, adjusting the frame around a bubble, word sheet on top of the bubble sheet, the reader opens on the page you left, *Listen* with the laptop's neural voice fetched in advance.

## 0.9 – 0.11 (2026-11-04)

Recognise show and episode from any page, start the recording from the phone, security audit (own server names only, ids checked before they reach the disk, all keys masked), Vite 7 and tests on every push, furigana read off the manga page, known dictionary mistakes corrected, voice for cards without sound.

## 0.1 – 0.8 (2026-10/11)

Mark → inbox → Anki card; paper-and-ink design; Chrome extension with audio and subtitles; manga reader with text recognition; phone-only mode with its own episode clock, `.apkg` cards and offline dictionary; word status and Yomitan dictionaries; Raspberry Pi / Docker image; modular installer.
