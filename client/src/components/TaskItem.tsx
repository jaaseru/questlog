import type { ReactNode } from 'react';
import { shortDate } from '../dates';
import { useMe, useToggleTask, useUsers } from '../queries';
import { KIND_SHORT, repeatChip } from '../repeat';
import type { Task, Upcoming } from '../types';
import { CheckIcon, RepeatIcon } from './icons';

interface Props {
  task: Task;
  today: string;
  onOpen: (task: Task) => void;
  action?: ReactNode;
}

export function TaskItem({ task, today, onOpen, action }: Props) {
  const toggle = useToggleTask();
  const me = useMe();
  const { byId } = useUsers();
  const others = task.memberIds.filter((id) => id !== me.id).map((id) => byId.get(id)?.displayName ?? 'someone');
  const completedBy = task.completedBy && task.completedBy !== me.id ? byId.get(task.completedBy)?.displayName : null;
  // Flip immediately while the request is in flight.
  const done = toggle.isPending ? task.status !== 'done' : task.status === 'done';
  const missed = !done && task.status === 'missed';
  const overdue = !done && task.dueDate !== null && task.dueDate < today;

  return (
    <li className={`task priority-${task.priority}${done ? ' is-done' : ''}${missed ? ' is-missed' : ''}`}>
      <button
        className="check"
        role="checkbox"
        aria-checked={done}
        aria-label={done ? `Mark "${task.title}" as not done` : `Complete "${task.title}"`}
        onClick={() => toggle.mutate(task)}
        disabled={toggle.isPending}
      >
        {done && <CheckIcon />}
      </button>
      <button className="task__body" onClick={() => onOpen(task)}>
        <span className="task__title">{task.title}</span>
        <span className="task__meta">
          {missed && <span className="chip chip--missed">missed</span>}
          {task.priority !== 'medium' && <span className={`chip chip--${task.priority}`}>{task.priority}</span>}
          {task.repeat && (
            <span className="chip chip--repeat">
              <RepeatIcon /> {repeatChip(task.repeat)} · {KIND_SHORT[task.repeat.kind]}
            </span>
          )}
          {!done && task.rolloverCount > 0 && task.originalDate && (
            <span className="chip chip--rolled" title={`Carried over ${task.rolloverCount}×`}>
              ↻ since {shortDate(task.originalDate)}
            </span>
          )}
          {task.dueDate && !done && (
            <span className={`chip${overdue ? ' chip--overdue' : ''}`}>due {shortDate(task.dueDate)}</span>
          )}
          {others.length > 0 && (
            <span className="chip chip--shared" title={`Shared with ${others.join(', ')}`}>
              {others.length === 1 ? `with ${others[0]}` : `with ${others[0]} +${others.length - 1}`}
            </span>
          )}
          {done && completedBy && <span className="chip">done by {completedBy}</span>}
          {task.notes && <span className="chip chip--notes" aria-label="Has notes">notes</span>}
        </span>
      </button>
      {action}
    </li>
  );
}

/** A future occurrence of a repeating task: a read-only preview until its day arrives. */
export function UpcomingItem({ item }: { item: Upcoming }) {
  return (
    <li className={`task task--upcoming priority-${item.priority}`}>
      <span className="check" aria-hidden />
      <span className="task__body">
        <span className="task__title">{item.title}</span>
        <span className="task__meta">
          <span className="chip chip--repeat">
            <RepeatIcon /> {repeatChip(item)} · {KIND_SHORT[item.kind]}
          </span>
          {item.estimated && <span className="chip">estimated: moves if the current one is done late</span>}
        </span>
      </span>
    </li>
  );
}

export function TaskList({ children }: { children: ReactNode }) {
  return <ul className="task-list">{children}</ul>;
}
