// What Horu is built on, with the licence of each part. Keep in step with THIRD-PARTY.md in the repository.

export type Credit = { name: string; licence: string; url: string; what: string; where: 'app' | 'laptop' | 'service' };

export const REPO = 'https://github.com/northkey-dev/horu';

export const CREDITS: Credit[] = [
  { name: 'JMdict', licence: 'CC BY-SA 4.0 · © Electronic Dictionary Research and Development Group', url: 'https://www.edrdg.org/jmdict/j_jmdict.html', what: 'The dictionary behind every word lookup (via jmdict-simplified)', where: 'app' },
  { name: 'KANJIDIC2', licence: 'CC BY-SA 4.0 · © Electronic Dictionary Research and Development Group', url: 'https://www.edrdg.org/wiki/index.php/KANJIDIC_Project', what: 'Kanji meanings and readings (via jmdict-simplified)', where: 'app' },
  { name: 'kuromoji.js with IPA dictionary', licence: 'Apache 2.0 (the IPA dictionary has its own permissive licence)', url: 'https://github.com/takuyaa/kuromoji.js', what: 'Splits Japanese text into words', where: 'app' },
  { name: 'open-anki-jlpt-decks', licence: 'MIT', url: 'https://github.com/jamsinclair/open-anki-jlpt-decks', what: 'JLPT word lists for the known-words baseline', where: 'app' },
  { name: 'React', licence: 'MIT', url: 'https://react.dev', what: 'The app’s interface', where: 'app' },
  { name: 'sql.js', licence: 'MIT', url: 'https://github.com/sql-js/sql.js', what: 'Builds Anki packages (.apkg) on the phone', where: 'app' },
  { name: 'fflate', licence: 'MIT', url: 'https://github.com/101arrowz/fflate', what: 'Reads and writes zip files', where: 'app' },
  { name: 'jsQR', licence: 'Apache 2.0', url: 'https://github.com/cozmo/jsQR', what: 'Scans the pairing code', where: 'app' },
  { name: 'Express, ws, qrcode', licence: 'MIT', url: 'https://expressjs.com', what: 'The laptop service', where: 'laptop' },
  { name: 'web-push', licence: 'MPL 2.0', url: 'https://github.com/web-push-libs/web-push', what: 'Reminders on the phone', where: 'laptop' },
  { name: 'faster-whisper and Whisper models', licence: 'MIT', url: 'https://github.com/SYSTRAN/faster-whisper', what: 'Listens to audio when there are no subtitles', where: 'laptop' },
  { name: 'mokuro', licence: 'GPL-3.0', url: 'https://github.com/kha-white/mokuro', what: 'Finds speech bubbles and reads manga text', where: 'laptop' },
  { name: 'EasyOCR', licence: 'Apache 2.0', url: 'https://github.com/JaidedAI/EasyOCR', what: 'Reads text on photos', where: 'laptop' },
  { name: 'Kokoro (kokoro-onnx, model, misaki)', licence: 'MIT / Apache 2.0', url: 'https://github.com/thewh1teagle/kokoro-onnx', what: 'A local voice for cards', where: 'laptop' },
  { name: 'edge-tts', licence: 'LGPL-3.0', url: 'https://github.com/rany2/edge-tts', what: 'Calls the neural Japanese voice of Microsoft Edge (off in Settings)', where: 'laptop' },
  { name: 'Suwayomi', licence: 'MPL 2.0', url: 'https://github.com/Suwayomi/Suwayomi-Server', what: 'Runs the manga source extensions you add yourself', where: 'laptop' },
  { name: 'Jimaku', licence: 'Service, your own account and key', url: 'https://jimaku.cc', what: 'Japanese subtitle files', where: 'service' },
  { name: 'Anki, AnkiConnect', licence: 'AGPL-3.0 / GPL-3.0, separate programs', url: 'https://apps.ankiweb.net', what: 'Where the cards end up', where: 'service' },
  { name: 'Yomitan, asbplayer, mpvacious, Sluka', licence: 'Ideas only, no code', url: 'https://github.com/yomidevs/yomitan', what: 'Tools that inspired parts of Horu', where: 'service' },
];
