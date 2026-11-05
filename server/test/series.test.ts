import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { addDays, todayIn } from '../src/dates.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { isoWeekday } from '../src/recurrence.js';
import { createRolloverScheduler, rolloverTasks } from '../src/rollover.js';
import { SeriesRepo } from '../src/series.js';
import { TaskRepo } from '../src/tasks/repo.js';
import { UserRepo, type User } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('repeating tasks (needs TEST_DATABASE_URL)', () => {
  const config: AppConfig = {
    port: 0,
    databaseUrl: databaseUrl!,
    databaseSsl: false,
    appPassword: '',
    adminUsername: 'admin',
    sessionSecret: 's'.repeat(32),
    timezone: 'UTC',
    isProduction: false,
  };
  const db = createPool(config.databaseUrl);
  const users = new UserRepo(db);
  const tasks = new TaskRepo(db);
  const series = new SeriesRepo(db);
  const scheduler = createRolloverScheduler(db, config.timezone);
  const app = createApp({ db, config, scheduler, loginLimits: { attemptsPerIp: 10_000, failuresPerUsername: 10_000 } });
  const T = todayIn('UTC');
  const day = (n: number) => addDays(T, n);
  const PASSWORD = 'correct horse battery';

  let alice: User, bob: User;
  const asAlice = request.agent(app);
  const asBob = request.agent(app);

  /** Simulates the nightly job on a given day: ordinary roll-over plus series processing. */
  async function runDay(date: string) {
    await rolloverTasks(db, date);
    await series.processAll(date);
  }

  async function occurrences(seriesId: string) {
    const { rows } = await db.query<{
      id: string;
      occurrence_date: string;
      scheduled_date: string;
      status: string;
      rollover_count: number;
    }>(
      `SELECT id, occurrence_date, scheduled_date, status, rollover_count FROM tasks
       WHERE series_id = $1 ORDER BY occurrence_date`,
      [seriesId],
    );
    return rows;
  }

  async function repeating(title: string, repeat: object, extra: object = {}) {
    const { body: task } = await asAlice.post('/api/tasks').send({ title, ...extra }).expect(201);
    const { body } = await asAlice.put(`/api/tasks/${task.id}/repeat`).send(repeat).expect(200);
    return body as { id: string; seriesId: string; repeat: unknown };
  }

  beforeAll(async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    alice = await users.create({ username: 'alice', displayName: 'Alice', password: PASSWORD });
    bob = await users.create({ username: 'bob', displayName: 'Bob', password: PASSWORD });
    await asAlice.post('/api/auth/login').send({ username: 'alice', password: PASSWORD }).expect(200);
    await asBob.post('/api/auth/login').send({ username: 'bob', password: PASSWORD }).expect(200);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE tasks, task_series CASCADE');
  });

  afterAll(async () => {
    await db.end();
  });

  describe('setting a repeat', () => {
    it('turns a task into the first occurrence and reports the rule', async () => {
      const task = await repeating('Standup', { frequency: 'daily', kind: 'optional' });
      expect(task.seriesId).toEqual(expect.any(String));
      expect(task.repeat).toEqual({ frequency: 'daily', every: 1, weekdays: [], kind: 'optional' });
      expect(await occurrences(task.seriesId)).toEqual([
        expect.objectContaining({ occurrence_date: T, scheduled_date: T, status: 'open' }),
      ]);
    });

    it('validates the rule and the task', async () => {
      const { body: task } = await asAlice.post('/api/tasks').send({ title: 'x' }).expect(201);
      const put = (body: object) => asAlice.put(`/api/tasks/${task.id}/repeat`).send(body);
      await put({ frequency: 'hourly', kind: 'optional' }).expect(400);
      await put({ frequency: 'daily', kind: 'sometimes' }).expect(400);
      await put({ frequency: 'daily', every: 0, kind: 'optional' }).expect(400);
      await put({ frequency: 'daily', weekdays: [1], kind: 'optional' }).expect(400);
      await put({ frequency: 'weekly', weekdays: [1, 4], kind: 'variable' }).expect(400);
      await put({ frequency: 'weekly', weekdays: [8], kind: 'fixed' }).expect(400);

      const { body: backlog } = await asAlice.post('/api/tasks').send({ title: 'b', scheduledDate: null }).expect(201);
      await asAlice.put(`/api/tasks/${backlog.id}/repeat`).send({ frequency: 'daily', kind: 'fixed' }).expect(400);

      await asAlice.post(`/api/tasks/${task.id}/complete`).expect(200);
      await put({ frequency: 'daily', kind: 'fixed' }).expect(400);
      await asBob.put(`/api/tasks/${task.id}/repeat`).send({ frequency: 'daily', kind: 'fixed' }).expect(404);
    });
  });

  describe('optional', () => {
    it('is marked missed when not done on its day, and the next one appears', async () => {
      const { seriesId } = await repeating('Stretch', { frequency: 'daily', kind: 'optional' });
      await runDay(day(1));
      await runDay(day(1)); // idempotent
      expect(await occurrences(seriesId)).toEqual([
        expect.objectContaining({ occurrence_date: T, scheduled_date: T, status: 'missed', rollover_count: 0 }),
        expect.objectContaining({ occurrence_date: day(1), scheduled_date: day(1), status: 'open' }),
      ]);
      const { body } = await asAlice.get(`/api/tasks/day/${T}`).expect(200);
      expect(body.missed.map((t: { title: string }) => t.title)).toEqual(['Stretch']);
    });

    it('catches up after days without a run, and missed ones can still be completed late', async () => {
      const { seriesId } = await repeating('Vitamins', { frequency: 'daily', kind: 'optional' });
      await runDay(day(4));
      const occ = await occurrences(seriesId);
      expect(occ.map((o) => [o.occurrence_date, o.status])).toEqual([
        [T, 'missed'],
        [day(1), 'missed'],
        [day(2), 'missed'],
        [day(3), 'missed'],
        [day(4), 'open'],
      ]);
      const late = await tasks.complete(alice.id, occ[1]!.id, day(4));
      expect(late).toMatchObject({ status: 'done', completedOn: day(4) });
    });
  });

  describe('mandatory, fixed day', () => {
    it('rolls over each day until the next occurrence arrives, then the old one is missed', async () => {
      const { seriesId } = await repeating('Weekly report', { frequency: 'weekly', kind: 'fixed' });
      for (let n = 1; n <= 6; n++) await runDay(day(n));
      expect(await occurrences(seriesId)).toEqual([
        expect.objectContaining({ occurrence_date: T, scheduled_date: day(6), status: 'open', rollover_count: 6 }),
      ]);
      await runDay(day(7));
      expect(await occurrences(seriesId)).toEqual([
        expect.objectContaining({ occurrence_date: T, scheduled_date: day(6), status: 'missed' }),
        expect.objectContaining({ occurrence_date: day(7), scheduled_date: day(7), status: 'open' }),
      ]);
    });

    it('keeps completed occurrences done and follows the fixed dates', async () => {
      const { id, seriesId } = await repeating('Bins out', { frequency: 'weekly', kind: 'fixed' });
      await runDay(day(2));
      await tasks.complete(alice.id, id, day(2)); // two days late
      await runDay(day(7));
      expect((await occurrences(seriesId)).map((o) => [o.occurrence_date, o.status])).toEqual([
        [T, 'done'],
        [day(7), 'open'],
      ]);
    });

    it('supports twice a week', async () => {
      const weekdays = [isoWeekday(T), isoWeekday(day(3))];
      await repeating('Gym', { frequency: 'weekly', weekdays, kind: 'fixed' });
      const { body } = await asAlice.get(`/api/tasks/calendar?from=${day(1)}&to=${day(10)}`).expect(200);
      expect(body.upcoming.map((u: { date: string }) => u.date)).toEqual([day(3), day(7), day(10)]);
    });
  });

  describe('mandatory, flexible (variable) day', () => {
    it('rolls over, and the whole series shifts to one period after completion', async () => {
      const { id, seriesId } = await repeating('Water plants', { frequency: 'weekly', kind: 'variable' });
      for (let n = 1; n <= 3; n++) await runDay(day(n));
      expect((await occurrences(seriesId))[0]).toMatchObject({ scheduled_date: day(3), status: 'open', rollover_count: 3 });

      await tasks.complete(alice.id, id, day(3));
      const upcoming = await series.upcoming(alice.id, day(4), day(20), day(3));
      expect(upcoming.map((u) => u.date)).toEqual([day(10), day(17)]);
      expect(upcoming[0]!.estimated).toBe(false);

      await runDay(day(9));
      expect(await occurrences(seriesId)).toHaveLength(1);
      await runDay(day(10));
      expect((await occurrences(seriesId)).map((o) => [o.occurrence_date, o.scheduled_date, o.status])).toEqual([
        [T, day(3), 'done'],
        [day(10), day(10), 'open'],
      ]);
    });

    it('shows estimated dates while the current one is still open', async () => {
      await repeating('Haircut', { frequency: 'monthly', kind: 'variable' });
      const [next] = await series.upcoming(alice.id, day(1), day(40), T);
      expect(next).toMatchObject({ estimated: true, title: 'Haircut' });
    });

    it('treats deleting the open occurrence as skipping it', async () => {
      const { id, seriesId } = await repeating('Call grandma', { frequency: 'weekly', kind: 'variable' });
      await runDay(day(2));
      expect(await tasks.delete(alice.id, id, day(2))).toBe('deleted');
      await runDay(day(8));
      expect(await occurrences(seriesId)).toHaveLength(0);
      await runDay(day(9));
      expect((await occurrences(seriesId)).map((o) => o.occurrence_date)).toEqual([day(9)]);
    });
  });

  describe('series behaviour', () => {
    it('applies title and priority edits to future occurrences', async () => {
      const { id, seriesId } = await repeating('Standup', { frequency: 'daily', kind: 'fixed' });
      await asAlice.patch(`/api/tasks/${id}`).send({ title: 'Team standup', priority: 'high' }).expect(200);
      await tasks.complete(alice.id, id, T);
      await runDay(day(1));
      const [, next] = await occurrences(seriesId);
      expect(await tasks.get(alice.id, next!.id)).toMatchObject({ title: 'Team standup', priority: 'high' });
    });

    it('shares occurrences and previews with the series members only', async () => {
      const { id, seriesId } = await repeating('Groceries', { frequency: 'daily', kind: 'fixed' }, { memberIds: [bob.id] });
      expect((await series.upcoming(bob.id, day(1), day(2), T)).map((u) => u.date)).toEqual([day(1), day(2)]);
      await tasks.complete(bob.id, id, T);
      await runDay(day(1));
      const { body } = await asBob.get(`/api/tasks/day/${day(1)}`).expect(200);
      expect(body.open.map((t: { seriesId: string }) => t.seriesId)).toEqual([seriesId]);

      const { body: solo } = await asAlice.post('/api/tasks').send({ title: 'Private' }).expect(201);
      await asAlice.put(`/api/tasks/${solo.id}/repeat`).send({ frequency: 'daily', kind: 'optional' }).expect(200);
      // Day 1 already ran above, so look at day 2.
      expect((await series.upcoming(bob.id, day(2), day(2), T)).map((u) => u.title)).toEqual(['Groceries']);
    });

    it('lists upcoming occurrences on future day pages, not on today or past days', async () => {
      await repeating('Stretch', { frequency: 'daily', kind: 'optional' });
      expect((await asAlice.get(`/api/tasks/day/${day(2)}`).expect(200)).body.upcoming).toEqual([
        expect.objectContaining({ date: day(2), title: 'Stretch' }),
      ]);
      expect((await asAlice.get(`/api/tasks/day/${T}`).expect(200)).body.upcoming).toEqual([]);
    });

    it('stops repeating: nothing new is created and the open one becomes an ordinary task', async () => {
      const { id, seriesId } = await repeating('Daily log', { frequency: 'daily', kind: 'optional' });
      const { body } = await asAlice.delete(`/api/tasks/${id}/repeat`).expect(200);
      expect(body.repeat).toBeNull();
      await runDay(day(1));
      expect(await occurrences(seriesId)).toEqual([
        expect.objectContaining({ occurrence_date: T, scheduled_date: day(1), status: 'open', rollover_count: 1 }),
      ]);
      expect(await series.upcoming(alice.id, day(1), day(5), T)).toEqual([]);
    });

    it('changing the rule re-anchors the schedule on the task', async () => {
      const { id, seriesId } = await repeating('Review', { frequency: 'daily', kind: 'fixed' });
      await asAlice.put(`/api/tasks/${id}/repeat`).send({ frequency: 'weekly', every: 2, kind: 'fixed' }).expect(200);
      const upcoming = await series.upcoming(alice.id, day(1), day(30), T);
      expect(upcoming.map((u) => u.date)).toEqual([day(14), day(28)]);
      expect(upcoming.every((u) => u.seriesId === seriesId)).toBe(true);
    });
  });
});
