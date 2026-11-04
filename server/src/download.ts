import { unzipSync } from 'fflate';
import { log } from './log.ts';

// Downloads data files from the jmdict-simplified GitHub releases. Retries a few
// times because a flaky connection otherwise surfaces as a bare "fetch failed".

const RELEASE_URL = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest';

async function fetchRetry(url: string, timeoutMs: number, tries = 3): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      const cause = (err as Error & { cause?: Error }).cause?.message ?? (err as Error).message;
      if (attempt >= tries) throw new Error(`Download failed (${new URL(url).host}): ${cause}. Check the internet connection.`);
      log.debug(`Download attempt ${attempt} failed`, url, cause);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

/** Fetches the latest release asset matching `pattern` (a .json.zip) and returns the unzipped JSON bytes. */
export async function downloadReleaseJson(pattern: RegExp): Promise<{ tag: string; bytes: Uint8Array }> {
  const release = (await (await fetchRetry(RELEASE_URL, 20_000)).json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find((a) => pattern.test(a.name));
  if (!asset) throw new Error(`Release asset ${pattern} not found`);
  const zip = new Uint8Array(await (await fetchRetry(asset.browser_download_url, 180_000)).arrayBuffer());
  const [bytes] = Object.values(unzipSync(zip));
  return { tag: release.tag_name, bytes };
}
