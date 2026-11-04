import { useState } from 'react';
import type { DayStat } from '../../../shared/types.ts';

// Small chart set for the analytics pages: plain DOM/SVG, themed through CSS variables.

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dateOf = (day: string) => new Date(`${day}T12:00:00`);

export const fmtDay = (day: string) => dateOf(day).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
export const fmtShort = (day: string) => dateOf(day).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function fmtMinutes(min: number): string {
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

// ---------------------------------------------------------------- range selector

export function Range({ value, onChange, options = [7, 30, 90] }: { value: number; onChange: (n: number) => void; options?: number[] }) {
  return (
    <div className="segmented range" role="radiogroup" aria-label="Time range">
      {options.map((n) => (
        <button key={n} role="radio" aria-checked={value === n} className={value === n ? 'on' : ''} onClick={() => onChange(n)}>
          {n} days
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- bars

export type BarDatum = { key: string; value: number; /** part of `value` drawn darker (e.g. cards out of marks) */ part?: number; tip: string };

/** Vertical bars with a tap/hover tooltip; an optional dashed goal line. */
export function Bars({
  data,
  goal,
  label,
  height = 132,
  axis,
  highlightLast = true,
}: {
  data: BarDatum[];
  goal?: number;
  label: string;
  height?: number;
  axis?: [string, string];
  highlightLast?: boolean;
}) {
  const [active, setActive] = useState<number>();
  const max = Math.max(1, goal ?? 0, ...data.map((d) => d.value));
  return (
    <div>
      <div
        className={`chart${data.length > 45 ? ' dense' : ''}${data.some((d) => d.part !== undefined) ? ' layered' : ''}${highlightLast ? '' : ' plain'}${active !== undefined ? ' has-active' : ''}`}
        style={{ height }}
        role="img"
        aria-label={label}
        onMouseLeave={() => setActive(undefined)}
      >
        {goal ? <i className="goal-line" style={{ bottom: `${(100 * goal) / max}%` }} aria-hidden="true" /> : null}
        {data.map((d, i) => (
          <div key={d.key} className={`col${active === i ? ' on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => setActive(active === i ? undefined : i)}>
            <div className={`bar${d.value ? '' : ' zero'}`} style={{ height: `${(100 * d.value) / max}%` }}>
              {d.part ? <i style={{ height: `${(100 * d.part) / Math.max(1, d.value)}%` }} /> : null}
            </div>
            {active === i && (
              <div className="chart-tip" style={i < 3 ? { left: 0, transform: 'translateY(-100%)' } : i > data.length - 4 ? { right: 0, transform: 'translateY(-100%)' } : { left: '50%' }}>
                {d.tip}
              </div>
            )}
          </div>
        ))}
      </div>
      {axis && (
        <div className="chart-axis">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
    </div>
  );
}

export type LinePoint = { key: string; value: number; tip: string };

/** Line with a soft area below it and a tap/hover tooltip; the y axis starts below the lowest value so small growth stays visible. */
export function Line({ data, label, height = 132, axis }: { data: LinePoint[]; label: string; height?: number; axis?: [string, string] }) {
  const [active, setActive] = useState<number>();
  const W = 100;
  const lo = Math.min(...data.map((d) => d.value));
  const hi = Math.max(...data.map((d) => d.value));
  const pad = Math.max(5, Math.round((hi - lo) * 0.15));
  const [min, max] = [Math.max(0, lo - pad), hi + pad];
  const x = (i: number) => (data.length < 2 ? W / 2 : (W * i) / (data.length - 1));
  const y = (v: number) => height - 8 - ((height - 16) * (v - min)) / Math.max(1, max - min);
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(d.value).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="line-chart" style={{ height }} role="img" aria-label={label} onMouseLeave={() => setActive(undefined)}>
        <svg viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={`${path} L${x(data.length - 1)} ${height} L${x(0)} ${height} Z`} className="area" />
          <path d={path} className="stroke" vectorEffect="non-scaling-stroke" />
        </svg>
        {data.map((d, i) => (
          <div key={d.key} className={`pt${active === i || (active === undefined && i === data.length - 1) ? ' on' : ''}`} style={{ left: `${x(i)}%`, top: y(d.value) }}>
            <i />
          </div>
        ))}
        {data.map((d, i) => (
          <div
            key={d.key}
            className="hit"
            style={{ left: `${x(i) - W / data.length / 2}%`, width: `${W / data.length}%` }}
            onMouseEnter={() => setActive(i)}
            onClick={() => setActive(active === i ? undefined : i)}
          />
        ))}
        {active !== undefined && (
          <div className="chart-tip" style={active < 3 ? { left: 0, transform: 'none' } : active > data.length - 4 ? { right: 0, transform: 'none' } : { left: `${x(active)}%` }}>
            {data[active].tip}
          </div>
        )}
      </div>
      {axis && (
        <div className="chart-axis">
          <span>{axis[0]}</span>
          <span>{axis[1]}</span>
        </div>
      )}
    </div>
  );
}

/** One bar per hour of the day; the busiest hour is drawn in the accent colour. */
export function HourBars({ hours, unit, label }: { hours: number[]; unit: string; label: string }) {
  const [active, setActive] = useState<number>();
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  const info = active ?? (Math.max(...hours) > 0 ? peak : undefined);
  return (
    <div>
      <div className="chart hours" style={{ height: 96 }} role="img" aria-label={label}>
        {hours.map((v, h) => (
          <div key={h} className={`col${active === h ? ' on' : ''}`} onClick={() => setActive(active === h ? undefined : h)}>
            <div className={`bar${v ? '' : ' zero'}${h === peak && v ? ' peak' : ''}`} style={{ height: `${(100 * v) / max}%` }} />
          </div>
        ))}
      </div>
      <div className="chart-axis hour-axis">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
      {info !== undefined && (
        <p className="footnote" style={{ marginTop: 6 }}>
          {pad(info)}:00–{pad((info + 1) % 24)}:00 · <b className="num">{hours[info].toLocaleString()}</b> {unit}
          {active === undefined && ' (busiest hour)'}
        </p>
      )}
    </div>
  );
}

/** Weekday bars, Monday first. */
export function WeekdayBars({ values, unit }: { values: number[]; unit: string }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const names = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  return (
    <div className="weekday" role="img" aria-label={`${unit} per weekday`}>
      {values.map((v, i) => (
        <div key={i} className="wd">
          <div className="wd-bar">
            <div className={i === peak && v ? 'peak' : ''} style={{ height: `${(100 * v) / max}%` }} />
          </div>
          <span className="num">{v}</span>
          <b>{names[i]}</b>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- stacked bar

export type Segment = { label: string; value: number; tone: 'accent' | 'ink' | 'mid' | 'soft' | 'faint' };

export function Stack({ segments, label }: { segments: Segment[]; label: string }) {
  const total = Math.max(1, segments.reduce((n, s) => n + s.value, 0));
  return (
    <div>
      <div className="stack-bar" role="img" aria-label={label}>
        {segments
          .filter((s) => s.value > 0)
          .map((s) => (
            <i key={s.label} className={`tone-${s.tone}`} style={{ width: `${(100 * s.value) / total}%` }} />
          ))}
      </div>
      <div className="legend">
        {segments.map((s) => (
          <span key={s.label}>
            <i className={`swatch tone-${s.tone}`} />
            {s.label} <b className="num">{s.value.toLocaleString()}</b>
            <span className="muted num"> · {Math.round((100 * s.value) / total)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- ring

/** Progress ring (daily goal). Draws the accent arc clockwise from the top. */
export function Ring({ value, goal, size = 124, children }: { value: number; goal: number; size?: number; children?: React.ReactNode }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const done = goal > 0 && value >= goal;
  const fraction = goal > 0 ? Math.min(1, value / goal) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={`${value} of ${goal} XP today`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="7" className="ring-track" />
        {fraction > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            strokeWidth="7"
            strokeLinecap="round"
            className={`ring-arc${done ? ' done' : ''}`}
            strokeDasharray={`${c * fraction} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="ring-center">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------- calendar heat map

const levelOf = (xp: number, goal: number) => (xp <= 0 ? 0 : xp >= goal ? 4 : xp >= goal * 0.5 ? 3 : xp >= goal * 0.25 ? 2 : 1);

/** 26 weeks, one column per week (Monday on top), shaded by XP relative to the daily goal. */
export function Heatmap({ days, goal, weeks = 26 }: { days: DayStat[]; goal: number; weeks?: number }) {
  const [active, setActive] = useState<string>();
  const lastDay = days[days.length - 1].day;
  const last = dateOf(lastDay);
  const monday = (last.getDay() + 6) % 7;
  const start = new Date(last);
  start.setDate(start.getDate() - monday - (weeks - 1) * 7);
  const byDay = new Map(days.map((d) => [d.day, d]));

  const cells: { key: string; day?: DayStat; future: boolean }[] = [];
  const months: { col: number; name: string }[] = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      const key = isoOf(date);
      cells.push({ key, day: byDay.get(key), future: key > lastDay });
      if (d === 0 && date.getDate() <= 7) months.push({ col: w, name: date.toLocaleDateString('en-GB', { month: 'short' }) });
    }
  }
  const shown = byDay.get(active ?? lastDay);
  return (
    <div>
      <div className="heat-months" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr)` }} aria-hidden="true">
        {months.map((m) => (
          <span key={m.col} style={{ gridColumn: `${m.col + 1} / span 4` }}>
            {m.name}
          </span>
        ))}
      </div>
      <div className="heat" style={{ gridAutoColumns: '1fr' }} role="grid" aria-label="Activity calendar">
        {cells.map((c) =>
          c.future ? (
            <i key={c.key} className="hm future" />
          ) : (
            <button
              key={c.key}
              className={`hm lvl-${levelOf(c.day?.xp ?? 0, goal)}${c.key === lastDay ? ' today' : ''}${active === c.key ? ' on' : ''}`}
              aria-label={`${fmtDay(c.key)}: ${c.day?.xp ?? 0} XP`}
              onClick={() => setActive(active === c.key ? undefined : c.key)}
            />
          ),
        )}
      </div>
      <div className="heat-foot">
        <span className="footnote" style={{ margin: 0 }}>
          {shown ? (
            <>
              <b>{fmtDay(shown.day)}</b> · <span className="num">{shown.xp}</span> XP
              {shown.reviews > 0 && ` · ${shown.reviews} reviews`}
              {shown.marked > 0 && ` · ${shown.marked} marks`}
              {shown.cards > 0 && ` · ${shown.cards} cards`}
              {shown.episodes > 0 && ` · ${shown.episodes} ep.`}
              {shown.chapters > 0 && ` · ${shown.chapters} ch.`}
            </>
          ) : null}
        </span>
        <span className="heat-legend" aria-hidden="true">
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <i key={l} className={`hm lvl-${l}`} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}
