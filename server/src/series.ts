import type pg from 'pg';
import { addDays } from './dates.js';
import { withTransaction, type Db, type Queryable } from './db.js';
import { HttpError } from './errors.js';
import { addPeriod, occurrencesBetween, type Frequency, type RepeatKind, type RepeatRule, type Schedule } from './recurrence.js';

export interface SeriesRow {
  id: string;
  title: string;
  notes: string;
  priority: string;
  frequency: Frequency;
  every: number;
  weekdays: number[];
  kind: RepeatKind;
  startDate: string;
  generatedThrough: string;
  nextDate: string | null;
  memberIds: string[];
  createdBy: string | null;
  active: boolean;
  /** Last day an occurrence may fall on (inclusive), or null to repeat forever. */
  until: string | null;
}

export interface RepeatInput extends RepeatRule {
  kind: RepeatKind;
  until?: string | null;
}

/** A future occurrence that doesn't exist as a task yet (shown as a preview). */
export interface UpcomingOccurrence {
  seriesId: string;
  date: string;
  title: string;
  priority: string;
  kind: RepeatKind;
  frequency: Frequency;
  every: number;
  weekdays: number[];
  /** Flexible series: the date moves if the current occurrence is completed late. */
  estimated: boolean;
}

const SERIES_COLUMNS = `
  id, title, notes, priority, frequency, repeat_every AS every, weekdays, kind,
  start_date AS "startDate", generated_through AS "generatedThrough", next_date AS "nextDate",
  member_ids AS "memberIds", created_by AS "createdBy", active, end_date AS "until"`;

/** Catch-up limit if the server was down for a long time: older occurrences are just skipped. */
const MAX_CATCH_UP = 62;

/** The earlier of two dates, treating null as "no limit". */
function capAt(date: string, until: string | null): string {
  return until && until < date ? until : date;
}

function schedule(s: SeriesRow): Schedule {
  return { frequency: s.frequency, every: s.every, weekdays: s.weekdays, startDate: s.startDate };
}

export function validateRepeat(input: RepeatInput): RepeatInput {
  const weekdays = [...new Set(input.weekdays)].sort();
  if (input.frequency !== 'weekly' && weekdays.length) {
    throw new HttpError(400, 'Weekdays only apply to weekly repeats');
  }
  if (input.kind === 'variable' && weekdays.length > 1) {
    throw new HttpError(400, 'A flexible series moves with each completion, so it can only use one weekday');
  }
  return { ...input, weekdays };
}

async function logEvent(db: Queryable, taskId: string, userId: string | null, type: string, from: string | null, to: string | null) {
  await db.query(
    'INSERT INTO task_events (task_id, user_id, type, from_date, to_date) VALUES ($1, $2, $3, $4, $5)',
    [taskId, userId, type, from, to],
  );
}

async function createOccurrence(c: pg.PoolClient, s: SeriesRow, occurrenceDate: string, scheduledDate: string) {
  const { rows } = await c.query<{ id: string }>(
    `INSERT INTO tasks (title, notes, priority, scheduled_date, original_date, created_by, series_id, occurrence_date)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
     ON CONFLICT (series_id, occurrence_date) WHERE series_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [s.title, s.notes, s.priority, scheduledDate, s.createdBy, s.id, occurrenceDate],
  );
  const id = rows[0]?.id;
  if (!id) return;
  await c.query(
    `INSERT INTO task_members (task_id, user_id)
     SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [id, s.memberIds],
  );
  await logEvent(c, id, null, 'created', null, scheduledDate);
}

async function markMissed(c: pg.PoolClient, taskId: string, day: string) {
  await c.query(`UPDATE tasks SET status = 'missed', updated_at = now() WHERE id = $1`, [taskId]);
  await logEvent(c, taskId, null, 'missed', day, null);
}

async function rollTo(c: pg.PoolClient, taskId: string, from: string, today: string) {
  await c.query(
    'UPDATE tasks SET scheduled_date = $2, rollover_count = rollover_count + 1, updated_at = now() WHERE id = $1',
    [taskId, today],
  );
  await logEvent(c, taskId, null, 'rolled_over', from, today);
}

/** Brings one series up to date for `today`. Idempotent. */
async function processOne(c: pg.PoolClient, s: SeriesRow, today: string) {
  const { rows: overdue } = await c.query<{ id: string; occurrence_date: string; scheduled_date: string }>(
    `SELECT id, occurrence_date, scheduled_date FROM tasks
     WHERE series_id = $1 AND status = 'open' AND scheduled_date < $2
     ORDER BY occurrence_date`,
    [s.id, today],
  );

  if (s.kind === 'variable') {
    for (const t of overdue) await rollTo(c, t.id, t.scheduled_date, today);
    const { rows: open } = await c.query('SELECT 1 FROM tasks WHERE series_id = $1 AND status = $2 LIMIT 1', [s.id, 'open']);
    if (open.length === 0 && s.nextDate && s.nextDate <= today && (!s.until || s.nextDate <= s.until)) {
      // If it came due while nobody was around, it starts on today's list.
      await createOccurrence(c, s, s.nextDate, today);
    }
    return;
  }

  // Fixed and optional: create every occurrence date that has arrived since the last run.
  if (s.generatedThrough < today) {
    const from = addDays(s.generatedThrough, 1);
    const dates = from <= capAt(today, s.until) ? occurrencesBetween(schedule(s), from, capAt(today, s.until)).slice(-MAX_CATCH_UP) : [];
    for (const d of dates) await createOccurrence(c, s, d, d);
    await c.query('UPDATE task_series SET generated_through = $2 WHERE id = $1', [s.id, today]);
  }

  // Then settle anything left undone on an earlier day (including catch-up ones just created).
  const { rows: pending } = await c.query<{ id: string; occurrence_date: string; scheduled_date: string }>(
    `SELECT id, occurrence_date, scheduled_date FROM tasks
     WHERE series_id = $1 AND status = 'open' AND scheduled_date < $2
     ORDER BY occurrence_date`,
    [s.id, today],
  );
  const { rows: latest } = await c.query<{ d: string | null }>(
    `SELECT max(occurrence_date) AS d FROM tasks WHERE series_id = $1 AND occurrence_date <= $2`,
    [s.id, today],
  );
  const newest = latest[0]?.d ?? null;
  for (const t of pending) {
    if (s.kind === 'optional') {
      await markMissed(c, t.id, t.scheduled_date);
    } else if (newest && newest > t.occurrence_date) {
      // Fixed: the next occurrence has arrived, so this one is dropped.
      await markMissed(c, t.id, t.scheduled_date);
    } else {
      await rollTo(c, t.id, t.scheduled_date, today);
    }
  }
}

export class SeriesRepo {
  constructor(private readonly db: Db) {}

  /** The daily job: create due occurrences, roll over or miss the undone ones. */
  async processAll(today: string): Promise<void> {
    const { rows } = await this.db.query<{ id: string }>('SELECT id FROM task_series WHERE active');
    for (const { id } of rows) {
      await withTransaction(this.db, async (c) => {
        const { rows: locked } = await c.query<SeriesRow>(
          `SELECT ${SERIES_COLUMNS} FROM task_series WHERE id = $1 AND active FOR UPDATE`,
          [id],
        );
        if (locked[0]) await processOne(c, locked[0], today);
      });
    }
  }

  async get(id: string, db: Queryable = this.db): Promise<SeriesRow | null> {
    const { rows } = await db.query<SeriesRow>(`SELECT ${SERIES_COLUMNS} FROM task_series WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  /**
   * Makes a task repeat (or changes how it repeats). The task becomes the first occurrence
   * and the schedule is anchored on its day.
   */
  async setRepeat(userId: string, taskId: string, input: RepeatInput): Promise<void> {
    const rule = validateRepeat(input);
    const until = input.until ?? null;
    await withTransaction(this.db, async (c) => {
      const task = await this.visibleTask(c, userId, taskId);
      if (task.status !== 'open') throw new HttpError(400, 'Only open tasks can be set to repeat');
      if (!task.scheduled_date) throw new HttpError(400, 'Put the task on a day before making it repeat');
      if (until && until < task.scheduled_date) {
        throw new HttpError(400, '"Repeat until" can\'t be before the task\'s day');
      }
      const members = (
        await c.query<{ user_id: string }>('SELECT user_id FROM task_members WHERE task_id = $1', [taskId])
      ).rows.map((r) => r.user_id);
      const existing = task.series_id ? await this.get(task.series_id, c) : null;
      const anchor = task.scheduled_date;

      if (existing?.active) {
        await c.query(
          `UPDATE task_series SET frequency = $2, repeat_every = $3, weekdays = $4, kind = $5,
             start_date = $6, generated_through = GREATEST(generated_through, $6), next_date = NULL,
             title = $7, notes = $8, priority = $9, member_ids = $10, end_date = $11, updated_at = now()
           WHERE id = $1`,
          [existing.id, rule.frequency, rule.every, rule.weekdays, rule.kind, anchor, task.title, task.notes, task.priority, members, until],
        );
        await c.query('UPDATE tasks SET occurrence_date = COALESCE(occurrence_date, $2) WHERE id = $1', [taskId, anchor]);
      } else {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO task_series (title, notes, priority, frequency, repeat_every, weekdays, kind,
             start_date, generated_through, member_ids, created_by, end_date)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11) RETURNING id`,
          [task.title, task.notes, task.priority, rule.frequency, rule.every, rule.weekdays, rule.kind, anchor, members, userId, until],
        );
        await c.query('UPDATE tasks SET series_id = $2, occurrence_date = $3, updated_at = now() WHERE id = $1', [
          taskId,
          rows[0]!.id,
          anchor,
        ]);
      }
      await logEvent(c, taskId, userId, 'repeat_set', null, anchor);
    });
  }

  /** Stops a series. Existing occurrences stay; any open one becomes an ordinary task. */
  async stopRepeat(userId: string, taskId: string): Promise<void> {
    await withTransaction(this.db, async (c) => {
      const task = await this.visibleTask(c, userId, taskId);
      if (!task.series_id) return;
      await c.query('UPDATE task_series SET active = false, updated_at = now() WHERE id = $1', [task.series_id]);
      await logEvent(c, taskId, userId, 'repeat_stopped', null, null);
    });
  }

  /** After an occurrence's title/notes/priority/members change, future ones follow. */
  async syncTemplate(c: Queryable, taskId: string): Promise<void> {
    await c.query(
      `UPDATE task_series s SET title = t.title, notes = t.notes, priority = t.priority,
         member_ids = ARRAY(SELECT m.user_id FROM task_members m WHERE m.task_id = t.id), updated_at = now()
       FROM tasks t WHERE t.id = $1 AND s.id = t.series_id AND s.active`,
      [taskId],
    );
  }

  /** Flexible series: the next one is due one period after this completion (or skip). */
  async scheduleNextFlexible(c: Queryable, taskId: string, fromDate: string): Promise<void> {
    const { rows } = await c.query<{ id: string; until: string | null } & RepeatRule>(
      `SELECT s.id, s.frequency, s.repeat_every AS every, s.weekdays, s.end_date AS until
       FROM task_series s JOIN tasks t ON t.series_id = s.id
       WHERE t.id = $1 AND s.active AND s.kind = 'variable'`,
      [taskId],
    );
    const s = rows[0];
    if (!s) return;
    const next = addPeriod(s, fromDate);
    // Past the end date: the series is finished.
    await c.query('UPDATE task_series SET next_date = $2, updated_at = now() WHERE id = $1', [
      s.id,
      s.until && next > s.until ? null : next,
    ]);
  }

  /** Future occurrences (after today) of the user's active series within [from, to]. */
  async upcoming(userId: string, from: string, to: string, today: string): Promise<UpcomingOccurrence[]> {
    const start = from > today ? from : addDays(today, 1);
    if (start > to) return [];
    const { rows: series } = await this.db.query<SeriesRow & { openDate: string | null }>(
      `SELECT ${SERIES_COLUMNS},
         (SELECT max(t.scheduled_date) FROM tasks t WHERE t.series_id = task_series.id AND t.status = 'open') AS "openDate"
       FROM task_series WHERE active AND $1 = ANY(member_ids)`,
      [userId],
    );
    const out: UpcomingOccurrence[] = [];
    for (const s of series) {
      const end = capAt(to, s.until);
      if (end < start) continue;
      const base = {
        seriesId: s.id,
        title: s.title,
        priority: s.priority,
        kind: s.kind,
        frequency: s.frequency,
        every: s.every,
        weekdays: s.weekdays,
      };
      if (s.kind === 'variable') {
        // Estimated: assumes the open occurrence is done today (or on its future day).
        let d = s.openDate ? addPeriod(s, s.openDate > today ? s.openDate : today) : s.nextDate;
        for (let i = 0; d && d <= end && i < 400; i++, d = addPeriod(s, d)) {
          if (d >= start) out.push({ ...base, date: d, estimated: s.openDate !== null });
        }
      } else {
        const after = addDays(s.generatedThrough, 1);
        for (const d of occurrencesBetween(schedule(s), after > start ? after : start, end)) {
          out.push({ ...base, date: d, estimated: false });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  private async visibleTask(c: pg.PoolClient, userId: string, taskId: string) {
    const { rows } = await c.query<{
      id: string;
      title: string;
      notes: string;
      priority: string;
      status: string;
      scheduled_date: string | null;
      series_id: string | null;
    }>(
      `SELECT t.id, t.title, t.notes, t.priority, t.status, t.scheduled_date, t.series_id FROM tasks t
       WHERE t.id = $2 AND EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id AND m.user_id = $1)
       FOR UPDATE`,
      [userId, taskId],
    );
    if (!rows[0]) throw new HttpError(404, 'Task not found');
    return rows[0];
  }
}
