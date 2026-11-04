/**
 * Manage questlog accounts.
 *
 *   node server/dist/cli/users.js list
 *   node server/dist/cli/users.js add <username> [--name "Display Name"]
 *   node server/dist/cli/users.js passwd <username>
 *   node server/dist/cli/users.js rename <username> "Display Name"
 *   node server/dist/cli/users.js disable <username>
 *   node server/dist/cli/users.js enable <username>
 *
 * Needs DATABASE_URL. Passwords are prompted for (hidden), or read from QUESTLOG_PASSWORD.
 */
import readline from 'node:readline';
import { describeDatabaseUrlProblem } from '../config.js';
import { createPool } from '../db.js';
import { migrate } from '../migrate.js';
import { MIN_PASSWORD_LENGTH, UserError, UserRepo } from '../users.js';

const USAGE = `Usage:
  users list
  users add <username> [--name "Display Name"]
  users passwd <username>
  users rename <username> "Display Name"
  users disable <username>
  users enable <username>

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
          console.log(`${u.username.padEnd(20)} ${u.displayName.padEnd(24)} ${u.disabled ? 'disabled' : 'active'}`);
        }
        return;
      }
      case 'add': {
        const isFirst = (await users.count()) === 0;
        const user = await users.create({ username: needUsername(), displayName: name, password: await readNewPassword() });
        console.log(`Added ${user.username} (${user.displayName}).`);
        if (isFirst) console.log('As the first user, they now own every existing task.');
        return;
      }
      case 'passwd':
        await users.setPassword(needUsername(), await readNewPassword());
        return console.log(`Password updated for ${username}.`);
      case 'rename': {
        const displayName = name ?? rest.join(' ');
        await users.rename(needUsername(), displayName);
        return console.log(`${username} is now shown as "${displayName.trim()}".`);
      }
      case 'disable':
        await users.setDisabled(needUsername(), true);
        return console.log(`${username} is disabled and signed out. Their tasks are kept.`);
      case 'enable':
        await users.setDisabled(needUsername(), false);
        return console.log(`${username} is enabled.`);
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
