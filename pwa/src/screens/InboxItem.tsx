import { useEffect, useMemo, useRef, useState } from 'react';
import { api, audioUrl, imageUrl, laptopMakesCards, laptopUp } from '../lib/api.ts';
import { aiRoute, cardRoute, explainOnPhone, makeCardOnPhone, promptFor } from '../lib/cards.ts';
import { parseExplanation, type Explanation } from '../../../shared/ai.ts';
import { Sheet } from '../components/Sheet.tsx';
import { cardMadeFor, knownCheck } from '../lib/words.ts';
import { flash, formatTime, navigate, useMedia, usePoll } from '../lib/hooks.ts';
import { suggestTarget, type Token } from '../lib/japanese.ts';
import { TokenText } from '../components/TokenText.tsx';
import { Icon } from '../components/Icon.tsx';
import { Nav } from '../components/Nav.tsx';
import type { Candidate, CardRequest, Moment } from '../../../shared/types.ts';

type Route = ReturnType<typeof cardRoute>;

const BUSY = new Set(['capturing', 'transcribing', 'creating']);

export function InboxItem({ id }: { id: string }) {
  const { data: moment, error, refresh } = usePoll(() => api.moment(id), 2000, [id]);
  if (error)
    return (
      <>
        <Head label="" />
        <div className="banner error">{error.message}</div>
      </>
    );
  if (!moment) return <Head label="Loading…" />;
  return <Editor key={`${moment.id}:${moment.status}:${moment.candidates.length}:${moment.matchedIndex ?? ''}`} moment={moment} refresh={refresh} />;
}

function Head({ label }: { label: string }) {
  return <Nav back="Inbox" to="inbox" title={label} />;
}

/** The line the user most likely reacted to: whisper's match, else the last one that started before the press. */
function defaultLine(m: Moment, lines: Candidate[]): number {
  if (!lines.length) return -1;
  if (m.matchedIndex !== undefined && lines === m.candidates && m.matchedIndex < lines.length) return m.matchedIndex;
  if (m.videoTime === undefined) return m.kind === 'anime' ? lines.length - 1 : 0;
  let idx = 0;
  lines.forEach((c, i) => {
    if (c.start <= m.videoTime! - 0.3) idx = i;
  });
  return idx;
}

function Editor({ moment, refresh }: { moment: Moment; refresh: () => void }) {
  const imageSrc = useMedia(imageUrl(moment.id));
  const audioSrc = useMedia(audioUrl(moment.id));
  const [lines, setLines] = useState<Candidate[]>(moment.candidates);
  const [sel, setSel] = useState(() => defaultLine(moment, moment.candidates));
  const [sentence, setSentence] = useState(lines[sel]?.text.replace(/\n/g, '') ?? '');
  const [editing, setEditing] = useState(false);
  const [withContext, setWithContext] = useState(moment.kind === 'anime');
  const [tokens, setTokens] = useState<Token[]>();
  const [suggested, setSuggested] = useState<{ start: number; end: number; form: string }>();
  const [target, setTarget] = useState<{ start: number; end: number; form: string }>();
  const [clip, setClip] = useState<{ start: number; end: number }>();
  const [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string>();
  const [error, setError] = useState<string>();
  const [ask, setAsk] = useState<{ req: CardRequest; route: Route }>();
  const [ankiLink, setAnkiLink] = useState<string>();
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number>();

  const busyStatus = BUSY.has(moment.status);
  const finished = moment.status === 'done' || moment.status === 'discarded';

  async function restore() {
    await api.restore(moment.id).catch((e: Error) => setError(e.message));
    refresh();
  }
  const hasClip = moment.hasAudio && moment.audioStart !== undefined && clip !== undefined && moment.kind === 'anime';

  // Reset target and clip whenever the chosen line changes.
  useEffect(() => {
    const line = lines[sel];
    setSentence(line?.text.replace(/\n/g, '') ?? '');
    setTarget(undefined);
    // Subtitles from another release can run early/late; whisper measured by how much (whisper lines are in audio time already).
    const shift = line?.source === 'subs' ? (moment.syncOffset ?? 0) : 0;
    setClip(line && line.end > line.start ? { start: line.start + shift - 0.25, end: line.end + shift + 0.35 } : undefined);
  }, [sel, lines]);

  useEffect(() => {
    if (!tokens) return;
    // Prefer words the user does not know yet (Anki decks + JLPT baseline).
    knownCheck([...new Set(tokens.flatMap((t) => [t.base, t.surface]))])
      .then((map) => new Set(Object.keys(map).filter((w) => map[w])))
      .catch(() => undefined)
      .then((known) => {
        // The word picked while reading comes first.
        const hint = moment.targetHint;
        const token = hint && tokens.find((t) => t.base === hint || t.surface === hint);
        if (token) return { start: token.start, end: token.end, form: token.base };
        const at = hint ? sentence.indexOf(hint) : -1;
        return at >= 0 ? { start: at, end: at + hint!.length, form: hint! } : suggestTarget(tokens, known);
      })
      .then(setSuggested);
  }, [tokens]);

  const effectiveTarget = target ?? suggested;
  const context = useMemo(() => {
    if (!withContext || sel < 0) return [];
    return [lines[sel - 1]?.text, lines[sel + 1]?.text].filter((t): t is string => Boolean(t)).map((t) => t.replace(/\n/g, ' '));
  }, [withContext, lines, sel]);

  function play(range?: { start: number; end: number }) {
    const el = audio.current;
    if (!el) return;
    if (range && moment.audioStart !== undefined) {
      el.currentTime = Math.max(0, range.start - moment.audioStart);
      stopAt.current = range.end - moment.audioStart;
    } else {
      el.currentTime = 0;
      stopAt.current = undefined;
    }
    void el.play();
  }

  async function moreLines() {
    if (!moment.sessionId || moment.videoTime === undefined) return;
    const cues = await api.cues(moment.sessionId, moment.videoTime - 45, moment.videoTime + 15);
    const current = lines[sel];
    const next = cues.map((c) => ({ ...c, source: 'subs' as const }));
    setLines(next);
    const keep = current ? next.findIndex((c) => c.start === current.start && c.text === current.text) : -1;
    setSel(keep >= 0 ? keep : defaultLine(moment, next));
  }

  async function create(skipAi = false) {
    if (!effectiveTarget) return setError('Tap a word and choose “Use as target”.');
    const req: CardRequest = {
      sentence,
      targetStart: effectiveTarget.start,
      targetEnd: effectiveTarget.end,
      targetDictForm: effectiveTarget.form,
      context,
      clipStart: hasClip ? clip?.start : undefined,
      clipEnd: hasClip ? clip?.end : undefined,
    };
    const route = cardRoute(laptopUp() && laptopMakesCards());
    const ai = skipAi ? 'none' : aiRoute(route);
    if (ai === 'copy') return setAsk({ req, route });
    await finish(req, route, ai);
  }

  /** Gets the explanation (unless the laptop asks its own AI) and makes the card where Settings → Cards says. */
  async function finish(req: CardRequest, route: Route, ai: ReturnType<typeof aiRoute>, explanation?: Explanation) {
    setBusy(true);
    setError(undefined);
    try {
      if (!explanation && (ai === 'gemini' || ai === 'anthropic' || ai === 'openai')) {
        setWorking('Asking the AI for the explanation…');
        explanation = await explainOnPhone(ai, moment, req);
      }
      const word = effectiveTarget?.form || targetText;
      if (route === 'laptop') {
        await api.createCard(moment.id, { ...req, explanation, skipAi: ai === 'none' });
        flash(`Card for ${word} is being created`);
        return await goNext();
      }
      setWorking('Making the card on this phone…');
      const card = await makeCardOnPhone(moment, req, explanation, route, { audio: audioUrl(moment.id), image: imageUrl(moment.id) });
      await api.cardDone(moment.id, { cardSentence: card.sentence, cardTarget: card.word });
      void cardMadeFor(card.word);
      if (card.link) {
        setWorking(undefined);
        return setAnkiLink(card.link);
      }
      flash(route === 'apkg' ? `Card for ${card.word} saved · export it in Settings → Cards` : `Card for ${card.word} added to Anki`);
      await goNext();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
      setWorking(undefined);
    }
  }

  async function discard() {
    setBusy(true);
    await api.discard(moment.id).catch(() => {});
    flash('Discarded · still in History for a few days');
    await goNext();
  }

  async function goNext() {
    const inbox = await api.inbox().catch(() => []);
    const next = inbox.find((m) => m.id !== moment.id && m.status === 'ready');
    navigate(next ? `inbox/${next.id}` : 'inbox');
  }

  const nudge = (key: 'start' | 'end', delta: number) => clip && setClip({ ...clip, [key]: clip[key] + delta });
  const targetText = effectiveTarget ? sentence.slice(effectiveTarget.start, effectiveTarget.end) : '';

  return (
    <div>
      <Head label={moment.sourceLabel} />

      {finished && (
        <div className="banner info">
          <div>
            {moment.status === 'done' ? `Card created${moment.cardTarget ? ` for ${moment.cardTarget}` : ''}.` : 'Discarded.'}
            {!moment.hasAudio && moment.kind === 'anime' ? ' The audio is no longer stored.' : ''}
          </div>
          <button className="small" onClick={restore}>
            Put back in inbox
          </button>
        </div>
      )}
      {moment.status === 'error' && <div className="banner error">{moment.error}</div>}
      {moment.status !== 'error' && moment.error && <div className="banner">{moment.error}</div>}
      {busyStatus && (
        <div className="banner info row">
          <span className="spinner" />
          <span className="grow">
            {moment.status === 'capturing' && 'Waiting for audio from Chrome…'}
            {moment.status === 'transcribing' && 'No subtitles. Whisper is listening (about 30 s)…'}
            {moment.status === 'creating' && 'Creating the card. Claude writes the explanation, then it goes to Anki…'}
          </span>
        </div>
      )}

      {moment.hasImage && <img className="shot" src={imageSrc} alt="" />}

      {moment.hasAudio && (
        <div className="player">
          <audio
            ref={audio}
            src={audioSrc}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => {
              if (stopAt.current !== undefined && e.currentTarget.currentTime >= stopAt.current) {
                e.currentTarget.pause();
                stopAt.current = undefined;
              }
            }}
          />
          {playing ? (
            <button onClick={() => audio.current?.pause()}>
              <Icon name="stop" size={18} /> Stop
            </button>
          ) : (
            <>
              <button onClick={() => play(clip)} disabled={!hasClip}>
                <Icon name="play" size={18} /> This line
              </button>
              <button onClick={() => play()}>
                <Icon name="wave" size={18} /> All{moment.audioDuration ? ` ${Math.round(moment.audioDuration)} s` : ''}
              </button>
            </>
          )}
        </div>
      )}

      <h2>{lines.length > 1 ? 'Which line was it?' : 'The line'}</h2>
      {!lines.length && !busyStatus && (
        <div className="card small muted">
          No text found for this moment.
          {moment.hasAudio && (
            <div>
              <button className="small" style={{ marginTop: 10 }} onClick={() => api.transcribe(moment.id).then(refresh)}>
                Transcribe with Whisper
              </button>
            </div>
          )}
        </div>
      )}
      {lines.length > 0 && (
        <div className="group">
          {lines.map((c, i) => (
            <button key={i} className={`list-item cand${i === sel ? ' sel' : ''}`} onClick={() => setSel(i)} aria-pressed={i === sel}>
              <span className="time">{c.source === 'ocr' || c.source === 'text' ? 'Text' : formatTime(c.start)}</span>
              <div className="grow">
                <div className="text jp">{c.text}</div>
                {(c.source === 'whisper' || (i === moment.matchedIndex && lines === moment.candidates)) && (
                  <div className="meta">
                    {c.source === 'whisper' ? 'Whisper' : ''}
                    {i === moment.matchedIndex && lines === moment.candidates ? `${c.source === 'whisper' ? ' · ' : ''}matched by ear` : ''}
                  </div>
                )}
              </div>
              <i className="dot" />
            </button>
          ))}
        </div>
      )}
      <div className="under">
        {moment.sessionId && moment.videoTime !== undefined && (
          <button className="small ghost" onClick={moreLines}>
            More lines
          </button>
        )}
        <button className="small ghost" onClick={() => setEditing(true)}>
          Fix text
        </button>
      </div>

      {(sentence || editing) && (
        <>
          <h2>Target word</h2>
          {editing ? (
            <div className="card stack">
              <textarea className="jp" rows={2} value={sentence} onChange={(e) => setSentence(e.target.value)} autoFocus />
              <button className="small primary" onClick={() => setEditing(false)}>
                Done
              </button>
            </div>
          ) : (
            <div className="card">
              <TokenText
                text={sentence}
                printed={moment.readings}
                target={target}
                suggested={suggested}
                onTokens={setTokens}
                onPick={(l) => setTarget({ start: l.start, end: l.end, form: l.form })}
              />
              <div className="target-line">
                {effectiveTarget ? (
                  <>
                    <b className="jp">{effectiveTarget.form !== targetText ? effectiveTarget.form : targetText}</b>
                    <span>{target ? 'chosen' : 'suggested · tap any word to change'}</span>
                  </>
                ) : (
                  <span>Tap a word to look it up and set it as target.</span>
                )}
              </div>
            </div>
          )}

          <h2>Card</h2>
          <div className="group">
            <label className="toggle">
              <input type="checkbox" checked={withContext} onChange={(e) => setWithContext(e.target.checked)} />
              <span className="grow">Neighbouring lines as context</span>
            </label>
            {hasClip && clip && (
              <>
                <div className="cell">
                  <span className="grow">Audio clip</span>
                  <span className="value num">{(clip.end - clip.start).toFixed(1)} s</span>
                </div>
                <ClipEdge label="Start" onEarlier={() => nudge('start', -0.5)} onLater={() => nudge('start', 0.5)} />
                <ClipEdge label="End" onEarlier={() => nudge('end', -0.5)} onLater={() => nudge('end', 0.5)} />
              </>
            )}
          </div>
          {hasClip && <p className="footnote">Each step moves the edge by half a second. Play “This line” to check.</p>}
        </>
      )}

      {error && <div className="banner error">{error}</div>}
      {working && (
        <div className="banner info row">
          <span className="spinner" />
          <span className="grow">{working}</span>
        </div>
      )}
      {ankiLink && (
        <div className="banner info">
          <div>The card is ready. AnkiMobile adds it when you open it.</div>
          <button
            className="small primary"
            onClick={() => {
              location.href = ankiLink;
              setTimeout(() => void goNext(), 800);
            }}
          >
            Open in AnkiMobile
          </button>
        </div>
      )}
      {ask && (
        <CopyPrompt
          prompt={promptFor(moment, ask.req)}
          onClose={() => setAsk(undefined)}
          onAnswer={(answer) => {
            const req = ask.req;
            setAsk(undefined);
            void finish(req, ask.route, 'copy', answer);
          }}
        />
      )}

      {!finished && !ankiLink && (
        <div className="action-bar">
          <button className="danger icon-only" disabled={busy || moment.status === 'creating'} onClick={discard} aria-label="Discard">
            <Icon name="trash" size={21} />
          </button>
          <button disabled={busy || busyStatus || !sentence} onClick={() => create(true)}>
            No AI
          </button>
          <button className="primary" disabled={busy || busyStatus || !sentence} onClick={() => create(false)}>
            {moment.status === 'error' ? 'Retry card' : 'Create card'}
          </button>
        </div>
      )}
    </div>
  );
}

/** "Copy prompt": the user asks any chat app (Claude, ChatGPT, Gemini …) and pastes the JSON answer back. */
function CopyPrompt({ prompt, onClose, onAnswer }: { prompt: string; onClose: () => void; onAnswer: (e: Explanation) => void }) {
  const [answer, setAnswer] = useState('');
  const [copied, setCopied] = useState(false);
  const parsed = answer.trim() ? parseExplanation(answer) : undefined;
  return (
    <>
    <div className="sheet-backdrop" onClick={onClose} />
    <Sheet onClose={onClose}>
      <h2>Explanation from a chat app</h2>
      <p className="footnote">1. Copy the prompt and send it in Claude, ChatGPT or Gemini. 2. Copy the whole answer and paste it below.</p>
      <button
        className="block"
        onClick={() =>
          navigator.clipboard.writeText(prompt).then(
            () => setCopied(true),
            () => setCopied(false),
          )
        }
      >
        <Icon name="copy" size={18} /> {copied ? 'Copied' : 'Copy prompt'}
      </button>
      <textarea rows={6} placeholder="Paste the answer here" value={answer} onChange={(e) => setAnswer(e.target.value)} style={{ marginTop: 14 }} />
      {answer.trim() && !parsed && <div className="hint">That does not look like the answer yet: it should contain a JSON object with “translation” and “explanation”.</div>}
      <button className="block primary" style={{ marginTop: 12 }} disabled={!parsed} onClick={() => parsed && onAnswer(parsed)}>
        Create card
      </button>
    </Sheet>
    </>
  );
}

/** One edge of the audio clip with a minus/plus stepper (half a second per tap). */
function ClipEdge({ label, onEarlier, onLater }: { label: string; onEarlier: () => void; onLater: () => void }) {
  return (
    <div className="cell">
      <span className="grow">{label}</span>
      <span className="stepper">
        <button onClick={onEarlier} aria-label={`${label} earlier`}>
          <Icon name="minus" size={18} />
        </button>
        <i />
        <button onClick={onLater} aria-label={`${label} later`}>
          <Icon name="plus" size={18} />
        </button>
      </span>
    </div>
  );
}
