import net from 'node:net';
import { getSettings } from './config.ts';

// What a media player or media server is playing right now, so the phone's episode clock can follow it
// (watching on a TV through Jellyfin, Plex or Kodi, or in mpv on the laptop) without the browser extension.

export type NowPlaying = { player: string; title: string; episode?: number; position: number; duration?: number; playing: boolean };

export const PLAYER_LABELS: Record<string, string> = { jellyfin: 'Jellyfin', plex: 'Plex', kodi: 'Kodi', mpv: 'mpv' };

const base = () => getSettings().playerUrl.trim().replace(/\/+$/, '');

async function getJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`${PLAYER_LABELS[getSettings().playerKind]} answered HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

async function jellyfin(): Promise<NowPlaying | undefined> {
  type S = { NowPlayingItem?: { Name: string; SeriesName?: string; IndexNumber?: number; RunTimeTicks?: number; Type?: string }; PlayState?: { PositionTicks?: number; IsPaused?: boolean } };
  const sessions = await getJson<S[]>(`${base()}/Sessions?ActiveWithinSeconds=120`, { headers: { 'X-Emby-Token': getSettings().playerToken.trim() } });
  const s = sessions.find((x) => x.NowPlayingItem && x.NowPlayingItem.Type !== 'Audio');
  if (!s?.NowPlayingItem) return undefined;
  const item = s.NowPlayingItem;
  return {
    player: 'Jellyfin',
    title: item.SeriesName ?? item.Name,
    episode: item.SeriesName ? item.IndexNumber : undefined,
    position: (s.PlayState?.PositionTicks ?? 0) / 1e7,
    duration: item.RunTimeTicks ? item.RunTimeTicks / 1e7 : undefined,
    playing: !s.PlayState?.IsPaused,
  };
}

async function plex(): Promise<NowPlaying | undefined> {
  type M = { type: string; title: string; grandparentTitle?: string; index?: number; viewOffset?: number; duration?: number; Player?: { state: string } };
  const data = await getJson<{ MediaContainer: { Metadata?: M[] } }>(`${base()}/status/sessions`, {
    headers: { 'X-Plex-Token': getSettings().playerToken.trim(), Accept: 'application/json' },
  });
  const m = data.MediaContainer.Metadata?.find((x) => x.type === 'episode' || x.type === 'movie');
  if (!m) return undefined;
  return {
    player: 'Plex',
    title: m.grandparentTitle ?? m.title,
    episode: m.type === 'episode' ? m.index : undefined,
    position: (m.viewOffset ?? 0) / 1000,
    duration: m.duration ? m.duration / 1000 : undefined,
    playing: m.Player?.state === 'playing',
  };
}

async function kodi(): Promise<NowPlaying | undefined> {
  const token = getSettings().playerToken.trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Basic ${Buffer.from(token).toString('base64')}`; // "user:password"
  const rpc = async <T>(method: string, params: unknown = {}) =>
    (await getJson<{ result: T }>(`${base()}/jsonrpc`, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).result;
  const players = await rpc<{ playerid: number; type: string }[]>('Player.GetActivePlayers');
  const video = players.find((p) => p.type === 'video');
  if (!video) return undefined;
  type T = { hours: number; minutes: number; seconds: number; milliseconds: number };
  const secs = (t: T) => t.hours * 3600 + t.minutes * 60 + t.seconds + t.milliseconds / 1000;
  const props = await rpc<{ time: T; totaltime: T; speed: number }>('Player.GetProperties', { playerid: video.playerid, properties: ['time', 'totaltime', 'speed'] });
  const { item } = await rpc<{ item: { title: string; showtitle?: string; episode?: number } }>('Player.GetItem', { playerid: video.playerid, properties: ['title', 'showtitle', 'episode'] });
  return {
    player: 'Kodi',
    title: item.showtitle || item.title,
    episode: item.showtitle && item.episode && item.episode > 0 ? item.episode : undefined,
    position: secs(props.time),
    duration: secs(props.totaltime) || undefined,
    playing: props.speed !== 0,
  };
}

/** mpv's JSON IPC (start mpv with --input-ipc-server=\\.\pipe\mpvsocket, the default here). */
function mpvGet(pipe: string, props: string[]): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(pipe);
    const results: unknown[] = new Array(props.length);
    let got = 0;
    let buffer = '';
    const timer = setTimeout(() => (socket.destroy(), reject(new Error('mpv did not answer'))), 3000);
    socket.on('error', (e) => (clearTimeout(timer), reject(new Error(`mpv is not running with an IPC server (${e.message})`))));
    socket.on('connect', () => props.forEach((p, i) => socket.write(`${JSON.stringify({ command: ['get_property', p], request_id: i })}\n`)));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const msg = JSON.parse(line) as { request_id?: number; data?: unknown };
        if (msg.request_id === undefined) continue; // events
        results[msg.request_id] = msg.data;
        if (++got === props.length) {
          clearTimeout(timer);
          socket.end();
          resolve(results);
        }
      }
    });
  });
}

async function mpv(): Promise<NowPlaying | undefined> {
  const pipe = getSettings().playerUrl.trim() || (process.platform === 'win32' ? '\\\\.\\pipe\\mpvsocket' : '/tmp/mpvsocket');
  const [pos, duration, paused, title] = await mpvGet(pipe, ['time-pos', 'duration', 'pause', 'media-title']);
  if (typeof pos !== 'number') return undefined;
  const name = String(title ?? '');
  const episode = /(?:^|[\s_\-\[(])(?:E|EP|第)?(\d{1,3})(?:話)?(?=[\s_\-\])v.]|$)/i.exec(name.replace(/\.\w+$/, ''))?.[1];
  return { player: 'mpv', title: name, episode: episode ? Number(episode) : undefined, position: pos, duration: typeof duration === 'number' ? duration : undefined, playing: paused === false };
}

export function playerConfigured(): string | undefined {
  const kind = getSettings().playerKind;
  return kind !== 'none' ? PLAYER_LABELS[kind] : undefined;
}

export async function nowPlaying(): Promise<NowPlaying | undefined> {
  switch (getSettings().playerKind) {
    case 'jellyfin':
      return jellyfin();
    case 'plex':
      return plex();
    case 'kodi':
      return kodi();
    case 'mpv':
      return mpv();
    default:
      throw new Error('No media player set up (Settings → Media player)');
  }
}
