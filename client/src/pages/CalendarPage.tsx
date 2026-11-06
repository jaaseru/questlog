import { Fragment, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, ChevronRight } from '../components/icons';
import {
  addMonths,
  isIsoMonth,
  isoWeek,
  longDate,
  monthGrid,
  monthLabel,
  weekdayNames,
} from '../dates';
import { useCalendar, useToday } from '../queries';
import type { Task, Upcoming } from '../types';

interface DayEntries {
  done: Task[];
  open: Task[];
  due: Task[];
  missed: Task[];
  upcoming: Upcoming[];
}

const EMPTY: DayEntries = { done: [], open: [], due: [], missed: [], upcoming: [] };
const MAX_TITLES = 3;

export function CalendarPage() {
  const today = useToday();
  if (!today) return <p className="muted center">Loading…</p>;
  return <CalendarView today={today} />;
}

function CalendarView({ today }: { today: string }) {
  const [params, setParams] = useSearchParams();
  const monthParam = params.get('month');
  const thisMonth = today.slice(0, 7);
  const month = monthParam && isIsoMonth(monthParam) ? monthParam : thisMonth;

  const grid = useMemo(() => monthGrid(month), [month]);
  const { data, error } = useCalendar(grid[0]!, grid[grid.length - 1]!);

  const byDay = useMemo(() => {
    const map = new Map<string, DayEntries>();
    const entry = (date: string) => {
      let e = map.get(date);
      if (!e) map.set(date, (e = { done: [], open: [], due: [], missed: [], upcoming: [] }));
      return e;
    };
    for (const t of data?.done ?? []) entry(t.completedOn!).done.push(t);
    for (const t of data?.open ?? []) entry(t.scheduledDate!).open.push(t);
    // A deadline is only worth its own marker when the task isn't already listed on that day.
    for (const t of data?.due ?? []) if (t.scheduledDate !== t.dueDate) entry(t.dueDate!).due.push(t);
    for (const t of data?.missed ?? []) entry(t.scheduledDate!).missed.push(t);
    for (const u of data?.upcoming ?? []) entry(u.date).upcoming.push(u);
    return map;
  }, [data]);

  // The month lives in the URL, so going back from a day returns to the same month.
  const showMonth = (m: string) => setParams(m === thisMonth ? {} : { month: m }, { replace: true });

  return (
    <section className="page page--wide">
      <header className="day-header">
        <button className="icon-btn" onClick={() => showMonth(addMonths(month, -1))} aria-label="Previous month">
          <ChevronLeft />
        </button>
        <div className="day-header__title">
          <h1>{monthLabel(month)}</h1>
        </div>
        <button className="icon-btn" onClick={() => showMonth(addMonths(month, 1))} aria-label="Next month">
          <ChevronRight />
        </button>
      </header>
      <div className="jump-slot">
        {month !== thisMonth && (
          <button className="back-today link-btn" onClick={() => showMonth(thisMonth)}>
            Back to this month
          </button>
        )}
      </div>

      {error && <p className="form-error">{error.message}</p>}

      <div className="calendar" role="group" aria-label={monthLabel(month)}>
        <div className="calendar__weekno calendar__weekno--head" aria-hidden>
          Wk
        </div>
        {weekdayNames().map((name) => (
          <div key={name} className="calendar__weekday" aria-hidden>
            {name}
          </div>
        ))}
        {grid.map((date, i) => (
          <Fragment key={date}>
            {i % 7 === 0 && (
              <div className="calendar__weekno" aria-label={`Week ${isoWeek(date)}`}>
                {isoWeek(date)}
              </div>
            )}
            <CalendarCell
              date={date}
              today={today}
              inMonth={date.startsWith(month)}
              entries={byDay.get(date) ?? EMPTY}
            />
          </Fragment>
        ))}
      </div>

      <div className="legend" aria-hidden>
        <span className="legend__item">
          <i className="dot dot--done" /> Completed
        </span>
        <span className="legend__item">
          <i className="dot dot--open" /> Planned
        </span>
        <span className="legend__item">
          <i className="dot dot--due" /> Due
        </span>
        <span className="legend__item">
          <i className="dot dot--missed" /> Missed
        </span>
      </div>

    </section>
  );
}

interface CellProps {
  date: string;
  today: string;
  inMonth: boolean;
  entries: DayEntries;
}

/** One day in the grid; tapping it opens that day's page. */
function CalendarCell({ date, today, inMonth, entries }: CellProps) {
  const { done, open, due, missed, upcoming } = entries;
  // Upcoming repeats count as planned: they become real tasks when the day comes.
  const planned = open.length + upcoming.length;
  const titles = [
    ...open.map((t) => ({ key: t.id, title: t.title, priority: t.priority, kind: 'open' as const })),
    ...upcoming.map((u) => ({ key: u.seriesId, title: u.title, priority: u.priority, kind: 'upcoming' as const })),
    ...due.map((t) => ({ key: t.id, title: t.title, priority: t.priority, kind: 'due' as const })),
    ...done.map((t) => ({ key: t.id, title: t.title, priority: t.priority, kind: 'done' as const })),
    ...missed.map((t) => ({ key: t.id, title: t.title, priority: t.priority, kind: 'missed' as const })),
  ];
  const summary = [
    done.length && `${done.length} completed`,
    planned && `${planned} planned`,
    due.length && `${due.length} due`,
    missed.length && `${missed.length} missed`,
  ]
    .filter(Boolean)
    .join(', ');

  const classes = [
    'calendar__day',
    !inMonth && 'is-outside',
    date === today && 'is-today',
    date < today && 'is-past',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Link
      to={date === today ? '/' : `/day/${date}`}
      className={classes}
      aria-label={`${longDate(date, today)}${date === today ? ' (today)' : ''}${summary ? `: ${summary}` : ''}`}
    >
      <span className="calendar__num">{Number(date.slice(8))}</span>

      {/* Phones: compact markers */}
      <span className="calendar__dots" aria-hidden>
        {done.length > 0 && <span className="count count--done">{done.length}</span>}
        {planned > 0 && <span className="count count--open">{planned}</span>}
        {due.length > 0 && <i className="dot dot--due" />}
        {missed.length > 0 && <i className="dot dot--missed" />}
      </span>

      {/* Wider screens: the first few titles */}
      <span className="calendar__titles" aria-hidden>
        {titles.slice(0, MAX_TITLES).map(({ key, title, priority, kind }) => (
          <span key={`${kind}-${key}`} className={`calendar__title calendar__title--${kind} priority-${priority}`}>
            {title}
          </span>
        ))}
        {titles.length > MAX_TITLES && <span className="calendar__more">+{titles.length - MAX_TITLES} more</span>}
      </span>
    </Link>
  );
}
