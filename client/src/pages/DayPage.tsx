import { Link, Navigate, useParams } from 'react-router';
import { DayTasks } from '../components/DayTasks';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { addDays, isIsoDate, isoWeek, longDate, relativeDayName } from '../dates';
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
  const dayHref = (d: string) => (d === today ? '/' : `/day/${d}`);

  return (
    <section className="page">
      <header className="day-header">
        <Link className="icon-btn" to={dayHref(addDays(date, -1))} aria-label="Previous day">
          <ChevronLeft />
        </Link>
        <div className="day-header__title">
          <h1>{relativeDayName(date, today)}</h1>
          <p className="muted">
            {longDate(date, today)} · Week {isoWeek(date)}
            {isPast && ' · Journal'}
          </p>
        </div>
        <Link className="icon-btn" to={dayHref(addDays(date, 1))} aria-label="Next day">
          <ChevronRight />
        </Link>
      </header>
      {date !== today && (
        <Link to="/" className="back-today">
          Back to today
        </Link>
      )}

      <DayTasks date={date} today={today} />
    </section>
  );
}
