import type { Db, Queryable } from './db.js';
import { getDummyHash, hashPassword, verifyPassword } from './passwords.js';

export interface User {
  id: string;
  username: string;
  displayName: string;
  disabled: boolean;
  createdAt: string;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{2,32}$/;
export const MIN_PASSWORD_LENGTH = 8;

const COLUMNS = `id, username, display_name AS "displayName", disabled, created_at AS "createdAt"`;

export class UserError extends Error {}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new UserError('Usernames are 2-32 characters: lowercase letters, digits, ".", "_" or "-".');
  }
  return normalized;
}

function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

export class UserRepo {
  constructor(private readonly db: Db) {}

  async list(includeDisabled = false): Promise<User[]> {
    const { rows } = await this.db.query<User>(
      `SELECT ${COLUMNS} FROM users ${includeDisabled ? '' : 'WHERE NOT disabled'} ORDER BY display_name, username`,
    );
    return rows;
  }

  async get(id: string): Promise<User | null> {
    const { rows } = await this.db.query<User>(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const { rows } = await this.db.query<User>(`SELECT ${COLUMNS} FROM users WHERE username = $1`, [
      username.trim().toLowerCase(),
    ]);
    return rows[0] ?? null;
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
    return rows[0]!.n;
  }

  /**
   * Creates a user. The very first user also adopts every task that has no members,
   * i.e. the tasks created back when questlog was single-user.
   */
  async create(
    input: { username: string; displayName?: string; password: string },
    opts: { skipPasswordPolicy?: boolean } = {},
  ): Promise<User> {
    const username = normalizeUsername(input.username);
    const displayName = (input.displayName ?? '').trim() || username;
    if (!opts.skipPasswordPolicy) checkPassword(input.password);
    const hash = await hashPassword(input.password);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const { rows: existing } = await client.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (existing.length) throw new UserError(`User "${username}" already exists.`);
      const { rows: before } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
      const { rows } = await client.query<User>(
        `INSERT INTO users (username, display_name, password_hash) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [username, displayName, hash],
      );
      const user = rows[0]!;
      if (before[0]!.n === 0) await adoptOrphanTasks(client, user.id);
      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async setPassword(username: string, password: string): Promise<void> {
    checkPassword(password);
    const hash = await hashPassword(password);
    const { rowCount } = await this.db.query(
      'UPDATE users SET password_hash = $2, updated_at = now() WHERE username = $1',
      [normalizeUsername(username), hash],
    );
    if (!rowCount) throw new UserError(`No user named "${username}".`);
  }

  async setDisabled(username: string, disabled: boolean): Promise<void> {
    const { rowCount } = await this.db.query(
      'UPDATE users SET disabled = $2, updated_at = now() WHERE username = $1',
      [normalizeUsername(username), disabled],
    );
    if (!rowCount) throw new UserError(`No user named "${username}".`);
  }

  async rename(username: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (!name || name.length > 100) throw new UserError('Display names are 1-100 characters.');
    const { rowCount } = await this.db.query(
      'UPDATE users SET display_name = $2, updated_at = now() WHERE username = $1',
      [normalizeUsername(username), name],
    );
    if (!rowCount) throw new UserError(`No user named "${username}".`);
  }

  /** Returns the active user for valid credentials, otherwise null. Always does one hash comparison. */
  async authenticate(username: string, password: string): Promise<User | null> {
    const { rows } = await this.db.query<User & { passwordHash: string }>(
      `SELECT ${COLUMNS}, password_hash AS "passwordHash" FROM users WHERE username = $1`,
      [username.trim().toLowerCase()],
    );
    const row = rows[0];
    const ok = await verifyPassword(password, row?.passwordHash ?? (await getDummyHash()));
    if (!row || !ok || row.disabled) return null;
    const { passwordHash: _, ...user } = row;
    return user;
  }
}

async function adoptOrphanTasks(db: Queryable, userId: string): Promise<void> {
  await db.query(
    `INSERT INTO task_members (task_id, user_id)
     SELECT t.id, $1 FROM tasks t
     WHERE NOT EXISTS (SELECT 1 FROM task_members m WHERE m.task_id = t.id)`,
    [userId],
  );
  await db.query('UPDATE tasks SET created_by = $1 WHERE created_by IS NULL', [userId]);
}

/**
 * Upgrade path from the single-password version: if there are no users yet and
 * APP_PASSWORD is set, create the first account from it (which adopts all existing tasks).
 */
export async function bootstrapFirstUser(
  users: UserRepo,
  opts: { username: string; password: string },
  log: (msg: string) => void,
): Promise<void> {
  if ((await users.count()) > 0) return;
  if (!opts.password) {
    log('No users yet. Create one with: node server/dist/cli/users.js add <username>');
    return;
  }
  // The existing APP_PASSWORD predates the length policy, so accept it as-is.
  const user = await users.create({ username: opts.username, password: opts.password }, { skipPasswordPolicy: true });
  log(
    `Created the first user "${user.username}" from APP_PASSWORD and gave it all existing tasks. ` +
      'Manage users with server/dist/cli/users.js; APP_PASSWORD is no longer needed.',
  );
}
