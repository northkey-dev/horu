// Where the laptop service is. The app can also be hosted statically (your own GitHub Pages) and works without a
// laptop; a connected laptop adds capture, Whisper, manga sources, OCR, Claude and Anki. When the laptop serves the app
// itself (http://localhost:7317 or its Tailscale address), it is simply the same origin.

const KEY = 'horu-laptop';

export const servedByLaptop = () => !location.hostname.endsWith('.github.io');

function saved(): string | undefined {
  try {
    return localStorage.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Base URL of the laptop ('' = same origin), or undefined when none is connected. */
export function laptopBase(): string | undefined {
  return saved() ?? (servedByLaptop() ? '' : undefined);
}

export const hasLaptop = () => laptopBase() !== undefined;

/** Absolute URL of a laptop path like /api/status; throws when no laptop is connected. */
export function laptopUrl(path: string): string {
  const base = laptopBase();
  if (base === undefined) throw new NoLaptopError();
  return base + path;
}

export class NoLaptopError extends Error {
  constructor() {
    super('No laptop connected');
  }
}

/** "name.tail1234.ts.net", "https://…/", a pairing link or its QR text → "https://name.tail1234.ts.net". */
export function parseLaptop(input: string): string | undefined {
  let text = input.trim();
  const fromLink = /(?:^|[?&])laptop=([^&]+)/.exec(text);
  if (fromLink) text = decodeURIComponent(fromLink[1]);
  if (!text) return undefined;
  if (!/^https?:\/\//.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return url.origin;
  } catch {
    return undefined;
  }
}

export function setLaptop(url: string | undefined): void {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: stays connected for this visit only
  }
  dispatchEvent(new Event('horu-laptop'));
}
