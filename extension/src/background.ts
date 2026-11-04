import { parseSubtitles } from '../../shared/subtitles.ts';
import { API_PATHS, authHeaders, loadServer, type Msg, type PageText } from './messages.ts';

// Service worker: toggles recording when the toolbar icon is clicked, owns the
// offscreen document and takes screenshots (offscreen pages cannot). Also the bridge between the reading
// help on web pages (words.ts) and the Horu service, and the switches for it (context menu, Alt+Shift+J).

type RecState = { tabId: number; windowId: number } | undefined;

async function getState(): Promise<RecState> {
  return (await chrome.storage.session.get('rec')).rec as RecState;
}

async function setState(state: RecState): Promise<void> {
  if (state) await chrome.storage.session.set({ rec: state });
  else await chrome.storage.session.remove('rec');
  await chrome.action.setBadgeText({ text: state ? 'REC' : '' });
  await chrome.action.setBadgeBackgroundColor({ color: '#e03131' });
  await chrome.action.setTitle({ title: state ? 'Horu: recording – click to stop' : 'Horu: start recording this tab' });
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
  return contexts.length > 0;
}

async function broadcastReporting(tabId: number, enabled: boolean): Promise<void> {
  // Delivered to every frame of the tab, including cross-origin player iframes.
  await chrome.tabs.sendMessage(tabId, { type: 'reporting', enabled } satisfies Msg).catch(() => {});
}

async function start(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id === undefined) return;
  const tabId = tab.id;
  const streamId = await new Promise<string>((resolve, reject) =>
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (id) =>
      chrome.runtime.lastError ? reject(new Error(chrome.runtime.lastError.message)) : resolve(id),
    ),
  );
  if (!(await hasOffscreen())) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: 'Keep a rolling buffer of the tab audio for sentence mining.',
    });
  }
  await chrome.runtime.sendMessage({ type: 'start-capture', streamId, target: 'offscreen', server: await loadServer() } satisfies Msg);
  await setState({ tabId: tab.id, windowId: tab.windowId });
  await broadcastReporting(tab.id, true);
  if (overlayOn) await setOverlay(true);
  // The page may still be loading and the player sets its title late: look a few times.
  for (const wait of [1500, 6000, 15000]) setTimeout(() => void detectPage(tabId), wait);
}

async function stop(): Promise<void> {
  const state = await getState();
  if (state && overlayOn) await chrome.tabs.sendMessage(state.tabId, { type: 'overlay', enabled: false } satisfies Msg).catch(() => {});
  if (await hasOffscreen()) {
    await chrome.runtime.sendMessage({ type: 'stop-capture', target: 'offscreen' } satisfies Msg).catch(() => {});
    await chrome.offscreen.closeDocument().catch(() => {});
  }
  if (state) await broadcastReporting(state.tabId, false);
  await setState(undefined);
  lastDetected = '';
}

async function toggle(tab: chrome.tabs.Tab | undefined): Promise<void> {
  const state = await getState();
  try {
    if (state) await stop();
    else if (tab) await start(tab);
  } catch (err) {
    console.error('Horu:', err);
    await stop();
    await chrome.action.setBadgeText({ text: 'ERR' });
    await chrome.action.setTitle({ title: `Horu: ${(err as Error).message}` });
  }
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));

// Alt+Shift+H and Ctrl+Shift+H (chrome://extensions/shortcuts) do the same as clicking the icon; Alt+Shift+J switches the
// word highlighting for the current site.
chrome.commands.onCommand.addListener(async (command, tab) => {
  const current = tab ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (command === 'toggle-recording' || command === 'record') void toggle(current);
  if (command === 'toggle-highlight' && current?.url) void toggleSite(current.url);
});

// ---- which show and episode? (shared/detect.ts reads the page's words on the laptop) ----

let lastDetected = '';
let detectTimer: ReturnType<typeof setTimeout> | undefined;

/** Sends the recorded page's title words to the laptop, which starts the episode they name (unless one was chosen by hand). */
async function detectPage(tabId: number): Promise<void> {
  const state = await getState();
  if (!state || state.tabId !== tabId) return;
  const texts = ((await chrome.tabs.sendMessage(tabId, { type: 'page-texts' } satisfies Msg, { frameId: 0 }).catch(() => undefined)) as PageText[] | undefined) ?? [];
  // The tab's own title is there even when the page's script does not answer.
  const tab = await chrome.tabs.get(tabId).catch(() => undefined);
  if (tab?.title && !texts.some((t) => t.text === tab.title)) texts.push({ text: tab.title, weight: 2 });
  if (!texts.length) return;
  const key = JSON.stringify(texts);
  if (key === lastDetected) return;
  lastDetected = key;
  const server = await loadServer();
  await fetch(`${server.url}/api/sessions/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(server) },
    body: JSON.stringify({ texts }),
  }).catch(() => {
    lastDetected = ''; // try again at the next change
  });
}

// The next episode is a new address or title in the recorded tab.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.title && !change.url && change.status !== 'complete') return;
  clearTimeout(detectTimer);
  detectTimer = setTimeout(() => void detectPage(tabId), 1500);
});

// ---- reading help (words.ts) ----

const siteOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

async function sites(): Promise<string[]> {
  return ((await chrome.storage.local.get('highlightSites')).highlightSites as string[] | undefined) ?? [];
}

async function toggleSite(url: string, on?: boolean): Promise<void> {
  const site = siteOf(url);
  if (!site) return;
  const list = await sites();
  const next = on ?? !list.includes(site);
  await chrome.storage.local.set({ highlightSites: next ? [...new Set([...list, site])] : list.filter((s) => s !== site) });
}

let overlayOn = false;

/** Shows or hides the running episode's subtitles over the video in the recorded tab. */
async function setOverlay(on: boolean): Promise<void> {
  overlayOn = on;
  const state = await getState();
  if (!state) return;
  let cues: { start: number; end: number; text: string }[] | undefined;
  if (on) {
    const server = await loadServer();
    const status = (await fetch(`${server.url}/api/status`, { headers: authHeaders(server) }).then((r) => r.json()).catch(() => undefined)) as { session?: { id: string } } | undefined;
    if (status?.session) cues = await fetch(`${server.url}/api/sessions/${status.session.id}/cues?from=0&to=100000`, { headers: authHeaders(server) }).then((r) => r.json()).catch(() => undefined);
  }
  await chrome.tabs.sendMessage(state.tabId, { type: 'overlay', enabled: on, cues } satisfies Msg).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'highlight', title: 'Highlight unknown Japanese words on this site', contexts: ['page', 'selection'], type: 'checkbox' });
  chrome.contextMenus.create({ id: 'overlay', title: 'Japanese subtitles over the recorded video', contexts: ['page', 'video'], type: 'checkbox' });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'highlight' && tab?.url) void toggleSite(tab.url, Boolean(info.checked));
  if (info.menuItemId === 'overlay') void setOverlay(Boolean(info.checked));
});
// The checkbox follows the site of the active tab.
async function syncMenu(url?: string): Promise<void> {
  if (url) chrome.contextMenus.update('highlight', { checked: (await sites()).includes(siteOf(url)) }, () => void chrome.runtime.lastError);
}
chrome.tabs.onActivated.addListener(({ tabId }) => void chrome.tabs.get(tabId).then((t) => syncMenu(t.url)));
chrome.tabs.onUpdated.addListener((_id, change, tab) => change.status === 'complete' && tab.active && void syncMenu(tab.url));
chrome.storage.onChanged.addListener(() => void chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => syncMenu(t?.url)));

chrome.tabs.onRemoved.addListener(async (tabId) => {
  if ((await getState())?.tabId === tabId) await stop();
});

// Navigations inside the recorded tab (next episode) re-ask via 'should-report'.
chrome.runtime.onMessage.addListener((msg: Msg, sender, sendResponse) => {
  if (msg.type === 'should-report') {
    getState().then((s) => sendResponse(s !== undefined && sender.tab?.id === s.tabId));
    return true;
  }
  if (msg.type === 'screenshot') {
    getState()
      .then((s) => (s ? chrome.tabs.captureVisibleTab(s.windowId, { format: 'jpeg', quality: 80 }) : undefined))
      .then((dataUrl) => sendResponse(dataUrl ?? null))
      .catch((err) => {
        console.warn('Horu screenshot failed', err);
        sendResponse(null);
      });
    return true;
  }
  if (msg.type === 'site-subs') {
    void getState().then((s) => s && sender.tab?.id === s.tabId && sendSiteSubs(msg.cues, msg.live, sender.tab.title));
    return false;
  }
  if (msg.type === 'capture-stopped') {
    void stop();
  }
  if (msg.type === 'api') {
    if (!API_PATHS.some((p) => p.test(msg.path))) {
      sendResponse({ error: 'Not allowed' });
      return false;
    }
    void loadServer().then((server) =>
      fetch(`${server.url}${msg.path}`, {
        method: msg.body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders(server) },
        body: msg.body === undefined ? undefined : JSON.stringify(msg.body),
      })
        .then((r) => r.json())
        .then(sendResponse, () => sendResponse({ error: 'Horu cannot be reached (is it running? check the address on the extension options page)' })),
    );
    return true;
  }
  return false;
});

// ---- the page's own subtitles (see content.ts) ----

async function sendSiteSubs(cues: { start: number; end: number; text: string }[], live: boolean, page?: string): Promise<unknown> {
  const server = await loadServer();
  return fetch(`${server.url}/api/sessions/site-subs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(server) },
    body: JSON.stringify({ cues, live, page }),
  }).catch(() => undefined);
}

// Subtitle files the recorded tab downloads (Crunchyroll's .ass, the .vtt of many web players). Only Japanese
// ones are passed on: most of their lines contain kana.
const SUB_FILE = /\.(vtt|ass|ssa|srt)(?:[?#]|$)/i;
const seenFiles = new Set<string>();
chrome.webRequest.onCompleted.addListener(
  (d) => {
    if (d.tabId < 0 || !SUB_FILE.test(d.url) || seenFiles.has(d.url)) return;
    void (async () => {
      const state = await getState();
      if (state?.tabId !== d.tabId) return;
      seenFiles.add(d.url);
      const text = await fetch(d.url).then((r) => (r.ok ? r.text() : ''), () => '');
      const name = new URL(d.url).pathname.split('/').pop() ?? 'subs.vtt';
      const cues = parseSubtitles(name, text);
      if (!cues.length || cues.filter((c) => /[぀-ヿ]/.test(c.text)).length < cues.length * 0.4) return;
      const tab = await chrome.tabs.get(d.tabId).catch(() => undefined);
      await sendSiteSubs(cues, false, tab?.title);
    })();
  },
  { urls: ['<all_urls>'], types: ['xmlhttprequest', 'other', 'media'] },
);

// The offscreen document does not survive a browser restart.
chrome.runtime.onStartup.addListener(() => void setState(undefined));
