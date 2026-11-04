import type { Db, Queryable } from './db.js';
import { getDummyHash, hashPassword, verifyPassword } from './passwords.js';

export interface User {
  id: string;
  username: string;
  displayName: string;
  disabled: boolean;
  isAdmin: boolean;
  sessionVersion: number;
  lastLoginAt: string | null;
  createdAt: string;
}

export const USERNAME_PATTERN = /^[a-z0-9._-]{2,32}$/;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

const COLUMNS = `
  id, username, display_name AS "displayName", disabled,
  is_admin AS "isAdmin", session_version AS "sessionVersion",
  last_login_at AS "lastLoginAt", created_at AS "createdAt"`;

/** A problem with the request itself (bad username, short password, unknown user…); safe to show. */
export class UserError extends Error {}

export function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!USERNAME_PATTERN.test(normalized)) {
    throw new UserError('Usernames are 2-32 characters: lowercase letters, digits, ".", "_" or "-".');
  }
  return normalized;
}

export function checkPassword(password: string) {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new UserError(`Passwords must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new UserError(`Passwords can be at most ${MAX_PASSWORD_LENGTH} characters.`);
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

  /** Looks a user up by username, or throws a UserError naming them. */
  async require(username: string): Promise<User> {
    const user = await this.findByUsername(username);
    if (!user) throw new UserError(`No user named "${username}".`);
    return user;
  }

  async count(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
    return rows[0]!.n;
  }

  /**
   * Creates a user. The very first user becomes the admin and adopts every task that has
   * no members, i.e. the tasks created back when questlog was single-user.
   */
  async create(
    input: { username: string; displayName?: string; password: string },
    opts: { skipPasswordPolicy?: boolean } = {},
  ): Promise<User> {
    const username = normalizeUsername(input.username);
    const displayName = (input.displayName ?? '').trim() || username;
    if (displayName.length > 100) throw new UserError('Display names are 1-100 characters.');
    if (!opts.skipPasswordPolicy) checkPassword(input.password);
    const hash = await hashPassword(input.password);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const { rows: existing } = await client.query('SELECT 1 FROM users WHERE username = $1', [username]);
      if (existing.length) throw new UserError(`User "${username}" already exists.`);
      const { rows: before } = await client.query<{ n: number }>('SELECT count(*)::int AS n FROM users');
      const isFirst = before[0]!.n === 0;
      const { rows } = await client.query<User>(
        `INSERT INTO users (username, display_name, password_hash, is_admin) VALUES ($1, $2, $3, $4)
         RETURNING ${COLUMNS}`,
        [username, displayName, hash, isFirst],
      );
      const user = rows[0]!;
      if (isFirst) await adoptOrphanTasks(client, user.id);
      await client.query('COMMIT');
      return user;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /** Sets a new password and signs the user out everywhere. Returns the new session version. */
  async setPassword(id: string, password: string): Promise<number> {
    checkPassword(password);
    const hash = await hashPassword(password);
    return this.bump(id, 'password_hash = $2', [hash]);
  }

  /** Signs the user out on every device. Returns the new session version. */
  signOutEverywhere(id: string): Promise<number> {
    return this.bump(id, '', []);
  }

  async setDisabled(id: string, disabled: boolean): Promise<void> {
    // Disabling also ends their sessions, so re-enabling later doesn't revive old ones.
    await this.bump(id, 'disabled = $2', [disabled]);
  }

  async setAdmin(id: string, isAdmin: boolean): Promise<void> {
    await this.bump(id, 'is_admin = $2', [isAdmin]);
  }

  async rename(id: string, displayName: string): Promise<void> {
    const name = displayName.trim();
    if (!name || name.length > 100) throw new UserError('Display names are 1-100 characters.');
    const { rowCount } = await this.db.query(
      'UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1',
      [id, name],
    );
    if (!rowCount) throw new UserError('No such user.');
  }

  async recordLogin(id: string): Promise<void> {
    await this.db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
  }

  async countAdmins(): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM users WHERE is_admin AND NOT disabled',
    );
    return rows[0]!.n;
  }

  /** Returns the user for valid credentials (active or not), otherwise null. Always does one hash comparison. */
  async checkCredentials(username: string, password: string): Promise<User | null> {
    const { rows } = await this.db.query<User & { passwordHash: string }>(
      `SELECT ${COLUMNS}, password_hash AS "passwordHash" FROM users WHERE username = $1`,
      [username.trim().toLowerCase()],
    );
    const row = rows[0];
    const ok = await verifyPassword(password, row?.passwordHash ?? (await getDummyHash()));
    if (!row || !ok) return null;
    const { passwordHash: _, ...user } = row;
    return user;
  }

  /** Like checkCredentials, but only for active accounts. */
  async authenticate(username: string, password: string): Promise<User | null> {
    const user = await this.checkCredentials(username, password);
    return user && !user.disabled ? user : null;
  }

  private async bump(id: string, set: string, values: unknown[]): Promise<number> {
    const { rows } = await this.db.query<{ v: number }>(
      `UPDATE users SET ${set ? `${set}, ` : ''}session_version = session_version + 1, updated_at = now()
       WHERE id = $1 RETURNING session_version AS v`,
      [id, ...values],
    );
    if (!rows[0]) throw new UserError('No such user.');
    return rows[0].v;
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
    `Created the first user "${user.username}" (admin) from APP_PASSWORD and gave it all existing tasks. ` +
      'APP_PASSWORD is no longer needed.',
  );
}
