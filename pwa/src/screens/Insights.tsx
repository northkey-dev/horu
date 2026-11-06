import { useState } from 'react';
import { api } from '../lib/api.ts';
import { navigate, usePoll } from '../lib/hooks.ts';
import { Nav } from '../components/Nav.tsx';
import { Icon } from '../components/Icon.tsx';
import { Bars, Heatmap, HourBars, Line, Range, Ring, Stack, WeekdayBars, fmtDay, fmtMinutes, fmtShort, type BarDatum } from '../components/charts.tsx';
import { JLPT_STEPS, SERIES, progress } from '../lib/achievements.ts';
import type { Analytics, DayStat } from '../../../shared/types.ts';

// Progress: streak, daily goal, level, calendar and achievements (Overview), the Anki review history (Anki)
// and what Horu itself mined (Mining).

type Tab = 'overview' | 'anki' | 'mining';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'anki', label: 'Anki' },
  { id: 'mining', label: 'Mining' },
];

function readTab(): Tab {
  try {
    const v = localStorage.getItem('horu-insights-tab');
    return v === 'anki' || v === 'mining' ? v : 'overview';
  } catch {
    return 'overview';
  }
}

const pct = (x: number) => `${Math.round(100 * x)}%`;
const isActive = (d?: DayStat) => !!d && d.reviews + d.marked + d.cards + d.watchBlocks + d.chapters + (d.readBlocks ?? 0) > 0;

export function Insights() {
  const { data, error, refresh } = usePoll(() => api.analytics(), 30_000);
  const [tab, setTab] = useState<Tab>(readTab);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string>();

  function choose(t: Tab) {
    setTab(t);
    try {
      localStorage.setItem('horu-insights-tab', t);
    } catch {
      // private mode
    }
  }

  async function updateAnki() {
    setUpdating(true);
    setUpdateError(undefined);
    try {
      await api.refreshAnki();
      refresh();
    } catch (e) {
      setUpdateError((e as Error).message);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <Nav />
      <h1>Insights</h1>
      <div className="segmented tabs" role="tablist" aria-label="Insights">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => choose(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {error && !data && <div className="banner error" style={{ marginTop: 16 }}>{error.message}</div>}
      {!data && !error && (
        <p className="muted row small" style={{ marginTop: 24 }}>
          <span className="spinner" /> Calculating…
        </p>
      )}
      {data && tab === 'overview' && <Overview a={data} />}
      {data && tab === 'anki' && <AnkiTab a={data} updating={updating} error={updateError} onUpdate={updateAnki} />}
      {data && tab === 'mining' && <Mining a={data} />}
    </div>
  );
}

// ---------------------------------------------------------------- overview

/** The last full week (Monday to Sunday) next to the one before it. */
function WeekReview({ a, weekIdx }: { a: Analytics; weekIdx: number }) {
  const end = a.days.length - 1 - weekIdx; // last day of the previous week
  if (end < 14) return null;
  const last = a.days.slice(end - 6, end + 1);
  const before = a.days.slice(end - 13, end - 6);
  const sum = (days: DayStat[], f: (d: DayStat) => number) => days.reduce((n, d) => n + f(d), 0);
  const xp = sum(last, (d) => d.xp);
  const xpBefore = sum(before, (d) => d.xp);
  if (!xp && !xpBefore) return null;

  const at = (day: string) => a.vocab.filter((p) => p.day <= day).pop();
  const [vNow, vBefore] = [at(last[6].day), at(before[6].day)];
  const words = vNow && vBefore ? vNow.total - vBefore.total : undefined;
  const delta = xp - xpBefore;
  const watched = sum(last, (d) => d.watched);

  return (
    <>
      <div className="section-head">
        <h2>Last week</h2>
        <span className="muted small num">
          {fmtShort(last[0].day)} – {fmtShort(last[6].day)}
        </span>
      </div>
      <div className="tiles">
        <div className="tile">
          <div className="label">XP</div>
          <div className="value">{xp.toLocaleString()}</div>
          <div className="label">{xpBefore ? `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} vs week before` : 'week before: none'}</div>
        </div>
        <div className="tile">
          <div className="label">Days studied</div>
          <div className="value">{last.filter(isActive).length} / 7</div>
        </div>
        <div className="tile">
          <div className="label">New words</div>
          <div className="value">{words === undefined ? '–' : `${words > 0 ? '+' : ''}${words}`}</div>
        </div>
        <div className="tile">
          <div className="label">Reviews · cards</div>
          <div className="value">
            {sum(last, (d) => d.reviews).toLocaleString()} · {sum(last, (d) => d.cards)}
          </div>
          {watched > 0 && <div className="label">{fmtMinutes(watched)} watched</div>}
        </div>
      </div>
    </>
  );
}

/** Known words over time. The server writes one data point per day, so the curve starts the day Horu began recording. */
function VocabGrowth({ a, field = 'total' }: { a: Analytics; field?: 'total' | 'anki' }) {
  const v = a.vocab.map((p) => ({ day: p.day, total: p[field] }));
  if (v.length < 2) {
    return (
      <p className="footnote" style={{ marginTop: 12 }}>
        Horu now records your word count once a day. The growth curve appears from tomorrow.
      </p>
    );
  }
  const gain = (days: number) => {
    const from = v.filter((p) => p.day <= (a.days[Math.max(0, a.days.length - 1 - days)]?.day ?? '')).pop() ?? v[0];
    return v[v.length - 1].total - from.total;
  };
  const sign = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString()}`;
  return (
    <>
      <div className="section-head">
        <h2>Growth</h2>
        <span className="muted small num">
          {sign(gain(7))} this week · {sign(gain(30))} in 30 days
        </span>
      </div>
      <div className="card">
        <Line
          data={v.map((p) => ({ key: p.day, value: p.total, tip: `${fmtDay(p.day)} · ${p.total.toLocaleString()} words` }))}
          label={field === 'anki' ? 'Words from Anki over time' : 'Known words over time'}
          axis={[fmtShort(v[0].day), 'Today']}
        />
      </div>
    </>
  );
}

function Overview({ a }: { a: Analytics }) {
  const [range, setRange] = useState(30);
  const [refreshing, setRefreshing] = useState(false);
  const [known, setKnown] = useState(a.known);
  const today = a.days[a.days.length - 1];

  const weekIdx = (new Date(`${a.today}T12:00:00`).getDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => a.days[a.days.length - 1 - weekIdx + i]);

  const bars: BarDatum[] = a.days.slice(-range).map((d) => ({ key: d.day, value: d.xp, tip: `${fmtDay(d.day)} · ${d.xp} XP` }));
  const weekXp = a.days.slice(-7).reduce((n, d) => n + d.xp, 0);

  const next = JLPT_STEPS.find((s) => s.words > known.total);
  const toGo = a.goal - today.xp;

  async function refreshKnown() {
    setRefreshing(true);
    const k = await api.known(true).catch(() => undefined);
    if (k) setKnown({ total: k.total, anki: k.anki, jlpt: k.jlpt, manual: k.manual });
    setRefreshing(false);
  }

  return (
    <>
      <button className="list-item action-row" style={{ marginBottom: 12 }} onClick={() => navigate('practice')}>
        Practice words and kanji from your marks
      </button>
      <button className="list-item action-row" style={{ marginBottom: 12 }} onClick={() => navigate('kanji')}>
        Kanji collection
      </button>
      <section className="hero">
        <div className="eyebrow">Streak</div>
        <div className="hero-row">
          <span className="hero-num serif num">{a.streak.current}</span>
          <span className="hero-unit">{a.streak.current === 1 ? 'day' : 'days'}</span>
        </div>
        <div className="italic">
          {a.streak.activeToday ? 'Done for today.' : a.streak.current ? 'Study today to keep it going.' : 'Study today to start a streak.'}
          <span className="faint"> · best {a.streak.best}</span>
        </div>
        <div className="week" role="list" aria-label="This week">
          {week.map((d, i) => (
            <div key={i} role="listitem" className={`wk${isActive(d) ? ' on' : ''}${i === weekIdx ? ' today' : ''}${!d ? ' future' : ''}`}>
              <i>{isActive(d) && <Icon name="check" size={15} weight={2.6} />}</i>
              <span>{'MTWTFSS'[i]}</span>
            </div>
          ))}
        </div>
      </section>

      <WeekReview a={a} weekIdx={weekIdx} />

      <h2>Today</h2>
      <div className="goal-row">
        <Ring value={today.xp} goal={a.goal}>
          <b className="serif num">{today.xp}</b>
          <small>of {a.goal} XP</small>
        </Ring>
        <div className="grow">
          <div className="facts">
            <div className="cell">
              <span className="grow muted">Anki reviews</span>
              <span className="num">{today.reviews}</span>
            </div>
            <div className="cell">
              <span className="grow muted">Study time</span>
              <span className="num">{fmtMinutes(today.minutes)}</span>
            </div>
            <div className="cell">
              <span className="grow muted">Marks</span>
              <span className="num">{today.marked}</span>
            </div>
            <div className="cell">
              <span className="grow muted">Cards created</span>
              <span className="num">{today.cards}</span>
            </div>
          </div>
        </div>
      </div>
      <p className="footnote">{toGo > 0 ? `${toGo} XP to your daily goal.` : 'Daily goal reached.'} Change the goal in Settings.</p>

      <h2>Level</h2>
      <div className="level">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="serif lvl num">{a.level.n}</span>
          <span className="grow muted">Level</span>
          <span className="num muted">{a.level.xp.toLocaleString()} XP</span>
        </div>
        <div className="meter">
          <div style={{ width: pct((a.level.xp - a.level.from) / (a.level.to - a.level.from)) }} />
        </div>
        <p className="footnote" style={{ marginTop: 6 }}>
          {(a.level.to - a.level.xp).toLocaleString()} XP to level {a.level.n + 1}. This week: <b className="num">{weekXp}</b> XP.
        </p>
      </div>

      <h2>Activity</h2>
      <div className="card">
        <Heatmap days={a.days} goal={a.goal} />
      </div>

      <div className="section-head">
        <h2>XP per day</h2>
        <Range value={range} onChange={setRange} />
      </div>
      <div className="card">
        <Bars data={bars} goal={a.goal} label={`XP per day, last ${range} days`} axis={[fmtShort(bars[0].key), 'Today']} />
      </div>
      <p className="footnote">1 XP per Anki review · 3 per mark · 10 per card · 15 per manga chapter · 5 per 5 minutes of watching (leftover minutes carry over to the next episode) · 5 per 250 words read. The dashed line is your daily goal.</p>

      <h2>Vocabulary</h2>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="serif lvl num">{known.total.toLocaleString()}</span>
          <span className="muted">words you probably know</span>
        </div>
        <Ladder total={known.total} />
        <p className="footnote" style={{ marginTop: 8 }}>
          {next ? `About ${(next.words - known.total).toLocaleString()} words to the ${next.level} level.` : 'Beyond the usual N1 vocabulary.'} The JLPT sizes are rough guides.
        </p>
      </div>
      <VocabGrowth a={a} />
      <div className="group" style={{ marginTop: 12 }}>
        <div className="cell">
          <span className="grow">From reviewed Anki cards</span>
          <span className="value num">{known.anki.toLocaleString()}</span>
        </div>
        <div className="cell">
          <span className="grow">JLPT N5 and N4 baseline</span>
          <span className="value num">{known.jlpt.toLocaleString()}</span>
        </div>
        <div className="cell">
          <span className="grow">Marked by you</span>
          <span className="value num">{known.manual.toLocaleString()}</span>
        </div>
        <button className="list-item action-row" disabled={refreshing} onClick={refreshKnown}>
          {refreshing ? 'Reading Anki…' : 'Refresh from Anki'}
        </button>
      </div>
      <p className="footnote">Used for episode difficulty, the pre-watch word list and target-word suggestions. Tap “Know it” in any dictionary popup to improve it.</p>

      <h2>Achievements</h2>
      <div className="ach">
        {SERIES.map((s) => {
          const p = progress(s, a);
          return (
            <div key={s.id} className={`ach-item${p.reached ? ' got' : ''}`}>
              <div className="stamp" aria-hidden="true">
                <b className="jp">{s.kanji}</b>
                {p.reached > 0 && <small>{p.roman}</small>}
              </div>
              <div className="grow">
                <div className="ach-title">
                  {s.title}
                  {p.label && <span className="muted"> · {p.label}</span>}
                </div>
                <div className="progress" style={{ margin: '6px 0 5px' }}>
                  <div style={{ width: pct(p.fraction) }} />
                </div>
                <div className="meta num">{p.next === undefined ? 'All tiers reached' : `${p.value.toLocaleString()} / ${p.next.toLocaleString()} ${s.unit}`}</div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Scale 0–10,000 words with the JLPT levels marked. */
function Ladder({ total }: { total: number }) {
  const max = JLPT_STEPS[JLPT_STEPS.length - 1].words;
  return (
    <div className="ladder" role="img" aria-label={`${total} words, JLPT levels from N5 at ${JLPT_STEPS[0].words}`}>
      <div className="ladder-track">
        <div style={{ width: pct(Math.min(1, total / max)) }} />
        {JLPT_STEPS.map((s) => (
          <i key={s.level} className={total >= s.words ? 'got' : ''} style={{ left: pct(s.words / max) }} />
        ))}
      </div>
      <div className="ladder-labels">
        {JLPT_STEPS.map((s) => (
          <span key={s.level} className={total >= s.words ? 'got' : ''} style={{ left: pct(s.words / max) }}>
            {s.level}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Anki

type Metric = 'reviews' | 'minutes' | 'learned';
const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'reviews', label: 'Reviews', unit: 'reviews' },
  { id: 'minutes', label: 'Minutes', unit: 'min' },
  { id: 'learned', label: 'New cards', unit: 'new cards' },
];

function AnkiTab({ a, updating, error, onUpdate }: { a: Analytics; updating: boolean; error?: string; onUpdate: () => void }) {
  const quiet = a.days.slice(-30).every((x) => x.reviews === 0) && a.days.slice(-90).some((x) => x.reviews > 0);
  const [range, setRange] = useState(quiet ? 90 : 30);
  const [metric, setMetric] = useState<Metric>('reviews');
  const d = a.anki.data;

  if (!d)
    return (
      <div className="empty">
        <span className="glyph jp" aria-hidden="true">
          復
        </span>
        <b>No Anki history yet</b>
        <p>Horu reads your review history from Anki: reviews, study time, retention and what is due next.</p>
        {error && <div className="banner error" style={{ marginTop: 16, textAlign: 'left' }}>{error}</div>}
        <button className="primary" style={{ marginTop: 20 }} disabled={updating} onClick={onUpdate}>
          {updating ? (
            <>
              <span className="spinner" style={{ borderTopColor: 'var(--bg)' }} /> Starting Anki…
            </>
          ) : (
            'Start Anki and read history'
          )}
        </button>
      </div>
    );

  const m = METRICS.find((x) => x.id === metric)!;
  const bars: BarDatum[] = a.days.slice(-range).map((day) => ({
    key: day.day,
    value: day[metric],
    tip: `${fmtDay(day.day)} · ${metric === 'minutes' ? fmtMinutes(day.minutes) : `${day[metric]} ${m.unit}`}`,
  }));

  const answers30 = d.answers30.again + d.answers30.hard + d.answers30.good + d.answers30.easy;
  const answers = answers30 > 0 ? d.answers30 : d.answersAll;
  const answerWindow = answers30 > 0 ? 'last 30 days' : 'all time';
  const retention = d.retention30 ?? d.retentionAll;
  const states = d.states;
  const asOf = new Date(a.anki.asOf ?? d.asOf);

  return (
    <>
      <div className="source-row">
        <span className={`status ${a.anki.status === 'live' ? 'ok' : 'warn'}`}>
          <span className="dot" />
          {a.anki.status === 'live' ? 'Up to date' : a.anki.online ? 'Updating in the background' : `Anki is not running · as of ${asOf.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`}
        </span>
        <button className="small" disabled={updating} onClick={onUpdate}>
          {updating ? <span className="spinner" /> : <Icon name="sync" size={15} />} Update
        </button>
      </div>
      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}

      <div className="tiles">
        <div className="tile">
          <div className="label">Reviews</div>
          <div className="value">{d.totals.reviews.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Study time</div>
          <div className="value">
            {d.totals.minutes >= 60 ? (
              <>
                {Math.floor(d.totals.minutes / 60)} h {d.totals.minutes % 60}
                <small>min</small>
              </>
            ) : (
              <>
                {d.totals.minutes}
                <small>min</small>
              </>
            )}
          </div>
        </div>
        <div className="tile">
          <div className="label">Retention{retention !== null ? (d.retention30 !== null ? ' · 30 days' : ' · all time') : ''}</div>
          <div className="value">{retention !== null ? pct(retention) : '–'}</div>
        </div>
        <div className="tile">
          <div className="label">Cards studied</div>
          <div className="value">{d.totals.cardsReviewed.toLocaleString()}</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Per day</h2>
        <Range value={range} onChange={setRange} />
      </div>
      <div className="segmented" style={{ marginBottom: 10 }} role="radiogroup" aria-label="Metric">
        {METRICS.map((x) => (
          <button key={x.id} role="radio" aria-checked={metric === x.id} className={metric === x.id ? 'on' : ''} onClick={() => setMetric(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="card">
        <Bars data={bars} label={`${m.label} per day, last ${range} days`} axis={[fmtShort(bars[0].key), 'Today']} />
      </div>

      <h2>Words from Anki</h2>
      <div className="card">
        <div className="row" style={{ alignItems: 'baseline' }}>
          <span className="serif lvl num">{a.known.anki.toLocaleString()}</span>
          <span className="muted">words in your reviewed cards</span>
        </div>
        <p className="footnote" style={{ marginTop: 8 }}>
          Japanese words found on cards you have studied{a.anki.data?.scope ? ` (${a.anki.data.scope})` : ''}, without the JLPT baseline and without words you marked yourself.
        </p>
      </div>
      <VocabGrowth a={a} field="anki" />

      <h2>Your cards</h2>
      <div className="card">
        <Stack
          label="Card maturity"
          segments={[
            { label: 'Learning', value: states.learning, tone: 'accent' },
            { label: 'Young', value: states.young, tone: 'mid' },
            { label: 'Mature', value: states.mature, tone: 'ink' },
          ]}
        />
      </div>
      <p className="footnote">
        Young is an interval under 21 days, mature 21 days or more. {states.suspended.toLocaleString()} suspended · {states.unseen.toLocaleString()} not started yet.
      </p>

      <h2>Answers · {answerWindow}</h2>
      <div className="card">
        <Stack
          label="Answer buttons"
          segments={[
            { label: 'Again', value: answers.again, tone: 'accent' },
            { label: 'Hard', value: answers.hard, tone: 'soft' },
            { label: 'Good', value: answers.good, tone: 'mid' },
            { label: 'Easy', value: answers.easy, tone: 'ink' },
          ]}
        />
      </div>

      <h2>Due in the next 14 days</h2>
      <div className="card">
        <Bars
          label="Cards due per day"
          highlightLast={false}
          axis={['Today', 'In 13 days']}
          data={d.forecast.map((n, i) => ({
            key: String(i),
            value: n,
            tip: `${i === 0 ? 'Today, incl. overdue' : i === 1 ? 'Tomorrow' : `In ${i} days`} · ${n} cards`,
          }))}
        />
      </div>

      <h2>When you study</h2>
      <div className="card">
        <HourBars hours={d.hours} unit="reviews" label="Reviews by hour of day" />
      </div>
      <p className="footnote">Last 180 days, by time of day.</p>

      {d.weakKanji && d.weakKanji.length > 0 && (
        <>
          <h2>Kanji behind your lapses</h2>
          <div className="group">
            {d.weakKanji.map((k) => (
              <div key={k.kanji} className="cell">
                <span className="jp" style={{ fontSize: 28, width: 40, textAlign: 'center' }}>
                  {k.kanji}
                </span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="jp ellipsis">{k.example}</div>
                  <div className="meta">on {k.cards} forgotten cards</div>
                </div>
                <span className="trail num">{k.lapses}× again</span>
              </div>
            ))}
          </div>
          <p className="footnote">Kanji that appear on at least two cards you have failed repeatedly. Worth writing out or learning on their own.</p>
        </>
      )}

      <h2>Cards you keep forgetting</h2>
      {d.hardest.length ? (
        <div className="group">
          {d.hardest.map((c, i) => (
            <div key={i} className="cell">
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="jp ellipsis" style={{ fontSize: 17 }}>
                  {c.text || '(empty card)'}
                </div>
                <div className="meta ellipsis">{c.deck} · interval {c.interval} d</div>
              </div>
              <span className="trail num">{c.lapses}× again</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="footnote">No card has failed twice yet.</p>
      )}
      <p className="footnote" style={{ marginTop: 18 }}>
        {d.scope ? (
          <>
            Only cards matching <code>{d.scope}</code>.
          </>
        ) : (
          'All decks.'
        )}{' '}
        Change the scope in Settings → Known words.
      </p>
    </>
  );
}

// ---------------------------------------------------------------- mining

function Mining({ a }: { a: Analytics }) {
  const [range, setRange] = useState(30);
  const t = a.totals;
  const h = a.horu;
  const bars: BarDatum[] = a.days.slice(-range).map((d) => ({
    key: d.day,
    value: d.marked,
    part: d.cards,
    tip: `${fmtDay(d.day)} · ${d.marked} marks · ${d.cards} cards`,
  }));
  const other = Math.max(0, t.marked - t.cards - t.discarded - t.inbox);
  const topKind = Math.max(1, ...h.byKind.map((k) => k.marked));

  return (
    <>
      <div className="tiles">
        <div className="tile">
          <div className="label">Moments marked</div>
          <div className="value">{t.marked.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Cards created</div>
          <div className="value">{t.cards.toLocaleString()}</div>
        </div>
        <div className="tile">
          <div className="label">Marks turned into cards</div>
          <div className="value">{t.marked ? pct(t.cards / t.marked) : '–'}</div>
        </div>
        <div className="tile">
          <div className="label">Waiting in inbox</div>
          <div className="value">{t.inbox}</div>
        </div>
      </div>

      <div className="section-head">
        <h2>Marks per day</h2>
        <Range value={range} onChange={setRange} />
      </div>
      <div className="card">
        <Bars data={bars} label={`Marks per day, last ${range} days`} axis={[fmtShort(bars[0].key), 'Today']} />
      </div>
      <p className="footnote">The dark part of a bar is what became a card.</p>

      <h2>What happened to your marks</h2>
      <div className="card">
        <Stack
          label="Fate of marked moments"
          segments={[
            { label: 'Cards', value: t.cards, tone: 'ink' },
            { label: 'Inbox', value: t.inbox, tone: 'mid' },
            { label: 'Discarded', value: t.discarded, tone: 'soft' },
            ...(other ? [{ label: 'Other', value: other, tone: 'faint' as const }] : []),
          ]}
        />
      </div>

      {h.byKind.length > 0 && (
        <>
          <h2>Sources</h2>
          <div className="group">
            {h.byKind.map((k) => (
              <div key={k.kind} className="cell bar-row" style={{ display: 'block' }}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon name={k.kind === 'manga' ? 'book' : k.kind === 'screen' ? 'phone' : 'watch'} size={17} className="muted" />
                  <span className="grow">{k.kind === 'anime' ? 'Anime' : k.kind === 'manga' ? 'Manga' : 'Screenshots'}</span>
                  <span className="muted num small">
                    {k.cards} / {k.marked}
                  </span>
                </div>
                <div className="bar" style={{ marginTop: 8 }}>
                  <div style={{ width: pct(k.marked / topKind) }} />
                </div>
              </div>
            ))}
          </div>
          <p className="footnote">Cards / marks</p>
        </>
      )}

      <h2>Watching and reading</h2>
      <div className="group">
        <div className="cell">
          <span className="grow">Episodes watched</span>
          <span className="value num">{t.episodes}</span>
        </div>
        <div className="cell">
          <span className="grow">Manga chapters finished</span>
          <span className="value num">{t.chapters}</span>
        </div>
        <div className="cell">
          <span className="grow">Words prepared with a card</span>
          <span className="value num">{t.prepared}</span>
        </div>
        <div className="cell">
          <span className="grow">Time watched</span>
          <span className="value num">{t.watchMinutes ? fmtMinutes(t.watchMinutes) : '–'}</span>
        </div>
        <div className="cell">
          <span className="grow">Words read</span>
          <span className="value num">{t.wordsRead ? t.wordsRead.toLocaleString() : '–'}</span>
        </div>
      </div>
      {h.watched.length > 0 && (
        <>
          <h2>Time per anime</h2>
          <div className="group">
            {h.watched.map((w) => (
              <div key={w.title} className="cell" style={{ display: 'block' }}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon name="watch" size={17} className="muted" />
                  <span className="grow ellipsis jp">{w.title}</span>
                  <span className="muted num small">{fmtMinutes(w.minutes)}</span>
                </div>
                <div className="muted small" style={{ marginTop: 4, paddingLeft: 25 }}>
                  {w.episodes.map((e) => `Ep ${e.episode} · ${fmtMinutes(e.minutes)}`).join('   ')}
                </div>
              </div>
            ))}
          </div>
          <p className="footnote">Counted while the extension records and the video is playing.</p>
        </>
      )}

      <h2>When you mark</h2>
      <div className="card">
        <HourBars hours={h.hours} unit="marks" label="Marks by hour of day" />
      </div>
      <h2>Which days</h2>
      <div className="card">
        <WeekdayBars values={h.weekdays} unit="marks" />
      </div>

      {h.titles.length > 0 && (
        <>
          <h2>Where your cards come from</h2>
          <div className="group">
            {h.titles.map((x) => (
              <div key={x.kind + x.title} className="cell">
                <Icon name={x.kind === 'manga' ? 'book' : x.kind === 'screen' ? 'phone' : 'watch'} size={17} className="muted" />
                <span className="grow ellipsis jp">{x.title}</span>
                <span className="muted num small">
                  {x.cards} / {x.marked}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
