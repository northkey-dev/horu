import { getSettings } from './config.ts';
import { log } from './log.ts';

// Card target jpdb.io (Settings → jpdb deck): every card's word is also added to a jpdb deck, with the
// sentence as its card sentence. Best effort next to Anki: failures only go to the log.

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`https://jpdb.io/api/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getSettings().jpdbApiKey.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error_message?: string };
  if (!res.ok) throw new Error(`jpdb: ${data.error_message ?? `HTTP ${res.status}`}`);
  return data;
}

export async function addToJpdb(word: string, sentence: string, translation: string): Promise<void> {
  const s = getSettings();
  if (!s.jpdbDeckId.trim() || !s.jpdbApiKey.trim()) return;
  try {
    const { vocabulary } = await post<{ vocabulary: [number, number, string][] }>('parse', { text: word, token_fields: [], vocabulary_fields: ['vid', 'sid', 'spelling'] });
    const hit = vocabulary.find((v) => v[2] === word) ?? vocabulary[0];
    if (!hit) throw new Error(`jpdb does not know ${word}`);
    const deck = /^\d+$/.test(s.jpdbDeckId.trim()) ? Number(s.jpdbDeckId.trim()) : s.jpdbDeckId.trim();
    await post('deck/add-vocabulary', { id: deck, vocabulary: [[hit[0], hit[1]]] });
    await post('set-card-sentence', { vid: hit[0], sid: hit[1], sentence, translation: translation || undefined }).catch(() => undefined);
    log.info(`jpdb: added ${word}`);
  } catch (err) {
    log.warn('jpdb card failed', (err as Error).message);
  }
}
