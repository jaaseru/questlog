import { createECDH, randomBytes } from 'node:crypto';
import request from 'supertest';
import webpush from 'web-push';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { addDays, todayIn } from '../src/dates.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { isAllowedEndpoint, loadVapidKeys, morningMessage, PushService, type Sender } from '../src/push.js';
import { createRolloverScheduler } from '../src/rollover.js';
import { TaskRepo, type Task } from '../src/tasks/repo.js';
import { UserRepo, type User } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

/** A browser-like subscription with real P-256 keys, so web-push can encrypt for it. */
function fakeSubscription(endpoint: string) {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { endpoint, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: randomBytes(16).toString('base64url') } };
}

describe('isAllowedEndpoint', () => {
  it('only accepts the big push services over https', () => {
    expect(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(true);
    expect(isAllowedEndpoint('https://web.push.apple.com/QG9')).toBe(true);
    expect(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x')).toBe(true);
    expect(isAllowedEndpoint('https://wns2-par02p.notify.windows.com/w/?token=x')).toBe(true);
    expect(isAllowedEndpoint('http://fcm.googleapis.com/x')).toBe(false);
    expect(isAllowedEndpoint('https://evil.example/fcm.googleapis.com')).toBe(false);
    expect(isAllowedEndpoint('https://fcm.googleapis.com.evil.example/x')).toBe(false);
    expect(isAllowedEndpoint('https://169.254.169.254/latest')).toBe(false);
    expect(isAllowedEndpoint('not a url')).toBe(false);
  });
});

describe('morningMessage', () => {
  const t = (title: string, extra: Partial<Task> = {}) => ({ title, rolloverCount: 0, dueDate: null, ...extra }) as Task;
  it('summarises the day', () => {
    expect(morningMessage([t('A'), t('B', { rolloverCount: 2 }), t('C', { dueDate: '2026-11-07' }), t('D')], '2026-11-07')).toEqual({
      title: 'Today: 4 tasks',
      body: 'A, B, C +1 more\n1 carried over · 1 due today',
      url: '/',
      tag: 'morning-2026-11-07',
    });
    expect(morningMessage([t('Only')], '2026-11-07').title).toBe('Today: 1 task');
  });
});

describe('web-push encryption', () => {
  it('builds a valid encrypted request with generated VAPID keys', () => {
    const keys = webpush.generateVAPIDKeys();
    const details = webpush.generateRequestDetails(fakeSubscription('https://fcm.googleapis.com/fcm/send/x'), '{"title":"hi"}', {
      vapidDetails: { subject: 'https://example.com', ...keys },
      TTL: 60,
    });
    expect(details.method).toBe('POST');
    expect(details.headers['Content-Encoding']).toBe('aes128gcm');
    expect(details.headers.Authorization).toMatch(/^vapid t=.+, k=/);
    expect((details.body as Buffer).length).toBeGreaterThan(16);
  });
});

describe.skipIf(!databaseUrl)('push notifications (needs TEST_DATABASE_URL)', () => {
  const config: AppConfig = {
    port: 0,
    databaseUrl: databaseUrl!,
    databaseSsl: false,
    appPassword: '',
    adminUsername: 'admin',
    weatherUserAgent: 'questlog-test',
    sessionSecret: 's'.repeat(32),
    timezone: 'UTC',
    isProduction: false,
  };
  const db = createPool(config.databaseUrl);
  const users = new UserRepo(db);
  const tasks = new TaskRepo(db);
  const scheduler = createRolloverScheduler(db, config.timezone);
  const PASSWORD = 'correct horse battery';
  const T = todayIn('UTC');

  const sent: { endpoint: string; message: { title: string; body: string; url: string; tag: string } }[] = [];
  const gone = new Set<string>();
  const sender: Sender = async (sub, payload) => {
    if (gone.has(sub.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
    sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) });
    return { statusCode: 201 };
  };
  const push = new PushService(db, 'test-public-key', sender);
  const app = createApp({ db, config, scheduler, push, loginLimits: { attemptsPerIp: 10_000, failuresPerUsername: 10_000 } });

  let alice: User, bob: User, carol: User;
  const as = { alice: request.agent(app), bob: request.agent(app), carol: request.agent(app) };
  const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
  const titles = () => sent.map((s) => `${s.endpoint.split('/').pop()}: ${s.message.title} | ${s.message.body}`);

  async function action<T>(fn: () => Promise<T>): Promise<T> {
    const result = await fn();
    await push.flush();
    return result;
  }

  beforeAll(async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
    alice = await users.create({ username: 'alice', displayName: 'Alice', password: PASSWORD });
    bob = await users.create({ username: 'bob', displayName: 'Bob', password: PASSWORD });
    carol = await users.create({ username: 'carol', displayName: 'Carol', password: PASSWORD });
    for (const n of ['alice', 'bob', 'carol'] as const) {
      await as[n].post('/api/auth/login').send({ username: n, password: PASSWORD }).expect(200);
    }
  });

  beforeEach(async () => {
    await db.query('TRUNCATE tasks, task_series, push_subscriptions CASCADE');
    await db.query(`UPDATE users SET notify_shared = true, notify_morning = true, morning_time = '07:30', last_morning_sent = NULL`);
    sent.length = 0;
    gone.clear();
    for (const n of ['alice', 'bob', 'carol'] as const) {
      await as[n].post('/api/push/subscribe').send(fakeSubscription(endpoint(n))).expect(201);
    }
  });

  afterAll(async () => {
    await db.end();
  });

  describe('subscriptions', () => {
    it('reports config, refuses unknown push services, and unsubscribes', async () => {
      const { body } = await as.bob.get('/api/push/config').expect(200);
      expect(body).toEqual({
        enabled: true,
        publicKey: 'test-public-key',
        devices: 1,
        prefs: { shared: true, morning: true, morningTime: '07:30' },
      });
      await as.bob.post('/api/push/subscribe').send(fakeSubscription('https://evil.example/hook')).expect(400);
      await as.bob.post('/api/push/subscribe').send({ endpoint: endpoint('x') }).expect(400);
      await request(app).post('/api/push/subscribe').send(fakeSubscription(endpoint('anon'))).expect(401);
      await as.bob.post('/api/push/unsubscribe').send({ endpoint: endpoint('bob') }).expect(200);
      expect((await as.bob.get('/api/push/config').expect(200)).body.devices).toBe(0);
    });

    it('sends a test to only the caller, and forgets devices the push service says are gone', async () => {
      await as.bob.post('/api/push/test').expect(200, { delivered: 1 });
      expect(titles()).toEqual(['bob: Questlog | Notifications are working on this device.']);
      gone.add(endpoint('bob'));
      await as.bob.post('/api/push/test').expect(400);
      expect((await as.bob.get('/api/push/config').expect(200)).body.devices).toBe(0);
    });

    it('applies quick successive changes without losing any', async () => {
      await Promise.all([
        as.bob.patch('/api/push/prefs').send({ morning: false }),
        as.bob.patch('/api/push/prefs').send({ morningTime: '06:15' }),
        as.bob.patch('/api/push/prefs').send({ shared: false }),
      ]);
      expect((await as.bob.get('/api/push/config').expect(200)).body.prefs).toEqual({
        shared: false,
        morning: false,
        morningTime: '06:15',
      });
    });

    it('validates preferences', async () => {
      await as.bob.patch('/api/push/prefs').send({ morningTime: '7:30' }).expect(400);
      await as.bob.patch('/api/push/prefs').send({ loud: true }).expect(400);
      await as.bob.patch('/api/push/prefs').send({ morningTime: '06:45', shared: false }).expect(200, {
        shared: false,
        morning: true,
        morningTime: '06:45',
      });
    });
  });

  describe('shared tasks', () => {
    it('notifies the other members (not the actor, not outsiders) when a shared task is created', async () => {
      await action(() => as.alice.post('/api/tasks').send({ title: 'Book venue', memberIds: [bob.id] }).expect(201));
      expect(titles()).toEqual(['bob: Alice shared a task with you | Book venue · today']);
      sent.length = 0;
      await action(() => as.alice.post('/api/tasks').send({ title: 'Private' }).expect(201));
      expect(sent).toEqual([]);
    });

    it('describes updates, and tells people when they are added', async () => {
      const { body: task } = await action(() =>
        as.alice.post('/api/tasks').send({ title: 'Book venue', memberIds: [bob.id] }).expect(201),
      );
      sent.length = 0;
      await action(() =>
        as.bob.patch(`/api/tasks/${task.id}`).send({ title: 'Book a venue', scheduledDate: addDays(T, 1), priority: 'high' }).expect(200),
      );
      expect(titles()).toEqual([
        'alice: Bob updated a shared task | Book a venue: renamed from "Book venue", moved to tomorrow, priority high',
      ]);
      sent.length = 0;
      await action(() => as.alice.patch(`/api/tasks/${task.id}`).send({ memberIds: [alice.id, bob.id, carol.id] }).expect(200));
      expect(titles()).toEqual(['carol: Alice shared a task with you | Book a venue · tomorrow']);
      expect(sent[0]!.message.url).toBe(`/day/${addDays(T, 1)}`);
    });

    it('stays quiet for edits that change nothing', async () => {
      const { body: task } = await action(() =>
        as.alice.post('/api/tasks').send({ title: 'Same', memberIds: [bob.id] }).expect(201),
      );
      sent.length = 0;
      await action(() => as.alice.patch(`/api/tasks/${task.id}`).send({ title: 'Same' }).expect(200));
      expect(sent).toEqual([]);
    });

    it('notifies on complete, reopen and delete', async () => {
      const { body: task } = await action(() =>
        as.alice.post('/api/tasks').send({ title: 'Groceries', memberIds: [bob.id, carol.id] }).expect(201),
      );
      sent.length = 0;
      await action(() => as.bob.post(`/api/tasks/${task.id}/complete`).expect(200));
      await action(() => as.bob.post(`/api/tasks/${task.id}/complete`).expect(200)); // already done: no repeat
      await action(() => as.carol.post(`/api/tasks/${task.id}/reopen`).expect(200));
      await action(() => as.alice.delete(`/api/tasks/${task.id}`).expect(204));
      expect(titles().sort()).toEqual(
        [
          'alice: Bob completed a shared task | Groceries',
          'carol: Bob completed a shared task | Groceries',
          'alice: Carol reopened a shared task | Groceries',
          'bob: Carol reopened a shared task | Groceries',
          'bob: Alice deleted a shared task | Groceries',
          'carol: Alice deleted a shared task | Groceries',
        ].sort(),
      );
    });

    it('respects people who turned shared-task notifications off', async () => {
      await as.bob.patch('/api/push/prefs').send({ shared: false }).expect(200);
      await action(() => as.alice.post('/api/tasks').send({ title: 'x', memberIds: [bob.id, carol.id] }).expect(201));
      expect(titles().map((t) => t.split(':')[0])).toEqual(['carol']);
    });
  });

  describe('morning summary', () => {
    const at = (time: string) => new Date(`${T}T${time}:00Z`);
    const list = (userId: string, day: string) => tasks.listForDay(userId, day);

    it('sends once per day at or after the chosen time, only to people with tasks', async () => {
      await tasks.create(alice.id, { title: 'Write report', scheduledDate: T });
      await tasks.create(alice.id, { title: 'Call Bob', scheduledDate: T, dueDate: T });
      await tasks.create(carol.id, { title: 'Tomorrow thing', scheduledDate: addDays(T, 1) });

      expect(await push.sendMorningSummaries('UTC', at('07:29'), list)).toBe(0);
      expect(await push.sendMorningSummaries('UTC', at('07:30'), list)).toBe(1);
      expect(await push.sendMorningSummaries('UTC', at('07:45'), list)).toBe(0);
      expect(titles()).toEqual(['alice: Today: 2 tasks | Write report, Call Bob\n1 due today']);
    });

    it("honours each person's time and opt-out, and skips if far past the time", async () => {
      await tasks.create(alice.id, { title: 'A', scheduledDate: T });
      await tasks.create(bob.id, { title: 'B', scheduledDate: T });
      await tasks.create(carol.id, { title: 'C', scheduledDate: T });
      await as.bob.patch('/api/push/prefs').send({ morningTime: '06:00' }).expect(200);
      await as.carol.patch('/api/push/prefs').send({ morning: false }).expect(200);

      expect(await push.sendMorningSummaries('UTC', at('06:05'), list)).toBe(1);
      expect(titles()).toEqual(['bob: Today: 1 task | B']);
      sent.length = 0;
      // 11:00 is more than three hours after Alice's 07:30: no "morning" note that late.
      expect(await push.sendMorningSummaries('UTC', at('11:00'), list)).toBe(0);
      expect(sent).toEqual([]);
    });

    it('does nothing for people without a device', async () => {
      await tasks.create(alice.id, { title: 'A', scheduledDate: T });
      await as.alice.post('/api/push/unsubscribe').send({ endpoint: endpoint('alice') }).expect(200);
      expect(await push.sendMorningSummaries('UTC', at('07:30'), list)).toBe(0);
    });
  });

  describe('VAPID keys', () => {
    it('generates a key pair once and keeps it', async () => {
      const first = await loadVapidKeys(db, {});
      const second = await loadVapidKeys(db, {});
      expect(second).toEqual(first);
      expect(first.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
      expect(await loadVapidKeys(db, { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' })).toEqual({ publicKey: 'pub', privateKey: 'priv' });
    });
  });
});
