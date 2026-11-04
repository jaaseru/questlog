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
- **Single-owner login.** One password, set by environment variable. Sessions are stored in signed, httpOnly cookies.

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
cp .env.example .env   # then fill in DATABASE_URL, APP_PASSWORD, SESSION_SECRET
```

```bash
npm run dev            # API on :3000, Vite on :5173 (proxies /api)
```

Open http://localhost:5173. Migrations run automatically when the server starts.

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
   | `APP_PASSWORD`   | The password you'll sign in with                             |
   | `SESSION_SECRET` | Output of `openssl rand -hex 32`                             |
   | `APP_TIMEZONE`   | Your IANA zone, e.g. `Europe/Oslo` (when "today" ends)       |

4. Under **Networking**, generate a public domain. The health check is `/api/health`.

On your phone, open the site and use **Add to Home Screen** to get an app-like, full-screen launcher.

## How roll-over works

- "Today" is computed in `APP_TIMEZONE`.
- When the date changes, the server moves every open task scheduled before today onto today. It checks every minute and before every task request, so the move happens even if the container was asleep at midnight.
- Each move increments `rollover_count`, keeps the first `original_date`, and writes a `rolled_over` event.
- A completed task records `completed_on` (its local date), which drives History and the past-day journal.
