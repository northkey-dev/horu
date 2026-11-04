// Known words from other learning services, pulled with the user's own API key. Runs on the laptop and,
// where the service allows calls from a web page (WaniKani), on the phone.

const JP = /[぀-ヿ㐀-鿿々〆ー]/;

async function json<T>(res: Response, label: string): Promise<T> {
  const data = (await res.json().catch(() => undefined)) as (T & { error?: string | { message?: string }; error_message?: string }) | undefined;
  if (!res.ok) {
    const reason = data?.error_message ?? (typeof data?.error === 'string' ? data.error : data?.error?.message);
    throw new Error(`${label}: ${reason ?? `HTTP ${res.status}`}`);
  }
  return data as T;
}

/** WaniKani: vocabulary at Guru or above (SRS stage 5+). Token from wanikani.com → Settings → API tokens. */
export async function wanikaniKnown(token: string): Promise<string[]> {
  const headers = { Authorization: `Bearer ${token.trim()}`, 'Wanikani-Revision': '20170710' };
  const get = async <T>(url: string) => json<T>(await fetch(url, { headers, signal: AbortSignal.timeout(30_000) }), 'WaniKani');
  type Page<T> = { data: T[]; pages?: { next_url: string | null } };
  const ids: number[] = [];
  let url: string | null = 'https://api.wanikani.com/v2/assignments?subject_types=vocabulary,kana_vocabulary&srs_stages=5,6,7,8,9';
  while (url) {
    const page: Page<{ data: { subject_id: number } }> = await get(url);
    ids.push(...page.data.map((a) => a.data.subject_id));
    url = page.pages?.next_url ?? null;
  }
  const words: string[] = [];
  for (let i = 0; i < ids.length; i += 500) {
    let next: string | null = `https://api.wanikani.com/v2/subjects?ids=${ids.slice(i, i + 500).join(',')}`;
    while (next) {
      const page: Page<{ data: { characters: string | null } }> = await get(next);
      for (const s of page.data) if (s.data.characters && JP.test(s.data.characters)) words.push(s.data.characters);
      next = page.pages?.next_url ?? null;
    }
  }
  return [...new Set(words)];
}

/** jpdb.io: vocabulary in the user's decks that jpdb considers known. API key from jpdb.io → Settings. */
export async function jpdbKnown(key: string): Promise<string[]> {
  const post = async <T>(path: string, body: unknown) =>
    json<T>(
      await fetch(`https://jpdb.io/api/v1/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      }),
      'jpdb',
    );
  const { decks } = await post<{ decks: [number | string, string][] }>('list-user-decks', { fields: ['id', 'name'] });
  const vocab = new Map<string, [number, number]>();
  for (const [id] of decks) {
    const { vocabulary } = await post<{ vocabulary: [number, number][] }>('deck/list-vocabulary', { id, fetch_occurences: false });
    for (const v of vocabulary) vocab.set(`${v[0]}:${v[1]}`, v);
  }
  const list = [...vocab.values()];
  const words = new Set<string>();
  for (let i = 0; i < list.length; i += 1000) {
    const { vocabulary_info } = await post<{ vocabulary_info: ([string, string, string[] | null] | null)[] }>('lookup-vocabulary', {
      list: list.slice(i, i + 1000),
      fields: ['spelling', 'reading', 'card_state'],
    });
    for (const info of vocabulary_info) {
      if (!info) continue;
      const [spelling, , state] = info;
      // Without a card state (older API) every deck word counts; otherwise only known ones.
      if (!state || state.some((s) => s === 'known' || s === 'never-forget')) if (JP.test(spelling)) words.add(spelling);
    }
  }
  return [...words];
}

const JLPT_URL = (level: string) => `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/${level}.csv`;

/** JLPT vocabulary lists (open-anki-jlpt-decks, MIT): expression and reading of each word. */
export async function jlptWords(levels = ['n5', 'n4']): Promise<string[]> {
  const words: string[] = [];
  for (const level of levels) {
    const res = await fetch(JLPT_URL(level), { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) continue;
    words.push(...parseJlptCsv(await res.text()));
  }
  return words;
}

export function parseJlptCsv(text: string): string[] {
  const words: string[] = [];
  for (const line of text.split('\n').slice(1)) {
    const [expression, reading] = line.split(',');
    if (expression) words.push(expression.trim());
    if (reading && reading !== expression) words.push(reading.trim());
  }
  return words;
}
