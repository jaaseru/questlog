import { Link, Navigate, useParams } from 'react-router';
import { DayTasks } from '../components/DayTasks';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { addDays, isIsoDate, isoWeek, longDate, relativeDayName, weekdayName } from '../dates';
import { WeekStrip } from '../components/WeekStrip';
import { useLayout } from '../layout';
import { useToday } from '../queries';

export function DayPage() {
  const today = useToday();
  const { date: param } = useParams();
  if (!today) return <p className="muted center">Loading…</p>;
  if (param && !isIsoDate(param)) return <Navigate to="/" replace />;
  if (param === today) return <Navigate to="/" replace />;
  return <DayView date={param ?? today} today={today} />;
}

function DayView({ date, today }: { date: string; today: string }) {
  const isPast = date < today;
  const title = relativeDayName(date, today);
  // "Today" / "Tomorrow" / "Yesterday" don't say which weekday it is, so add it below.
  const weekday = weekdayName(date);
  const dayHref = (d: string) => (d === today ? '/' : `/day/${d}`);
  const layout = useLayout();

  return (
    <section className="page">
      <header className="day-header">
        <Link className="icon-btn" to={dayHref(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeft />
        </Link>
        <div className="day-header__title">
          <h1>{title}</h1>
          <p className="muted">
            {title !== weekday && `${weekday}, `}
            {longDate(date, today)} · Week {isoWeek(date)}
            {isPast && ' · Journal'}
          </p>
        </div>
        <Link className="icon-btn" to={dayHref(addDays(date, 1))} aria-label="Next day">
          <ChevronRight />
        </Link>
      </header>
      {layout === 'a' && <WeekStrip date={date} today={today} />}
      {/* The slot is always there, so nothing moves when the link appears. */}
      <div className="jump-slot">
        {date !== today && (
          <Link to="/" className="back-today">
            Back to today
          </Link>
        )}
      </div>

      <DayTasks date={date} today={today} />
    </section>
  );
}
