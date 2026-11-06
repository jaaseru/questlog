import { Link } from 'react-router';
import { addDays } from '../dates';
import { useCalendar } from '../queries';

/** Layout A: Monday–Sunday of the shown day's week; tap a day to jump to it. */
export function WeekStrip({ date, today }: { date: string; today: string }) {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addDays(date, -weekday);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const { data } = useCalendar(days[0]!, days[6]!);
  const count = (d: string) =>
    (data?.open.filter((t) => t.scheduledDate === d).length ?? 0) + (data?.upcoming.filter((u) => u.date === d).length ?? 0);

  return (
    <nav className="week-strip" aria-label="This week">
      {days.map((d) => {
        const n = count(d);
        const cls = ['week-strip__day', d === date && 'is-selected', d === today && 'is-today', d < today && 'is-past']
          .filter(Boolean)
          .join(' ');
        return (
          <Link key={d} to={d === today ? '/' : `/day/${d}`} className={cls} aria-current={d === date ? 'date' : undefined}>
            <span className="week-strip__name">
              {new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' })}
            </span>
            <span className="week-strip__num">{Number(d.slice(8))}</span>
            <span className="week-strip__dots" aria-label={n ? `${n} planned` : undefined}>
              {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
