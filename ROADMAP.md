# Roadmap

Possible future features for questlog. This is a menu, not a commitment: reorder it, cross things out, add ideas.

**Size** is a rough guide to effort relative to what's already built:

- **S**: small and self-contained (like the "Back to today" button or the users list privacy fix)
- **M**: a feature in its own right (like the calendar view)
- **L**: big, or needs a new outside service (like multi-user was)

---

## Suggested next

These give the most value for the effort, given what the app already has.

| # | Feature | Size | Why now |
| --- | --- | --- | --- |
| 1 | **Nightly AI review** | L | The original goal. `task_events` already records age, roll-overs and reschedules, which are the signals it needs. |
| 2 | **Automatic tests on GitHub** | S | Runs the 66 tests on every pull request, so a broken change can't reach `main` unnoticed. |
| 3 | **Two-factor sign-in for the admin** | M | Your account can manage everyone else's; a second factor protects it if your password leaks. |
| 4 | **Push reminders** | L | Makes due dates and future todos actually reach you, instead of waiting for you to open the app. |

---

## AI

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| **Nightly AI review** | Once a night, looks through each person's open tasks and highlights the ones to follow up, with a one-line reason ("rolled over 6 days, due Friday"). Shown as a "Follow up" section on Today. | L | Claude via the Anthropic API; needs an API key in Railway. Scheduled in the server, in `APP_TIMEZONE`. Each person's review only sees their own and shared tasks. |
| Weekly summary | A short written recap each Monday: what got done, what keeps slipping. | M | Builds on the nightly review. |
| Smart quick-add | Type "Call mom tomorrow, high priority" and get the date and priority set. | M | Could be done without AI for simple patterns (see Natural-language quick-add). |
| Break down a task | Suggests subtasks for a big task. | M | Needs Subtasks first. |

## Planning & tasks

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| Subtasks / checklists | Tick off steps inside a task; the task shows "2/5". | M | |
| Projects or tags | Group tasks ("Work", "Home", "Trip") and filter lists by them. | M | |
| Board view | Jira-style columns: To do / In progress / Done, per project. | L | Needs an "in progress" status and Projects. |
| "In progress" / "Waiting on" status | Mark a task as started, or blocked on someone else. | S | |
| Reorder by dragging | Put a day's tasks in your own order instead of by priority. | M | Needs a position column; touch-friendly drag. |
| Time of day & duration | "14:00, 30 min", shown as a simple timeline on the day page. | M | |
| Snooze & bulk move | "Move to tomorrow" in one tap; select several tasks and move them together. | S | |
| Search | Find any task, open or done, by words in its title or notes. | M | Postgres full-text search. |
| Task templates | Reusable task sets, e.g. a "Trip prep" checklist. | M | |
| Attachments | Add photos or files to a task. | L | Needs file storage (a Railway volume or S3-style bucket). |

## Calendar & journal

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| Week view | Seven days side by side, between the day page and the month grid. | M | Reuses the calendar endpoint. |
| Daily note | A few lines of journal per day ("what went well"), shown in the calendar and history. | S | |
| Stats | Tasks done per week, streaks, what rolls over most. | M | All derivable from `task_events`. |
| Calendar subscription (iCal) | See questlog tasks inside Google/Apple Calendar via a private feed link. | M | Read-only; needs a per-user secret URL that can be revoked. |
| Holidays & weekends | Option to skip weekends when rolling over. | S | |

## Reminders & notifications

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| **Push reminders** | Phone notification at a chosen time, or when something is due. | L | Web Push (works for home-screen apps on iOS 16.4+ and Android); needs a service worker and keys. |
| Shared-task alerts | "Bob completed *Book venue*." | M | Builds on push. |
| Email digest | Morning email with today's list. | M | Needs an email provider (e.g. Resend, Postmark). |

## Sharing & collaboration

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| Comments on tasks | A short thread on a shared task, Jira-style. | M | |
| Assignee | On a shared task, mark who's responsible (others can still see it). | S | |
| Task history | "Created by Julian · moved to Friday by Bob · done by Sara". | S | Data is already in `task_events`; this is just showing it. |
| "Shared with me" filter | A view of only shared tasks. | S | |

## App & usability

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| Undo | "Task completed · Undo" toast after completing or deleting. | S | |
| Natural-language quick-add | `Dentist fri !high` sets the day and priority. | M | |
| Swipe gestures | Swipe right to complete, left to move to tomorrow. | M | |
| Keyboard shortcuts | `n` new task, `t` today, arrows for days, on a computer. | S | |
| Works offline | Open the app and tick things off without signal; syncs later. | L | Service worker plus conflict handling. |
| Light/dark switch | Choose a theme instead of following the phone. | S | |
| Translations | The interface in another language. | M | |

## Security & operations

| Feature | What it does | Size | Notes |
| --- | --- | --- | --- |
| **Automatic tests on GitHub** | GitHub Actions runs typecheck, tests and build on every pull request. | S | Needs a Postgres service in the workflow. |
| **Two-factor sign-in** | A 6-digit code from an authenticator app, at least for the admin. | M | TOTP; with backup codes. |
| Passkeys | Sign in with Face ID / fingerprint instead of a password. | L | |
| Export my data | Download all your tasks as JSON or CSV. | S | |
| Backups check | Confirm Railway Postgres backups are on, and document restoring. | S | Mostly settings, not code. |
| Durable sign-in limits | Keep the sign-in throttle in the database so a restart doesn't reset it. | S | |
| Audit log retention | Automatically drop activity older than, say, a year. | S | |
| Error alerts | Get told when the server hits an error (e.g. Sentry). | S | Needs an account with the service. |

---

## Shipped

- Day lists with automatic roll-over, backlog, history
- Calendar month view with journal, planned days and due dates
- Multiple users, private and shared tasks
- Admin page, account page, revocable sessions, sign-in throttling, audit log
- Week numbers in the calendar and day header
- Repeating tasks: daily/weekly/monthly/yearly, optional / mandatory fixed / mandatory flexible, missed tracking
