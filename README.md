# Horu 掘る

Sentence mining for Japanese learners who don't want to pause.

You watch anime (on a laptop, a TV, anywhere), read manga, articles or books. Whenever a line catches you, you tap **Mark** on your phone and keep going. Later, Horu shows you the moment in an inbox: the subtitle lines around it, the audio, sometimes a screenshot. You pick the word, and Horu makes an Anki card with furigana, audio and a short explanation of what a textbook learner would miss.

Horu is a web app for your phone (it installs to the home screen). It runs on its own, and gets more capable when a Windows laptop runs the Horu service next to it.

> Status: personal project, used daily, now open for anyone who finds it useful. Japanese only (JMdict, kuromoji, Jimaku).

**Contents:** [What it does](#what-it-does) · [Two ways to use it](#two-ways-to-use-it) · [Furigana on the cards](#furigana-on-the-cards) · [Manga](#manga) · [Camera](#camera) · [Raspberry Pi / Docker](#raspberry-pi--docker) · [Updating](#updating) · [Settings reference](#settings-reference) · [Privacy](#privacy) · [Your own copy](#your-own-copy-of-the-app)

## What it does

**Watching**
- *TV or other screen*: start an episode on the phone, its clock runs with the episode (or follows Jellyfin, Plex, Kodi or mpv). Subtitles come from [Jimaku](https://jimaku.cc). A mark keeps the lines around that moment and, if you switch it on, the last 20 seconds of room audio from the microphone.
- *On the phone itself* (Safari or a streaming app, fullscreen): when a line catches you, swipe to Horu; the video keeps playing small and Horu marks the moment you left. Or keep Horu open with the video in picture-in-picture, or mark with a double tap on the back of the phone (iOS Shortcut, needs the laptop).
- *Laptop + Chrome*: the extension records the tab's audio, so a mark keeps the exact audio and a screenshot. It takes the Japanese subtitles the site itself shows or loads (YouTube, Netflix, Crunchyroll, most web players), so dramas and YouTube work without Jimaku. Whisper fills in lines when there are no subtitles, and picks the line you actually heard.
- *Laptop + Chrome, without touching the laptop:* **Watch → Start recording in Chrome** (or a Shortcut “Horu record”, see Settings → Laptop → *Mark without opening Horu*) makes the laptop press the extension's shortcut in the front Chrome window (Windows only; the video's tab must be the open one). Horu then reads the page, on any site: tab title, headings, the player's own title and the address words (never the site or the query) name show and episode, the laptop finds the show on Jimaku and loads its subtitles. The next episode is recognised by itself. A page without an episode number (a film, an overview page) is left alone, so choose those by hand. An episode you chose by hand is never replaced; a doubtful match gets a note with *Not right? Choose it yourself*.
- Optional subtitle overlay over the video, with unknown words underlined.
- Out of sync? Tap the subtitle line the moment you hear it.

**Reading**
- Manga through Suwayomi sources you choose, uploaded `.cbz` files, or your Komga/Kavita server. Text recognition with mokuro (or `.mokuro` files you already have). Tap a speech bubble, then a word for the dictionary, or translate the whole bubble. Chapters can be saved on the phone. See [Manga](#manga).
- Text reader for articles, EPUB books and pasted text. Unknown words are underlined; tap one for the dictionary.
- Podcasts and audio books: the recording plays under its lines (from a transcript file, or written by Whisper on the laptop); a mined line keeps its sound.
- **Camera:** photograph a sign, a menu, a packet or a pullover. The laptop reads the text, you tap a line on the picture for the dictionary, a translation or a card. Without the laptop, copy the text with the phone's own text recognition (Live Text, Google Lens) and paste it. See [Camera](#camera).
- Photos of book pages become text for the text reader: the laptop reads the photo, or you paste the text.
- Games and visual novels: lines from Textractor or LunaTranslator appear in the app as you play.
- On any web page: the Chrome extension underlines words you don't know yet, shows the dictionary on hover and sends the sentence to your inbox.

**Cards**
- Cards without sound (manga, text, photos) get a computer voice reading the sentence, made on your own computer at no cost (module `tts`, Settings → *Voice on cards without sound*). It can misread a word: the furigana on the card count.
- Anki through AnkiConnect (desktop, or AnkiConnect Android), or an `.apkg` file built right on the phone (with audio and picture) for AnkiMobile/AnkiDroid, or AnkiMobile's add-note link, or CSV/JSON. Optionally also jpdb.io.
- Explanations from Claude Code (your subscription), Gemini (free API key), Anthropic or OpenAI keys, Ollama on the laptop, or any chat app via "copy prompt / paste answer". Or none.

**Knowing what you know**
- Word status 1–4, known, ignore. Known words come from your Anki reviews, WaniKani, jpdb.io, word lists and the JLPT N5/N4 baseline.
- Before an episode or chapter: how much of it you'll understand and the key new words.
- Yomitan dictionaries (Jitendex, frequency lists, pitch accent) next to JMdict.
- Progress page with XP, streaks, Anki retention, watch and reading time. AniList episodes ticked off automatically.

## Two ways to use it

### Phone only

There is no central Horu site: everyone runs their own copy. Without a laptop you host the app yourself on GitHub Pages, which is free and takes a few minutes (see [Your own copy of the app](#your-own-copy-of-the-app)).

1. Open your address (`https://<your-name>.github.io/horu/`) in Safari (iPhone) or Chrome (Android) → *Add to Home Screen*.
2. Settings → *This phone*: paste a free Jimaku API key (jimaku.cc → account).
3. Settings → *Cards on this phone*: pick where cards go (an `.apkg` you open in AnkiMobile/AnkiDroid is the default) and who writes explanations (a free Gemini key, or copy prompt).
4. Watch → *TV or other screen* → search the anime → *Start episode* → start the clock with the episode.

Everything stays on the phone (IndexedDB). Without a laptop there is no screenshot, Whisper, manga text recognition or reminder.

### With a laptop (Windows, macOS, Linux)

Requirements: [Node.js 22+](https://nodejs.org), [ffmpeg](https://ffmpeg.org), Chrome; [Tailscale](https://tailscale.com) on laptop and phone (or the home Wi-Fi, see below); for the optional parts Python 3.11/3.12 and Anki with [AnkiConnect](https://ankiweb.net/shared/info/2055492159).

Windows (installs ffmpeg with winget, adds a tray launcher):

```powershell
git clone https://github.com/northkey-dev/horu.git
cd horu
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

macOS / Linux (start and stop with `scripts/horu.sh start|stop|status`, `--autostart` uses launchd/systemd):

```bash
git clone https://github.com/northkey-dev/horu.git
cd horu
bash scripts/install.sh
```

The installer asks which modules you want:

| Module | Adds | Needs |
|---|---|---|
| core | the service, Chrome extension, tray launcher | Node.js |
| whisper | transcription for marks without subtitles | Python, ~1.5 GB model on first use |
| manga | Suwayomi (manga sources), mokuro (text recognition) and EasyOCR's text detector for photos | Python; mokuro brings PyTorch (1–2 GB); Java 21 on macOS/Linux; ~80 MB more for the photo detector |
| tts | a computer voice for cards without sound (manga, text, photos) | Python, ~120 MB |
| claude | card explanations with Claude Code | a Claude subscription |
| ollama | card explanations with a local model | a decent CPU/GPU |

Add modules later with `scripts\install.ps1 -Modules whisper,manga` (`bash scripts/install.sh --modules whisper,manga`). Pass `-Autostart` (`--autostart`) to start Horu when you log in.

Then:
1. Chrome → `chrome://extensions` → Developer mode → *Load unpacked* → `extension/dist`.
2. Once in a terminal: `tailscale serve --bg 7317`.
3. Tray icon → *Connect phone…* (macOS/Linux: open http://localhost:7317/pair) → scan the code with the phone's camera, open it in Safari (Chrome on Android) and add the page to the home screen. Your laptop serves the app itself, so you need no website.

**No Tailscale?** The pairing page also shows a code for the home Wi-Fi: the phone opens the app straight from the laptop. That works only at home, and without offline use, microphone and reminders (browsers allow those only on https).

Phone and laptop sync whenever both are reachable; marks made on the phone alone move to the laptop later.

**Laptop switched off?** The app on your home screen keeps working from what the phone stored and shows *Laptop not reachable*. It starts after about 3 seconds. You can still mark moments, read texts and saved manga chapters, look up words and make `.apkg` cards. Screenshots and audio from the laptop, Whisper, manga sources, text recognition and reminders wait until it is back. Only two things need the laptop on: adding the app to the home screen and opening it once or twice afterwards, so it can store everything (about 40 MB), and getting a new version.

## The inbox

Every mark and mined line waits here. Each row shows the line, the word Horu suggests to learn and where it is from. **has a card** means you already have a card for that word; the full view says so too. Horu checks your *Horu Sentence* cards in Anki and what you made in the last days, so words from other note types are not counted.

- **List:** tap a row for the full view: choose the line, the word and the audio clip, then *Create card*.
- **Swipe:** one moment at a time, with line and word already chosen. Swipe right for the card, left to discard. Tap a word to choose another one, *Open* for the full view. The view you used last stays. If your AI route is *Copy prompt*, or cards go to AnkiMobile, a swipe to the right opens the full view, because those need a tap there.
- **Edit** (in the list): tick marks you made by accident and discard them together. Discarded moments stay in *History* for a few days. A mark only this phone knows (the laptop was away) is gone right away.

## Furigana on the cards

The front of a card shows the sentence without furigana, so the answer is not given away. **Tap a word to see its reading**, only that word; tap again to hide it. Words you do not know yet stay a puzzle, and you can reveal them one by one when you cannot place them. On the back, all readings are shown next to the translation and explanation.

This is part of the *Horu Sentence* note type. Horu keeps the note type up to date in Anki (whenever it makes a card, once per start), so older cards get it too. Cards built on the phone as `.apkg` carry the same note type. Nothing to set up in Anki desktop or AnkiDroid.

**AnkiMobile (iPhone/iPad)** turns a tap anywhere on the card into "Show Answer", so one setting is needed:

1. AnkiMobile (version 2.0.39 or newer) → gear icon → *Preferences* → *Review* → *Taps*.
2. Under **When Question is Shown**, set the **top and middle rows** of the 3×3 grid to **Off**. That is where the sentence is.
3. Leave the **bottom row** on *Show Answer* (or use the *Show Answer* button). *When Answer is Shown* stays as it is.
4. Sync Anki on the laptop and then in AnkiMobile, so the phone has the current note type.

If tapping a word still shows the answer, the zone over the sentence is not off yet, or the phone has not synced.

## Manga

Manga needs the laptop (it downloads the pages and reads the text) and the **manga** module of the installer. Once a chapter is prepared you can read it on the phone, and with *Save on phone* even without the laptop.

### How it works

1. You pick a manga from a **source** (a website, through Suwayomi), from your **own files** (`.cbz`/`.zip`) or from your **Komga/Kavita** server.
2. The laptop downloads the pages of the chapter you read and reads the text on them (mokuro text recognition), one chapter at a time in the background.
3. On the phone you read like in any manga app. Tap a speech bubble: you get its text with a dictionary for every word, a translation of the whole bubble, and *Mine this line*, which sends the sentence to your inbox (then pick the word and make the card as usual).

Everything lives under **Read** in the bottom bar. The *Texts* button there is the text reader for articles and books.

### 1. Add a source (once)

Horu ships **no** manga sources and no source repository. Which sites you read, and whether that is allowed where you live, is your responsibility. Official free services (for example Shōnen Jump+, Comic Days, Magazine Pocket) work well, and your own files and Komga/Kavita always work.

Sources are small community extensions for [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server), the same kind Mihon uses. They come from an **extension repository**, a web address that you add yourself:

1. Find the index address of an extension repository (the Suwayomi and Mihon communities publish them; Horu does not recommend one).
2. On the phone: **Settings → Manga → Extension repository**, paste the address.
3. **Read → + (top right) → Manage sources** (at the bottom of the page). Type a name in *Filter sources* and tap **Install** next to the sources you want. Installed ones are listed first; **Remove** uninstalls.
4. Go back: the installed sources now appear in the *Source* menu.

Good to know:
- The first time you open this page the laptop starts Suwayomi, which takes about 30 seconds.
- Only Japanese sources are shown (and those that cover all languages).
- **Most Japanese raw sites are marked 18+ in the extension store** (Rawkuma, Pixiv Comic, Piccoma …), so they are **hidden until you switch on Settings → Manga → Show 18+ sources**. If you cannot find a source you expect, this is almost always why. Turn it on, then open *Manage sources* again. The switch only unhides the list; it does not change what the sources contain.
- The list stays empty until a repository is set.

### 2. Find a manga and start reading

1. **Read → +**. Choose the *Source*, type a title (Japanese works best, e.g. バガボンド) and tap *Search*. An empty search shows what is popular.
2. Tap a manga, then **Start reading**. It joins your library under *Reading*, and the laptop starts preparing the chapters.
3. In the chapter list, tap a chapter marked **Prepare** to get it right away, or tap a ready chapter to read.

**Check the language.** Some sources list a Chinese edition as Japanese (Japanese text has roughly three kana for every kanji; Chinese has none). Once a chapter has been read by text recognition, Horu notices and shows a red notice in the reader and on the manga page, and stops preparing further chapters of it. Remove it and try another source, or search with the Japanese title.

### 3. Own files and servers

- **Files:** Read → *Import a .cbz or .zip file* (at the bottom). Folders inside the archive become chapters; a flat archive is one chapter. If the archive contains the `.mokuro` file of the volume, its text is used and nothing has to be recognised.
- **Komga / Kavita:** Settings → *Manga server*: choose the server, enter its address (for example `http://192.168.1.20:25600`) and an API key (Komga: Account → API keys; Kavita: User settings → 3rd party clients). Then **Read → [server name]**, search a series, open it and **Import** the volumes you want. They are copied into Horu's library like an uploaded file.

### Reading

- **Turn pages:** tap the **left** third of the screen (or swipe right) for the next page, the **right** third (swipe left) for the previous one: Japanese reading order. Tap the middle to show or hide the bars. The end of a chapter opens the next prepared one.
- **Zoom:** pinch to zoom in (up to 4×), drag to move the page, **double-tap the middle** to zoom in and out. The speech bubbles zoom with the page. On a double-page spread held upright Horu points this out once; turning the phone sideways also works.
- **Tap a speech bubble** to open it. Then:
  - words you do not know yet are **underlined** (strongly for new, faintly for words you are learning), like in the text reader;
  - **Listen** reads the whole bubble aloud with the voice of the phone (Japanese voice from iOS/Chrome, no laptop or internet needed; for a better one install an enhanced Japanese voice under iOS Settings → Accessibility → Spoken Content → Voices). Press again to stop;
  - tap a word for the dictionary (JMdict and your Yomitan dictionaries, frequency, pitch accent) and set how well you know it. Under the entry the word's **kanji** are listed one by one with meaning and readings. If a word is not in the dictionary (a name, a rare word or an OCR error), the kanji list is what you get. **Mine with this word** in that dictionary entry sends the line to your inbox with the word already chosen, so you only confirm the card. The speaker button reads the word aloud (by its kana reading). The word sheet is a second sheet on top of the bubble: pull it down and you are back in the bubble sheet (Translate, Mine); tap outside it and you are back on the manga page;
  - **Furigana** next to a line is left out of the text, and read on its own: the reading the page prints is what the furigana in the app, the card and the voice use (vertical text only, and only if it really is a reading of that kanji). In rare cases it still slips into the text when it touches it; then use *Fix the text*.
  - **Fix the text** lets you correct what the text recognition got wrong (it is not perfect, especially with unusual fonts). The correction is kept for that bubble, and is what Translate and Mine use. *Back to the recognised text* undoes it;
  - **Adjust the frame** is for a bubble whose text was cut off, or that took in too much (the orange frame shows what was read). Drag the corners and edges, or the frame itself, so it holds all of the text, then press **Read again**: the laptop reads what is inside the frame, in a few seconds (up to half a minute when its text recognition has to start first). You can zoom while you adjust. The new frame and text replace the old ones on the laptop and on the phone and survive *Read text again*; a correction made with *Fix the text* for that bubble is dropped. This needs the laptop;
  - **Show furigana** adds readings above the words (a faint reading is a guess from the kanji dictionary);
  - **Translate** translates the whole bubble into English, with the previous bubbles as context, a note on what a learner would miss, and every word with its reading and meaning (*Word by word* under Settings → This phone). The translation starts in the background when you open the bubble, so the answer is often there when you press (*Translate ahead* under Settings → This phone; it costs one AI request per bubble you open, switch it off if your AI is paid per use). It uses the AI from Settings (the laptop's, or your key on the phone); without one, the prompt is copied so you can paste it into any chat app;
  - **Mine this line** puts the sentence into your inbox.
- Pages are loaded in the background: the whole chapter starts loading when you open it, so turning pages does not wait. On a slow connection the old page stays until the next one is ready (a small spinner shows). **Save on phone** (below) removes the waiting completely.
- *Before you read* (on the manga page) shows how much of the chapter you will probably understand and its key new words. It can be switched off in Settings.
- **Tint bubbles by new words** (off by default, Settings → Manga reader): bubbles with words you do not know yet get a colour, the stronger the more new words. It helps you find the bubbles worth your time. Takes effect when you open a chapter.
- **Continue:** the Read page starts with a *Continue* button that opens the manga you read last, at the page where you stopped.
- **Your place is remembered:** every chapter opens on the page you left it on, even if you closed the app in the middle, with or without the laptop (the phone keeps the place of your last 300 chapters). A chapter left on its last page counts as finished and starts again from page 1.

### Managing chapters

Open a manga from the library to see its chapters. States: *Queued*, *Loading* (pages), *Reading* (text recognition), *Ready*, *Paused*, *Error*, *Not downloaded*, *On phone*.

| You want to | Do this |
|---|---|
| Stop a download for now | **Pause** on the chapter. The pages already loaded are kept; **Resume** carries on. |
| Stop and throw it away | **Cancel**. The pages are deleted and the chapter is not downloaded again by itself. **Download** gets it back. For imported files, cancel removes the chapter completely. |
| Pause or resume everything | **Pause all** / **Resume all** (shown when more than one chapter is busy) |
| Delete a finished chapter | **Edit** (next to *Chapters*), then **Delete**. It is removed from the laptop and the phone. |
| Read it without waiting, or without the laptop | **Save on phone** next to a ready chapter. Its pages are stored on the phone and open instantly. |
| Free the phone's space | **Edit**, then **Off phone** (the chapter stays on the laptop) |
| Save everything you read onto the phone | **Read → Sync** (the *On this phone* box). **Stop** ends it; what was saved stays. |
| Run the text recognition again (for chapters from an older Horu) | **Edit**, then **Read text again** on a chapter, or **Read the text of all chapters again**. About eight seconds per page; the pages are counted under the chapter, it stays readable, and a phone fetches the new text with its next sync. |
| Stop preparing new chapters of a manga | **Mark as paused** (and *Mark as reading* to continue) |
| Remove a manga | **Remove** at the bottom of its page |
| Mark a chapter read (or unread) | **Edit**, then **Mark read** / **Mark unread**. Read chapters are cleaned up after the days set in Settings. |
| See what the chapters take up | The **Storage** box on the Read page: the laptop's share and the phone's whole storage for Horu. |
| Delete everything you have read | **Free … MB** in the Storage box. It deletes all read chapters on the laptop and this phone (chapters you saved by hand and have read too). |
| Find a chapter in a long list (100+) | On the manga's *All chapters* page: **Find a chapter** (type a number), **My place** and **Latest** jump to where you are or to the newest chapter. |

About saving on the phone:
- It works from the hosted app and over Tailscale (https). Over plain home Wi-Fi without https the phone has no storage for it and the button is not shown.
- The laptop has to be reachable while saving. Afterwards it is not needed to read.
- A chapter you save by hand stays until you take it off the phone with **Off phone**. Chapters saved by *Sync* are cleared a few days after you finished them, or when they are no longer being prepared.
- A colour chapter is roughly 10 to 40 MB. iOS may clear a web app's storage when the phone runs short on space; then save it again.

### Settings → Manga

| Setting | Meaning |
|---|---|
| Chapters prepared at once | How many chapters, counted from the one you are on, the laptop keeps ready (default 15, at least 1). With **1** it does one chapter at a time: the next one starts when you finish this one, or when you tap it. Lowering it removes chapters that are only waiting. |
| Manga read in parallel | How many manga can be set to *Reading* at once (default 5) |
| Remove read chapters after (days) | Finished chapters are deleted from the laptop after this many days (default 3) |
| Show 18+ sources | Unhides sources the extension store marks as 18+ (see above) |
| Extension repository | The address of the repository the sources are installed from |
| Suwayomi server | Address of Suwayomi, started automatically from `tools/suwayomi` |

### Settings → Manga reader (on the phone)

| Setting | Meaning |
|---|---|
| Tint speech bubbles by new words | Off by default. Colours bubbles by how many new words they hold (see Reading). |

### When something goes wrong

| What you see | Reason and fix |
|---|---|
| *Manage sources* is empty | No repository set (Settings → Manga → Extension repository), or the source you look for is marked 18+ (switch on *Show 18+ sources*). |
| Red notice "This chapter is in Chinese" | The source's edition is Chinese. Remove the manga and try another source. |
| Pages show, but no bubble can be tapped | The text recognition (mokuro) is not installed on the laptop. Add the manga module with `scripts\install.ps1 -Modules manga` (`bash scripts/install.sh --modules manga`), then **Cancel** and **Download** the chapter again. |
| A chapter says *Error* | The message under the name says what failed in plain words, for example "The source refused the download (blocked by the site, rate limit or Cloudflare)". Horu tries again by itself every half hour and whenever you turn a page; **Resume** tries right away. |
| "This chapter was deleted…" | You deleted or cancelled it. Use **Download** in the chapter list. |
| Nothing works away from home | The laptop is off or not reachable. Chapters saved on the phone still open. |
| A word has no dictionary entry | Look at the kanji list under it; for text that is not Japanese at all it says so. |

## Camera

Read → **Camera** (also under *Texts*) turns a photo of Japanese text into something you can mine, with the same sheet as a manga speech bubble.

1. **Take a photo** opens the phone's camera; **From your photos** picks an existing one. Hold the phone straight on, close enough that the text is large, in good light.
2. With the laptop on, it reads the text: first a detector made for photos ([EasyOCR](https://github.com/JaidedAI/EasyOCR)'s CRAFT) finds the lines, then the same reader as for manga ([manga-ocr](https://github.com/kha-white/manga-ocr)) reads each one. That takes a few seconds, and the very first photo also downloads the detector (about 80 MB, once). The lines it found are outlined on the photo and listed under it. **Only Japanese is kept**: German, English and other Latin text on the photo is left out. If no outline is found at all, the whole photo is read as one line as a guess (it works for one big character) and a note says so.
   **Select text yourself** is the reliable way when the automatic reading misses or garbles something: drag a frame over one line of text and only that frame is read. It is made for handwriting, a single character, a stylised font or small print, because it does not need to find the text first. Frame one line as tightly as you can; text running downwards is detected and turned automatically.
3. Tap an outlined line, or a row in the list. The sheet opens:
   - tap a word for the dictionary, its kanji, and its status; **Mine with this word** sends the line to your inbox with that word already chosen;
   - **Translate** translates the whole line (with the AI from Settings, or *copy prompt* for a chat app) with a note on what a learner would miss;
   - **Fix the text** corrects what the recognition got wrong.
4. **Mine this line** puts it in the inbox. With the laptop, the card gets a cut-out of your photo around the line as its picture.

**Without the laptop** Horu cannot read the picture itself (iPhone Safari has no text recognition for web apps). Use the phone's own: on iPhone open the photo (or the Camera app), touch and hold the text → *Copy* (Live Text); on Android use Google Lens → *Copy text*. Then tap **Paste from clipboard** (or type or paste into the box) on the Camera page; each row becomes a line you can tap, translate (with your own AI key, or *copy prompt*) and mine. A line mined this way is kept as text only, without the photo.

Good to know:
- The automatic reading is good on printed horizontal text (signs, menus, packets) but not perfect: a long line can be cut in two where it wraps, a character can be misread, and one big single character is not found as a line (Horu then reads the whole photo as one line). When that happens use **Select text yourself** (frame the line) and **Fix the text**. Decorated fonts, text on fabric, curved or slanted lines and very small print are the hardest.
- If EasyOCR is not installed (an older installation), photos are read with the manga detector, which finds text on photos much less well. Re-run the installer's manga module (`scripts\install.ps1 -Modules manga`) to add it.
- **Handwriting:** photograph it large on plain paper, straight on, and frame it with *Select text yourself*. If it is still not read, write the character with your keyboard's handwriting input (Android: Gboard → Japanese handwriting; iPhone: add the *Chinese (Traditional) – Handwriting* keyboard, it draws kanji) and type it into the box on the Camera page.
- A frame is read as **one line**. For several lines frame them one after another.
- Many prints on clothes are not real sentences (kanji chosen for the look). The kanji list under a word still tells you what each character means.
- Photos are shrunk on the phone before they are sent (longest side 1600 pixels). They are not kept on the laptop except as the cut-out on a mined card.

## Raspberry Pi / Docker

Horu can run as containers on a Raspberry Pi (or any 64-bit Linux computer, or a PC with Docker) instead of on your laptop, so it is always on and the laptop can stay off. The phone app and the Chrome extension work as before; a few things differ (see the table). Start with [Step by step](#step-by-step-from-an-empty-pi-to-horu): it takes you from an empty Pi to a running Horu.

### What you need

| | Recommended | Notes |
|---|---|---|
| Computer | **Raspberry Pi 5, 8 GB**, 64-bit Raspberry Pi OS (or Ubuntu Server), active cooling, the official 27 W power supply | A Pi 4 (8 GB) works but is about half as fast. With 4 GB leave the manga text recognition out. A 32-bit system does not work. |
| Storage | **SSD** (NVMe on a HAT, or USB 3), 128 GB or more | Manga chapters take 10 to 40 MB each, and constant writing wears out SD cards. |
| Network | Home network with internet | [Tailscale](https://tailscale.com) on the Pi's containers and on your phone and computer (free). |

Rough memory use: Horu 0.3 GB, Suwayomi 0.5 to 1 GB, manga and photo text recognition 1.5 to 2 GB while it works (it stops after a few idle minutes). In a test container on a PC, Horu with the manga module, Suwayomi started and the text recognition loaded used about 2.8 GB in total (the Pi itself was not measured). Home Assistant and other containers add 0.5 to 1 GB each, so 8 GB leaves room for several. A manga chapter takes minutes to prepare in the background (a Pi is several times slower than a laptop here), a photo 20 to 60 seconds. The image is about 2 GB with the manga module (1 GB without). **Whisper is slow on a Pi**; the default there is the `small` model, switched off for marks (Settings → Listening).

### Step by step: from an empty Pi to Horu

About an hour the first time (most of it waiting). You need: the Pi with its power supply and the SSD, a computer to set it up from, your phone, and a network cable or the Wi-Fi password. At the end you have Horu running 24/7 on the Pi, your phone and Chrome connected to it, and the laptop free.

**1. Put the system on the Pi**

1. On your computer install **Raspberry Pi Imager** (raspberrypi.com/software).
2. Plug the SSD into your computer (or an SD card for the first start, see the note).
3. In the Imager choose your Pi model, as system **Raspberry Pi OS Lite (64-bit)** (under *Raspberry Pi OS (other)*), and as storage the SSD.
4. In the customisation step set: a **hostname** (e.g. `horu-pi`), a **user name and password**, the **Wi-Fi** if you do not use a cable, your **time zone**, and switch on **SSH** (password login is fine). Write the image.
5. Put the SSD into the Pi, connect the cable, plug in the power. After a minute or two it is on your network.

*Note:* a Pi 5 boots from an SSD by itself with current firmware. If it does not, start it once from an SD card with the same image and run `sudo raspi-config` → *Advanced Options* → *Boot Order* → *NVMe/USB Boot*.

**2. Log in to the Pi from your computer**

Open a terminal (Windows: PowerShell; Mac: Terminal) and run, with your user name and hostname from step 1:

```bash
ssh your-user@horu-pi.local
```

Answer *yes* to the question about the fingerprint and type your password. If `horu-pi.local` is not found, look up the Pi's address in your router's device list and use that instead. Then update the system and install git:

```bash
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git
```

**3. Set up Tailscale (free), once**

Tailscale connects your devices privately and gives Horu an https address, so nothing is opened to the internet.

1. Create an account at tailscale.com and install the **Tailscale app on your phone** and on **your computer**, signed in with the same account.
2. In the admin console (login.tailscale.com/admin) open **DNS**: switch on **MagicDNS** and, further down, **HTTPS Certificates**.
3. Open **Settings → Keys** and **Generate auth key**. Reusable is fine. Copy the key (it starts with `tskey-`). You will paste it in the next step.

(No Tailscale? You can leave the key empty in the next step. Then Horu works on the home network only, over http, without microphone, offline mode and reminders on the phone. Tailscale is strongly recommended.)

**4. Install Horu on the Pi**

Still in the SSH session:

```bash
git clone https://github.com/northkey-dev/horu.git
cd horu
bash scripts/pi-install.sh
```

While the repository is private, `git clone` asks for your GitHub user name and, as the password, a **personal access token** (GitHub → Settings → Developer settings → Personal access tokens, with read access to the repository).

The script then asks:

- **Tailscale auth key:** paste the key from step 3 (or Enter for home-network-only).
- **Whisper?** Answer `n`: it is slow on a Pi and you can add it later.

It installs Docker if needed, gets or builds the image and starts everything. If it has to build the image on the Pi this takes **20 to 40 minutes** (once). It ends with the address, for example `https://horu.your-tailnet.ts.net`. If it says you need to log out and in again for Docker, do that when it is finished.

**5. Check that it runs**

On your computer (with Tailscale on) open the address from step 4 followed by `/pair`, e.g. `https://horu.your-tailnet.ts.net/pair`. You should see a page with a QR code. If you see a warning that the Tailscale container has not signed in, see *If something is wrong* below.

**6. Connect the phone**

1. On the phone, switch Tailscale on and scan the code from the page in step 5 with the camera.
2. Open the link in Safari (iPhone) or Chrome (Android) and add it to the home screen (iPhone: Share → *Add to Home Screen*). The Pi serves the app itself, so you need no website.
3. Open Horu from the home screen. At the top of Settings you now see `App v…` and `Laptop v…`: the second line is the Pi. Under *Status* *Laptop* is green.

**7. Connect Chrome on your computer**

1. On the pairing page of step 5 tap **download the extension**. Unzip the file somewhere you will keep it (e.g. `Documents/horu-extension`).
2. In Chrome open `chrome://extensions`, switch on **Developer mode**, click **Load unpacked** and choose the unzipped folder.
3. Open the extension's **Options** (on `chrome://extensions` → Horu → *Details* → *Extension options*), enter the Pi's address (`https://horu.your-tailnet.ts.net`) as server address and click **Save**, then **Test connection**: it should say *Connected to Horu*.
4. Try it: open a video tab, press `Ctrl+Shift+H` (or tap *Start recording in Chrome* on the app's **Watch** page) to start recording, and tap **Mark**. Horu recognises the show and episode from the page. The moment appears in the **Inbox**.

**8. Set up the cards (this Horu has no Anki)**

1. Settings → **Cards on this phone** → *Cards go to*: choose **Collect on the phone (.apkg)** (or *AnkiConnect on this device*). Cards are then built on the phone and imported into AnkiMobile or AnkiDroid.
2. *Explanation when the phone makes the card*: choose **Gemini** and paste a free key from aistudio.google.com (or Anthropic/OpenAI, or *Copy prompt*). Claude Code is not available on the Pi.
3. Anki on your computer instead? In Anki's AnkiConnect settings set `webBindAddress` to `0.0.0.0`, then on the Pi edit `~/horu/.env`, set `HORU_ANKI_URL=http://<your-computer>:8765` and run `docker compose up -d`. Cards then go to that Anki whenever the computer is on, and wait in the inbox otherwise.

**9. Move your data from the laptop (optional)**

Stop Horu on the Pi, copy the laptop's `data/` folder over, start again. From your computer (replace names):

```bash
ssh your-user@horu-pi.local "cd horu && docker compose stop horu"
scp -r path/to/laptop/horu/data/* your-user@horu-pi.local:horu/data/
ssh your-user@horu-pi.local "cd horu && docker compose up -d"
```

History, known words, manga and settings come along. Check settings that name paths on the laptop (such as the extra backup folder). Then stop Horu on the laptop so only one copy is in use.

**10. Done: a checklist**

- [ ] `https://…/pair` opens and shows a QR code
- [ ] The phone shows `Laptop v…` in Settings and *Status → Laptop* is green
- [ ] The extension says *Connected to Horu*, and a mark from the app arrives in the Inbox
- [ ] A card can be made (Settings → Cards on this phone is set up)
- [ ] After restarting the Pi (`sudo reboot`) everything comes back by itself

What runs: a **Tailscale container** (the https address, reachable only on your tailnet) and the **Horu container**. Your data is the `data/` folder next to `docker-compose.yml` (`~/horu/data`). Run `bash scripts/pi-install.sh` again any time: it keeps your settings and data and updates and restarts. With `--yes` and `TS_AUTHKEY=…` in the environment it asks nothing.

### What differs from the laptop

| | Laptop | Pi / Docker |
|---|---|---|
| Anki | Horu starts and uses Anki on the laptop | no Anki: the phone makes the cards, or `HORU_ANKI_URL` points to Anki on another computer |
| Claude Code | possible | not available: use Gemini, Anthropic, OpenAI |
| Whisper | `medium`, on for every mark | `small`, off for marks (change under Settings → Listening) |
| Chrome extension | talks to `127.0.0.1` | server address in the extension's Options |
| mpv as the player | possible | not possible; Jellyfin, Plex and Kodi work |
| Game text (Textractor) | `ws://127.0.0.1:6677` | put your PC's address in Settings → Games |
| Autostart | tray launcher | `restart: unless-stopped`: starts with the Pi |

**Without Tailscale** (`docker-compose.lan.yml`, chosen by the script when you give no key): Horu is reachable on the home network over plain http only. Then the phone app has no microphone, offline mode or reminders (browsers allow those only on https), you open the pairing page as `http://<pi>:7317/pair?t=<token>` and the extension needs the access token. Use Tailscale if you can.

### Updating, backup, logs

```bash
git pull
docker compose pull        # or: bash scripts/pi-install.sh
docker compose up -d
docker compose logs -f horu
```

Back up the `data/` folder (Horu also writes 14 daily backups into `data/backups`). The version number at the top of **Settings** shows `App` and `Laptop`; on a Pi the second line is the Pi's Horu.

### Home Assistant and other containers

Run them in their own compose files; they do not need to know about Horu. Home Assistant in Docker usually uses `network_mode: host`; Horu stays reachable through its Tailscale container and opens no port on the Pi. To let Home Assistant react to Horu (a card was made, a mark was set), create a webhook automation in Home Assistant and paste its address (`http://<pi>:8123/api/webhook/<id>`) into Horu's **Settings → More from other tools → Webhook**.

### Building the image yourself

`docker compose build` (or `docker build -t horu .`) builds from this folder. Choose what goes in with `HORU_MODULES` in `.env`: `manga`, `whisper`, both (`manga,whisper`) or empty (the service alone, small and fast to build). The published image (`ghcr.io/northkey-dev/horu`, built for arm64 and amd64 by the *Docker image* GitHub workflow) contains both.

| Variable (`.env`) | Meaning |
|---|---|
| `TS_AUTHKEY`, `TS_HOSTNAME` | Tailscale key, and the name of the machine on your tailnet (default `horu`) |
| `HORU_MODULES` | Any of `manga`, `whisper`, `tts`, comma separated, or empty (only when building) |
| `HORU_VERSION` | Image version to run (default `latest`) |
| `HORU_ANKI_URL` | AnkiConnect address of Anki on another computer |
| `HORU_PORT`, `HORU_LAN_ADDRESS` | Home-network variant: the port and the Pi's address shown on the pairing page |
| `HORU_ALLOWED_HOSTS` | Names of your own for a reverse proxy or domain, comma separated. Addresses, names without a dot, `*.ts.net`, `*.local`, `*.lan`, `*.internal`, `*.home.arpa` and `*.fritz.box` always work; every other name is refused so that no website can pose as this computer. |
| `PUID`, `PGID`, `TZ` | Your user id (so `data/` belongs to you) and time zone |

### If something is wrong

| What you see | Reason and fix |
|---|---|
| The pairing page says the Tailscale container has not signed in | The key in `.env` is wrong, expired or already used. Make a new one, then `docker compose up -d --force-recreate`. `docker compose logs tailscale` says why. |
| `https://horu…` does not open | MagicDNS or HTTPS certificates are off in the Tailscale admin console, or the phone/computer is not on your tailnet. |
| The extension says Horu cannot be reached | Check the address on its Options page (*Test connection*). |
| A card cannot be made | Expected without Anki: use *Cards on this phone*, or set `HORU_ANKI_URL`. |
| Manga text recognition is missing | The image was built without the `manga` module (`HORU_MODULES`). |
| `data/` is not writable | `PUID` and `PGID` in `.env` must be your own (`id -u`, `id -g`). |

## Updating

Horu shows its version number at the top of **Settings**: `App v…` is the app on the phone, `Laptop v…` the service on the laptop. If they differ, a line says which one is older.

- **The app** (phone) updates itself from the hosted copy: close it fully and open it again.
- **The laptop:** `git pull`, `npm install`, `npm run build`, then restart Horu (tray icon → Quit, then start it again). Reload the Chrome extension in `chrome://extensions` after a build.

## Settings reference

Every option in **Settings**, in the order of the screen. Settings that belong to the **laptop** appear only while the laptop is reachable; change them and tap **Save changes** at the bottom. Settings that belong to the **phone** save by themselves and stay on that phone.

**Top of the page:** the version line shows `App v…` and `Laptop v…`. If they differ, a note says which is older (see [Updating](#updating)).

### Laptop and phone

| Section | Option | What it does |
|---|---|---|
| **Laptop** | Connect / Change / Disconnect | Pairs a copy of the app hosted on your own GitHub Pages with the laptop: scan the code from the tray icon (*Connect phone…*) or type its Tailscale name. Not needed when the laptop serves the app. *Disconnect* keeps what the phone saved. |
| | Mark without opening Horu | Steps to set up an iOS Shortcut (Back Tap, Action button, Siri) that sends a mark to the laptop while a video runs full screen. Needs Tailscale on the phone. It counts only while Chrome records the tab or an episode is running on the phone (started in Horu, ended with *End*, or after four hours without the app); otherwise the laptop answers "Nothing marked" and keeps nothing. The shortcut itself records no sound. |
| | Continue starts at once (*This phone*) | Off by default. On: one tap on an anime under Watch → *Continue* starts its next episode with the subtitle file Jimaku lists first. Off: the tap opens the episode page first, where you can pick another episode or file. |
| **This phone** | Jimaku API key | Used when an episode runs on a TV or the laptop is off: the phone loads subtitles itself. Free key from jimaku.cc → account. A connected laptop hands its key over by itself. |
| | Marks waiting for the laptop | How many marks made on the phone alone are still waiting to move to the laptop. |
| **Cards on this phone** | Cards go to | Where a card goes when the phone makes it. *Laptop, else collect on the phone* (default): the laptop's Anki when reachable, otherwise a file for AnkiMobile/AnkiDroid. *Always the laptop*: cards wait in the inbox until the laptop is on. *Collect on the phone (.apkg)*: with audio and picture, exported as a file. *AnkiConnect on this device*: AnkiDroid with the AnkiConnect Android app, or Anki on another computer. *AnkiMobile, one by one*: opens AnkiMobile per card, text only. |
| | Explanation when the phone makes the card | Who writes the explanation: *Automatic* (the laptop's AI when it makes the card, otherwise the first key below, otherwise copy prompt), *Gemini* (free key), *Anthropic* or *OpenAI* (paid per card), *Copy prompt into a chat app* (you paste the answer back), or *No explanation*. |
| | Key / Model | The API key for the chosen service (stays on this phone) and an optional model name; empty uses the service's default. |
| | Deck | Anki deck for cards made on the phone; empty uses the laptop's deck. |
| | AnkiConnect address | Only for *AnkiConnect on this device*. In AnkiConnect's own settings add the address of this app to the allowed origins (`webCorsOriginList`). |
| | About you (for the AI) | Your level and goals, so explanations fit. Empty uses the laptop's text. |
| | Cards to export | Shown when cards wait: choose *.apkg*, *CSV* or *JSON* and tap **Export**. *Export the last batch again* repeats it. iPhone: share the `.apkg` to AnkiMobile; Android: open it with AnkiDroid. Importing a card twice updates it instead of adding a copy. |
| **Manga reader** | Tint speech bubbles by new words | Off by default. Colours bubbles by how many new words they hold. |

### Words and dictionaries (phone)

| Section | Option | What it does |
|---|---|---|
| **Known words** | Import from | Adds words you already know: *WaniKani* (read-only API token, vocabulary at Guru and above), *jpdb.io* (API key, words jpdb considers known) or a *word list* (one word per line, or a CSV/TSV with the word in the first column, e.g. from Anki, Migaku, Language Reactor). The count of known words on this phone is shown. While the laptop runs, Anki stays the main source. |
| **Dictionaries** | Add a Yomitan dictionary (.zip) | Shows definitions, frequency or pitch accent under JMdict when you tap a word. Good ones: Jitendex (definitions), JPDB or Innocent Corpus (frequency), Kanjium (pitch accent). Big dictionaries belong on the laptop; without it they go into the phone. *Remove* deletes one. |
| **AniList** | Client ID / Log in / token | Ticks off watched episodes in your AniList (about two thirds of an episode must have played). Create your own client ID at AniList's developer settings, or paste a token. MyAnimeList users can sync AniList to MAL with a tool such as MAL-Sync. |
| **Import sentences** | Choose a file | Brings saved items from Language Reactor, asbplayer or Migaku exports, or any list with a sentence column, into the inbox like mined lines. |

### Status

| Section | What you see |
|---|---|
| **Status** | Laptop version, Anki (connected / starting / offline; Anki starts by itself when a card is made), Chrome extension (recording / idle / not connected), Jimaku (key set), Whisper (ready). |
| **Laptop modules** | Which optional parts are installed: Whisper, Manga sources, Text recognition, Claude Code, Ollama. Add one later with `scripts\install.ps1 -Modules whisper,manga,claude,ollama`. |

### Laptop settings

| Section | Option (default) | What it does |
|---|---|---|
| **Progress** | Daily goal XP (40) | Fills the ring on Insights. About 40 XP is 20 reviews and a few marks; a card is worth 10. |
| **Reminder** | Remind me when the goal is open (off) | One notification a day, only if you have not reached your goal. The laptop has to be on. |
| | Time (19:00) | When the reminder is sent (laptop time). |
| | Allow notifications on this device | Per device. On iPhone: Share → Add to Home Screen first, then open Horu from the home screen (iOS 16.4 or newer). *Send a test notification* checks it. |
| **Subtitles** | Jimaku API key | The laptop's key for Japanese subtitles (free, jimaku.cc → account). |
| **Cards on the laptop** | Anki deck (Anime Mining) | The deck cards are added to. |
| | New cards per day (10) | Applied once, when the deck is created. Change it later in Anki's deck options. |
| | Explanations by (Claude Code) | *Claude Code* (`claude -p`, your subscription), *Gemini* (free key), *Anthropic* or *OpenAI* (your key), *Ollama* (a local model on the laptop, free). |
| | Claude model (sonnet) | `sonnet`, `opus` or `haiku` (only for Claude Code). |
| | API key / Model / Ollama address | Key for Gemini, Anthropic or OpenAI (stays on the laptop and is left out of the extra backup copy); optional model name; address of Ollama (default `http://127.0.0.1:11434`). |
| | About you (for the AI) | Level and goals, so explanations fit. Phones use it too unless they set their own. |
| | Screenshot on anime cards (off) | Off: anime cards only get sentence and audio. Manga cards always get their panel. |
| | Kanji cards (off) | Also adds one card per new kanji of a target word, in the subdeck `::Kanji`. |
| **Preparation** | Before you watch (on) | On the Watch screen: how much of the episode you will understand and its key new words. |
| | Before you read (on) | The same on a manga page, for the chapter you are about to read. |
| | Words in the list (12) | 5 to 30 key words. More words cover more of the text, but each extra word adds less. |
| **Listening** | Audio per mark, seconds (25) | How many seconds of audio before a mark are kept. |
| | Keep finished, days (7) | After a card is made or a moment is discarded it stays in History and can be put back for this long. Its audio and pictures are removed afterwards. |
| | Whisper model (medium) | `small` is fast, `medium` is better, `large-v3` is best but slow on a plain CPU. |
| | Pick the line by ear (on) | Whisper listens to every mark and preselects the subtitle line that was actually spoken. |
| **Backup** | Extra copy to | Optional folder (for example in OneDrive) that gets a copy of the daily backup. It leaves out your Jimaku key, access token and push keys. Horu always keeps the last 14 days in `data/backups`. |
| | Back up now / Restore | Writes a backup right away. *Restore* picks a day, replaces your current data with it and restarts Horu; the current state is kept as a safety copy. |
| **Known words from Anki** | Anki search (empty) | Which reviewed cards count as known. Empty means all decks. Example: `deck:Japanisch*`. |
| | Count JLPT N5 and N4 as known (on) | Treats the N5 and N4 vocabulary as known, so previews and suggestions skip it. |
| **Media player** | Player (none) | *Jellyfin*, *Plex*, *Kodi* or *mpv*: the laptop asks it for the playback position, so the phone's episode clock follows it. Switch on *Follow* on the Watch screen. |
| | Server address / API key / Plex token / user:password | The address of the server and its key. Kodi needs *Allow remote control via HTTP* (Settings → Services → Control). mpv needs `--input-ipc-server=…` (the field shows the pipe name; empty uses the default). |
| **More from other tools** | jpdb deck ID / jpdb API key | Also adds each card's word and sentence to a jpdb.io deck, and keeps the words jpdb knows in your known words. |
| | Webhook | Every new mark and card is sent here as JSON (n8n, Zapier, Home Assistant, a script of yours). |
| | Export everything as JSON | Downloads your moments, sessions and word data. |
| **Manga server** | Server / Address / API key | Komga or Kavita: where volumes are imported from (see [Manga](#3-own-files-and-servers)). |
| **Games** | Text hooker (`ws://127.0.0.1:6677`) | WebSocket of Textractor (its WebSocket extension) or LunaTranslator. Lines show under Read → Texts → Game text. |
| **Manga** | Chapters prepared at once (15) | How many chapters, from the one you are on, the laptop keeps ready. With 1 it does one chapter at a time. |
| | Manga read in parallel (5) | How many manga can be *Reading* at once. |
| | Remove read chapters after, days (3) | Finished chapters are deleted from the laptop after this long. |
| | Show 18+ sources (off) | Unhides sources the extension store marks 18+ (most Japanese raw sites). |
| | Extension repository | The address the manga sources are installed from. Horu ships none. |
| | Suwayomi server (`http://127.0.0.1:4567`) | Address of Suwayomi; started automatically from `tools/suwayomi`. |

### Bottom of the page

| Section | What it does |
|---|---|
| **Appearance** | *Automatic* follows the phone, or force *Dark* or *Light*. |
| **Install on iPhone** | Short steps: open the app in Safari → Share → Add to Home Screen; with a laptop install Tailscale on both and run `tailscale serve --bg 7317`. |
| **Japanese text anywhere on the iPhone** | Steps for an iOS Shortcut: Take Screenshot → send it to the laptop's `/api/screen` → show the result, started with Back Tap. After a few seconds you see the text with readings and new words, and the screenshot also lands in the inbox. Needs the laptop to be on. |

### Chrome extension

The extension has one options page (the server address); otherwise it is controlled from the toolbar icon, the context menu and two shortcuts:

| Control | What it does |
|---|---|
| `Ctrl+Shift+H` | Start or stop recording the current tab (its audio and subtitles). The phone's *Start recording in Chrome* presses this one. Check at `chrome://extensions/shortcuts` that it is set. |
| `Alt+Shift+H` | The same, for installations that had it before. In some Chrome versions this combination does not reach extensions; then use `Ctrl+Shift+H`. |
| `Alt+Shift+J` | Highlight unknown Japanese words on this site (the choice is remembered per site). |
| Options page (`chrome://extensions` → Horu → Details → Extension options) | Where Horu runs: empty for this computer, or the address of Horu on a Raspberry Pi (and an access token when it is reached without Tailscale). *Test connection* checks it. |
| Right-click → *Highlight unknown Japanese words on this site* | The same as `Alt+Shift+J`. |
| Right-click → *Japanese subtitles over the recorded video* | Shows the subtitles as an overlay on the video, with unknown words underlined. |
| Hover a word | The dictionary appears; from there you can send the sentence to your inbox. |

## Content and responsibility

Horu ships no anime, manga, subtitles, audio or lists of sources. It works on what you bring: your own files, your own servers, your own accounts. You are responsible for where your material comes from and for following the terms of the sites and services you use (including streaming services whose subtitles or audio you record) and the copyright law where you live. The manga source extensions are third-party add-ons that you add yourself; Horu does not recommend or include any. Horu is provided as is, without warranty (GPL-3.0).

## Privacy

- No account, no server of ours, no central site, no analytics. The app is static files that you serve yourself (from your laptop or Pi, or from your own GitHub Pages); your data lives on your phone and your laptop.
- The laptop only answers the app, your Tailscale network (through `tailscale serve`) and its own Chrome extension. Everything else needs the access token, also a plain `http://100.x.y.z:7317` address.
- API keys you saved on the laptop stay there: the app only sees their last four characters. The Jimaku key is the exception, a connected phone gets it so it can load subtitles itself.
- While you record a tab, the extension sends the words of that page that name the show (tab title, headings, address words; not the site name or the query) to your own laptop, and only there.
- API keys you enter stay on the device where you enter them (phone keys never go to the laptop). The optional extra backup copy leaves keys out.
- Calls go only to the services you set up: Jimaku, AnkiConnect, your AI service, AniList, jpdb, WaniKani, your media or manga server.

## Your own copy of the app

There is no central Horu site. With a laptop or Pi you need nothing else: it serves the app. For phone-only use, host it on GitHub Pages for free:

1. Sign in to GitHub and press **Fork** on this repository.
2. In your fork: **Settings → Pages → Source → GitHub Actions**.
3. **Actions** tab → allow workflows if asked → **Publish app** → **Run workflow**.
4. After a few minutes the app is at `https://<your-name>.github.io/horu/`. For a new version: *Sync fork*, then run the workflow again.

Your data stays on your devices and is tied to this address, so keep the address once you use it.

The page holds only the app, never your data, and it tells search engines not to list it. On a free GitHub account it is still public for anyone who knows the address (GitHub cannot password-protect Pages there). If you want it less visible, give the Pages repo an unremarkable name, or host the `pwa/dist` folder on another static host such as Cloudflare Pages (`npx wrangler pages deploy pwa/dist`).

Want this copy to work with a laptop too? Put `HORU_APP_URL=https://<your-name>.github.io/horu/` in `.env` next to `package.json` (Docker: the same line in the `.env` of the install folder) and restart Horu, otherwise the laptop refuses the app. The pairing page then shows the code for *Settings → Laptop → Scan QR code*.

From your computer instead of Actions: `HORU_PAGES_REPO=<you>/<you>.github.io npm run deploy`.

Development: `npm run dev -w pwa` (app on :5173, proxies the service on :7317), `npm start -w server`, `npm test`, `npm run smoke`. The design and decisions are in [docs/PRD.md](docs/PRD.md).

## Credits

- [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (EDRDG, CC BY-SA 4.0) via [jmdict-simplified](https://github.com/scriptin/jmdict-simplified)
- [kuromoji.js](https://github.com/takuyaa/kuromoji.js) with the IPA dictionary (Apache 2.0)
- [Jimaku](https://jimaku.cc) for Japanese subtitles
- [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) (MIT) for the JLPT baseline
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (MIT), [mokuro](https://github.com/kha-white/mokuro) (GPL-3.0), [Suwayomi](https://github.com/Suwayomi/Suwayomi-Server) (MPL 2.0)
- [sql.js](https://github.com/sql-js/sql.js) (MIT), [fflate](https://github.com/101arrowz/fflate) (MIT), [jsQR](https://github.com/cozmo/jsQR) (Apache 2.0)
- Ideas from [Sluka](https://www.sluka.app), [Yomitan](https://github.com/yomidevs/yomitan), asbplayer and mpvacious

## Licence

[GPL-3.0-or-later](LICENSE). You may use, change and share Horu; changed versions you distribute must stay open under the same licence.
