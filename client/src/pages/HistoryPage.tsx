import { QueryError } from '../components/QueryError';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { TaskEditor } from '../components/TaskEditor';
import { TaskItem, TaskList } from '../components/TaskItem';
import { addDays, longDate, relativeDayName } from '../dates';
import { useHistory, useToday } from '../queries';
import type { Task } from '../types';

const PAGE_DAYS = 30;

export function HistoryPage() {
  const today = useToday();
  if (!today) return <p className="muted center">Loading…</p>;
  return <HistoryView today={today} />;
}

function HistoryView({ today }: { today: string }) {
  const [days, setDays] = useState(PAGE_DAYS);
  const from = addDays(today, -(days - 1));
  const { data, isPending, isFetching, error } = useHistory(from, today);
  const [editing, setEditing] = useState<Task | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of data?.tasks ?? []) {
      const key = t.completedOn!;
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    return [...map.entries()];
  }, [data]);

  return (
    <section className="page">
      <header className="page-header">
        <h1>History</h1>
        <p className="muted">
          {data ? `${data.tasks.length} completed in the last ${days} days` : 'Everything you have finished'}
        </p>
      </header>

      <QueryError error={error} hasData={Boolean(data)} />
      {isPending && <p className="muted center">Loading…</p>}
      {data && groups.length === 0 && <p className="empty">Nothing completed in this period yet.</p>}

      {groups.map(([date, tasks]) => (
        <div key={date} className="history-day">
          <h2 className="section-title">
            <Link to={date === today ? '/' : `/day/${date}`}>
              {relativeDayName(date, today)} · {longDate(date, today)}
            </Link>
          </h2>
          <TaskList>
            {tasks.map((t) => (
              <TaskItem key={t.id} task={t} today={today} onOpen={setEditing} viewDate={t.completedOn ?? undefined} />
            ))}
          </TaskList>
        </div>
      ))}

      {data && (
        <button className="btn btn--block" onClick={() => setDays((d) => d + PAGE_DAYS)} disabled={isFetching}>
          {isFetching ? 'Loading…' : 'Show older'}
        </button>
      )}

      {editing && <TaskEditor task={editing} today={today} onClose={() => setEditing(null)} />}
    </section>
  );
}
