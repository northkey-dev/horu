// Types shared by server, PWA and extension. Keep this file free of runtime code
// that depends on Node or the DOM.

export type Cue = {
  start: number; // seconds (video time)
  end: number;
  text: string;
};

export type CandidateSource = 'subs' | 'whisper' | 'ocr' | 'text';

export type Candidate = Cue & { source: CandidateSource };

/** text: a sentence from a web page (extension) or the app's text reader */
export type MomentKind = 'anime' | 'manga' | 'screen' | 'text';

export type MomentStatus =
  | 'capturing' // waiting for the extension to deliver audio/screenshot
  | 'transcribing' // whisper fallback running
  | 'ready' // waiting in the inbox
  | 'creating' // card creation in progress (claude + anki)
  | 'done'
  | 'discarded'
  | 'error';

export type Moment = {
  id: string;
  kind: MomentKind;
  createdAt: string;
  status: MomentStatus;
  error?: string;
  sessionId?: string;
  /** Human readable source, e.g. "Frieren · Ep 5 · 12:34" */
  sourceLabel: string;
  title: string;
  episode?: number;
  /** Video time at the moment of the button press. */
  videoTime?: number;
  /** Video time at which the audio buffer starts. */
  audioStart?: number;
  audioDuration?: number;
  hasAudio: boolean;
  hasImage: boolean;
  candidates: Candidate[];
  // Manga specifics
  mangaTitle?: string;
  chapterName?: string;
  page?: number;
  /** Candidate index whisper matched to what was actually said (auto line pick). */
  matchedIndex?: number;
  /** Seconds the audio runs ahead of the subtitle times (off-sync subtitles), measured by whisper. */
  syncOffset?: number;
  /** Word the user picked when mining a text, preselected as target */
  targetHint?: string;
  /** Set when the card was created */
  noteId?: number;
  /** What the card was made from (the candidates stay untouched so it can be redone). */
  cardSentence?: string;
  cardTarget?: string;
};

export type Session = {
  id: string;
  createdAt: string;
  title: string;
  jimakuEntryId?: number;
  anilistId?: number;
  episode: number;
  subtitleName?: string;
  cueCount: number;
  /** Seconds of video played while recording, by day (see watchSeconds in extensionHub.ts) */
  watch?: Record<string, number>;
  /** The episode was ticked off in the AniList list (shared/anilist.ts) */
  listSynced?: boolean;
  /** Made by the page recognition, not chosen by hand: a new page may replace it (shared/detect.ts) */
  auto?: boolean;
  /** How sure the recognition is: found on Jimaku, found but unsure, or only the page's words */
  detected?: 'matched' | 'unsure' | 'guess';
};

export type CardRequest = {
  sentence: string;
  /** Start/end offsets of the target word inside `sentence`. */
  targetStart: number;
  targetEnd: number;
  targetDictForm?: string;
  context: string[];
  clipStart?: number; // video time
  clipEnd?: number;
  /** Explanation the phone already has (pasted from a chat app or asked there); the laptop then asks no AI */
  explanation?: { targetReading: string; targetMeaning: string; translation: string; explanation: string };
};

export type Status = {
  version: string;
  /** This Horu can make Anki cards itself (false in a container without an Anki address: the phone makes them) */
  cards?: boolean;
  extensionConnected: boolean;
  extensionRecording: boolean;
  anki: 'ok' | 'offline' | 'starting';
  jimakuConfigured: boolean;
  whisperAvailable: boolean;
  session?: Session;
  /** Marks in the running session (for the counter on the button). */
  sessionMarks: number;
  inboxCount: number;
  /** Media player or server the laptop can ask for the playback position (Settings → Media player) */
  player?: string;
};

export type Settings = {
  jimakuApiKey: string;
  deckName: string;
  newCardsPerDay: number;
  claudeModel: string;
  whisperModel: string;
  bufferSeconds: number;
  suwayomiUrl: string;
  mangaPrefetchChapters: number;
  mangaMaxActive: number;
  mangaKeepReadDays: number;
  /** Anki search for notes whose words count as known; empty = all decks. */
  knownWordsQuery: string;
  jlptBaseline: boolean;
  autoMatchWhisper: boolean;
  kanjiCards: boolean;
  /** Put the video frame on anime cards (manga cards always get their panel). */
  animeScreenshot: boolean;
  /** Days that audio/images of finished or discarded moments stay available for "restore". */
  keepDays: number;
  /** Daily goal in XP (see analytics.ts for how XP is earned). */
  dailyGoalXp: number;
  /** Push reminder when the daily goal is still open at `reminderTime` (HH:MM, laptop time). */
  reminderEnabled: boolean;
  reminderTime: string;
  /** Extra folder (e.g. in OneDrive) that gets a copy of the daily backup; empty = only data/backups */
  backupFolder: string;
  /** Word preview on the Watch screen / on a manga page */
  prepBeforeWatch: boolean;
  prepBeforeRead: boolean;
  /** Key words listed in the previews (5-30) */
  prepWordCount: number;
  /** List manga sources the store marks 18+ (most Japanese raw sites carry that flag) */
  showAdultSources: boolean;
  /** Suwayomi extension repository (index URL) the manga sources come from; Horu ships none */
  mangaExtensionRepo: string;
  /** Who writes the card explanations on the laptop: Claude Code (`claude -p`) or an HTTP service (shared/ai.ts) */
  aiEngine: 'claude' | 'gemini' | 'anthropic' | 'openai' | 'ollama';
  aiApiKey: string;
  /** Empty = the service's default model */
  aiModel: string;
  ollamaUrl: string;
  /** Describes the learner in the AI prompt (level, goals) */
  learnerProfile: string;
  /** POSTs a JSON event to this URL when a card is made or a moment is marked; empty = off */
  webhookUrl: string;
  /** Known-word sources pulled with the user's keys (shared/knownSources.ts) */
  jpdbApiKey: string;
  wanikaniToken: string;
  /** Also add every card's word (with its sentence) to this jpdb.io deck; empty = off */
  jpdbDeckId: string;
  /** AniList access token: watched episodes are ticked off */
  anilistToken: string;
  /** Media player/server that drives the phone's episode clock */
  playerKind: 'none' | 'jellyfin' | 'plex' | 'kodi' | 'mpv';
  /** Server address (Jellyfin/Plex/Kodi) or mpv's IPC pipe */
  playerUrl: string;
  /** Jellyfin API key, Plex token, or Kodi "user:password" */
  playerToken: string;
  /** Komga or Kavita manga server to import volumes from */
  mangaServerKind: 'none' | 'komga' | 'kavita';
  mangaServerUrl: string;
  mangaServerKey: string;
  /** WebSocket of a text hooker for games (Textractor's WebSocket extension, LunaTranslator) */
  hookUrl: string;
};

export type JimakuEntry = {
  id: number;
  name: string;
  japanese_name?: string | null;
  english_name?: string | null;
  anilist_id?: number | null;
};

export type JimakuFile = {
  url: string;
  name: string;
  size: number;
  last_modified?: string;
};

// ---- Extension <-> server protocol ----

export type ExtToServer =
  | { type: 'hello'; recording: boolean }
  | { type: 'recording'; recording: boolean }
  /** Heartbeat every 5 s while a video is playing in the recorded tab */
  | { type: 'playing' };

export type ServerToExt = { type: 'mark'; momentId: string; seconds: number };

export type ExtMomentMeta = {
  videoTime: number | null;
  playing: boolean;
  bufferSeconds: number;
  pageTitle: string;
  pageUrl: string;
  /** Why no video position was found (counts and sizes only, never an address). */
  videoDiag?: string;
  screenshot?: string; // data URL (jpeg)
};

// ---- analytics (server/src/analytics.ts) ----

export type DayStat = {
  day: string;
  /** Anki reviews that day */
  reviews: number;
  /** Time spent in Anki reviews */
  minutes: number;
  /** Cards seen for the first time in Anki */
  learned: number;
  /** Horu: moments marked / cards created, episodes watched (5+ min), manga chapters finished */
  marked: number;
  cards: number;
  episodes: number;
  chapters: number;
  /** Minutes of video played with the extension recording, and the 5-minute blocks of it that paid XP */
  watched: number;
  watchBlocks: number;
  /** Japanese words read in the text reader, and the blocks of them that paid XP */
  read: number;
  readBlocks: number;
  xp: number;
};

export type AnkiStats = {
  asOf: string;
  /** Anki search the numbers are restricted to (Settings → Known words), empty = whole collection */
  scope: string;
  totals: { reviews: number; minutes: number; cardsReviewed: number; firstDay?: string };
  /** Share of review cards answered correctly in the last 30 days (null while there are too few) */
  retention30: number | null;
  retentionAll: number | null;
  answers30: { again: number; hard: number; good: number; easy: number };
  answersAll: { again: number; hard: number; good: number; easy: number };
  /** Reviews per hour of day, last 180 days */
  hours: number[];
  states: { learning: number; young: number; mature: number; suspended: number; unseen: number };
  /** Cards due today (incl. overdue) and on each of the next 13 days */
  forecast: number[];
  hardest: { text: string; lapses: number; interval: number; deck: string }[];
  /** Kanji that recur on cards you keep forgetting (absent in data cached by an older version) */
  weakKanji?: { kanji: string; cards: number; lapses: number; example: string }[];
};

/** Size of the known-word estimate at the end of a day (see snapshotVocab). */
export type VocabPoint = { total: number; anki: number; manual: number };

export type Analytics = {
  generatedAt: string;
  today: string;
  goal: number;
  days: DayStat[];
  totals: { xp: number; marked: number; cards: number; discarded: number; inbox: number; episodes: number; chapters: number; reviews: number; minutes: number; watchMinutes: number; prepared: number; knownWords: number; wordsRead: number };
  streak: { current: number; best: number; activeToday: boolean };
  level: { n: number; xp: number; from: number; to: number };
  horu: {
    /** Marks per hour of day / per weekday (Monday first) */
    hours: number[];
    weekdays: number[];
    byKind: { kind: string; marked: number; cards: number }[];
    titles: { title: string; kind: string; cards: number; marked: number }[];
    /** Watch time per anime, longest first, with its episodes */
    watched: { title: string; minutes: number; episodes: { episode: number; minutes: number }[] }[];
  };
  known: { total: number; anki: number; jlpt: number; manual: number };
  /** One point per day since Horu started tracking, oldest first */
  vocab: (VocabPoint & { day: string })[];
  anki: { status: 'live' | 'cached' | 'none'; online: boolean; asOf?: string; data?: AnkiStats };
};
