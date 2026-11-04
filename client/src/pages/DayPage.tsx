import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { ChevronLeft, ChevronRight } from '../components/icons';
import { QuickAdd } from '../components/QuickAdd';
import { TaskEditor } from '../components/TaskEditor';
import { TaskItem, TaskList } from '../components/TaskItem';
import { addDays, isIsoDate, longDate, relativeDayName } from '../dates';
import { useDay, useToday } from '../queries';
import type { Task } from '../types';

export function DayPage() {
  const today = useToday();
  const { date: param } = useParams();
  if (!today) return <p className="muted center">Loading…</p>;
  if (param && !isIsoDate(param)) return <Navigate to="/" replace />;
  if (param === today) return <Navigate to="/" replace />;
  return <DayView date={param ?? today} today={today} />;
}

function DayView({ date, today }: { date: string; today: string }) {
  const { data, isPending, error } = useDay(date);
  const [editing, setEditing] = useState<Task | null>(null);
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
            {longDate(date, today)}
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

      {!isPast && <QuickAdd scheduledDate={date} />}

      {error && <p className="form-error">{error.message}</p>}
      {isPending && <p className="muted center">Loading…</p>}

      {data && (
        <>
          {data.open.length > 0 ? (
            <TaskList>
              {data.open.map((t) => (
                <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
              ))}
            </TaskList>
          ) : (
            <p className="empty">
              {isPast
                ? 'Nothing was left open on this day.'
                : data.done.length > 0
                  ? 'All done. Nice work.'
                  : 'Nothing planned yet.'}
            </p>
          )}

          {data.done.length > 0 && (
            <>
              <h2 className="section-title">Completed · {data.done.length}</h2>
              <TaskList>
                {data.done.map((t) => (
                  <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
                ))}
              </TaskList>
            </>
          )}
        </>
      )}

      {editing && <TaskEditor task={editing} today={today} onClose={() => setEditing(null)} />}
    </section>
  );
}
