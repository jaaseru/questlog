import { useState } from 'react';
import { useDay } from '../queries';
import type { Task } from '../types';
import { QuickAdd } from './QuickAdd';
import { TaskEditor } from './TaskEditor';
import { TaskItem, TaskList, UpcomingItem } from './TaskItem';
import { WeatherCard } from './WeatherCard';

interface Props {
  date: string;
  today: string;
  /** Open tasks due on this day that live on another list; shown as deadline reminders. */
  dueElsewhere?: Task[];
}

/** One day's quick-add, open list and completed list: shared by the Day page and the calendar agenda. */
export function DayTasks({ date, today, dueElsewhere = [] }: Props) {
  const { data, isPending, error } = useDay(date);
  const [editing, setEditing] = useState<Task | null>(null);
  const isPast = date < today;

  return (
    <>
      {!isPast && <QuickAdd scheduledDate={date} />}

      {error && <p className="form-error">{error.message}</p>}
      {isPending && <p className="muted center">Loading…</p>}

      {data && (
        <>
          {data.open.length > 0 || data.upcoming.length > 0 ? (
            <TaskList>
              {data.open.map((t) => (
                <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
              ))}
              {data.upcoming.map((u) => (
                <UpcomingItem key={`${u.seriesId}-${u.date}`} item={u} />
              ))}
            </TaskList>
          ) : isPast && (data.missed.length > 0 || data.done.length > 0) ? null : (
            <p className="empty">
              {isPast
                ? 'Nothing happened on this day.'
                : data.done.length > 0
                  ? 'All done. Nice work.'
                  : 'Nothing planned yet.'}
            </p>
          )}

          {dueElsewhere.length > 0 && (
            <>
              <h2 className="section-title">Due this day · {dueElsewhere.length}</h2>
              <TaskList>
                {dueElsewhere.map((t) => (
                  <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
                ))}
              </TaskList>
            </>
          )}

          {/* Weather sits under the day's tasks and above what's already done. */}
          <WeatherCard date={date} today={today} />

          {data.missed.length > 0 && (
            <>
              <h2 className="section-title">Missed · {data.missed.length}</h2>
              <TaskList>
                {data.missed.map((t) => (
                  <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
                ))}
              </TaskList>
            </>
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
    </>
  );
}
