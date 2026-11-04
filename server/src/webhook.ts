import { getSettings } from './config.ts';
import { log } from './log.ts';

// Settings → Webhook: every new mark and card is POSTed as JSON to a URL of the user's choice
// (Zapier, n8n, Home Assistant, a script of their own). Fire and forget; failures only go to the log.

export type WebhookEvent = 'mark' | 'card';

export function notify(event: WebhookEvent, data: Record<string, unknown>): void {
  const url = getSettings().webhookUrl.trim();
  if (!/^https?:\/\//.test(url)) return;
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Horu' },
    body: JSON.stringify({ event, at: new Date().toISOString(), ...data }),
    signal: AbortSignal.timeout(10_000),
  }).then(
    (res) => res.ok || log.warn(`Webhook answered HTTP ${res.status}`),
    (err: Error) => log.warn('Webhook failed', err.message),
  );
}
