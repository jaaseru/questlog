import { useState, type FormEvent } from 'react';
import { useCreateTask } from '../queries';
import { PlusIcon } from './icons';

export function QuickAdd({ scheduledDate, placeholder }: { scheduledDate: string | null; placeholder?: string }) {
  const [title, setTitle] = useState('');
  const create = useCreateTask();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    // Clear right away so the next task can be typed while this one saves; restore it on failure.
    setTitle('');
    create.mutate({ title: trimmed, scheduledDate }, { onError: () => setTitle((current) => current || trimmed) });
  };

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
      <button type="submit" className="btn btn--primary" disabled={!title.trim()} aria-label="Add task">
        <PlusIcon />
      </button>
      {create.isError && <p className="form-error">{create.error.message}</p>}
    </form>
  );
}
