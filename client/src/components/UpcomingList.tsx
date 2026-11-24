import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { addDays, isoWeek, longDate, relativeDayName } from '../dates';
import { useCalendar } from '../queries';
import { PRIORITIES, type Task, type Upcoming } from '../types';
import { QueryError } from './QueryError';
import { TaskEditor } from './TaskEditor';
import { TaskItem, TaskList, UpcomingItem } from './TaskItem';

/** How far ahead the list looks (the calendar endpoint allows up to 62 days per request). */
export const UPCOMING_DAYS = 56;

interface Day {
  date: string;
  tasks: Task[];
  repeats: Upcoming[];
}

const rank = (t: Task) => PRIORITIES.indexOf(t.priority);

/** Calendar "List" view: open tasks from today on, grouped by day, with week headings. */
export function UpcomingList({ today }: { today: string }) {
  const end = addDays(today, UPCOMING_DAYS - 1);
  const { data, error, isPending } = useCalendar(today, end);
  const [editing, setEditing] = useState<Task | null>(null);

  const days = useMemo(() => {
    const map = new Map<string, Day>();
    const day = (date: string) => {
      let d = map.get(date);
      if (!d) map.set(date, (d = { date, tasks: [], repeats: [] }));
      return d;
    };
    const listed = new Set<string>();
    for (const t of data?.open ?? []) {
      day(t.scheduledDate!).tasks.push(t);
      listed.add(t.id);
    }
    // Tasks due in the range but not planned in it (backlog or later) show on their due day.
    for (const t of data?.due ?? []) if (!listed.has(t.id)) day(t.dueDate!).tasks.push(t);
    for (const u of data?.upcoming ?? []) day(u.date).repeats.push(u);
    for (const d of map.values()) d.tasks.sort((a, b) => rank(a) - rank(b));
    return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  return (
    <>
      <QueryError error={error} hasData={Boolean(data)} />
      {isPending && <p className="muted center">Loading…</p>}
      {data && days.length === 0 && <p className="empty">Nothing planned for the next {UPCOMING_DAYS / 7} weeks.</p>}

      <div className="upcoming">
        {days.map((d, i) => {
          const week = isoWeek(d.date);
          const newWeek = i === 0 || isoWeek(days[i - 1]!.date) !== week;
          return (
            <section key={d.date} className="upcoming__day">
              {newWeek && <h2 className="upcoming__week">Week {week}</h2>}
              <h3 className="upcoming__date">
                <Link to={d.date === today ? '/' : `/day/${d.date}`}>
                  <strong>{relativeDayName(d.date, today)}</strong>
                  <span className="muted"> · {longDate(d.date, today)}</span>
                </Link>
              </h3>
              <TaskList>
                {d.tasks.map((t) => (
                  <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
                ))}
                {d.repeats.map((u) => (
                  <UpcomingItem key={`${u.seriesId}-${u.date}`} item={u} />
                ))}
              </TaskList>
            </section>
          );
        })}
      </div>

      {data && days.length > 0 && (
        <p className="muted small center">
          The next {UPCOMING_DAYS / 7} weeks. Tasks in the backlog without a due date aren't listed.
        </p>
      )}

      {editing && <TaskEditor task={editing} today={today} onClose={() => setEditing(null)} />}
    </>
  );
}
