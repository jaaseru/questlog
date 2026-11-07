import { QueryError } from '../components/QueryError';
import { useState } from 'react';
import { QuickAdd } from '../components/QuickAdd';
import { TaskEditor } from '../components/TaskEditor';
import { TaskItem, TaskList } from '../components/TaskItem';
import { useBacklog, useToday, useUpdateTask } from '../queries';
import type { Task } from '../types';

export function BacklogPage() {
  const today = useToday();
  const { data, isPending, error } = useBacklog();
  const update = useUpdateTask();
  const [editing, setEditing] = useState<Task | null>(null);

  if (!today) return <p className="muted center">Loading…</p>;

  return (
    <section className="page">
      <header className="page-header">
        <h1>Backlog</h1>
        <p className="muted">Tasks without a day. Pull them onto today when you're ready.</p>
      </header>

      <QuickAdd scheduledDate={null} placeholder="Add to backlog…" />

      <QueryError error={error} hasData={Boolean(data)} />
      {isPending && <p className="muted center">Loading…</p>}
      {data && data.tasks.length === 0 && <p className="empty">The backlog is empty.</p>}
      {data && data.tasks.length > 0 && (
        <TaskList>
          {data.tasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              today={today}
              onOpen={setEditing}
              action={
                <button
                  className="btn btn--small"
                  onClick={() => update.mutate({ id: t.id, patch: { scheduledDate: today } })}
                  disabled={update.isPending}
                >
                  Today
                </button>
              }
            />
          ))}
        </TaskList>
      )}

      {editing && <TaskEditor task={editing} today={today} onClose={() => setEditing(null)} />}
    </section>
  );
}
