import { useEffect, useState } from 'react';
import { TokenText } from './TokenText.tsx';
import { Sheet } from './Sheet.tsx';
import { SpeakButton } from './SpeakButton.tsx';
import { translateAhead, translateLine } from '../lib/cards.ts';
import { api } from '../lib/api.ts';
import type { Translation } from '../../../shared/ai.ts';
import type { Printed } from '../../../shared/readings.ts';

// Bottom sheet for one piece of text read off a picture (a manga speech bubble, a line on a photo):
// words with the dictionary, the text fixed by hand, translated as a whole, or mined. The caller mounts it
// with a new `key` for every piece of text, so it starts without a translation or an open editor.

type Props = {
  /** The text as shown: corrected by hand, else as recognised */
  text: string;
  /** Whether `text` differs from what was recognised */
  edited: boolean;
  /** Where the text is from, for the translation prompt */
  source: string;
  /** Text before this one, as context for the translation */
  context: string[];
  /** A corrected text, or undefined to go back to the recognised one */
  onEdit: (text: string | undefined) => void;
  /** Furigana the page prints for this text */
  readings?: Printed[];
  /** Mine the line, with the tapped word already chosen when there is one */
  onMine: (targetHint?: string) => void;
  /** Change the frame around the text so it is read again; left out where there is none */
  onReframe?: () => void;
  onClose: () => void;
};

export function TextSheet({ text, readings, edited, source, context, onEdit, onMine, onReframe, onClose }: Props) {
  const [translation, setTranslation] = useState<Translation | 'busy' | 'copied' | { error: string }>();
  const [draft, setDraft] = useState<string>();
  const [rated, setRated] = useState<1 | -1>();

  // A moment after opening, so flipping through bubbles costs nothing. Closing the sheet cancels it.
  useEffect(() => {
    const ahead = setTimeout(() => translateAhead({ text, context, source, readings }), 600);
    return () => clearTimeout(ahead);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  async function translate(fresh = false) {
    setTranslation('busy');
    setRated(undefined);
    try {
      setTranslation(await translateLine({ text, context, source, readings }, fresh));
    } catch (e) {
      setTranslation({ error: (e as Error).message });
    }
  }

  // A mark on the answer goes into the laptop's AI log; "Poor" answers stay out of the training examples.
  function rate(ref: string, rating: 1 | -1) {
    setRated(rating);
    api.rateAnswer(ref, rating).catch(() => setRated(undefined));
  }

  function save(value: string | undefined) {
    onEdit(value?.trim() || undefined);
    setDraft(undefined);
    setTranslation(undefined);
  }

  return (
    <Sheet className="reader-sheet" onClose={onClose}>
      {draft === undefined ? (
        <TokenText text={text} printed={readings} className="sentence" highlight pickLabel="Mine with this word" onPick={(l) => onMine(l.form)} onDismissAll={onClose} />
      ) : (
        <div>
          <textarea className="jp bubble-edit" rows={3} value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} />
          <div className="row" style={{ gap: 8, marginTop: 8 }}>
            <button className="primary grow" onClick={() => save(draft)}>
              Use this text
            </button>
            <button className="grow" onClick={() => setDraft(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {draft === undefined && (
        <div className="row" style={{ gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          <SpeakButton text={text} readings={readings} label="Listen" />
          <button className="ghost small" onClick={() => setDraft(text)}>
            Fix the text
          </button>
          {onReframe && (
            <button className="ghost small" onClick={onReframe}>
              Adjust the frame
            </button>
          )}
          {edited && (
            <button className="ghost small" onClick={() => save(undefined)}>
              Back to the recognised text
            </button>
          )}
        </div>
      )}
      {draft === undefined && translation && translation !== 'busy' && (
        <div className="translation">
          {translation === 'copied' ? (
            <p className="hint">Prompt copied. Paste it into any chat app (ChatGPT, Gemini, Claude) for the translation, or add an AI key in Settings → Cards on the phone.</p>
          ) : 'error' in translation ? (
            <p className="hint label-bad">{translation.error}</p>
          ) : (
            <>
              <p>{translation.translation}</p>
              {translation.notes && <p className="hint">{translation.notes}</p>}
              {!!translation.words?.length && (
                <dl className="word-list">
                  {translation.words.map((w, i) => (
                    <div key={i}>
                      <dt className="jp">
                        {w.word} <span className="muted">{w.reading}</span>
                      </dt>
                      <dd>{w.meaning}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                {translation.ref && (
                  <>
                    <button className={`ghost small${rated === 1 ? ' on' : ''}`} onClick={() => rate(translation.ref!, 1)}>
                      Good
                    </button>
                    <button className={`ghost small${rated === -1 ? ' on' : ''}`} onClick={() => rate(translation.ref!, -1)}>
                      Poor
                    </button>
                  </>
                )}
                <button className="ghost small" onClick={() => translate(true)}>
                  Ask again
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {draft === undefined && (
        <>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="grow" disabled={translation === 'busy'} onClick={() => translate()}>
              {translation === 'busy' ? <span className="spinner" /> : 'Translate'}
            </button>
            <button className="primary grow" onClick={() => onMine()}>
              Mine this line
            </button>
          </div>
          <p className="hint center" style={{ margin: '10px 0 0' }}>
            Tap a word for its meaning; there you can mine the line with that word already chosen. Otherwise you pick the word in the inbox.
          </p>
        </>
      )}
    </Sheet>
  );
}
