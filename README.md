# questlog

A private and professional task manager and calendar.

Mobile-first web app (it scales up to desktop) for planning each day, carrying unfinished work forward, and keeping a journal of what got done.

## What works today

- **Day lists.** Every day has its own todo list. Use ‹ › to move between days. Future days take tasks as reminders. Past days read as a journal of what was finished.
- **Automatic roll-over.** Open tasks left on a past day move onto today. They get a "↻ since …" badge, and the roll-over is logged.
- **Calendar.** A month grid that combines the journal (completed), today, planned days and due dates. Phones show counters per day; wider screens show task titles. Tap a day to open it.
- **Repeating tasks.** Daily, weekly (every N weeks, or on chosen weekdays such as Mon and Thu), monthly or yearly. Each series is a **routine** (not done on its day → missed), a **chore with a fixed day** (rolls over until the next one is due, then missed) or a **flexible chore** (rolls over, and the next one is one period after completion). Series can end on a chosen date. Future occurrences show as previews; missed ones stay in the journal and can still be completed. See [How repeating tasks work](#how-repeating-tasks-work).
- **Weather.** Today's page shows the weather now and for the rest of today for your location, under the day's tasks; the pages for the next three days show that day's forecast. Data from [MET Norway](https://api.met.no/) (the forecasts behind yr.no). It's opt-in per device (**Use my location**, or the setting on the Account page); coordinates are rounded to about 1 km, sent only to fetch the forecast, and not stored on the server.
- **Push notifications** (opt-in per device, on the Account page): when someone creates, changes, completes or deletes a task shared with you, and a morning summary of your day at a time you choose. Works on Android and desktop browsers, and on iPhone/iPad from the Home Screen app (iOS 16.4+). See [Notifications](#notifications).
- **Shopping list.** One list shared by everyone. Anyone can add, remove and check off items. Items can have sub-items (one level, e.g. "Taco night" → tortillas, salsa). Checking an item checks its sub-items; an item is only checked off when it's checked itself, even if all its sub-items are done. Checked-off entries move to a *Checked off* group (with who checked them) and are deleted 12 hours later. Other people's changes appear within about 15 seconds.
- **Backlog.** Tasks with no day. Tap **Today** to pull one in.
- **History.** Completed tasks grouped by the day they were finished.
- **Task details.** Title, notes, priority (urgent / high / medium / low), scheduled day, due date.
- **A few users, managed by you.** Accounts are added from the command line (see [docs/managing-users.md](docs/managing-users.md)). Each person sees only their own tasks and the tasks shared with them.
- **Shared tasks.** Share a task with one or more people from quick-add (the people button) or the task editor. Every member sees it on their lists and can edit or complete it; the list shows who completed it. Only the creator can delete a shared task; others can **Leave** it.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for possible future features, grouped by theme with rough sizes and a suggested order.

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
   | `VAPID_SUBJECT`  | Optional. Contact for push services, e.g. `https://your-site.up.railway.app` or `mailto:you@example.com` |
   | `WEATHER_USER_AGENT` | Optional. Sent to MET Norway, whose terms require an app name and contact, e.g. `questlog/1.0 (+https://your-site.up.railway.app)` |

4. Under **Networking**, generate a public domain. The health check is `/api/health`.
5. Create your account; see [Managing users](#managing-users).

On your phone, open the site and use **Add to Home Screen** to get an app-like, full-screen launcher.

## Managing users

**Step-by-step guide: [docs/managing-users.md](docs/managing-users.md)** (the Admin page, the command line, troubleshooting).

Day to day, use the **Admin page** in the app (only the admin sees it). The command line below is the backup.

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
| `passwd <username>`                       | Sets a new password and signs them out everywhere            |
| `rename <username> "Display Name"`        | Changes the name others see                                  |
| `disable <username>` / `enable <username>`| Blocks or restores sign-in; a disabled user is signed out at once and their tasks are kept |
| `signout <username>`                      | Ends all of their sessions                                   |
| `grant-admin <username>` / `revoke-admin <username>` | Gives or removes access to the Admin page        |

Usernames are 2–32 characters: lowercase letters, digits, `.`, `_` or `-`. For scripts, pass the password in `QUESTLOG_PASSWORD` instead of typing it.

### Upgrading from the single-password version

If the database has no users yet and `APP_PASSWORD` is set, the server creates the first account on start-up: username `ADMIN_USERNAME` (default `admin`) with `APP_PASSWORD` as its password. That account takes over every existing task. After that, `APP_PASSWORD` is ignored and can be removed. Existing sessions end, so everyone signs in again with a username.

## Security

- **Passwords** are hashed with scrypt (salted, 32 MiB cost). Sign-ins for unknown usernames take as long as for real ones, so usernames can't be probed by timing.
- **Sessions** are signed, httpOnly, SameSite=Lax cookies (Secure in production) valid for 30 days. Each carries the account's session version, so a password change, reset, disable or "sign out everywhere" ends existing sessions immediately.
- **Sign-in throttling**: 20 attempts per network address and 10 failures per username per 15 minutes; failed and blocked attempts are logged. Throttling is in memory and resets when the app restarts.
- **Access control**: every task query is scoped to the signed-in user's memberships. The admin API requires the admin flag, which can only be granted from the command line.
- **Requests**: state-changing API calls from another site's origin are rejected; API responses are `Cache-Control: no-store`; security headers (CSP, HSTS, etc.) via helmet; request bodies capped at 100 kB.
- **Audit log**: sign-ins, failures and account changes are stored in `audit_log` and shown on the Admin page.

## How repeating tasks work

Open a task that's on a day, choose **Repeat**, and pick how often and what happens when it isn't done. The task becomes the first occurrence and the schedule is anchored on its day.

| Class | Not done on its day… | Next occurrence |
| --- | --- | --- |
| **Routine** | Marked **missed** (stays in that day's journal) | On schedule |
| **Chore · fixed day** | Moves to the next day, every day, until the next occurrence is due; then the old one is marked **missed** | On schedule; dates never move |
| **Chore · flexible** | Moves to the next day until done | One full period after the day it's completed; the whole series shifts. Only one weekday can be chosen. |

- **Until** (optional) sets the last day an occurrence may fall on. After it, nothing new is created; a chore's last occurrence still rolls over until it's done.
- Occurrences become real tasks on their day (in `APP_TIMEZONE`). Until then the calendar and future day pages show them as dashed previews; a flexible series' previews are marked *estimated* while the current one is open.
- Changing an occurrence's title, notes, priority or who it's shared with also changes future occurrences.
- Deleting an occurrence removes just that one. For a flexible series it counts as skipping: the next one is a period from today.
- **Stop repeating** keeps past occurrences; the current one becomes an ordinary task.
- Monthly on the 31st falls on the last day of shorter months; yearly on 29 February falls on the 28th in other years.

## Notifications

- Turn on per device under **Account → Notifications**. On iPhone/iPad, add Questlog to the Home Screen first (Share → Add to Home Screen) and open it from there; Safari tabs can't receive push.
- **Shared tasks:** everyone else on a shared task is told when it's created (or they're added), its title/day/priority/due date/notes change, or it's completed, reopened or deleted. The person who made the change isn't notified.
- **Morning summary:** at your chosen time (default 07:30, in `APP_TIMEZONE`), your open tasks for the day. Skipped on days with nothing planned, and not sent if the server only gets to it more than three hours late.
- Preferences apply to all of a person's devices; each device opts in separately. Devices that uninstall or unsubscribe are forgotten automatically.
- The server's push keys (VAPID) are generated on first start and kept in the database. To manage them yourself, set `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` (`npx web-push generate-vapid-keys`). Changing them means every device has to turn notifications on again.
- The server only sends to Apple, Google, Mozilla and Microsoft push services.
- **Railway:** keep the service running (turn off app sleeping / serverless), or morning summaries won't be sent while it's asleep.

## How roll-over works

- "Today" is computed in `APP_TIMEZONE`.
- When the date changes, the server moves every open task scheduled before today onto today. It checks every minute and before every task request, so the move happens even if the container was asleep at midnight.
- Each move increments `rollover_count`, keeps the first `original_date`, and writes a `rolled_over` event.
- A completed task records `completed_on` (its local date), which drives History and the past-day journal.
