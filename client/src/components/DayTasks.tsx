import { useState } from 'react';
import { useDay } from '../queries';
import { PRIORITIES, type Task } from '../types';
import { QuickAdd } from './QuickAdd';
import { TaskEditor } from './TaskEditor';
import { TaskItem, TaskList, UpcomingItem } from './TaskItem';
import { WeatherCard } from './WeatherCard';

interface Props {
  date: string;
  today: string;
}

/** One day's quick-add, open list, weather, and missed/completed lists. */
export function DayTasks({ date, today }: Props) {
  const { data, isPending, error } = useDay(date);
  const [editing, setEditing] = useState<Task | null>(null);
  const isPast = date < today;
  const total = data ? data.open.length + data.done.length + data.missed.length : 0;

  return (
    <>
      {/* How far through today you are (not shown for other days). */}
      {data && date === today && total > 0 && (
        <div className="day-progress" aria-label={`${data.done.length} of ${total} done`}>
          <div className="day-progress__bar">
            <span style={{ width: `${(data.done.length / total) * 100}%` }} />
          </div>
          <span className="day-progress__text">
            {data.done.length} of {total} done
          </span>
        </div>
      )}

      {!isPast && <QuickAdd scheduledDate={date} />}

      {error && <p className="form-error">{error.message}</p>}
      {isPending && <p className="muted center">Loading…</p>}

      {data && (
        <>
          {data.open.length > 0 ? (
            // Open tasks grouped under their priority, then upcoming repeats.
            PRIORITIES.filter((p) => data.open.some((t) => t.priority === p)).map((p) => {
              const group = data.open.filter((t) => t.priority === p);
              return (
                <section key={p} className={`priority-group priority-${p}`}>
                  <h2 className="priority-group__title">
                    {p} <span>{group.length}</span>
                  </h2>
                  <TaskList>
                    {group.map((t) => (
                      <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} />
                    ))}
                  </TaskList>
                </section>
              );
            }).concat(
              data.upcoming.length > 0 ? (
                <section key="upcoming" className="priority-group">
                  <h2 className="priority-group__title">
                    Repeats <span>{data.upcoming.length}</span>
                  </h2>
                  <TaskList>
                    {data.upcoming.map((u) => (
                      <UpcomingItem key={`${u.seriesId}-${u.date}`} item={u} />
                    ))}
                  </TaskList>
                </section>
              ) : [],
            )
          ) : data.upcoming.length > 0 ? (
            // Only repeats coming up on this day.
            <TaskList>
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

          {data.dueElsewhere.length > 0 && (
            <>
              <h2 className="section-title">Due this day · {data.dueElsewhere.length}</h2>
              <TaskList>
                {data.dueElsewhere.map((t) => (
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
