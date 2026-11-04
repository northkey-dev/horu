// Messages between content scripts, the service worker and the offscreen document.

// Where Horu runs: on this computer by default, or at the address set on the options page (Horu on a Raspberry
// Pi, e.g. https://horu.your-tailnet.ts.net), with an access token when it is reached without Tailscale.
export const DEFAULT_SERVER = 'http://127.0.0.1:7317';

export type ServerConfig = { url: string; token: string };

export const wsUrl = (c: ServerConfig) => `${c.url.replace(/^http/, 'ws')}/ws/ext${c.token ? `?t=${encodeURIComponent(c.token)}` : ''}`;
/** Headers a call to the server carries (the token, when there is one) */
export const authHeaders = (c: ServerConfig): Record<string, string> => (c.token ? { 'X-Horu-Token': c.token } : {});

/** The address and token from the options page; this computer when none is set. */
export async function loadServer(): Promise<ServerConfig> {
  const saved = (await chrome.storage.local.get(['server', 'serverToken'])) as { server?: string; serverToken?: string };
  return { url: (saved.server?.trim() || DEFAULT_SERVER).replace(/\/+$/, ''), token: saved.serverToken?.trim() ?? '' };
}

export type VideoState = {
  type: 'video-state';
  currentTime: number;
  paused: boolean;
  playbackRate: number;
  duration: number;
  area: number;
  /** The tab is in the background or minimised */
  hidden: boolean;
};

/** What a frame contains, without any page address or title (privacy): used to explain why no video position was found. */
export type VideoDiag = {
  type: 'video-diag';
  top: boolean;
  videos: { duration: number | null; readyState: number; width: number; height: number; paused: boolean; source: 'blob' | 'http' | 'none'; shadow: boolean }[];
};

export type Msg =
  | VideoState
  | VideoDiag
  | { type: 'should-report' }
  | { type: 'reporting'; enabled: boolean }
  | { type: 'start-capture'; streamId: string; target: 'offscreen'; server: ServerConfig }
  | { type: 'stop-capture'; target: 'offscreen' }
  | { type: 'capture-stopped' }
  | { type: 'screenshot' }
  /** words.ts → service worker: a call to the Horu service (content scripts cannot reach it themselves) */
  | { type: 'api'; path: string; body?: unknown }
  /** content.ts → service worker: Japanese subtitles of the recorded page (a whole track, or lines read off the screen) */
  | { type: 'site-subs'; cues: { start: number; end: number; text: string }[]; live: boolean }
  /** service worker → words.ts: subtitle overlay switched, with the running episode's lines */
  | { type: 'overlay'; enabled: boolean; cues?: { start: number; end: number; text: string }[] };

/** Service paths the content script may call through the service worker. */
export const API_PATHS = [/^\/api\/text\/(analyse|mine)$/, /^\/api\/lookup$/, /^\/api\/dicts\/lookup$/, /^\/api\/insights\/status$/];
