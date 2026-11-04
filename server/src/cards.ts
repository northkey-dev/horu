import { speak, ttsOn } from './tts.ts';
import fs from 'node:fs';
import { cutClip } from './audio.ts';
import { ClaudeError, explain, translate } from './claude.ts';
import { explainWith, translateWith, type ExplainInput, type Explanation, type TranslateInput, type Translation } from '../../shared/ai.ts';
import { highlight, slug } from '../../shared/furigana.ts';
import { notify } from './webhook.ts';
import { cardMade } from './knownWords.ts';
import { addToJpdb } from './jpdb.ts';
import { addNote } from './anki.ts';
import { furiganaHtml, readingOf } from './japanese.ts';
import { addKanjiCards } from './kanji.ts';
import { log } from './log.ts';
import { getSettings } from './config.ts';
import * as store from './store.ts';
import type { CardRequest } from '../../shared/types.ts';

// Inbox item -> Anki note. Runs one card at a time (claude calls are the slow part).

let chain: Promise<unknown> = Promise.resolve();

export function createCard(id: string, req: CardRequest, opts: { skipAi?: boolean } = {}): void {
  const moment = store.getMoment(id);
  if (!moment) throw new Error('Unknown moment');
  if (!req.sentence.trim()) throw new Error('Sentence is empty');
  if (!(req.targetEnd > req.targetStart)) throw new Error('Pick a target word first');
  store.updateMoment(id, { status: 'creating', error: undefined });
  chain = chain.then(() =>
    build(id, req, opts).catch((err: Error) => {
      log.error('Card creation failed', err);
      store.updateMoment(id, { status: 'error', error: err.message });
    }),
  );
}

async function build(id: string, req: CardRequest, opts: { skipAi?: boolean }): Promise<void> {
  const moment = store.getMoment(id)!;
  const sentence = req.sentence.trim();
  const target = sentence.slice(req.targetStart, req.targetEnd);

  let clip: string | undefined;
  // The wav is deleted once a card exists; the mp3 is good enough for cutting again after a restore.
  const source = [store.mediaPath(id, 'wav'), store.mediaPath(id, 'mp3')].find((f) => fs.existsSync(f));
  if (moment.hasAudio && source) {
    clip = store.mediaPath(id, 'clip.mp3');
    if (req.clipStart !== undefined && req.clipEnd !== undefined && moment.audioStart !== undefined) {
      await cutClip(source, req.clipStart - moment.audioStart, req.clipEnd - moment.audioStart, clip);
    } else {
      fs.copyFileSync(store.mediaPath(id, 'mp3'), clip);
    }
  }
  // Nothing to hear (manga, text, a photo): a computer voice reads the sentence. Without it the card is still a card.
  if (!clip && ttsOn()) {
    const voice = store.mediaPath(id, 'clip.mp3');
    await speak(sentence, voice).then(
      () => (clip = voice),
      (err: Error) => log.warn('Voice for the card failed', err.message),
    );
  }

  let ai: Explanation = req.explanation ?? { targetReading: '', targetMeaning: '', translation: '', explanation: '' };
  if (!opts.skipAi && !req.explanation) {
    const input = { sentence, target: req.targetDictForm && req.targetDictForm !== target ? `${target} (${req.targetDictForm})` : target, context: req.context, source: moment.sourceLabel };
    try {
      ai = await explainOnLaptop(input);
    } catch (err) {
      // A timeout means Claude is down or rate-limited; retrying would only double the wait.
      if (err instanceof ClaudeError && err.timedOut) throw err;
      if (/did not answer|no API key/.test((err as Error).message)) throw err;
      log.warn('AI failed, retrying once', err);
      ai = await explainOnLaptop(input);
    }
  }
  if (!ai.targetReading) ai.targetReading = await readingOf(req.targetDictForm || target);

  const noteId = await addNote({
    sentence: highlight(sentence, req.targetStart, req.targetEnd),
    sentenceFurigana: await furiganaHtml(sentence, req.targetStart, req.targetEnd),
    target: req.targetDictForm || target,
    targetReading: ai.targetReading,
    targetMeaning: ai.targetMeaning,
    translation: ai.translation,
    explanation: ai.explanation,
    context: req.context.join('\n'),
    audioPath: clip,
    imagePath: moment.hasImage && (moment.kind !== 'anime' || getSettings().animeScreenshot) ? store.mediaPath(id, 'jpg') : undefined,
    source: moment.sourceLabel,
    mediaPrefix: `horu_${id}`,
    tags: [moment.kind, slug(moment.title)].filter(Boolean),
  });

  await addKanjiCards(req.targetDictForm || target, ai.targetReading, sentence);
  cardMade(req.targetDictForm || target);
  void addToJpdb(req.targetDictForm || target, sentence, ai.translation);

  store.updateMoment(id, {
    status: 'done',
    noteId,
    cardSentence: sentence,
    cardTarget: req.targetDictForm || target,
  });
  // Anki keeps its own copies; the rest stays for a few days (history → restore) and is purged later.
  store.removeFile(store.mediaPath(id, 'wav'));
  store.removeFile(store.mediaPath(id, 'clip.mp3'));
  log.info(`Card created for ${id} (note ${noteId})`);
  notify('card', { moment: store.getMoment(id), target: req.targetDictForm || target, sentence, ...ai });
}

/** Explanation from the AI chosen in Settings → AI on the laptop. */
function explainOnLaptop(input: ExplainInput): Promise<Explanation> {
  const s = getSettings();
  if (s.aiEngine === 'claude') return explain(input);
  return explainWith({ service: s.aiEngine, key: s.aiApiKey, model: s.aiModel, url: s.ollamaUrl }, input, s.learnerProfile);
}

const translations = new Map<string, Translation>();

/** Translation of a line (manga speech bubble) by the same AI; the last few hundred are kept. */
export async function translateOnLaptop(input: TranslateInput): Promise<Translation> {
  const cached = translations.get(input.text);
  if (cached) return cached;
  const s = getSettings();
  const result = s.aiEngine === 'claude' ? await translate(input) : await translateWith({ service: s.aiEngine, key: s.aiApiKey, model: s.aiModel, url: s.ollamaUrl }, input, s.learnerProfile);
  translations.set(input.text, result);
  if (translations.size > 500) translations.delete(translations.keys().next().value!);
  return result;
}
