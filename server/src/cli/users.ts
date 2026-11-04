/**
 * Manage questlog accounts.
 *
 *   node server/dist/cli/users.js list
 *   node server/dist/cli/users.js add <username> [--name "Display Name"]
 *   node server/dist/cli/users.js passwd <username>
 *   node server/dist/cli/users.js rename <username> "Display Name"
 *   node server/dist/cli/users.js disable <username>
 *   node server/dist/cli/users.js enable <username>
 *   node server/dist/cli/users.js signout <username>
 *   node server/dist/cli/users.js grant-admin <username>
 *   node server/dist/cli/users.js revoke-admin <username>
 *
 * Needs DATABASE_URL. Passwords are prompted for (hidden), or read from QUESTLOG_PASSWORD.
 */
import readline from 'node:readline';
import { describeDatabaseUrlProblem } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';
import { AuditLog, type AuditAction } from '../audit.js';
import { MIN_PASSWORD_LENGTH, UserError, UserRepo } from '../users.js';

const USAGE = `Usage:
  users list
  users add <username> [--name "Display Name"]
  users passwd <username>
  users rename <username> "Display Name"
  users disable <username>
  users enable <username>
  users signout <username>        End all of their sessions
  users grant-admin <username>    Give access to the admin page
  users revoke-admin <username>

Passwords are prompted for, or taken from the QUESTLOG_PASSWORD environment variable.`;

function ask(question: string, hidden: boolean): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(question);
    if (hidden) {
      // Swallow readline's echo so the password never appears on screen.
      (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    }
    rl.question('', (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readNewPassword(): Promise<string> {
  const fromEnv = process.env.QUESTLOG_PASSWORD;
  if (fromEnv) return fromEnv;
  if (!process.stdin.isTTY) {
    throw new UserError('No terminal to prompt on. Set QUESTLOG_PASSWORD instead.');
  }
  const first = await ask(`Password (min ${MIN_PASSWORD_LENGTH} characters): `, true);
  const second = await ask('Repeat password: ', true);
  if (first !== second) throw new UserError('Passwords did not match.');
  return first;
}

function takeFlag(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (value === undefined) throw new UserError(`${flag} needs a value.`);
  return value;
}

async function main(argv: string[]): Promise<void> {
  const args = [...argv];
  const command = args.shift();
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return;
  }

  const url = process.env.DATABASE_URL ?? '';
  const urlProblem = url ? describeDatabaseUrlProblem(url) : 'DATABASE_URL is not set.';
  if (urlProblem) throw new UserError(urlProblem);

  const db = createPool(url, process.env.DATABASE_SSL === 'true');
  try {
    await migrate(db);
    const users = new UserRepo(db);
    const audit = new AuditLog(db);
    const record = (action: AuditAction, targetUserId: string, detail: Record<string, unknown> = {}) =>
      audit.record({ action, targetUserId, detail: { ...detail, via: 'cli' } });
    const target = async () => users.require(needUsername());
    const name = takeFlag(args, '--name');
    const [username, ...rest] = args;
    const needUsername = () => {
      if (!username) throw new UserError(`"${command}" needs a username.\n\n${USAGE}`);
      return username;
    };

    switch (command) {
      case 'list': {
        const all = await users.list(true);
        if (all.length === 0) return console.log('No users yet.');
        for (const u of all) {
          const status = [u.disabled ? 'disabled' : 'active', u.isAdmin && 'admin'].filter(Boolean).join(', ');
          const seen = u.lastLoginAt ? `last sign-in ${new Date(u.lastLoginAt).toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never signed in';
          console.log(`${u.username.padEnd(20)} ${u.displayName.padEnd(24)} ${status.padEnd(16)} ${seen}`);
        }
        return;
      }
      case 'add': {
        const isFirst = (await users.count()) === 0;
        const user = await users.create({ username: needUsername(), displayName: name, password: await readNewPassword() });
        await record('user_created', user.id, { username: user.username });
        console.log(`Added ${user.username} (${user.displayName}).`);
        if (isFirst) console.log('As the first user, they are the admin and own every existing task.');
        return;
      }
      case 'passwd': {
        const user = await target();
        await users.setPassword(user.id, await readNewPassword());
        await record('password_reset', user.id);
        return console.log(`Password updated for ${user.username}. They are signed out everywhere.`);
      }
      case 'rename': {
        const user = await target();
        const displayName = name ?? rest.join(' ');
        await users.rename(user.id, displayName);
        await record('user_renamed', user.id, { from: user.displayName, to: displayName.trim() });
        return console.log(`${user.username} is now shown as "${displayName.trim()}".`);
      }
      case 'disable': {
        const user = await target();
        await users.setDisabled(user.id, true);
        await record('user_disabled', user.id);
        return console.log(`${user.username} is disabled and signed out. Their tasks are kept.`);
      }
      case 'enable': {
        const user = await target();
        await users.setDisabled(user.id, false);
        await record('user_enabled', user.id);
        return console.log(`${user.username} is enabled.`);
      }
      case 'signout': {
        const user = await target();
        await users.signOutEverywhere(user.id);
        await record('signed_out_everywhere', user.id);
        return console.log(`${user.username} is signed out on every device.`);
      }
      case 'grant-admin': {
        const user = await target();
        await users.setAdmin(user.id, true);
        await record('admin_granted', user.id);
        return console.log(`${user.username} is now an admin. They need to sign in again.`);
      }
      case 'revoke-admin': {
        const user = await target();
        if (user.isAdmin && !user.disabled && (await users.countAdmins()) <= 1) {
          throw new UserError(`${user.username} is the only admin. Grant someone else admin first.`);
        }
        await users.setAdmin(user.id, false);
        await record('admin_revoked', user.id);
        return console.log(`${user.username} is no longer an admin.`);
      }
      default:
        throw new UserError(`Unknown command "${command}".\n\n${USAGE}`);
    }
  } finally {
    await db.end();
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof UserError ? err.message : err);
  process.exit(1);
});
