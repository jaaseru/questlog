import { useEffect, useRef, useState, type FormEvent } from 'react';
import { longDate } from '../dates';
import { useDeleteTask, useToggleTask, useUpdateTask } from '../queries';
import { PRIORITIES, type Priority, type Task, type TaskInput } from '../types';

interface Props {
  task: Task;
  today: string;
  onClose: () => void;
}

export function TaskEditor({ task, today, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [inBacklog, setInBacklog] = useState(task.scheduledDate === null);
  const [scheduledDate, setScheduledDate] = useState(task.scheduledDate ?? today);
  const [dueDate, setDueDate] = useState(task.dueDate ?? '');

  const update = useUpdateTask();
  const remove = useDeleteTask();
  const toggle = useToggleTask();
  const isOpen = task.status === 'open';
  const error = update.error ?? remove.error ?? toggle.error;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const save = (e: FormEvent) => {
    e.preventDefault();
    const patch: Partial<TaskInput> = {};
    if (title.trim() !== task.title) patch.title = title.trim();
    if (notes !== task.notes) patch.notes = notes;
    if (priority !== task.priority) patch.priority = priority;
    if (isOpen) {
      const nextDate = inBacklog ? null : scheduledDate;
      if (nextDate !== task.scheduledDate) patch.scheduledDate = nextDate;
    }
    const nextDue = dueDate || null;
    if (nextDue !== task.dueDate) patch.dueDate = nextDue;

    if (Object.keys(patch).length === 0) return onClose();
    update.mutate({ id: task.id, patch }, { onSuccess: onClose });
  };

  const del = () => {
    if (confirm(`Delete "${task.title}"? This can't be undone.`)) {
      remove.mutate(task.id, { onSuccess: onClose });
    }
  };

  return (
    <dialog
      ref={dialogRef}
      className="sheet"
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && dialogRef.current.close()}
      aria-label="Edit task"
    >
      <form onSubmit={save} className="sheet__body">
        <div className="sheet__handle" aria-hidden />
        <input
          className="sheet__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
          required
          maxLength={500}
        />
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          aria-label="Notes"
          rows={4}
          maxLength={10_000}
        />

        <fieldset className="field">
          <legend>Priority</legend>
          <div className="segmented">
            {PRIORITIES.map((p) => (
              <label key={p} className={`segmented__item priority-${p}${priority === p ? ' is-selected' : ''}`}>
                <input type="radio" name="priority" value={p} checked={priority === p} onChange={() => setPriority(p)} />
                {p}
              </label>
            ))}
          </div>
        </fieldset>

        {isOpen ? (
          <fieldset className="field">
            <legend>When</legend>
            <div className="row">
              <label className="toggle">
                <input type="checkbox" checked={inBacklog} onChange={(e) => setInBacklog(e.target.checked)} />
                Backlog
              </label>
              {!inBacklog && (
                <input
                  type="date"
                  value={scheduledDate}
                  min={today}
                  onChange={(e) => setScheduledDate(e.target.value)}
                  aria-label="Scheduled day"
                  required
                />
              )}
            </div>
          </fieldset>
        ) : (
          <p className="muted">Completed {task.completedOn && longDate(task.completedOn, today)}</p>
        )}

        <label className="field">
          <span className="field__label">Due date</span>
          <div className="row">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />
            {dueDate && (
              <button type="button" className="btn btn--ghost" onClick={() => setDueDate('')}>
                Clear
              </button>
            )}
          </div>
        </label>

        {error && <p className="form-error">{error.message}</p>}

        <div className="sheet__actions">
          <button type="button" className="btn btn--danger-ghost" onClick={del} disabled={remove.isPending}>
            Delete
          </button>
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => toggle.mutate(task, { onSuccess: onClose })}
            disabled={toggle.isPending}
          >
            {isOpen ? 'Complete' : 'Reopen'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!title.trim() || update.isPending}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}
