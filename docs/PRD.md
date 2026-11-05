# Horu (掘る) – PRD

> "Horu" = to dig. Dig sentences out of anime and manga without breaking the flow.

Updated: 2026-11-01 · Status: V1–V4 built for one user; V5 (local-first, public release) agreed, see §15.

---

## 1. Problem

Sentence mining from anime today means pausing: stop the scene, look up the word, build a card, keep watching. When watching together with someone, that kills the flow. Existing tools (Anki, Yomitan, asbplayer, mpvacious, Migaku …) are:

- desktop-centric and hardly usable on iOS,
- a lot of setup (5–7 tools),
- built around pausing,
- vocabulary-centric; nobody explains grammar and nuance,
- prone to over-mining and the review avalanche that follows.

## 2. Users

- **Original user:** an intermediate learner (around JLPT N4, learned from a textbook, weak kanji). Wants to understand anime by ear and read manga. Windows laptop, iPhone, Anki, no paid APIs.
- **Public (from V5):** Japanese learners with a similar setup (Windows + Chrome, iPhone or Android, usually Anki), who already use other tools and want Horu to fit in. See §15.

## 3. Goals / Non-goals

**Goals**
- Mark anime moments with a phone button, **without pausing**.
- After the episode, turn marked moments into good Anki sentence cards on the phone.
- Cards with audio, screenshot and an AI explanation at the learner's level.
- Read manga on the phone with tappable text, an offline dictionary and mining into the same inbox.
- (V5) Work on the phone alone; the laptop adds power when it is there.

**Non-goals**
- Native iOS app / App Store.
- Own SRS (Anki or another SRS stays the learning system).
- Paid APIs or paid hosting.
- Hosting or redistributing video, or shipping piracy sources.
- Accounts or a central server.

## 4. Glossary

| Term | Meaning |
|---|---|
| **Moment** | One button press while watching: timestamp + audio buffer + screenshot + candidate lines |
| **Candidate lines** | The 3–4 Japanese subtitle lines around the timestamp |
| **Inbox** | Unprocessed moments (anime) and manga passages; here you pick what becomes a card |
| **Target word** | The one word a card is about (bold) |
| **Laptop service** | Background program "Horu" on the laptop; the hub in V1–V4, an optional booster from V5 |
| **Session** | One episode: chosen anime + episode + loaded JP subtitles + running audio capture |
| **Active manga** | Manga with status "reading"; prepared in advance |
| **Adapter** | (V5) Exchangeable connection to an outside system: card target, AI provider, known-word source, playback source |

## 5. Architecture (V1–V4)

```
 iPhone (PWA "Horu")                    Laptop (Windows)
 ┌─────────────────────┐   Tailscale    ┌────────────────────────────────────┐
 │ Button (session)    │◄──── HTTPS ───►│ Laptop service "Horu" (Node, TS)   │
 │ Inbox               │                │  ├─ serves the PWA                 │
 │ Offline dictionary  │                │  ├─ inbox store (audio, images)    │
 │ Manga reader        │                │  ├─ Jimaku client (JP subs)        │
 │ Offline storage     │                │  ├─ Whisper (fallback, local)      │
 └─────────────────────┘                │  ├─ claude -p (explanations)       │
                                        │  ├─ AnkiConnect → Anki Desktop     │
                                        │  └─ Suwayomi + Mokuro              │
                                        │                                    │
                                        │ Chrome extension (MV3)             │
                                        │  ├─ finds <video> (all frames)     │
                                        │  ├─ tab audio ring buffer (~20 s)  │
                                        │  └─ screenshot                     │
                                        └────────────────────────────────────┘
                                              Anki Desktop ─► AnkiWeb ─► AnkiMobile
```

- **Reachability:** Tailscale (free) on phone and laptop, `tailscale serve` provides HTTPS. In V1–V4 this only works while the laptop is on (V5 changes that, §15).
- **Autostart:** Windows Run entry (HKCU `Run`) named "Horu", visible and switchable in **Task Manager → Startup apps**.
- **Stack:** TypeScript everywhere. Monorepo with `extension/` (Chrome MV3), `server/` (Node), `pwa/` (Vite + React), `shared/`. Whisper and Mokuro as external Python tools called by the service.

## 6. V1 – Anime

### 6.1 Flow

1. **Before the episode** (phone): search the anime, pick the episode. Next time the next episode is suggested. The service loads the JP subtitles from Jimaku.
2. **On the laptop:** click the extension icon once to allow audio capture (Chrome requires this per session). Then fullscreen and watch. The TV shows the site's English hard subs; the JP subtitles run invisibly.
3. **While watching:** one big "Mark" button on the phone. Dark UI, screen stays on (Wake Lock), undo for the last press.
4. **After the episode** (phone): work through the inbox (6.3).
5. **Create card:** the service calls Claude and adds the card via AnkiConnect. AnkiWeb syncs it to the phone.

### 6.2 What a moment stores

- Playback time (`video.currentTime`)
- Audio: the last ~20 s from the ring buffer
- Screenshot of the video (including English hard subs, back side only)
- Candidate lines: JP lines around the timestamp, ±1 line context
- Anime, episode, session

### 6.3 Inbox

- Play the moment's audio.
- **Tap the right line** (makes up for subtitle sync drift). Neighbouring lines optional as context.
- Tapping a word opens the offline dictionary popup.
- **Choose the target word** (Claude suggests one "probably unknown at Minna 2 level").
- Actions: **Create card** / **Discard**.
- No JP subtitles on Jimaku: Whisper transcribes the clip locally, the result becomes the candidate line.
- Audio clip trimmed to the chosen line (cue times ± padding), as MP3 for AnkiMobile.

### 6.4 Known words

V1 has no knowledge model; the user picks the target word, Claude suggests. Known words came in V3.

## 7. Anki card

- **Deck:** "Anime Mining" (manga in the same deck or a subdeck)
- **New cards per day:** 10
- **Own lean note type** (no third-party template like Lapis)

**Front**
- Sentence in kanji, target word **bold**
- Furigana **hidden**: tapping a word shows the reading (rule: if you needed the target word's reading, answer "Hard" or "Again")
- Audio

**Back**
- Sentence with furigana
- Target word: reading + meaning
- English translation
- AI explanation **in English**, 2–4 sentences: grammar, nuance, slang, role language, relation to the Minna level
- Screenshot
- Source: anime, episode, timestamp

**No extra kanji cards** (optional switch later).

**AI:** `claude -p` (Claude Code headless, Pro subscription) on the laptop. Called **only on "Create card"** to save quota.

## 8. V2 – Manga

- **Reading on the phone**, in the PWA reader.
- **Sources:** Suwayomi server on the laptop (uses the Mihon/Tachiyomi source extensions, including Japanese raw sources) **+ import of own `.cbz`/`.zip` files**.
- **Text recognition:** Mokuro / manga-ocr on the laptop makes speech bubbles tappable.
- **Prepare ahead:** for up to **5 active manga** the laptop fetches the **next 15 chapters** and runs OCR whenever it is on.
- **Offline:** the phone takes prepared chapters whenever the app is opened while the laptop is reachable (iOS allows no background downloads). Then read without laptop and internet.
- **Live mode:** a chapter that is not prepared yet can be opened right away (laptop must be on, slower).
- **Clean-up:** read chapters are deleted from the phone after 3 days.
- **While reading:** tapping a word opens the offline dictionary (works without laptop). "Mark" stores the passage (sentence + page crop) locally and syncs it into the shared inbox once the laptop is reachable.

## 9. Shared building blocks

- **Offline dictionary** in the PWA: JMdict + tokenizer (kuromoji.js). One component for inbox, manga reader and card preview.

## 10. V3 – Extras

1. **Preparation before the episode:** most frequent unknown words of the next episode
2. **Difficulty per anime/episode:** estimated comprehension in %
3. **Statistics:** marked moments, cards, progress per anime/manga
4. **Whisper automation:** every clip transcribed and matched to the Jimaku line automatically
5. **Back Tap shortcut** (iOS): screenshot of any Japanese text → OCR → popup + inbox
6. Knowledge model (known words from Anki / JLPT lists), required for 1 and 2
7. Optional kanji cards

## 11. V1 done criterion

The user watches a **real episode** without pausing and presses the button **5 times**. Afterwards they work through the inbox on the iPhone, and the cards appear in **AnkiMobile** (with audio, screenshot and explanation).

## 12. Technical risks

| Risk | Check / plan B |
|---|---|
| Video sits in a foreign iframe | Content script with `all_frames`; read `currentTime` inside the frame |
| Screenshot: canvas of a cross-origin video is tainted | `chrome.tabs.captureVisibleTab` (fullscreen = video frame) |
| `tabCapture` mutes the tab | Play the captured stream again via AudioContext (offscreen document) |
| Jimaku subs out of sync | Manual line choice in the inbox, Whisper matching |
| Jimaku API needs a (free) key | One-time setup |
| `claude -p` quota / login | One card = one short call; failure → card without explanation + retry |
| AnkiConnect needs Anki Desktop running | Service starts Anki minimised when needed |
| AnkiMobile audio format | Clips as MP3 (ffmpeg) |
| Wake Lock in iOS home-screen PWA | Fallback: hint "turn off Auto-Lock" |
| Whisper slow on CPU | Runs in the background; faster-whisper / kotoba-whisper (int8) |
| Mokuro on CPU | Prepared in the background, minutes per chapter batch |
| iOS storage limit for PWAs | Max. 5 active manga × 15 chapters, clean-up after 3 days |

## 13. Small decisions

- UI language: **English** (2026-10-22).
- The Claude explanation prompt is tuned iteratively.

## 14. V4 – Progress and everyday use (built 2026-10-23/24)

**Insights** (PWA, three tabs: Overview, Anki, Mining). Data from Horu (`analytics.ts`) and, when Anki is reachable, its review history.

- **XP:** 1 per Anki review, 3 per mark, 10 per card, 15 per manga chapter, 5 per **full 5 minutes of playback**. Leftovers carry over to the next episode (19 min = 3 blocks, 4 min left). Opening an episode gives nothing. Day starts at 4 am like Anki.
- **Watch time:** the extension reports every 5 s while a video plays in the foreground tab and sound was audible in the last 30 s. The laptop stores seconds per session and day (`Session.watch`).
- **Streak:** days with reviews, marks, cards, chapters or a watch block. A quiet day the last Anki fetch could not fully see does not break the streak (iPhone reviews arrive late via AnkiWeb). Anki syncs before every fetch.
- **Vocabulary:** the size of the known-words estimate is stored once a day (`vocab-history.json`) → growth curve (total and Anki only).
- Weekly overview, heatmap, achievements, Anki stats (retention, forecast, kanji behind many lapses), time per anime and episode.

**Reminders** (Web Push via Apple's/Google's free push service, VAPID keys in `data/push.json`): once a day at the chosen time if the daily goal is open (Anki is started and synced first); a second one if at least 3 moments have waited 2 days in the inbox. Only while the laptop is on. iOS: Horu must be on the home screen (iOS 16.4+).

**Preparation** ("Before you watch" / "Before you read", each switchable): comprehension and most frequent unknown words of an episode or chapter (also the next one). Filler words (あっ, うーん …) are filtered out; example sentences chosen by length and word form. "Card" adds an Anki card (example line, no audio, no Claude call); words with an existing Horu card are skipped; "Add all" adds all open ones. 5–30 words (default 12).

**Backup:** daily `data/backups/<date>` (last 7 days + one per week for 4 weeks), optional extra folder without secrets (no Jimaku key, token, push keys). Restore in Settings: backs up the current state, restores, restarts.

**Tests:** `npm test` (unit: XP carry-over, streak, level, filler words), `npm run smoke` (throwaway server with its own data folder `data-smoke`, checks the API), plus the big E2E test in `tests/e2e`.

**Measured** (11 episodes of Cowboy Bebop and One Piece, estimate of 3801 known words): without the filter 48 % of the 12 most frequent "unknown" words were filler; with the filter the kanji share of the list rose from 32 % to 66 %. Every word beyond 12 adds clearly less coverage.

## 15. V5 – Local-first and public release (agreed 2026-11-01)

Trigger: the app showed only a blank cream screen when the laptop was off, and the plan is to make the repo public. Ideas partly taken from Sluka (sluka.app: unknown-word highlighting on any page, word status 1–4, local data, phone syncs with the computer directly).

### 15.1 Audience and licence

- Japanese learners with Windows + Chrome and iPhone or Android, usually Anki. Japanese stays the core (JMdict, kuromoji, Jimaku); no multi-language rebuild.
- Every outside dependency becomes an **adapter**, so people keep the tools they already use.
- Licence **GPL-3.0**. README and docs in English.

### 15.2 Architecture: local-first

- The PWA is hosted **statically on GitHub Pages**, not served by the laptop. It always starts.
- The **phone holds its data** (IndexedDB, persistent storage requested). The laptop is an optional **booster**: audio and screenshot capture, Whisper, OCR, Suwayomi, `claude -p`, AnkiConnect, push.
- **Pairing** by QR code; connection **only via Tailscale** (an https page may not call `http://` LAN addresses). Cloudflare Tunnel only if someone asks.
- Phone and laptop **sync whenever both are reachable**. Open inbox moments are mirrored to the phone **including audio and screenshot**; after card/discard the phone deletes the media.

**Built 2026-11-01 (phase 2):** the app was first hosted on GitHub Pages (published by `npm run deploy`); since 0.7.0 everyone hosts their own copy, see below. The same build still runs from the laptop. Settings → Laptop: scan the QR code from tray → "Connect phone…" or type the Tailscale name. Every laptop read keeps its last answer in IndexedDB and shows it offline; discard/restore/known words wait in an outbox; while the status check says the laptop is away, calls fail at once. The laptop answers only the hosted app, the Vite dev server and the extension across origins. Chrome (Android, desktop) asks once for "local network access"; iOS Safari does not.

**Changed 2026-11-04:** no central hosted app. Everyone self-hosts: the laptop or Pi serves the app (default, pairing page opens it directly), or a fork publishes it with the *Publish app* workflow; `HORU_APP_URL` in `.env` lets a laptop accept such a copy.

### 15.3 Phone only (no laptop)

- **Mark** with timestamp, title and episode; the phone loads subtitles from **Jimaku directly** (CORS allowed, user's own key).
- **Microphone buffer** (switch, default off): while the Watch screen is open the phone keeps the last ~20 s of room audio in memory and saves it on a mark.
- Inbox, dictionary, saved manga chapters, insights and streak work offline.
- No screenshot, Whisper or OCR without the laptop.
- **Built 2026-11-01 (phase 3):** Watch offers "Laptop · Chrome" or "TV or other screen" (the latter is the only choice without a reachable laptop). A phone episode runs an **episode clock**: start it with the episode, or tap the time and type what the screen shows, nudge ±5 s until the faint current subtitle line matches what you hear. A mark stores clock time, the lines around it (`shared/subtitles.ts` `candidatesAt`, same as the laptop) and, with the microphone on, the last 20 s as 16 kHz WAV. Marks and sessions live on the phone (`pwa/src/lib/phone.ts`) and move to the laptop (`/api/sessions/import`, `/api/moments/import`, same id) as soon as it answers; Whisper then checks or fills the lines, and cards are made there. Watch time of the clock counts for XP. A connected laptop hands its Jimaku key to the phone; Settings → This phone shows it and the marks still waiting. Jimaku search, file list and download run from the phone (`shared/jimaku.ts`).
- **Reminders** only with the laptop; otherwise the README documents an iOS Shortcuts automation. An optional free Cloudflare Worker as push sender maybe later.

### 15.4 Adapters

| Kind | Adapters |
|---|---|
| Card target | AnkiConnect (Desktop or *AnkiConnect Android*), **.apkg built on the phone** (batch, with audio and image, shared to AnkiMobile; default without laptop), AnkiMobile URL `anki://x-callback-url/addnote` (single card, text only), CSV/JSON export; later jpdb.io, Mochi |
| AI | `claude -p` (laptop), **Gemini API key, free tier** (phone calls it directly; default without laptop), "copy prompt" into the Claude app and paste the answer back, own Anthropic/OpenAI key, Ollama (laptop), none |
| Known words | Anki via AnkiConnect, jpdb.io and WaniKani APIs, word list, JLPT level, AnkiMobile .apkg export (optional) |

**Built 2026-11-01 (phase 4):** Settings → *Cards on this phone* picks the target (`auto` = laptop when reachable, else collect on the phone; laptop; .apkg; AnkiConnect on this device; AnkiMobile one by one) and the explanation (automatic, Gemini/Anthropic/OpenAI key on the phone, copy prompt, none). The phone builds the card itself (`pwa/src/lib/cards.ts`): furigana with its own kuromoji (`shared/furigana.ts`), the clip cut from the mirrored audio as WAV, picture if wanted; same note type as the laptop (`shared/notetype.ts`). .apkg files are built with sql.js (`pwa/src/lib/apkg.ts`, legacy schema 11, guid `horu-<moment>` so re-imports update) and shared via the share sheet, or CSV/JSON. The phone learns the laptop's note type id, deck and learner profile so imports land in the same note type. Moments carded on the phone leave the inbox (`/api/moments/:id/done`; phone marks keep status `done` when they move to the laptop). Laptop side: Settings → *Cards on the laptop* chooses Claude Code, Gemini, Anthropic, OpenAI or Ollama (`shared/ai.ts`), plus the learner profile used in the prompt; a phone that already has an explanation sends it along. Checked with Anki's own importer (`anki` Python package): imports, second import is a duplicate, not a copy.

**Known words update automatically:** words from Horu cards count at once, jpdb/WaniKani are pulled by API, and whenever the laptop is reachable it reads Anki and passes the result to the phone. Full Anki state without the laptop is impossible on iOS (AnkiWeb has no public API, a web app cannot read AnkiMobile).

**Built 2026-11-01 (phase 5):** word status `shared/words.ts` (new, 1–3, known, ignore) replaces the known/unknown lists in `data/known.json` (migrated). The word sheet shows a status row; known and ignored count as understood. Sources: Anki (as before), WaniKani and jpdb.io (`shared/knownSources.ts`, key kept in settings and re-pulled every 12 h with the Anki refresh), pasted/uploaded word lists, JLPT baseline; a card made anywhere sets its word to known unless it has a status. The phone keeps the laptop's word state (`/api/insights/words`) plus its own sources and statuses (`pwa/src/lib/words.ts`); without any laptop it starts from the JLPT N5/N4 list and imports WaniKani/lists itself (jpdb only via the laptop if its API refuses browser calls). Yomitan dictionaries (`shared/yomitan.ts`: definitions as plain text, frequency, pitch accent; kanji banks skipped) import onto the laptop (`data/dicts`, `/api/dicts`) or, without it, into the phone; the word sheet shows frequency rank, pitch pattern and the extra definitions under JMdict. JMdict now ships with the app build (`dist/dict/jmdict.json.gz`) so a phone that never saw a laptop has a dictionary.

### 15.5 Integrations (priority order)

1. Known-word import (above)
2. **Yomitan dictionaries** (Jitendex, frequency lists, pitch accent)
3. **AniList / MyAnimeList**: tick off episodes and chapters
4. **Jellyfin / Plex / Kodi / mpv**: playback time and subtitles from a media server, so marking works without the browser extension
5. **Komga / Kavita** manga servers and **.mokuro** files
6. Card target jpdb.io
7. JSON export / webhooks
8. asbplayer / Language Reactor import

**Built 2026-11-01 (phase 7):** (1–2 in phase 5.) **AniList** (`shared/anilist.ts`): implicit login with the user's own client id (redirect back to the app, `#access_token=`) or a pasted token; laptop (`lists.ts`, every 2 min) and phone (episode clock) tick off an episode once 16 min played, never lowering progress, COMPLETED at the last episode. MAL directly would need an OAuth app with a secret; MAL-Sync covers it. **Media players** (`players.ts`, `/api/player/now`): Jellyfin (Sessions + API key), Plex (`/status/sessions` + token), Kodi (JSON-RPC), mpv (JSON IPC pipe, episode number guessed from the file name); the phone's episode clock gets a "Follow <player>" switch. **Komga/Kavita** (`manga/servers.ts`): search, volumes, import into the library (`manga/importer.ts`, shared with the upload); a `.mokuro` file in the archive supplies the text boxes so the chapter is ready without OCR. **jpdb.io card target** (`jpdb.ts`): with a deck id, each card's word is added to that deck with its sentence. **Webhook** on mark and card, **JSON export** of moments, sessions, words. **Sentence import** (`shared/importLines.ts`): Language Reactor / asbplayer / Migaku / any CSV, TSV or JSON with a sentence column → text moments in the inbox (laptop, or the phone alone). Checked against fake Jellyfin, Komga and mpv servers.

### 15.6 Sluka-style features

- Extension: **highlight unknown words on any web page**, hover dictionary, mine into the inbox; **subtitle overlay** for solo watching.
- **Word status 1–4 + ignore** (names, numbers) instead of only known/unknown; feeds previews and comprehension %.
- **Text reader** for articles / EPUB / NHK Easy with mining.
- Counter for **words read** and listening time beyond anime (YouTube, Spotify web).
- The extension keeps needing the laptop service; desktop-only users use the PWA in the desktop browser.

**Built 2026-11-01 (phase 6):** extension `words.ts` (content script in every frame): per-site switch via context menu or Alt+Shift+J (`chrome.storage.local.highlightSites`); text nodes with Japanese go through the service worker to `/api/text/analyse` (tokens with status), unknown words get an underline (new strong, 1–3 fainter), new content is picked up by a MutationObserver (budget 4000 text nodes per page). Hover → popup in a closed shadow root: JMdict + Yomitan extras, status buttons, "Add sentence to inbox" (`/api/text/mine` → moment kind `text`, `targetHint` preselects the word). Context menu "Japanese subtitles over the recorded video" draws the running episode's cues over the video (also in fullscreen), highlighted the same way. App: Read tab (was Manga) → Texts (`pwa/src/screens/Texts.tsx`, `lib/texts.ts`): paste, EPUB/TXT/HTML file, or a web page fetched by the laptop (`/api/text/fetch`, simple article extraction, furigana stripped); paragraphs tokenized when near the screen and underlined by status; tap → word sheet → "Add sentence to inbox" (phone mark, moves to the laptop like the others). Paragraphs read past count as words read (`/api/text/read`, `data/reading.json`), 5 XP per 250 words per day. Counting YouTube/Spotify listening time is left out (the extension only sees the recorded tab).

### 15.7 Manga

- Reading only covers what a Suwayomi extension supports (hundreds of sites, few Japanese raw sources, official ones like Jump+, ComicWalker, Pixiv). Pasting any URL or embedding a site like mangafire.to is not possible in a PWA (iframe bans, cross-origin images, scrambled pages).
- The keiyoushi store moved to a new index format (`index.pb`); Suwayomi 2.4 migrated the stored URL by itself and lists 139 Japanese extensions. The reason only a few showed up: the store marks almost every raw site 18+ (Rawkuma, MangaFire, Pixiv Comic, Piccoma …), and Horu hid those. Settings → Manga → "Show 18+ sources" (default off) lists them, tagged 18+.
- Public: **no built-in raw sources**. The user enters a repo URL; only official free sources are preset; README note.

### 15.8 Installer

- **Modular:** core (service + extension); optional Whisper, Suwayomi + Mokuro, `claude -p`, Ollama. Missing modules can be added later from Settings.

**Built 2026-11-01 (phase 8, prepared, repo still private):** `scripts/install.ps1 -Modules core,whisper,manga,claude,ollama [-Autostart]` (asks per module without `-Modules`; core always; Suwayomi downloaded from its GitHub release; autostart only on request; Start-menu shortcut); Settings → *Laptop modules* shows what is installed (`/api/modules`) and the command to add the rest. No built-in manga repository any more: Settings → Manga → *Extension repository* (`mangaExtensionRepo`, empty by default). README (English), LICENSE (GPL-3.0 text, packages `GPL-3.0-or-later`). History scan: no secret value (Jimaku key, access token, push keys) and no `data/` file in any commit; only placeholder Tailscale names. Before going public: commit author e-mail rewritten to the GitHub noreply address, PRD §2 made neutral (also in older revisions).

### 15.9 Order

1. Fix the blank screen without laptop; fix the Suwayomi store
2. Local-first + GitHub Pages + QR pairing
3. Phone-only capture (Jimaku from the phone, microphone buffer, offline inbox)
4. Card and AI adapters
5. Known words, Yomitan dictionaries, word status
6. Extension à la Sluka + text reader
7. Integrations
8. Public release: modular installer, README, licence, full secret scan of the git history, repo public

## 16. V5.1 – Gaps after the first full build (2026-11-01)

**Watching on the phone itself.** A browser inside the app is not possible for a web app: streaming sites forbid being framed, a page cannot read another site's video, and the iPhone's fullscreen player covers everything. Instead:
- *Coming back marks:* leaving Horu while the episode clock runs remembers the moment; coming back (the video continues as picture-in-picture) offers a mark at that moment, or marks at once ("Coming back to Horu → Marks right away"). Marks from the past use the clock that applied then (`clockLog`).
- *Picture-in-picture:* Horu shows the lines around the clock; tapping a line sets the clock to it (sync by ear).
- *Shortcut:* `POST /api/mark/remote` (Back Tap, Action button, Siri). The extension takes it while it records; otherwise the phone picks it up (`/api/mark/remote/take`) and places it on its clock.
- A native app or Safari extension with a real in-app browser stays open until people ask for it (needs a Mac build and Apple signing).

**Further gaps closed:**
1. *The page's own subtitles:* the extension reads Japanese text tracks, captions on screen (YouTube, Netflix, Prime Video, common players) and downloaded .vtt/.ass/.srt files of the recorded tab. A whole track replaces Jimaku's lines (it matches the video exactly); screen lines only fill a session without other subtitles. Without an episode started, the page title names a new session.
2. *YouTube, dramas, podcasts:* YouTube and dramas through 1. Recordings in the text reader: lines from a transcript (.srt/.vtt/.lrc) or Whisper on the laptop (background job); a mined line keeps its sound (decoded at 16 kHz on the phone).
3. *macOS/Linux:* `scripts/install.sh` (same modules), `scripts/horu.sh` instead of the tray launcher, launchd/systemd for autostart, Suwayomi as jar with the system's Java. ffmpeg is now installed (Windows) or checked.
4. *Without Tailscale:* the pairing page shows a code for the home Wi-Fi; the laptop serves the app itself, the home screen app's start address carries the access token (iOS keeps its cookies apart). No offline use, microphone or push there (no https).
5. *Photos of pages:* on the phone alone through the system's text recognition (Live Text / Google Lens → Copy → "Paste from clipboard" in the text reader); with the laptop, the reader can also send the photo to its text recognition (`/api/screen?inbox=0`).
6. *Games:* `/api/hook` listens to a text hooker's WebSocket (Textractor's WebSocket extension, LunaTranslator; Settings → Games) and takes lines by POST; Read → Texts → Game text shows them for mining.

Still open: built-in reviews for people without Anki, listening practice, several users on one laptop, a German interface.
