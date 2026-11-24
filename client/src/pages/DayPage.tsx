import { useCallback, useRef } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { DayTasks } from '../components/DayTasks';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { addDays, isIsoDate, isoWeek, longDate, relativeDayName, weekdayName } from '../dates';
import { useToday } from '../queries';
import { useSwipeNav } from '../useSwipeNav';

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

  // Swipe left for the next day, right for the previous one. The direction rides along in the
  // navigation state so the new day slides in from the matching side.
  const navigate = useNavigate();
  const { state } = useLocation() as { state: { slide?: 'next' | 'prev' } | null };
  const swipeArea = useRef<HTMLElement>(null);
  const onNext = useCallback(
    () => navigate(dayHref(addDays(date, 1)), { state: { slide: 'next' } }),
    [date, today, navigate],
  );
  const onPrev = useCallback(
    () => navigate(dayHref(addDays(date, -1)), { state: { slide: 'prev' } }),
    [date, today, navigate],
  );
  useSwipeNav(swipeArea, { onNext, onPrev });

  return (
    <section ref={swipeArea} key={date} className={`page swipe-area${state?.slide ? ` slide-in-${state.slide}` : ''}`}>
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
