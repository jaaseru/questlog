# questlog

A private and professional task manager and calendar.

Mobile-first web app (it scales up to desktop) for planning each day, carrying unfinished work forward, and keeping a journal of what got done.

## What works today

- **Day lists.** Every day has its own todo list. Use ‹ › to move between days. Future days take tasks as reminders. Past days read as a journal of what was finished.
- **Automatic roll-over.** Open tasks left on a past day move onto today. They get a "↻ since …" badge, and the roll-over is logged.
- **Calendar.** A month grid that combines the journal (completed), today, planned days and due dates. Phones show counters per day; wider screens show task titles. Tap a day to see and edit its tasks below the grid.
- **Backlog.** Tasks with no day. Tap **Today** to pull one in.
- **History.** Completed tasks grouped by the day they were finished.
- **Task details.** Title, notes, priority (urgent / high / medium / low), scheduled day, due date.
- **A few users, managed by you.** Accounts are added from the command line (see [docs/managing-users.md](docs/managing-users.md)). Each person sees only their own tasks and the tasks shared with them.
- **Shared tasks.** Share a task with one or more people from quick-add (the people button) or the task editor. Every member sees it on their lists and can edit or complete it; the list shows who completed it. Only the creator can delete a shared task; others can **Leave** it.

## Roadmap

1. **Nightly AI review.** A scheduled job reads open tasks (age, roll-over count, due dates, priority) and flags the ones that need a follow-up. The `task_events` log already records the history it needs.
2. Quality-of-life: drag to reorder, swipe gestures, tags/projects, search.

## Stack

| Part      | Tech                                                         |
| --------- | ------------------------------------------------------------ |
| Client    | React 19 + TypeScript, Vite, TanStack Query, React Router    |
| Server    | Node 22, Express 5, TypeScript, zod                          |
| Database  | PostgreSQL (plain SQL migrations in `server/migrations/`)    |
| Hosting   | One Railway service (Dockerfile) + a Railway Postgres        |

The server serves the API under `/api` and the built client from the same origin, so a single container covers everything.

```
client/            React app
server/src/        API: auth, tasks, roll-over scheduler, migrations runner
server/migrations/ SQL migrations, applied automatically on start
server/test/       Unit + API integration tests
```

## Local development

You'll need Node 22+ and a Postgres database.

```bash
npm install
```

```bash
cp .env.example .env   # then fill in DATABASE_URL and SESSION_SECRET
```

```bash
npm run users:dev -w server -- add yourname
```

```bash
npm run dev            # API on :3000, Vite on :5173 (proxies /api)
```

Open http://localhost:5173 and sign in. Migrations run automatically when the server (or the users tool) starts.

### Checks

```bash
npm run typecheck
```

```bash
TEST_DATABASE_URL=postgres://user:pass@localhost:5432/questlog_test npm test
```

The API tests **wipe** the database they're pointed at. Give them a dedicated one. Without `TEST_DATABASE_URL` they are skipped.

## Deploying to Railway

1. Create a project and add a **PostgreSQL** database.
2. Add a service from this GitHub repo. Railway picks up `railway.json` and builds the `Dockerfile`.
3. Set the service variables:

   | Variable         | Value                                                        |
   | ---------------- | ------------------------------------------------------------ |
   | `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}` (reference to the database)     |
   | `SESSION_SECRET` | Output of `openssl rand -hex 32`                             |
   | `APP_TIMEZONE`   | Your IANA zone, e.g. `Europe/Oslo` (when "today" ends)       |

4. Under **Networking**, generate a public domain. The health check is `/api/health`.
5. Create your account; see [Managing users](#managing-users).

On your phone, open the site and use **Add to Home Screen** to get an app-like, full-screen launcher.

## Managing users

**Step-by-step guide: [docs/managing-users.md](docs/managing-users.md)** (Railway CLI setup, every command, troubleshooting).

Accounts live in the `users` table. Passwords are hashed with scrypt, so add and change them with the bundled tool rather than by editing the table.

On Railway, open a shell in the running app with the [Railway CLI](https://docs.railway.com/guides/cli) (`railway link`, then `railway ssh`), and run:

```bash
node server/dist/cli/users.js add bob --name "Bob Berg"
```

It prompts for the password without echoing it (minimum 8 characters). All commands:

| Command                                   | Does                                                         |
| ----------------------------------------- | ------------------------------------------------------------ |
| `list`                                    | Shows every account and whether it's active                  |
| `add <username> [--name "Display Name"]`  | Creates an account                                           |
| `passwd <username>`                       | Sets a new password                                          |
| `rename <username> "Display Name"`        | Changes the name others see                                  |
| `disable <username>` / `enable <username>`| Blocks or restores sign-in; a disabled user is signed out at once and their tasks are kept |

Usernames are 2–32 characters: lowercase letters, digits, `.`, `_` or `-`. For scripts, pass the password in `QUESTLOG_PASSWORD` instead of typing it.

### Upgrading from the single-password version

If the database has no users yet and `APP_PASSWORD` is set, the server creates the first account on start-up: username `ADMIN_USERNAME` (default `admin`) with `APP_PASSWORD` as its password. That account takes over every existing task. After that, `APP_PASSWORD` is ignored and can be removed. Existing sessions end, so everyone signs in again with a username.

## How roll-over works

- "Today" is computed in `APP_TIMEZONE`.
- When the date changes, the server moves every open task scheduled before today onto today. It checks every minute and before every task request, so the move happens even if the container was asleep at midnight.
- Each move increments `rollover_count`, keeps the first `original_date`, and writes a `rolled_over` event.
- A completed task records `completed_on` (its local date), which drives History and the past-day journal.
