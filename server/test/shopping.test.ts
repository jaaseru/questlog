import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { createRolloverScheduler } from '../src/rollover.js';
import { ShoppingRepo } from '../src/shopping.js';
import { UserRepo, type User } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('shopping list (needs TEST_DATABASE_URL)', () => {
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
  const shopping = new ShoppingRepo(db);
  const app = createApp({
    db,
    config,
    scheduler: createRolloverScheduler(db, 'UTC'),
    loginLimits: { attemptsPerIp: 10_000, failuresPerUsername: 10_000 },
  });
  const PASSWORD = 'correct horse battery';
  let alice: User, bob: User;
  const asAlice = request.agent(app);
  const asBob = request.agent(app);

  async function add(agent: ReturnType<typeof request.agent>, title: string, parentId?: string) {
    const { body } = await agent.post('/api/shopping').send({ title, parentId }).expect(201);
    return body as { id: string };
  }
  async function state() {
    const { body } = await asAlice.get('/api/shopping').expect(200);
    return Object.fromEntries(
      (body.items as { title: string; checkedAt: string | null }[]).map((i) => [i.title, i.checkedAt ? 'checked' : 'open']),
    );
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
    await db.query('TRUNCATE shopping_items');
  });

  afterAll(async () => {
    await db.end();
  });

  it('is one list shared by everyone, and needs a signed-in user', async () => {
    await add(asAlice, 'Milk');
    const { body } = await asBob.get('/api/shopping').expect(200);
    expect(body).toMatchObject({ retentionHours: 12, items: [{ title: 'Milk', createdBy: alice.id, parentId: null }] });
    await request(app).get('/api/shopping').expect(401);
    await request(app).post('/api/shopping').send({ title: 'x' }).expect(401);
  });

  it('lets anyone check, uncheck and remove any item', async () => {
    const milk = await add(asAlice, 'Milk');
    await asBob.post(`/api/shopping/${milk.id}/check`).expect(200);
    const { body } = await asAlice.get('/api/shopping').expect(200);
    expect(body.items[0]).toMatchObject({ checkedBy: bob.id, checkedAt: expect.any(String) });
    await asAlice.post(`/api/shopping/${milk.id}/uncheck`).expect(200);
    expect(await state()).toEqual({ Milk: 'open' });
    await asBob.delete(`/api/shopping/${milk.id}`).expect(204);
    expect(await state()).toEqual({});
  });

  it('validates input', async () => {
    await asAlice.post('/api/shopping').send({ title: '   ' }).expect(400);
    await asAlice.post('/api/shopping').send({ title: 'x'.repeat(201) }).expect(400);
    await asAlice.post('/api/shopping').send({ title: 'x', parentId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await asAlice.post('/api/shopping').send({ title: 'x', extra: 1 }).expect(400);
    await asAlice.post('/api/shopping/not-a-uuid/check').expect(404);
    await asAlice.delete('/api/shopping/00000000-0000-4000-8000-000000000000').expect(404);
  });

  describe('sub-items', () => {
    it('are one level deep', async () => {
      const tacos = await add(asAlice, 'Taco night');
      const salsa = await add(asAlice, 'Salsa', tacos.id);
      await asAlice.post('/api/shopping').send({ title: 'Mild', parentId: salsa.id }).expect(400);
    });

    it('checking an item checks its sub-items; unchecking it reopens them', async () => {
      const tacos = await add(asAlice, 'Taco night');
      await add(asAlice, 'Tortillas', tacos.id);
      await add(asAlice, 'Salsa', tacos.id);
      await asBob.post(`/api/shopping/${tacos.id}/check`).expect(200);
      expect(await state()).toEqual({ 'Taco night': 'checked', Tortillas: 'checked', Salsa: 'checked' });
      await asBob.post(`/api/shopping/${tacos.id}/uncheck`).expect(200);
      expect(await state()).toEqual({ 'Taco night': 'open', Tortillas: 'open', Salsa: 'open' });
    });

    it('the item stays open when all its sub-items are checked; it must be checked itself', async () => {
      const tacos = await add(asAlice, 'Taco night');
      const tortillas = await add(asAlice, 'Tortillas', tacos.id);
      const salsa = await add(asAlice, 'Salsa', tacos.id);
      await asAlice.post(`/api/shopping/${tortillas.id}/check`).expect(200);
      await asBob.post(`/api/shopping/${salsa.id}/check`).expect(200);
      expect(await state()).toEqual({ 'Taco night': 'open', Tortillas: 'checked', Salsa: 'checked' });
      await asBob.post(`/api/shopping/${tacos.id}/check`).expect(200);
      expect(await state()).toEqual({ 'Taco night': 'checked', Tortillas: 'checked', Salsa: 'checked' });
    });

    it('unchecking a sub-item of a checked item reopens the item', async () => {
      const tacos = await add(asAlice, 'Taco night');
      await add(asAlice, 'Tortillas', tacos.id);
      const salsa = await add(asAlice, 'Salsa', tacos.id);
      await asAlice.post(`/api/shopping/${tacos.id}/check`).expect(200);
      await asAlice.post(`/api/shopping/${salsa.id}/uncheck`).expect(200);
      expect(await state()).toEqual({ 'Taco night': 'open', Tortillas: 'checked', Salsa: 'open' });
    });

    it('adding a sub-item to a checked item reopens it', async () => {
      const tacos = await add(asAlice, 'Taco night');
      await asAlice.post(`/api/shopping/${tacos.id}/check`).expect(200);
      await add(asBob, 'Lime', tacos.id);
      expect(await state()).toEqual({ 'Taco night': 'open', Lime: 'open' });
    });

    it('removing an item removes its sub-items', async () => {
      const tacos = await add(asAlice, 'Taco night');
      await add(asAlice, 'Tortillas', tacos.id);
      await asBob.delete(`/api/shopping/${tacos.id}`).expect(204);
      expect(await state()).toEqual({});
    });
  });

  describe('ordering', () => {
    async function titles(parentId: string | null = null) {
      const { body } = await asBob.get('/api/shopping').expect(200);
      return (body.items as { title: string; parentId: string | null }[]).filter((i) => i.parentId === parentId).map((i) => i.title);
    }
    const move = (id: string, beforeId: string | null) => asAlice.post(`/api/shopping/${id}/move`).send({ beforeId });

    it('keeps the order entries were added in, new ones last', async () => {
      await add(asAlice, 'Milk');
      await add(asBob, 'Eggs');
      await add(asAlice, 'Bread');
      expect(await titles()).toEqual(['Milk', 'Eggs', 'Bread']);
    });

    it('moves an item before another, or to the end, for everyone', async () => {
      const milk = await add(asAlice, 'Milk');
      await add(asAlice, 'Eggs');
      const bread = await add(asAlice, 'Bread');
      await move(bread.id, milk.id).expect(200);
      expect(await titles()).toEqual(['Bread', 'Milk', 'Eggs']);
      await move(bread.id, null).expect(200);
      expect(await titles()).toEqual(['Milk', 'Eggs', 'Bread']);
      await move(milk.id, bread.id).expect(200);
      expect(await titles()).toEqual(['Eggs', 'Milk', 'Bread']);
      await move(milk.id, milk.id).expect(200);
      expect(await titles()).toEqual(['Eggs', 'Milk', 'Bread']);
      // Added after moving: still last.
      await add(asBob, 'Cheese');
      expect(await titles()).toEqual(['Eggs', 'Milk', 'Bread', 'Cheese']);
    });

    it('moves sub-items within their item only', async () => {
      const tacos = await add(asAlice, 'Taco night');
      const tortillas = await add(asAlice, 'Tortillas', tacos.id);
      const salsa = await add(asAlice, 'Salsa', tacos.id);
      const milk = await add(asAlice, 'Milk');
      await move(salsa.id, tortillas.id).expect(200);
      expect(await titles(tacos.id)).toEqual(['Salsa', 'Tortillas']);
      expect(await titles()).toEqual(['Taco night', 'Milk']);
      await move(salsa.id, milk.id).expect(400);
      await move(milk.id, salsa.id).expect(400);
    });

    it('validates input', async () => {
      const milk = await add(asAlice, 'Milk');
      await move(milk.id, 'nope').expect(400);
      await asAlice.post(`/api/shopping/${milk.id}/move`).send({}).expect(400);
      await move('00000000-0000-4000-8000-000000000000', null).expect(404);
      await request(app).post(`/api/shopping/${milk.id}/move`).send({ beforeId: null }).expect(401);
    });
  });

  describe('clearing checked-off items', () => {
    it('deletes entries 12 hours after they were checked off, and nothing else', async () => {
      const milk = await add(asAlice, 'Milk');
      const eggs = await add(asAlice, 'Eggs');
      const tacos = await add(asAlice, 'Taco night');
      const salsa = await add(asAlice, 'Salsa', tacos.id);
      await add(asAlice, 'Bread');
      const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
      await db.query('UPDATE shopping_items SET checked_at = $2 WHERE id = $1', [milk.id, ago(12.1)]);
      await db.query('UPDATE shopping_items SET checked_at = $2 WHERE id = $1', [eggs.id, ago(11.9)]);
      await db.query('UPDATE shopping_items SET checked_at = $2 WHERE id = $1', [salsa.id, ago(13)]);

      // The list endpoint clears expired entries before answering.
      expect(await state()).toEqual({ Eggs: 'checked', 'Taco night': 'open', Bread: 'open' });
      expect(await shopping.purgeExpired()).toBe(0);
    });

    it('takes an expired item’s sub-items with it', async () => {
      const tacos = await add(asAlice, 'Taco night');
      await add(asAlice, 'Salsa', tacos.id);
      await asAlice.post(`/api/shopping/${tacos.id}/check`).expect(200);
      expect(await shopping.purgeExpired(new Date(Date.now() + 12.5 * 3_600_000))).toBe(2);
    });
  });
});
