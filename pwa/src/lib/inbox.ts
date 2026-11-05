import { api, audioUrl, imageUrl } from './api.ts';
import { aiRoute, cardRoute, explainOnPhone, makeCardOnPhone, queuedWords } from './cards.ts';
import { suggestTarget, tokenize, type Token } from './japanese.ts';
import { cardMadeFor, knownCheck } from './words.ts';
import type { Explanation } from '../../../shared/ai.ts';
import type { Candidate, CardRequest, Moment } from '../../../shared/types.ts';

// What the inbox works out for a moment without being asked: the line, the word, whether that word has a card.
// The list, the swipe view and the full view all go through here, so they agree on it.

export type Target = { start: number; end: number; form: string };
export type Plan = { sentence: string; target?: Target; line?: Candidate };
type Route = ReturnType<typeof cardRoute>;

/** The line the user most likely reacted to: whisper's match, else the last one that started before the press. */
export function defaultLine(m: Moment, lines: Candidate[]): number {
  if (!lines.length) return -1;
  if (m.matchedIndex !== undefined && lines === m.candidates && m.matchedIndex < lines.length) return m.matchedIndex;
  if (m.videoTime === undefined) return m.kind === 'anime' ? lines.length - 1 : 0;
  let idx = 0;
  lines.forEach((c, i) => {
    if (c.start <= m.videoTime! - 0.3) idx = i;
  });
  return idx;
}

/** The stretch of audio for a line. Subtitles from another release can run early or late; whisper measured by how much. */
export function clipOf(m: Moment, line?: Candidate): { start: number; end: number } | undefined {
  if (!line || line.end <= line.start) return undefined;
  const shift = line.source === 'subs' ? (m.syncOffset ?? 0) : 0;
  return { start: line.start + shift - 0.25, end: line.end + shift + 0.35 };
}

/** The word to learn: the one picked while reading, else the rarest one the user does not know yet. */
export async function suggestFor(tokens: Token[], sentence: string, hint?: string): Promise<Target | undefined> {
  const known = await knownCheck([...new Set(tokens.flatMap((t) => [t.base, t.surface]))])
    .then((map) => new Set(Object.keys(map).filter((w) => map[w])))
    .catch(() => undefined);
  const token = hint && tokens.find((t) => t.base === hint || t.surface === hint);
  if (token) return { start: token.start, end: token.end, form: token.base };
  const at = hint ? sentence.indexOf(hint) : -1;
  return at >= 0 ? { start: at, end: at + hint!.length, form: hint! } : suggestTarget(tokens, known);
}

export const planKey = (m: Moment) => `${m.id}:${m.candidates.length}:${m.matchedIndex ?? ''}`;

const plans = new Map<string, Promise<Plan>>();

/** Line and word as the full view would preselect them. */
export function planFor(m: Moment): Promise<Plan> {
  const key = planKey(m);
  let plan = plans.get(key);
  if (!plan) {
    const line = m.candidates[defaultLine(m, m.candidates)];
    const sentence = line?.text.replace(/\n/g, '') ?? '';
    plan = (sentence ? tokenize(sentence).then((tokens) => suggestFor(tokens, sentence, m.targetHint)) : Promise.resolve(undefined)).then(
      (target) => ({ sentence, target, line }),
      () => {
        plans.delete(key);
        return { sentence, line };
      },
    );
    plans.set(key, plan);
  }
  return plan;
}

/** The card as the full view would ask for it with nothing changed. */
export function requestFor(m: Moment, plan: Plan, target: Target): CardRequest {
  const at = plan.line ? m.candidates.indexOf(plan.line) : -1;
  const clip = m.hasAudio && m.audioStart !== undefined && m.kind === 'anime' ? clipOf(m, plan.line) : undefined;
  return {
    sentence: plan.sentence,
    targetStart: target.start,
    targetEnd: target.end,
    targetDictForm: target.form,
    context: m.kind === 'anime' ? [m.candidates[at - 1]?.text, m.candidates[at + 1]?.text].filter((t): t is string => Boolean(t)).map((t) => t.replace(/\n/g, ' ')) : [],
    clipStart: clip?.start,
    clipEnd: clip?.end,
  };
}

const CHECK_FOR = 60_000;
const checked = new Map<string, { has: boolean; at: number }>();
/** Cards made since the app opened: the laptop may still be working on them. */
const madeNow = new Set<string>();

/** Which of these words already have a card. Without an answer from the laptop: the ones this phone knows of. */
export async function haveCards(words: string[]): Promise<Set<string>> {
  const fresh = (w: string) => Date.now() - (checked.get(w)?.at ?? 0) < CHECK_FOR;
  const ask = [...new Set(words)].filter((w) => !fresh(w));
  if (ask.length) {
    const found = await api.hasCards(ask).catch(() => undefined);
    if (found) for (const w of ask) checked.set(w, { has: found.includes(w), at: Date.now() });
  }
  const queued = new Set(await queuedWords().catch(() => []));
  return new Set(words.filter((w) => checked.get(w)?.has || madeNow.has(w) || queued.has(w)));
}

/** Gets the explanation (unless the laptop asks its own AI) and makes the card where Settings → Cards says. */
export async function sendCard(
  moment: Moment,
  req: CardRequest,
  word: string,
  route: Route,
  ai: ReturnType<typeof aiRoute>,
  explanation?: Explanation,
  step?: (text: string) => void,
): Promise<{ message: string; link?: string }> {
  if (!explanation && (ai === 'gemini' || ai === 'anthropic' || ai === 'openai')) {
    step?.('Asking the AI for the explanation…');
    explanation = await explainOnPhone(ai, moment, req);
  }
  if (route === 'laptop') {
    await api.createCard(moment.id, { ...req, explanation, skipAi: ai === 'none' });
    madeNow.add(word);
    return { message: `Card for ${word} is being created` };
  }
  step?.('Making the card on this phone…');
  const card = await makeCardOnPhone(moment, req, explanation, route, { audio: audioUrl(moment.id), image: imageUrl(moment.id) });
  await api.cardDone(moment.id, { cardSentence: card.sentence, cardTarget: card.word });
  void cardMadeFor(card.word);
  madeNow.add(card.word);
  return { link: card.link, message: route === 'apkg' ? `Card for ${card.word} saved · export it in Settings → Cards` : `Card for ${card.word} added to Anki` };
}
