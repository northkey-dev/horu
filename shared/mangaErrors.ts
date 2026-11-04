// Plain-language versions of the errors that come back when a manga source or Suwayomi fails.

export function friendlyMangaError(message: string): string {
  if (/Page download failed: (403|429|5\d\d)/.test(message)) return 'The source refused the download (blocked by the site, rate limit or Cloudflare). Horu tries again later; you can also tap Resume.';
  if (/Page download failed: (404|410)/.test(message)) return 'The source no longer has this chapter or page.';
  if (/ECONNREFUSED|ENOTFOUND|fetch failed|not reachable|Suwayomi.*(start|reach)/i.test(message)) return 'Suwayomi or the source cannot be reached. Is the manga module installed (Java needed), and is the source site up?';
  if (/timeout|timed out|aborted|TimeoutError/i.test(message)) return 'The source or Suwayomi took too long to answer. Try again in a moment.';
  return message;
}
