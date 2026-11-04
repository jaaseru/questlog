import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createPool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { UserError, UserRepo } from '../src/users.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('UserRepo (needs TEST_DATABASE_URL)', () => {
  const db = createPool(databaseUrl!);
  const users = new UserRepo(db);

  beforeEach(async () => {
    await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await migrate(db);
  });

  afterAll(async () => {
    await db.end();
  });

  it('normalizes usernames and defaults the display name', async () => {
    const user = await users.create({ username: '  Julian ', password: 'long enough' });
    expect(user).toMatchObject({ username: 'julian', displayName: 'julian', disabled: false });
    expect(await users.authenticate('JULIAN', 'long enough')).toMatchObject({ id: user.id });
  });

  it('enforces username rules, uniqueness and password length', async () => {
    await expect(users.create({ username: 'a', password: 'long enough' })).rejects.toThrow(UserError);
    await expect(users.create({ username: 'has space', password: 'long enough' })).rejects.toThrow(UserError);
    await expect(users.create({ username: 'sam', password: 'short' })).rejects.toThrow(/at least 8/);
    await users.create({ username: 'sam', password: 'long enough' });
    await expect(users.create({ username: 'SAM', password: 'long enough' })).rejects.toThrow(/already exists/);
  });

  it('changes passwords, display names and disabled state', async () => {
    await users.create({ username: 'sam', password: 'first password' });
    await users.setPassword('sam', 'second password');
    expect(await users.authenticate('sam', 'first password')).toBeNull();
    expect(await users.authenticate('sam', 'second password')).not.toBeNull();

    await users.rename('sam', 'Sam S.');
    expect((await users.findByUsername('sam'))!.displayName).toBe('Sam S.');

    await users.setDisabled('sam', true);
    expect(await users.authenticate('sam', 'second password')).toBeNull();
    await expect(users.setDisabled('nobody', true)).rejects.toThrow(/No user/);
  });

  it('only gives orphaned tasks to the first user', async () => {
    await db.query(`INSERT INTO tasks (title) VALUES ('old')`);
    const first = await users.create({ username: 'first', password: 'long enough' });
    await db.query(`INSERT INTO tasks (title) VALUES ('orphan made later')`);
    await users.create({ username: 'second', password: 'long enough' });
    const { rows } = await db.query(
      `SELECT t.title, m.user_id FROM tasks t LEFT JOIN task_members m ON m.task_id = t.id ORDER BY t.title`,
    );
    expect(rows).toEqual([
      { title: 'old', user_id: first.id },
      { title: 'orphan made later', user_id: null },
    ]);
  });
});
