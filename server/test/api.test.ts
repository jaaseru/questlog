import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { addDays, todayIn } from '../src/dates.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createRolloverScheduler, rolloverTasks } from '../src/rollover.js';
import { bootstrapFirstUser, UserRepo, type User } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('API (needs TEST_DATABASE_URL)', () => {
  const config: AppConfig = {
    port: 0,
    databaseUrl: databaseUrl!,
    databaseSsl: false,
    appPassword: '',
    adminUsername: 'admin',
    weatherUserAgent: 'questlog-test',
    sessionSecret: 's'.repeat(32),
    timezone: 'Europe/Oslo',
    isProduction: false,
  };
  const db = createPool(config.databaseUrl);
  const users = new UserRepo(db);
  const scheduler = createRolloverScheduler(db, config.timezone);
  const app = createApp({ db, config, scheduler, loginLimits: { attemptsPerIp: 10_000, failuresPerUsername: 10_000 } });
  const today = todayIn(config.timezone);
  const PASSWORD = 'correct horse battery';

  let alice: User, bob: User, carol: User;
  const as = {
    alice: request.agent(app),
    bob: request.agent(app),
    carol: request.agent(app),
  };

  const ids = (list: { id: string }[]) => list.map((t) => t.id);

  async function resetSchema() {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
  }

  beforeAll(async () => {
    await resetSchema();
    alice = await users.create({ username: 'alice', displayName: 'Alice', password: PASSWORD });
    bob = await users.create({ username: 'bob', displayName: 'Bob', password: PASSWORD });
    carol = await users.create({ username: 'carol', displayName: 'Carol', password: PASSWORD });
    for (const name of ['alice', 'bob', 'carol'] as const) {
      await as[name].post('/api/auth/login').send({ username: name, password: PASSWORD }).expect(200);
    }
  });

  beforeEach(async () => {
    await db.query('TRUNCATE tasks CASCADE');
    // Tests that disable Carol end her session; bring her back for the next test.
    const current = await users.get(carol.id); // absent once the upgrade tests rebuild the schema
    if (current && (current.disabled || (await as.carol.get('/api/auth/me')).body.signedIn !== true)) {
      await db.query('UPDATE users SET disabled = false');
      await as.carol.post('/api/auth/login').send({ username: 'carol', password: PASSWORD }).expect(200);
    }
  });

  afterAll(async () => {
    await db.end();
  });

  describe('auth', () => {
    it('rejects requests without a session', async () => {
      await request(app).get('/api/tasks/backlog').expect(401);
      await request(app).get('/api/auth/me').expect(200, { signedIn: false });
    });

    it('rejects wrong passwords and unknown users with the same message', async () => {
      const wrong = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'nope' }).expect(401);
      const unknown = await request(app).post('/api/auth/login').send({ username: 'mallory', password: 'x' }).expect(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('accepts usernames case-insensitively and reports the user', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: ' Alice ', password: PASSWORD }).expect(200);
      const { body } = await agent.get('/api/auth/me').expect(200);
      expect(body).toEqual({ signedIn: true, user: { id: alice.id, username: 'alice', displayName: 'Alice', isAdmin: true } });
    });

    it('signs out disabled users immediately and refuses their login', async () => {
      await users.setDisabled(carol.id, true);
      await as.carol.get('/api/tasks/backlog').expect(401);
      await request(app).post('/api/auth/login').send({ username: 'carol', password: PASSWORD }).expect(401);
      await users.setDisabled(carol.id, false);
      // Re-enabling doesn't revive old sessions: Carol signs in again.
      await as.carol.get('/api/tasks/backlog').expect(401);
      await as.carol.post('/api/auth/login').send({ username: 'carol', password: PASSWORD }).expect(200);
      await as.carol.get('/api/tasks/backlog').expect(200);
    });

    it('lists active users for sharing', async () => {
      await users.setDisabled(carol.id, true);
      const { body } = await as.alice.get('/api/users').expect(200);
      expect(body.users.map((u: { username: string }) => u.username)).toEqual(['alice', 'bob']);
      expect(body.users[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('tasks', () => {
    it('creates a task on today by default, owned by the creator', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: '  Write spec  ' }).expect(201);
      expect(task).toMatchObject({
        title: 'Write spec',
        status: 'open',
        priority: 'medium',
        scheduledDate: today,
        createdBy: alice.id,
        memberIds: [alice.id],
      });
      const { body: day } = await as.alice.get(`/api/tasks/day/${today}`).expect(200);
      expect(ids(day.open)).toEqual([task.id]);
    });

    it('puts tasks with scheduledDate null in the backlog', async () => {
      await as.alice.post('/api/tasks').send({ title: 'Someday', scheduledDate: null }).expect(201);
      const { body } = await as.alice.get('/api/tasks/backlog').expect(200);
      expect(body.tasks.map((t: { title: string }) => t.title)).toEqual(['Someday']);
    });

    it('orders open tasks by priority', async () => {
      for (const [title, priority] of [['b', 'low'], ['c', 'urgent'], ['a', 'high']]) {
        await as.alice.post('/api/tasks').send({ title, priority }).expect(201);
      }
      const { body } = await as.alice.get(`/api/tasks/day/${today}`).expect(200);
      expect(body.open.map((t: { title: string }) => t.title)).toEqual(['c', 'a', 'b']);
    });

    it('refuses to schedule open tasks in the past', async () => {
      await as.alice.post('/api/tasks').send({ title: 'x', scheduledDate: addDays(today, -1) }).expect(400);
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'x' }).expect(201);
      await as.alice.patch(`/api/tasks/${task.id}`).send({ scheduledDate: addDays(today, -1) }).expect(400);
    });

    it('validates input', async () => {
      await as.alice.post('/api/tasks').send({ title: '' }).expect(400);
      await as.alice.post('/api/tasks').send({ title: 'x', priority: 'whenever' }).expect(400);
      await as.alice.post('/api/tasks').send({ title: 'x', dueDate: '2026-02-30' }).expect(400);
      await as.alice.post('/api/tasks').send({ title: 'x', memberIds: ['not-a-uuid'] }).expect(400);
      await as.alice.get('/api/tasks/not-a-uuid').expect(404);
    });

    it('completes, reopens and records history with the acting user', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'Ship it' }).expect(201);
      const { body: done } = await as.alice.post(`/api/tasks/${task.id}/complete`).expect(200);
      expect(done).toMatchObject({ status: 'done', completedOn: today, completedBy: alice.id });

      const { body: day } = await as.alice.get(`/api/tasks/day/${today}`).expect(200);
      expect(day.open).toEqual([]);
      expect(ids(day.done)).toEqual([task.id]);
      const { body: history } = await as.alice.get('/api/tasks/history').expect(200);
      expect(ids(history.tasks)).toEqual([task.id]);

      const { body: reopened } = await as.alice.post(`/api/tasks/${task.id}/reopen`).expect(200);
      expect(reopened).toMatchObject({ status: 'open', completedOn: null, completedBy: null, scheduledDate: today });

      const { rows } = await db.query('SELECT type, user_id FROM task_events WHERE task_id = $1 ORDER BY id', [task.id]);
      expect(rows).toEqual([
        { type: 'created', user_id: alice.id },
        { type: 'completed', user_id: alice.id },
        { type: 'reopened', user_id: alice.id },
      ]);
    });

    it('logs reschedules and deletes tasks', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'Later' }).expect(201);
      const tomorrow = addDays(today, 1);
      const { body: moved } = await as.alice.patch(`/api/tasks/${task.id}`).send({ scheduledDate: tomorrow }).expect(200);
      expect(moved.scheduledDate).toBe(tomorrow);
      const { rows } = await db.query(
        `SELECT from_date, to_date FROM task_events WHERE task_id = $1 AND type = 'rescheduled'`,
        [task.id],
      );
      expect(rows).toEqual([{ from_date: today, to_date: tomorrow }]);

      await as.alice.delete(`/api/tasks/${task.id}`).expect(204);
      await as.alice.get(`/api/tasks/${task.id}`).expect(404);
    });
  });

  describe('privacy', () => {
    it("never exposes one user's private tasks to another", async () => {
      const { body: secret } = await as.alice.post('/api/tasks').send({ title: 'Private', dueDate: today }).expect(201);
      const { body: backlogSecret } = await as.alice.post('/api/tasks').send({ title: 'P2', scheduledDate: null }).expect(201);
      await as.alice.post(`/api/tasks/${backlogSecret.id}/complete`).expect(200);

      const { body: day } = await as.bob.get(`/api/tasks/day/${today}`).expect(200);
      expect([...day.open, ...day.done]).toEqual([]);
      expect((await as.bob.get('/api/tasks/backlog').expect(200)).body.tasks).toEqual([]);
      expect((await as.bob.get('/api/tasks/history').expect(200)).body.tasks).toEqual([]);
      const { body: cal } = await as.bob.get(`/api/tasks/calendar?from=${today}&to=${today}`).expect(200);
      expect([...cal.open, ...cal.done, ...cal.due]).toEqual([]);

      await as.bob.get(`/api/tasks/${secret.id}`).expect(404);
      await as.bob.patch(`/api/tasks/${secret.id}`).send({ title: 'pwned' }).expect(404);
      await as.bob.patch(`/api/tasks/${secret.id}`).send({ memberIds: [bob.id] }).expect(404);
      await as.bob.post(`/api/tasks/${secret.id}/complete`).expect(404);
      await as.bob.post(`/api/tasks/${backlogSecret.id}/reopen`).expect(404);
      await as.bob.delete(`/api/tasks/${secret.id}`).expect(404);

      const { body: still } = await as.alice.get(`/api/tasks/${secret.id}`).expect(200);
      expect(still).toMatchObject({ title: 'Private', status: 'open', memberIds: [alice.id] });
    });
  });

  describe('sharing', () => {
    it('lets every member see and complete a shared task', async () => {
      const { body: task } = await as.alice
        .post('/api/tasks')
        .send({ title: 'Plan offsite', memberIds: [bob.id] })
        .expect(201);
      expect(task.memberIds).toEqual(expect.arrayContaining([alice.id, bob.id]));
      expect(task.memberIds).toHaveLength(2);

      const { body: bobsDay } = await as.bob.get(`/api/tasks/day/${today}`).expect(200);
      expect(ids(bobsDay.open)).toEqual([task.id]);
      await as.carol.get(`/api/tasks/${task.id}`).expect(404);

      const { body: done } = await as.bob.post(`/api/tasks/${task.id}/complete`).expect(200);
      expect(done.completedBy).toBe(bob.id);
      const { body: alicesDay } = await as.alice.get(`/api/tasks/day/${today}`).expect(200);
      expect(alicesDay.done).toEqual([expect.objectContaining({ id: task.id, completedBy: bob.id })]);
    });

    it('lets members change who a task is shared with, including leaving it', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'Groceries' }).expect(201);
      await as.alice.patch(`/api/tasks/${task.id}`).send({ memberIds: [alice.id, bob.id, carol.id] }).expect(200);
      await as.carol.get(`/api/tasks/${task.id}`).expect(200);

      // Bob leaves.
      const { body: afterLeave } = await as.bob
        .patch(`/api/tasks/${task.id}`)
        .send({ memberIds: [alice.id, carol.id] })
        .expect(200);
      expect(afterLeave.memberIds).not.toContain(bob.id);
      await as.bob.get(`/api/tasks/${task.id}`).expect(404);

      const { rows } = await db.query(
        `SELECT user_id FROM task_events WHERE task_id = $1 AND type = 'members_changed' ORDER BY id`,
        [task.id],
      );
      expect(rows.map((r) => r.user_id)).toEqual([alice.id, bob.id]);
    });

    it('rejects empty member lists and inactive or unknown users', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'x' }).expect(201);
      await as.alice.patch(`/api/tasks/${task.id}`).send({ memberIds: [] }).expect(400);
      await as.alice
        .post('/api/tasks')
        .send({ title: 'y', memberIds: ['00000000-0000-4000-8000-000000000000'] })
        .expect(400);
      await users.setDisabled(carol.id, true);
      await as.alice.patch(`/api/tasks/${task.id}`).send({ memberIds: [alice.id, carol.id] }).expect(400);
      const { body: unchanged } = await as.alice.get(`/api/tasks/${task.id}`).expect(200);
      expect(unchanged.memberIds).toEqual([alice.id]);
    });

    it('only lets the creator delete a shared task', async () => {
      const { body: task } = await as.alice.post('/api/tasks').send({ title: 'Ours', memberIds: [bob.id] }).expect(201);
      await as.bob.delete(`/api/tasks/${task.id}`).expect(403);
      await as.alice.delete(`/api/tasks/${task.id}`).expect(204);
      await as.bob.get(`/api/tasks/${task.id}`).expect(404);
    });
  });

  describe('calendar', () => {
    it('returns completed, planned and due tasks within the range', async () => {
      const tomorrow = addDays(today, 1);
      const nextWeek = addDays(today, 7);
      const { body: finished } = await as.alice.post('/api/tasks').send({ title: 'finished' }).expect(201);
      await as.alice.post(`/api/tasks/${finished.id}/complete`).expect(200);
      const { body: planned } = await as.alice
        .post('/api/tasks')
        .send({ title: 'planned', scheduledDate: tomorrow })
        .expect(201);
      const { body: deadline } = await as.alice
        .post('/api/tasks')
        .send({ title: 'deadline', scheduledDate: null, dueDate: nextWeek })
        .expect(201);
      await as.alice.post('/api/tasks').send({ title: 'out of range', scheduledDate: addDays(today, 40) }).expect(201);

      const { body } = await as.alice.get(`/api/tasks/calendar?from=${today}&to=${addDays(today, 13)}`).expect(200);
      expect(ids(body.done)).toEqual([finished.id]);
      expect(ids(body.open)).toEqual([planned.id]);
      expect(ids(body.due)).toEqual([deadline.id]);
    });

    it('rejects missing, inverted and oversized ranges', async () => {
      await as.alice.get('/api/tasks/calendar').expect(400);
      await as.alice.get(`/api/tasks/calendar?from=${today}&to=${addDays(today, -1)}`).expect(400);
      await as.alice.get(`/api/tasks/calendar?from=${today}&to=${addDays(today, 62)}`).expect(400);
      await as.alice.get(`/api/tasks/calendar?from=${today}&to=${addDays(today, 61)}`).expect(200);
    });
  });

  describe('rollover', () => {
    async function insertOpenTask(title: string, scheduledDate: string | null) {
      const { rows } = await db.query(
        `INSERT INTO tasks (title, scheduled_date, original_date, created_by) VALUES ($1, $2, $2, $3) RETURNING id`,
        [title, scheduledDate, alice.id],
      );
      await db.query('INSERT INTO task_members (task_id, user_id) VALUES ($1, $2)', [rows[0].id, alice.id]);
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

      const { rows } = await db.query(`SELECT id, scheduled_date, original_date, rollover_count FROM tasks`);
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

  // Runs last: it rebuilds the schema to simulate a database from the single-user version.
  describe('upgrade from single-user', () => {
    it('creates the first user from APP_PASSWORD and gives it every existing task', async () => {
      await resetSchema();
      await db.query(`INSERT INTO tasks (title, scheduled_date) VALUES ('legacy one', $1), ('legacy two', NULL)`, [today]);
      const logs: string[] = [];

      await bootstrapFirstUser(users, { username: 'julian', password: 'short' }, (m) => logs.push(m));
      await bootstrapFirstUser(users, { username: 'other', password: 'whatever' }, (m) => logs.push(m));

      expect((await users.list()).map((u) => u.username)).toEqual(['julian']);
      expect(logs).toHaveLength(1);
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ username: 'julian', password: 'short' }).expect(200);
      const { body: day } = await agent.get(`/api/tasks/day/${today}`).expect(200);
      expect(day.open.map((t: { title: string }) => t.title)).toEqual(['legacy one']);
      const { body: backlog } = await agent.get('/api/tasks/backlog').expect(200);
      expect(backlog.tasks).toEqual([expect.objectContaining({ title: 'legacy two', createdBy: day.open[0].createdBy })]);
    });

    it('does nothing without APP_PASSWORD', async () => {
      await resetSchema();
      const logs: string[] = [];
      await bootstrapFirstUser(users, { username: 'admin', password: '' }, (m) => logs.push(m));
      expect(await users.count()).toBe(0);
      expect(logs[0]).toMatch(/users\.js add/);
    });
  });
});
