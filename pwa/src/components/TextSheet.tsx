import { useState } from 'react';
import { TokenText } from './TokenText.tsx';
import { Sheet } from './Sheet.tsx';
import { translateLine } from '../lib/cards.ts';
import type { Translation } from '../../../shared/ai.ts';

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
  /** Mine the line, with the tapped word already chosen when there is one */
  onMine: (targetHint?: string) => void;
  onClose: () => void;
};

export function TextSheet({ text, edited, source, context, onEdit, onMine, onClose }: Props) {
  const [translation, setTranslation] = useState<Translation | 'busy' | 'copied' | { error: string }>();
  const [draft, setDraft] = useState<string>();

  async function translate() {
    setTranslation('busy');
    try {
      setTranslation(await translateLine({ text, context, source }));
    } catch (e) {
      setTranslation({ error: (e as Error).message });
    }
  }

  function save(value: string | undefined) {
    onEdit(value?.trim() || undefined);
    setDraft(undefined);
    setTranslation(undefined);
  }

  return (
    <Sheet className="reader-sheet" onClose={onClose}>
      {draft === undefined ? (
        <TokenText text={text} className="sentence" highlight pickLabel="Mine with this word" onPick={(l) => onMine(l.form)} />
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
        <div className="row" style={{ gap: 4, marginTop: 4 }}>
          <button className="ghost small" onClick={() => setDraft(text)}>
            Fix the text
          </button>
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
            </>
          )}
        </div>
      )}
      {draft === undefined && (
        <>
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="grow" disabled={translation === 'busy'} onClick={translate}>
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
