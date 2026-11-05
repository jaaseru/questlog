import { useEffect, useRef, useState, type FormEvent } from 'react';
import { longDate } from '../dates';
import { useDeleteTask, useMe, useSetRepeat, useToggleTask, useUpdateTask, useUsers } from '../queries';
import { describeRepeat, KIND_LABEL, sameRepeat } from '../repeat';
import { RepeatPicker } from './RepeatPicker';
import { SharePicker } from './SharePicker';
import { PRIORITIES, type Priority, type Task, type TaskInput, type TaskRepeat } from '../types';

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
  const [repeat, setRepeat] = useState<TaskRepeat | null>(task.repeat);
  const me = useMe();
  const { users, byId } = useUsers();
  const [shareWith, setShareWith] = useState(task.memberIds.filter((id) => id !== me.id));
  // Everyone else who could be on the task: active users plus any existing (possibly disabled) members.
  const people = [
    ...users.filter((u) => u.id !== me.id),
    ...shareWith.filter((id) => !users.some((u) => u.id === id)).map((id) => ({ id, username: id, displayName: 'Former user' })),
  ];
  const isCreator = task.createdBy === null || task.createdBy === me.id;
  const creatorName = task.createdBy && !isCreator ? (byId.get(task.createdBy)?.displayName ?? 'someone') : null;

  const update = useUpdateTask();
  const remove = useDeleteTask();
  const toggle = useToggleTask();
  const repeatMutation = useSetRepeat();
  const isOpen = task.status === 'open';
  const error = update.error ?? remove.error ?? toggle.error ?? repeatMutation.error;
  const saving = update.isPending || repeatMutation.isPending;

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
    const nextMembers = [me.id, ...shareWith];
    if (!sameSet(nextMembers, task.memberIds)) patch.memberIds = nextMembers;

    const repeatChanged = !sameRepeat(repeat, task.repeat);
    if (Object.keys(patch).length === 0 && !repeatChanged) return onClose();

    // Save the task first (its day anchors the repeat), then the repeat rule.
    const saveRepeat = () =>
      repeatChanged ? repeatMutation.mutate({ id: task.id, repeat }, { onSuccess: onClose }) : onClose();
    if (Object.keys(patch).length === 0) return saveRepeat();
    update.mutate({ id: task.id, patch }, { onSuccess: saveRepeat });
  };

  const leave = () => {
    if (confirm(`Leave "${task.title}"? It will disappear from your lists.`)) {
      update.mutate({ id: task.id, patch: { memberIds: task.memberIds.filter((id) => id !== me.id) } }, { onSuccess: onClose });
    }
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
        ) : task.status === 'missed' ? (
          <p className="muted">
            Missed on {task.scheduledDate && longDate(task.scheduledDate, today)}. You can still complete it.
          </p>
        ) : (
          <p className="muted">Completed {task.completedOn && longDate(task.completedOn, today)}</p>
        )}

        {isOpen && !inBacklog ? (
          <RepeatPicker value={repeat} onChange={setRepeat} anchor={scheduledDate} />
        ) : (
          task.repeat && (
            <fieldset className="field">
              <legend>Repeat</legend>
              <div className="row">
                <span className="muted">
                  {describeRepeat(task.repeat, task.occurrenceDate)} · {KIND_LABEL[task.repeat.kind]}
                </span>
                <button
                  type="button"
                  className="btn btn--small"
                  onClick={() => repeatMutation.mutate({ id: task.id, repeat: null }, { onSuccess: onClose })}
                  disabled={repeatMutation.isPending}
                >
                  Stop repeating
                </button>
              </div>
            </fieldset>
          )
        )}

        {people.length > 0 && (
          <fieldset className="field">
            <legend>Shared with</legend>
            <SharePicker people={people} selected={shareWith} onChange={setShareWith} />
            {creatorName && <p className="muted">Created by {creatorName}</p>}
          </fieldset>
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
          {isCreator ? (
            <button type="button" className="btn btn--danger-ghost" onClick={del} disabled={remove.isPending}>
              Delete
            </button>
          ) : (
            <button type="button" className="btn btn--danger-ghost" onClick={leave} disabled={update.isPending}>
              Leave
            </button>
          )}
          <span className="spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => toggle.mutate(task, { onSuccess: onClose })}
            disabled={toggle.isPending}
          >
            {task.status === 'done' ? 'Reopen' : 'Complete'}
          </button>
          <button type="submit" className="btn btn--primary" disabled={!title.trim() || saving}>
            Save
          </button>
        </div>
      </form>
    </dialog>
  );
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}
