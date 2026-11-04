import type { Db } from '../db.js';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type TaskStatus = 'open' | 'done';

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  scheduledDate: string | null;
  originalDate: string | null;
  dueDate: string | null;
  rolloverCount: number;
  completedAt: string | null;
  completedOn: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  scheduledDate?: string | null;
  dueDate?: string | null;
}

export type TaskPatch = Partial<TaskInput>;

const COLUMNS = `
  id, title, notes, status, priority,
  scheduled_date AS "scheduledDate",
  original_date AS "originalDate",
  due_date AS "dueDate",
  rollover_count AS "rolloverCount",
  completed_at AS "completedAt",
  completed_on AS "completedOn",
  created_at AS "createdAt",
  updated_at AS "updatedAt"`;

const BY_PRIORITY = `
  CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  created_at`;

export class TaskRepo {
  constructor(private readonly db: Db) {}

  /** A day page: open tasks on that day's list plus tasks completed that day. */
  async listForDay(date: string): Promise<{ open: Task[]; done: Task[] }> {
    const [open, done] = await Promise.all([
      this.db.query<Task>(
        `SELECT ${COLUMNS} FROM tasks WHERE status = 'open' AND scheduled_date = $1 ORDER BY ${BY_PRIORITY}`,
        [date],
      ),
      this.db.query<Task>(
        `SELECT ${COLUMNS} FROM tasks WHERE status = 'done' AND completed_on = $1 ORDER BY completed_at`,
        [date],
      ),
    ]);
    return { open: open.rows, done: done.rows };
  }

  async listBacklog(): Promise<Task[]> {
    const { rows } = await this.db.query<Task>(
      `SELECT ${COLUMNS} FROM tasks WHERE status = 'open' AND scheduled_date IS NULL ORDER BY ${BY_PRIORITY}`,
    );
    return rows;
  }

  /** Completed tasks between two dates (inclusive), newest first. */
  async listCompleted(from: string, to: string): Promise<Task[]> {
    const { rows } = await this.db.query<Task>(
      `SELECT ${COLUMNS} FROM tasks
       WHERE status = 'done' AND completed_on BETWEEN $1 AND $2
       ORDER BY completed_on DESC, completed_at DESC`,
      [from, to],
    );
    return rows;
  }

  /**
   * Everything a calendar needs for a date range (inclusive):
   * - done: tasks completed in the range (the journal)
   * - open: open tasks on a day list in the range (today and planned days)
   * - due: open tasks with a due date in the range (deadline markers)
   */
  async listCalendar(from: string, to: string): Promise<{ done: Task[]; open: Task[]; due: Task[] }> {
    const [done, open, due] = await Promise.all([
      this.db.query<Task>(
        `SELECT ${COLUMNS} FROM tasks WHERE status = 'done' AND completed_on BETWEEN $1 AND $2
         ORDER BY completed_on, completed_at`,
        [from, to],
      ),
      this.db.query<Task>(
        `SELECT ${COLUMNS} FROM tasks WHERE status = 'open' AND scheduled_date BETWEEN $1 AND $2
         ORDER BY scheduled_date, ${BY_PRIORITY}`,
        [from, to],
      ),
      this.db.query<Task>(
        `SELECT ${COLUMNS} FROM tasks WHERE status = 'open' AND due_date BETWEEN $1 AND $2
         ORDER BY due_date, ${BY_PRIORITY}`,
        [from, to],
      ),
    ]);
    return { done: done.rows, open: open.rows, due: due.rows };
  }

  async get(id: string): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(`SELECT ${COLUMNS} FROM tasks WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async create(input: TaskInput): Promise<Task> {
    const scheduled = input.scheduledDate ?? null;
    const { rows } = await this.db.query<Task>(
      `WITH inserted AS (
         INSERT INTO tasks (title, notes, priority, scheduled_date, original_date, due_date)
         VALUES ($1, $2, $3, $4, $4, $5)
         RETURNING *
       ), ev AS (
         INSERT INTO task_events (task_id, type, to_date) SELECT id, 'created', scheduled_date FROM inserted
       )
       SELECT ${COLUMNS} FROM inserted`,
      [input.title, input.notes ?? '', input.priority ?? 'medium', scheduled, input.dueDate ?? null],
    );
    return rows[0]!;
  }

  async update(id: string, patch: TaskPatch): Promise<Task | null> {
    const columnFor: Record<keyof TaskInput, string> = {
      title: 'title',
      notes: 'notes',
      priority: 'priority',
      scheduledDate: 'scheduled_date',
      dueDate: 'due_date',
    };
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const [key, column] of Object.entries(columnFor) as [keyof TaskInput, string][]) {
      if (patch[key] === undefined) continue;
      values.push(patch[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) return this.get(id);

    const { rows } = await this.db.query<Task>(
      `WITH before AS (SELECT id, scheduled_date FROM tasks WHERE id = $1 FOR UPDATE),
       updated AS (
         UPDATE tasks t SET ${sets.join(', ')}, updated_at = now()
         FROM before WHERE t.id = before.id
         RETURNING t.*, before.scheduled_date AS previous_date
       ), ev AS (
         INSERT INTO task_events (task_id, type, from_date, to_date)
         SELECT id, 'rescheduled', previous_date, scheduled_date FROM updated
         WHERE previous_date IS DISTINCT FROM scheduled_date
       )
       SELECT ${COLUMNS} FROM updated`,
      values,
    );
    return rows[0] ?? null;
  }

  /** Marks an open task done on `today`. Returns null if the task doesn't exist or is already done. */
  async complete(id: string, today: string): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      `WITH updated AS (
         UPDATE tasks SET status = 'done', completed_at = now(), completed_on = $2, updated_at = now()
         WHERE id = $1 AND status = 'open'
         RETURNING *
       ), ev AS (
         INSERT INTO task_events (task_id, type, to_date) SELECT id, 'completed', $2 FROM updated
       )
       SELECT ${COLUMNS} FROM updated`,
      [id, today],
    );
    return rows[0] ?? null;
  }

  /** Reopens a done task. If it belonged to a past day it comes back on today's list. */
  async reopen(id: string, today: string): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      `WITH updated AS (
         UPDATE tasks SET
           status = 'open', completed_at = NULL, completed_on = NULL, updated_at = now(),
           scheduled_date = CASE WHEN scheduled_date < $2 THEN $2 ELSE scheduled_date END
         WHERE id = $1 AND status = 'done'
         RETURNING *
       ), ev AS (
         INSERT INTO task_events (task_id, type, to_date) SELECT id, 'reopened', scheduled_date FROM updated
       )
       SELECT ${COLUMNS} FROM updated`,
      [id, today],
    );
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM tasks WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }
}
