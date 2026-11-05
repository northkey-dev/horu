import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { api, audioUrl, imageUrl, laptopMakesCards, laptopUp } from '../lib/api.ts';
import { aiRoute, cardRoute } from '../lib/cards.ts';
import { flash, navigate, useMedia } from '../lib/hooks.ts';
import { clipOf, haveCards, planFor, planKey, requestFor, sendCard, type Plan, type Target } from '../lib/inbox.ts';
import { lookupForm } from '../lib/japanese.ts';
import { TokenText } from '../components/TokenText.tsx';
import { Icon } from '../components/Icon.tsx';
import type { Moment } from '../../../shared/types.ts';

// The inbox one moment at a time, with line and word already chosen: swipe right for the card, left to let it go.
// Anything that needs more than that (another line, the clip, an AI answer to paste) is in the full view.

const SWIPE = 90;

export function InboxStack({ moments, refresh }: { moments: Moment[]; refresh: () => void }) {
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const left = moments.filter((m) => m.status === 'ready' && !gone.has(m.id));
  const [top, next] = left;

  useEffect(() => {
    if (next) void planFor(next);
  }, [next?.id]);

  const hide = (id: string) => setGone((g) => new Set(g).add(id));
  const bringBack = (id: string, e: Error) => {
    setGone((g) => new Set([...g].filter((x) => x !== id)));
    flash(e.message);
  };

  async function card(m: Moment, plan?: Plan, target?: Target) {
    const route = cardRoute(laptopUp() && laptopMakesCards());
    const ai = aiRoute(route);
    // Pasting an AI answer and opening AnkiMobile need a tap there.
    if (!plan || !target || ai === 'copy' || route === 'ankimobile') return navigate(`inbox/${m.id}`);
    hide(m.id);
    try {
      flash((await sendCard(m, requestFor(m, plan, target), target.form, route, ai)).message);
      refresh();
    } catch (e) {
      bringBack(m.id, e as Error);
    }
  }

  async function discard(m: Moment) {
    hide(m.id);
    try {
      await api.discard(m.id);
      flash('Discarded · still in History for a few days');
      refresh();
    } catch (e) {
      bringBack(m.id, e as Error);
    }
  }

  if (!top)
    return (
      <div className="empty">
        <b>Nothing to swipe</b>
        <p>What is left here is still being worked on, or needs a look in the list.</p>
      </div>
    );
  return (
    <>
      <SwipeCard key={planKey(top)} moment={top} onCard={(plan, target) => void card(top, plan, target)} onDiscard={() => void discard(top)} />
      {next?.hasImage && <Preload id={next.id} />}
    </>
  );
}

function Preload({ id }: { id: string }) {
  return <img src={useMedia(imageUrl(id))} alt="" hidden />;
}

function SwipeCard({ moment, onCard, onDiscard }: { moment: Moment; onCard: (plan?: Plan, target?: Target) => void; onDiscard: () => void }) {
  const image = useMedia(imageUrl(moment.id));
  const sound = useMedia(audioUrl(moment.id));
  const [plan, setPlan] = useState<Plan>();
  const [picked, setPicked] = useState<Target>();
  const [meaning, setMeaning] = useState<string>();
  const [hasCard, setHasCard] = useState(false);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<'left' | 'right'>();
  const drag = useRef<{ x: number; y: number; on: boolean }>();
  const dragged = useRef(false);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number>();
  const target = picked ?? plan?.target;

  useEffect(() => {
    let alive = true;
    void planFor(moment).then((p) => alive && setPlan(p));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const word = target?.form;
    setHasCard(false);
    setMeaning(undefined);
    if (!word) return;
    let alive = true;
    void haveCards([word]).then((have) => alive && setHasCard(have.has(word)));
    lookupForm(word).then((entries) => alive && setMeaning(entries[0]?.senses[0]), () => undefined);
    return () => {
      alive = false;
    };
  }, [target?.form]);

  function leave(side: 'left' | 'right') {
    setLeaving(side);
    setTimeout(() => (side === 'right' ? onCard(plan, target) : onDiscard()), 170);
  }

  function down(e: PointerEvent<HTMLDivElement>) {
    dragged.current = false;
    // The dictionary opens inside the card.
    drag.current = (e.target as Element).closest('.sheet, .sheet-backdrop') ? undefined : { x: e.clientX, y: e.clientY, on: false };
  }

  function move(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || leaving) return;
    const x = e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(x) < 12 || Math.abs(x) < Math.abs(e.clientY - d.y) * 1.4) return;
      d.on = true;
      dragged.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(x);
  }

  function up(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    drag.current = undefined;
    if (!d?.on) return;
    const x = e.clientX - d.x;
    if (Math.abs(x) > SWIPE) leave(x > 0 ? 'right' : 'left');
    else setDx(0);
  }

  function play() {
    const el = audio.current;
    if (!el) return;
    const clip = moment.kind === 'anime' && moment.audioStart !== undefined ? clipOf(moment, plan?.line) : undefined;
    el.currentTime = clip ? Math.max(0, clip.start - moment.audioStart!) : 0;
    stopAt.current = clip ? clip.end - moment.audioStart! : undefined;
    void el.play();
  }

  const moved = leaving ? (leaving === 'right' ? 1 : -1) * innerWidth * 1.2 : dx;
  const pull = Math.min(1, Math.abs(dx) / SWIPE);
  return (
    <>
      <div
        className={`swipe-card${drag.current?.on ? ' held' : ''}`}
        style={moved ? { transform: `translateX(${moved}px) rotate(${moved / 40}deg)` } : undefined}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          drag.current = undefined;
          setDx(0);
        }}
        onClickCapture={(e) => {
          if (dragged.current) e.stopPropagation();
        }}
      >
        <span className="swipe-label yes" style={{ opacity: dx > 0 ? pull : 0 }}>
          Card
        </span>
        <span className="swipe-label no" style={{ opacity: dx < 0 ? pull : 0 }}>
          Discard
        </span>
        {moment.hasImage && <img className="shot" src={image} alt="" draggable={false} />}
        <div className="swipe-body">
          <div className="meta ellipsis">{moment.sourceLabel}</div>
          {plan?.sentence ? (
            <TokenText text={plan.sentence} printed={moment.readings} target={picked} suggested={plan.target} onPick={(l) => setPicked({ start: l.start, end: l.end, form: l.form })} />
          ) : (
            <p className="muted">{plan ? 'No text for this moment yet.' : ' '}</p>
          )}
          {target && (
            <div className="target-line">
              <b className="jp">{target.form}</b>
              {meaning && <span className="ellipsis">{meaning}</span>}
            </div>
          )}
          {hasCard && <div className="has-card">You already have a card for this word.</div>}
          {moment.hasAudio && (
            <>
              <audio
                ref={audio}
                src={sound}
                preload="auto"
                onTimeUpdate={(e) => {
                  if (stopAt.current !== undefined && e.currentTarget.currentTime >= stopAt.current) {
                    e.currentTarget.pause();
                    stopAt.current = undefined;
                  }
                }}
              />
              <button className="small swipe-play" onClick={play}>
                <Icon name="play" size={16} /> Play
              </button>
            </>
          )}
        </div>
      </div>
      <div className="action-bar">
        <button className="danger icon-only" disabled={!!leaving} onClick={() => leave('left')} aria-label="Discard">
          <Icon name="trash" size={21} />
        </button>
        <button disabled={!!leaving} onClick={() => navigate(`inbox/${moment.id}`)}>
          Open
        </button>
        <button className="primary" disabled={!!leaving || !plan} onClick={() => leave('right')}>
          Create card
        </button>
      </div>
      <p className="footnote center">Swipe right for a card, left to discard. Tap a word to choose another one.</p>
    </>
  );
}
