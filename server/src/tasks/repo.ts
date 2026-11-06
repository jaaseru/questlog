import type pg from 'pg';
import { withTransaction, type Db, type Queryable } from '../db.js';
import { HttpError } from '../errors.js';
import type { Frequency, RepeatKind } from '../recurrence.js';
import { SeriesRepo } from '../series.js';

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];
export type TaskStatus = 'open' | 'done' | 'missed';

export interface TaskRepeat {
  frequency: Frequency;
  every: number;
  weekdays: number[];
  kind: RepeatKind;
  until: string | null;
}

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
  completedBy: string | null;
  createdBy: string | null;
  /** Users who can see and work on the task. More than one means it's shared. */
  memberIds: string[];
  seriesId: string | null;
  occurrenceDate: string | null;
  /** How the task repeats, if it belongs to an active series. */
  repeat: TaskRepeat | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  scheduledDate?: string | null;
  dueDate?: string | null;
  /** On create: other users to share with. On update: the complete member list. */
  memberIds?: string[];
}

export type TaskPatch = Partial<TaskInput>;

const COLUMNS = `
  t.id, t.title, t.notes, t.status, t.priority,
  t.scheduled_date AS "scheduledDate",
  t.original_date AS "originalDate",
  t.due_date AS "dueDate",
  t.rollover_count AS "rolloverCount",
  t.completed_at AS "completedAt",
  t.completed_on AS "completedOn",
  t.completed_by AS "completedBy",
  t.created_by AS "createdBy",
  ARRAY(SELECT m.user_id FROM task_members m WHERE m.task_id = t.id ORDER BY m.added_at, m.user_id) AS "memberIds",
  t.series_id AS "seriesId",
  t.occurrence_date AS "occurrenceDate",
  (SELECT json_build_object('frequency', s.frequency, 'every', s.repeat_every, 'weekdays', s.weekdays, 'kind', s.kind, 'until', s.end_date)
     FROM task_series s WHERE s.id = t.series_id AND s.active) AS "repeat",
  t.created_at AS "createdAt",
  t.updated_at AS "updatedAt"`;

/** Every query takes the acting user as $1 and only sees tasks that user is a member of. */
const VISIBLE = `EXISTS (SELECT 1 FROM task_members vm WHERE vm.task_id = t.id AND vm.user_id = $1)`;

const BY_PRIORITY = `
  CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
  t.created_at`;

const FIELD_COLUMNS = {
  title: 'title',
  notes: 'notes',
  priority: 'priority',
  scheduledDate: 'scheduled_date',
  dueDate: 'due_date',
} as const;

export type DeleteResult = 'deleted' | 'not_found' | 'forbidden';

export class TaskRepo {
  private readonly series: SeriesRepo;

  constructor(private readonly db: Db) {
    this.series = new SeriesRepo(db);
  }

  /**
   * A day page: open tasks on that day's list, tasks completed that day, missed occurrences,
   * and open tasks due that day that sit on another day or in the backlog.
   */
  async listForDay(
    userId: string,
    date: string,
  ): Promise<{ open: Task[]; done: Task[]; missed: Task[]; dueElsewhere: Task[] }> {
    const [open, done, missed, dueElsewhere] = await Promise.all([
      this.select(`t.status = 'open' AND t.scheduled_date = $2 ORDER BY ${BY_PRIORITY}`, [userId, date]),
      // Done on this day, or planned for this day and done early (or late): both belong here.
      this.select(
        `t.status = 'done' AND (t.completed_on = $2 OR t.scheduled_date = $2) ORDER BY t.completed_at`,
        [userId, date],
      ),
      this.select(`t.status = 'missed' AND t.scheduled_date = $2 ORDER BY ${BY_PRIORITY}`, [userId, date]),
      this.select(
        `t.status = 'open' AND t.due_date = $2 AND t.scheduled_date IS DISTINCT FROM $2 ORDER BY ${BY_PRIORITY}`,
        [userId, date],
      ),
    ]);
    return { open, done, missed, dueElsewhere };
  }

  listBacklog(userId: string): Promise<Task[]> {
    return this.select(`t.status = 'open' AND t.scheduled_date IS NULL ORDER BY ${BY_PRIORITY}`, [userId]);
  }

  /** Completed tasks between two dates (inclusive), newest first. */
  listCompleted(userId: string, from: string, to: string): Promise<Task[]> {
    return this.select(
      `t.status = 'done' AND t.completed_on BETWEEN $2 AND $3 ORDER BY t.completed_on DESC, t.completed_at DESC`,
      [userId, from, to],
    );
  }

  /**
   * Everything a calendar needs for a date range (inclusive):
   * - done: tasks completed in the range, or planned in the range and completed (early or late)
   * - open: open tasks on a day list in the range (today and planned days)
   * - due: open tasks with a due date in the range (deadline markers)
   */
  async listCalendar(
    userId: string,
    from: string,
    to: string,
  ): Promise<{ done: Task[]; open: Task[]; due: Task[]; missed: Task[] }> {
    const params = [userId, from, to];
    const [done, open, due, missed] = await Promise.all([
      this.select(
        `t.status = 'done' AND (t.completed_on BETWEEN $2 AND $3 OR t.scheduled_date BETWEEN $2 AND $3)
         ORDER BY t.completed_on, t.completed_at`,
        params,
      ),
      this.select(
        `t.status = 'open' AND t.scheduled_date BETWEEN $2 AND $3 ORDER BY t.scheduled_date, ${BY_PRIORITY}`,
        params,
      ),
      this.select(`t.status = 'open' AND t.due_date BETWEEN $2 AND $3 ORDER BY t.due_date, ${BY_PRIORITY}`, params),
      this.select(`t.status = 'missed' AND t.scheduled_date BETWEEN $2 AND $3 ORDER BY t.scheduled_date`, params),
    ]);
    return { done, open, due, missed };
  }

  async get(userId: string, id: string, db: Queryable = this.db): Promise<Task | null> {
    return (await this.select('t.id = $2', [userId, id], db))[0] ?? null;
  }

  async create(userId: string, input: TaskInput): Promise<Task> {
    return withTransaction(this.db, async (c) => {
      const scheduled = input.scheduledDate ?? null;
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO tasks (title, notes, priority, scheduled_date, original_date, due_date, created_by)
         VALUES ($1, $2, $3, $4, $4, $5, $6) RETURNING id`,
        [input.title, input.notes ?? '', input.priority ?? 'medium', scheduled, input.dueDate ?? null, userId],
      );
      const id = rows[0]!.id;
      const members = [userId, ...(input.memberIds ?? []).filter((m) => m !== userId)];
      await assertActiveUsers(c, members);
      await c.query(
        `INSERT INTO task_members (task_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
        [id, members],
      );
      await logEvent(c, id, userId, 'created', null, scheduled);
      return (await this.get(userId, id, c))!;
    });
  }

  async update(userId: string, id: string, patch: TaskPatch): Promise<Task | null> {
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<{ scheduled_date: string | null }>(
        `SELECT t.scheduled_date FROM tasks t WHERE t.id = $2 AND ${VISIBLE} FOR UPDATE`,
        [userId, id],
      );
      if (!rows[0]) return null;
      const previousDate = rows[0].scheduled_date;

      const sets: string[] = [];
      const values: unknown[] = [id];
      for (const [key, column] of Object.entries(FIELD_COLUMNS) as [keyof typeof FIELD_COLUMNS, string][]) {
        if (patch[key] === undefined) continue;
        values.push(patch[key]);
        sets.push(`${column} = $${values.length}`);
      }
      if (sets.length) {
        await c.query(`UPDATE tasks SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, values);
      }
      if (patch.scheduledDate !== undefined && patch.scheduledDate !== previousDate) {
        await logEvent(c, id, userId, 'rescheduled', previousDate, patch.scheduledDate);
      }

      if (patch.memberIds !== undefined) {
        const members = [...new Set(patch.memberIds)];
        if (members.length === 0) throw new HttpError(400, 'A task needs at least one member');
        const { rows: current } = await c.query<{ user_id: string }>(
          'SELECT user_id FROM task_members WHERE task_id = $1',
          [id],
        );
        const currentIds = new Set(current.map((r) => r.user_id));
        // Existing members may be disabled accounts; only newly added people must be active.
        await assertActiveUsers(c, members.filter((m) => !currentIds.has(m)));
        await c.query('DELETE FROM task_members WHERE task_id = $1 AND NOT (user_id = ANY($2::uuid[]))', [id, members]);
        await c.query(
          'INSERT INTO task_members (task_id, user_id) SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING',
          [id, members],
        );
        const changed = members.length !== currentIds.size || members.some((m) => !currentIds.has(m));
        if (changed) {
          await logEvent(c, id, userId, 'members_changed', null, null);
          await c.query('UPDATE tasks SET updated_at = now() WHERE id = $1', [id]);
        }
      }

      if (sets.length || patch.memberIds !== undefined) await this.series.syncTemplate(c, id);

      // The acting user may have just removed themselves; return what they last saw in that case.
      return (await this.get(userId, id, c)) ?? (await this.getUnscoped(id, c));
    });
  }

  /**
   * Marks an open (or missed) task done on `today`. Returns null if the task isn't visible or is
   * already done. Completing a flexible occurrence sets when the next one is due.
   */
  async complete(userId: string, id: string, today: string): Promise<Task | null> {
    return withTransaction(this.db, async (c) => {
      const { rowCount } = await c.query(
        `UPDATE tasks t SET status = 'done', completed_at = now(), completed_on = $3, completed_by = $1, updated_at = now()
         WHERE t.id = $2 AND t.status IN ('open', 'missed') AND ${VISIBLE}`,
        [userId, id, today],
      );
      if (!rowCount) return null;
      await logEvent(c, id, userId, 'completed', null, today);
      await this.series.scheduleNextFlexible(c, id, today);
      return this.get(userId, id, c);
    });
  }

  /** Reopens a done task. If it belonged to a past day it comes back on today's list. */
  async reopen(userId: string, id: string, today: string): Promise<Task | null> {
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<{ scheduled_date: string | null }>(
        `UPDATE tasks t SET
           status = 'open', completed_at = NULL, completed_on = NULL, completed_by = NULL, updated_at = now(),
           scheduled_date = CASE WHEN t.scheduled_date < $3 THEN $3 ELSE t.scheduled_date END
         WHERE t.id = $2 AND t.status IN ('done', 'missed') AND ${VISIBLE}
         RETURNING t.scheduled_date`,
        [userId, id, today],
      );
      if (!rows[0]) return null;
      await logEvent(c, id, userId, 'reopened', null, rows[0].scheduled_date);
      return this.get(userId, id, c);
    });
  }

  /**
   * Only the creator may delete. Other members can leave a shared task by removing themselves.
   * Deleting the open occurrence of a flexible series skips it: the next one is a period from today.
   */
  async delete(userId: string, id: string, today: string): Promise<DeleteResult> {
    const task = await this.get(userId, id);
    if (!task) return 'not_found';
    if (task.createdBy !== null && task.createdBy !== userId) return 'forbidden';
    await withTransaction(this.db, async (c) => {
      if (task.status === 'open') await this.series.scheduleNextFlexible(c, id, today);
      await c.query('DELETE FROM tasks WHERE id = $1', [id]);
    });
    return 'deleted';
  }

  private async select(where: string, params: unknown[], db: Queryable = this.db): Promise<Task[]> {
    const { rows } = await db.query<Task>(`SELECT ${COLUMNS} FROM tasks t WHERE ${VISIBLE} AND ${where}`, params);
    return rows;
  }

  private async getUnscoped(id: string, db: Queryable): Promise<Task | null> {
    const { rows } = await db.query<Task>(`SELECT ${COLUMNS} FROM tasks t WHERE t.id = $1`, [id]);
    return rows[0] ?? null;
  }
}

async function assertActiveUsers(db: pg.PoolClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { rows } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[]) AND NOT disabled',
    [ids],
  );
  if (rows[0]!.n !== new Set(ids).size) throw new HttpError(400, 'Can only share with active users');
}

async function logEvent(
  db: Queryable,
  taskId: string,
  userId: string | null,
  type: string,
  fromDate: string | null,
  toDate: string | null,
): Promise<void> {
  await db.query(
    'INSERT INTO task_events (task_id, user_id, type, from_date, to_date) VALUES ($1, $2, $3, $4, $5)',
    [taskId, userId, type, fromDate, toDate],
  );
}
