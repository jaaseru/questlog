import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createRolloverScheduler } from '../src/rollover.js';
import { UserRepo, type User } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('security (needs TEST_DATABASE_URL)', () => {
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
  const scheduler = createRolloverScheduler(db, config.timezone);
  const relaxed = { attemptsPerIp: 10_000, failuresPerUsername: 10_000 };
  const app = createApp({ db, config, scheduler, loginLimits: relaxed });
  const PASSWORD = 'correct horse battery';

  let julian: User, bob: User;

  async function signIn(username: string, password = PASSWORD, target = app) {
    const agent = request.agent(target);
    await agent.post('/api/auth/login').send({ username, password }).expect(200);
    return agent;
  }

  async function auditActions() {
    const { rows } = await db.query<{ action: string }>('SELECT action FROM audit_log ORDER BY id');
    return rows.map((r) => r.action);
  }

  beforeAll(async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
  });

  beforeEach(async () => {
    await db.query('TRUNCATE users, audit_log, tasks CASCADE');
    julian = await users.create({ username: 'julian', displayName: 'Julian', password: PASSWORD });
    bob = await users.create({ username: 'bob', displayName: 'Bob', password: PASSWORD });
  });

  afterAll(async () => {
    await db.end();
  });

  describe('admin access', () => {
    it('makes only the first account an admin', async () => {
      expect(julian.isAdmin).toBe(true);
      expect(bob.isAdmin).toBe(false);
      const { body } = await (await signIn('bob')).get('/api/auth/me').expect(200);
      expect(body.user.isAdmin).toBe(false);
    });

    it('refuses every admin endpoint to non-admins and to anonymous requests', async () => {
      const asBob = await signIn('bob');
      const anon = request(app);
      const calls: [string, string, object?][] = [
        ['get', '/api/admin/users'],
        ['post', '/api/admin/users', { username: 'eve', password: 'long enough' }],
        ['patch', `/api/admin/users/${julian.id}`, { disabled: true }],
        ['post', `/api/admin/users/${julian.id}/password`, { password: 'taken over!' }],
        ['post', `/api/admin/users/${julian.id}/signout`],
        ['get', '/api/admin/audit'],
      ];
      for (const [method, url, body] of calls) {
        await (asBob as any)[method](url).send(body).expect(403);
        await (anon as any)[method](url).send(body).expect(401);
      }
      expect(await users.findByUsername('eve')).toBeNull();
      expect((await users.get(julian.id))!.disabled).toBe(false);
    });

    it('lets the admin list, create, rename, disable and enable users', async () => {
      const admin = await signIn('julian');
      const { body: created } = await admin
        .post('/api/admin/users')
        .send({ username: 'Sara', displayName: 'Sara S', password: 'long enough' })
        .expect(201);
      expect(created).toMatchObject({ username: 'sara', displayName: 'Sara S', isAdmin: false, disabled: false });
      expect(created).not.toHaveProperty('passwordHash');

      await admin.post('/api/admin/users').send({ username: 'sara', password: 'long enough' }).expect(400);
      await admin.post('/api/admin/users').send({ username: 'x', password: 'long enough' }).expect(400);
      await admin.post('/api/admin/users').send({ username: 'kim', password: 'short' }).expect(400);

      const asSara = await signIn('sara', 'long enough');
      await admin.patch(`/api/admin/users/${created.id}`).send({ displayName: 'Sara Svensson' }).expect(200);
      const { body: disabled } = await admin.patch(`/api/admin/users/${created.id}`).send({ disabled: true }).expect(200);
      expect(disabled).toMatchObject({ displayName: 'Sara Svensson', disabled: true });
      await asSara.get('/api/tasks/backlog').expect(401);
      await request(app).post('/api/auth/login').send({ username: 'sara', password: 'long enough' }).expect(401);

      await admin.patch(`/api/admin/users/${created.id}`).send({ disabled: false }).expect(200);
      await signIn('sara', 'long enough');

      const { body: list } = await admin.get('/api/admin/users').expect(200);
      expect(list.users.map((u: { username: string }) => u.username).sort()).toEqual(['bob', 'julian', 'sara']);
      expect(list.users.find((u: { username: string }) => u.username === 'sara').lastLoginAt).not.toBeNull();
    });

    it('does not let the admin disable an admin account (no lock-out)', async () => {
      const admin = await signIn('julian');
      await admin.patch(`/api/admin/users/${julian.id}`).send({ disabled: true }).expect(400);
      await admin.get('/api/admin/users').expect(200);
    });

    it("doesn't reveal who the admin is in the shared people list", async () => {
      const { body } = await (await signIn('bob')).get('/api/users').expect(200);
      expect(body.users).toHaveLength(2);
      for (const u of body.users) expect(Object.keys(u).sort()).toEqual(['displayName', 'id', 'username']);
    });

    it('rejects unknown fields so admin rights cannot be granted through the API', async () => {
      const admin = await signIn('julian');
      await admin.patch(`/api/admin/users/${bob.id}`).send({ isAdmin: true }).expect(400);
      expect((await users.get(bob.id))!.isAdmin).toBe(false);
      await admin.patch('/api/admin/users/not-a-uuid').send({ disabled: true }).expect(404);
    });

    it('resets passwords and signs the user out everywhere', async () => {
      const admin = await signIn('julian');
      const asBob = await signIn('bob');
      await admin.post(`/api/admin/users/${bob.id}/password`).send({ password: 'short' }).expect(400);
      await admin.post(`/api/admin/users/${bob.id}/password`).send({ password: 'a fresh password' }).expect(200);
      await asBob.get('/api/tasks/backlog').expect(401);
      await request(app).post('/api/auth/login').send({ username: 'bob', password: PASSWORD }).expect(401);
      await signIn('bob', 'a fresh password');
    });

    it("signs a user out remotely, and keeps the admin's own session when targeting themselves", async () => {
      const admin = await signIn('julian');
      const adminPhone = await signIn('julian');
      const asBob = await signIn('bob');
      await admin.post(`/api/admin/users/${bob.id}/signout`).expect(200);
      await asBob.get('/api/tasks/backlog').expect(401);

      await admin.post(`/api/admin/users/${julian.id}/signout`).expect(200);
      await admin.get('/api/admin/users').expect(200);
      await adminPhone.get('/api/tasks/backlog').expect(401);
    });
  });

  describe('own account', () => {
    it('changes the password with the current one, signing out other devices only', async () => {
      const laptop = await signIn('bob');
      const phone = await signIn('bob');
      await laptop
        .post('/api/account/password')
        .send({ currentPassword: 'wrong one', newPassword: 'a brand new one' })
        .expect(400);
      await laptop
        .post('/api/account/password')
        .send({ currentPassword: PASSWORD, newPassword: PASSWORD })
        .expect(400);
      await laptop
        .post('/api/account/password')
        .send({ currentPassword: PASSWORD, newPassword: 'short' })
        .expect(400);
      await laptop
        .post('/api/account/password')
        .send({ currentPassword: PASSWORD, newPassword: 'a brand new one' })
        .expect(200);

      await laptop.get('/api/tasks/backlog').expect(200);
      await phone.get('/api/tasks/backlog').expect(401);
      await signIn('bob', 'a brand new one');
    });

    it('signs out other devices on request', async () => {
      const laptop = await signIn('bob');
      const phone = await signIn('bob');
      await laptop.post('/api/account/signout-others').expect(200);
      await laptop.get('/api/tasks/backlog').expect(200);
      await phone.get('/api/tasks/backlog').expect(401);
    });

    it('throttles guessing the current password', async () => {
      const strict = createApp({ db, config, scheduler, loginLimits: { attemptsPerIp: 100, failuresPerUsername: 3 } });
      const asBob = await signIn('bob', PASSWORD, strict);
      for (let i = 0; i < 3; i++) {
        await asBob.post('/api/account/password').send({ currentPassword: `guess ${i}`, newPassword: 'whatever123' }).expect(400);
      }
      await asBob.post('/api/account/password').send({ currentPassword: PASSWORD, newPassword: 'whatever123' }).expect(429);
    });
  });

  describe('sign-in throttling', () => {
    it('locks a username after repeated failures, even for the right password, without affecting others', async () => {
      const strict = createApp({ db, config, scheduler, loginLimits: { attemptsPerIp: 100, failuresPerUsername: 3 } });
      for (let i = 0; i < 3; i++) {
        await request(strict).post('/api/auth/login').send({ username: 'bob', password: `guess ${i}` }).expect(401);
      }
      const blocked = await request(strict).post('/api/auth/login').send({ username: 'BOB', password: PASSWORD });
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await signIn('julian', PASSWORD, strict);
    });

    it('limits attempts per network address', async () => {
      const strict = createApp({ db, config, scheduler, loginLimits: { attemptsPerIp: 3, failuresPerUsername: 100 } });
      for (let i = 0; i < 3; i++) {
        await request(strict).post('/api/auth/login').send({ username: `user${i}`, password: 'x' }).expect(401);
      }
      await request(strict).post('/api/auth/login').send({ username: 'julian', password: PASSWORD }).expect(429);
    });

    it('gives disabled accounts the same answer as wrong passwords', async () => {
      await users.setDisabled(bob.id, true);
      const disabled = await request(app).post('/api/auth/login').send({ username: 'bob', password: PASSWORD });
      const wrong = await request(app).post('/api/auth/login').send({ username: 'julian', password: 'nope' });
      expect(disabled.status).toBe(401);
      expect(disabled.body).toEqual(wrong.body);
    });
  });

  describe('request hardening', () => {
    it('blocks state-changing requests from other origins', async () => {
      const asBob = await signIn('bob');
      await asBob.post('/api/tasks').set('Origin', 'https://evil.example').send({ title: 'csrf' }).expect(403);
      await request(app)
        .post('/api/auth/login')
        .set('Origin', 'https://evil.example')
        .send({ username: 'bob', password: PASSWORD })
        .expect(403);
      const sameSite = await asBob.post('/api/tasks').set('Host', 'questlog.test').set('Origin', 'http://questlog.test');
      expect(sameSite.status).not.toBe(403);
      // Reads are unaffected.
      await asBob.get('/api/tasks/backlog').set('Origin', 'https://evil.example').expect(200);
    });

    it('marks API responses as not cacheable', async () => {
      const { headers } = await (await signIn('bob')).get('/api/tasks/backlog').expect(200);
      expect(headers['cache-control']).toBe('no-store');
    });
  });

  describe('audit log', () => {
    it('records sign-ins and account changes, visible to the admin', async () => {
      const admin = await signIn('julian');
      await request(app).post('/api/auth/login').send({ username: 'bob', password: 'nope' }).expect(401);
      await request(app).post('/api/auth/login').send({ username: 'nobody', password: 'nope' }).expect(401);
      await admin.post('/api/admin/users').send({ username: 'kim', password: 'long enough' }).expect(201);
      await admin.patch(`/api/admin/users/${bob.id}`).send({ disabled: true }).expect(200);

      expect(await auditActions()).toEqual([
        'login_succeeded',
        'login_failed',
        'login_failed',
        'user_created',
        'user_disabled',
      ]);

      const { body } = await admin.get('/api/admin/audit?limit=10').expect(200);
      expect(body.entries[0]).toMatchObject({ action: 'user_disabled', actor: 'Julian', target: 'Bob' });
      const failedUnknown = body.entries.find(
        (e: { action: string; detail: { username?: string } }) => e.action === 'login_failed' && e.detail.username === 'nobody',
      );
      expect(failedUnknown).toMatchObject({ target: null, detail: { reason: 'bad_credentials' } });
      // Passwords are never written to the log.
      const { rows } = await db.query('SELECT detail::text AS d FROM audit_log');
      expect(rows.some((r) => r.d.includes('nope') || r.d.includes('long enough'))).toBe(false);
    });
  });
});
