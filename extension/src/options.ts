import { authHeaders, DEFAULT_SERVER, type ServerConfig } from './messages.ts';

// Options page: where Horu runs (this computer, or a Raspberry Pi / other computer).

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const serverInput = $<HTMLInputElement>('server');
const tokenInput = $<HTMLInputElement>('token');
const result = $<HTMLDivElement>('result');

function show(text: string, ok: boolean): void {
  result.textContent = text;
  result.className = ok ? 'ok' : 'bad';
}

function current(): ServerConfig | undefined {
  const raw = serverInput.value.trim().replace(/\/+$/, '');
  if (raw && !/^https?:\/\/[^\s/]+/i.test(raw)) {
    show('The address must start with http:// or https://', false);
    return undefined;
  }
  return { url: raw || DEFAULT_SERVER, token: tokenInput.value.trim() };
}

void chrome.storage.local.get(['server', 'serverToken']).then((saved) => {
  serverInput.value = (saved.server as string | undefined) ?? '';
  tokenInput.value = (saved.serverToken as string | undefined) ?? '';
});

$('save').addEventListener('click', async () => {
  const c = current();
  if (!c) return;
  await chrome.storage.local.set({ server: serverInput.value.trim().replace(/\/+$/, ''), serverToken: c.token });
  show('Saved. A recording that is running keeps its old address until you stop and start it again.', true);
});

$('test').addEventListener('click', async () => {
  const c = current();
  if (!c) return;
  show('Testing…', true);
  try {
    const res = await fetch(`${c.url}/api/status`, { headers: authHeaders(c), signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'The server refused it: check the access token (or use the Tailscale address).' : `HTTP ${res.status}`);
    const status = (await res.json()) as { version?: string };
    show(`Connected to Horu${status.version ? ` v${status.version}` : ''}.`, true);
  } catch (e) {
    show(`Not reachable: ${(e as Error).message}`, false);
  }
});
