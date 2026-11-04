import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { addDays, todayIn } from '../src/dates.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createRolloverScheduler, rolloverTasks } from '../src/rollover.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('API (needs TEST_DATABASE_URL)', () => {
  const config: AppConfig = {
    port: 0,
    databaseUrl: databaseUrl!,
    databaseSsl: false,
    appPassword: 'correct horse battery staple',
    sessionSecret: 's'.repeat(32),
    timezone: 'Europe/Oslo',
    isProduction: false,
  };
  const db = createPool(config.databaseUrl);
  const scheduler = createRolloverScheduler(db, config.timezone);
  const app = createApp({ db, config, scheduler });
  const agent = request.agent(app);
  const today = todayIn(config.timezone);

  beforeAll(async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    await agent.post('/api/auth/login').send({ password: config.appPassword }).expect(200);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE tasks CASCADE');
  });

  afterAll(async () => {
    await db.end();
  });

  describe('auth', () => {
    it('rejects requests without a session', async () => {
      await request(app).get('/api/tasks/backlog').expect(401);
      await request(app).get('/api/auth/me').expect(200, { signedIn: false });
    });

    it('rejects a wrong password', async () => {
      await request(app).post('/api/auth/login').send({ password: 'nope' }).expect(401);
    });

    it('reports a signed-in session', async () => {
      await agent.get('/api/auth/me').expect(200, { signedIn: true });
    });
  });

  describe('tasks', () => {
    it('creates a task on today by default and lists it on the day page', async () => {
      const { body: task } = await agent.post('/api/tasks').send({ title: '  Write spec  ' }).expect(201);
      expect(task).toMatchObject({ title: 'Write spec', status: 'open', priority: 'medium', scheduledDate: today });

      const { body: day } = await agent.get(`/api/tasks/day/${today}`).expect(200);
      expect(day.open.map((t: { id: string }) => t.id)).toEqual([task.id]);
      expect(day.done).toEqual([]);
    });

    it('puts tasks with scheduledDate null in the backlog', async () => {
      await agent.post('/api/tasks').send({ title: 'Someday', scheduledDate: null }).expect(201);
      const { body } = await agent.get('/api/tasks/backlog').expect(200);
      expect(body.tasks.map((t: { title: string }) => t.title)).toEqual(['Someday']);
    });

    it('orders open tasks by priority', async () => {
      for (const [title, priority] of [['b', 'low'], ['c', 'urgent'], ['a', 'high']]) {
        await agent.post('/api/tasks').send({ title, priority }).expect(201);
      }
      const { body } = await agent.get(`/api/tasks/day/${today}`).expect(200);
      expect(body.open.map((t: { title: string }) => t.title)).toEqual(['c', 'a', 'b']);
    });

    it('refuses to schedule open tasks in the past', async () => {
      await agent.post('/api/tasks').send({ title: 'x', scheduledDate: addDays(today, -1) }).expect(400);
      const { body: task } = await agent.post('/api/tasks').send({ title: 'x' }).expect(201);
      await agent.patch(`/api/tasks/${task.id}`).send({ scheduledDate: addDays(today, -1) }).expect(400);
    });

    it('validates input', async () => {
      await agent.post('/api/tasks').send({ title: '' }).expect(400);
      await agent.post('/api/tasks').send({ title: 'x', priority: 'whenever' }).expect(400);
      await agent.post('/api/tasks').send({ title: 'x', dueDate: '2026-02-30' }).expect(400);
      await agent.get('/api/tasks/not-a-uuid').expect(404);
    });

    it('completes, reopens and records history', async () => {
      const { body: task } = await agent.post('/api/tasks').send({ title: 'Ship it' }).expect(201);
      const { body: done } = await agent.post(`/api/tasks/${task.id}/complete`).expect(200);
      expect(done).toMatchObject({ status: 'done', completedOn: today });

      const { body: day } = await agent.get(`/api/tasks/day/${today}`).expect(200);
      expect(day.open).toEqual([]);
      expect(day.done.map((t: { id: string }) => t.id)).toEqual([task.id]);

      const { body: history } = await agent.get('/api/tasks/history').expect(200);
      expect(history.tasks.map((t: { id: string }) => t.id)).toEqual([task.id]);

      const { body: reopened } = await agent.post(`/api/tasks/${task.id}/reopen`).expect(200);
      expect(reopened).toMatchObject({ status: 'open', completedOn: null, scheduledDate: today });

      const { rows } = await db.query('SELECT type FROM task_events WHERE task_id = $1 ORDER BY id', [task.id]);
      expect(rows.map((r) => r.type)).toEqual(['created', 'completed', 'reopened']);
    });

    it('logs reschedules and deletes tasks', async () => {
      const { body: task } = await agent.post('/api/tasks').send({ title: 'Later' }).expect(201);
      const tomorrow = addDays(today, 1);
      const { body: moved } = await agent.patch(`/api/tasks/${task.id}`).send({ scheduledDate: tomorrow }).expect(200);
      expect(moved.scheduledDate).toBe(tomorrow);

      const { rows } = await db.query(
        `SELECT from_date, to_date FROM task_events WHERE task_id = $1 AND type = 'rescheduled'`,
        [task.id],
      );
      expect(rows).toEqual([{ from_date: today, to_date: tomorrow }]);

      await agent.delete(`/api/tasks/${task.id}`).expect(204);
      await agent.get(`/api/tasks/${task.id}`).expect(404);
    });
  });

  describe('rollover', () => {
    async function insertOpenTask(title: string, scheduledDate: string | null) {
      const { rows } = await db.query(
        `INSERT INTO tasks (title, scheduled_date, original_date) VALUES ($1, $2, $2) RETURNING id`,
        [title, scheduledDate],
      );
      return rows[0].id as string;
    }

    it('moves unfinished tasks from past days to today, once', async () => {
      const stale = await insertOpenTask('stale', addDays(today, -3));
      const current = await insertOpenTask('current', today);
      const future = await insertOpenTask('future', addDays(today, 2));
      const backlog = await insertOpenTask('backlog', null);
      const finished = await insertOpenTask('finished', addDays(today, -1));
      await db.query(
        `UPDATE tasks SET status = 'done', completed_at = now(), completed_on = $2 WHERE id = $1`,
        [finished, addDays(today, -1)],
      );

      expect(await rolloverTasks(db, today)).toBe(1);
      expect(await rolloverTasks(db, today)).toBe(0);

      const { rows } = await db.query(
        `SELECT id, scheduled_date, original_date, rollover_count FROM tasks`,
      );
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
      expect(byId[stale]).toMatchObject({ scheduled_date: today, original_date: addDays(today, -3), rollover_count: 1 });
      expect(byId[current].scheduled_date).toBe(today);
      expect(byId[future].scheduled_date).toBe(addDays(today, 2));
      expect(byId[backlog].scheduled_date).toBeNull();
      expect(byId[finished].scheduled_date).toBe(addDays(today, -1));

      const { rows: events } = await db.query(`SELECT task_id, from_date, to_date FROM task_events WHERE type = 'rolled_over'`);
      expect(events).toEqual([{ task_id: stale, from_date: addDays(today, -3), to_date: today }]);
    });

    it('runs again when the day changes', async () => {
      let now = new Date('2026-11-04T12:00:00Z');
      const clocked = createRolloverScheduler(db, 'UTC', () => {}, () => now);
      const id = await insertOpenTask('carry me', '2026-11-03');

      await clocked.ensure();
      now = new Date('2026-11-05T00:01:00Z');
      await clocked.ensure();
      await clocked.ensure();

      const { rows } = await db.query('SELECT scheduled_date, rollover_count FROM tasks WHERE id = $1', [id]);
      expect(rows[0]).toEqual({ scheduled_date: '2026-11-05', rollover_count: 2 });
    });
  });
});
