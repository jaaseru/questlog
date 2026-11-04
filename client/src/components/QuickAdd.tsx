import { useState, type FormEvent } from 'react';
import { useCreateTask, useMe, useUsers } from '../queries';
import { PeopleIcon, PlusIcon } from './icons';
import { SharePicker } from './SharePicker';

export function QuickAdd({ scheduledDate, placeholder }: { scheduledDate: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  const [sharing, setSharing] = useState(false);
  const [shareWith, setShareWith] = useState<string[]>([]);
  const create = useCreateTask();
  const me = useMe();
  const others = useUsers().users.filter((u) => u.id !== me.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // Clear right away so the next task can be typed while this one saves; restore it on failure.
    setTitle('');
    create.mutate(
      { title: trimmed, scheduledDate, memberIds: sharing ? shareWith : [] },
      { onError: () => setTitle((current) => current || trimmed) },
    );
  };

  const shareLabel = sharing && shareWith.length > 0 ? `Shared with ${shareWith.length}` : 'Share';

  return (
    <form className="quick-add" onSubmit={submit}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={placeholder ?? 'Add a task…'}
        aria-label="New task title"
        maxLength={500}
        enterKeyHint="done"
      />
      {others.length > 0 && (
        <button
          type="button"
          className={`btn quick-add__share${sharing ? ' is-on' : ''}`}
          onClick={() => setSharing((s) => !s)}
          aria-pressed={sharing}
          aria-label={shareLabel}
          title={shareLabel}
        >
          <PeopleIcon />
          {sharing && shareWith.length > 0 && <span className="quick-add__count">{shareWith.length}</span>}
        </button>
      )}
      <button type="submit" className="btn btn--primary" disabled={!title.trim()} aria-label="Add task">
        <PlusIcon />
      </button>
      {sharing && (
        <div className="quick-add__people">
          <span className="muted">New tasks are shared with:</span>
          <SharePicker people={others} selected={shareWith} onChange={setShareWith} />
        </div>
      )}
      {create.isError && <p className="form-error">{create.error.message}</p>}
    </form>
  );
}
