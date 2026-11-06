# Working on questlog

## Rules from the owner (Julian)

- **Never merge to `main` without Julian's explicit approval.** Open a pull request, describe the change and how it was tested, then wait. Railway deploys from `main`, so merging means going live.
- Work on a feature branch, never commit directly to `main`.

## What this is

A private, mobile-first task manager and calendar for a handful of users, managed by the admin. React + TypeScript client (`client/`), Express + TypeScript API (`server/`), PostgreSQL, deployed to Railway as one Docker container that serves both. See `README.md` for features and `ROADMAP.md` for ideas.

## Commands

```bash
npm install
npm run typecheck
npm run build
TEST_DATABASE_URL=postgres://… npm test   # wipes that database; API tests are skipped without it
npm run dev                               # API :3000, Vite :5173
```

## Conventions

- Database changes go in a new numbered file in `server/migrations/` (e.g. `006_….sql`); they run on start. Never edit an applied migration.
- Every task query is scoped to the signed-in user's memberships (`task_members`); keep it that way and test it.
- Dates are `YYYY-MM-DD` strings; "today" comes from `APP_TIMEZONE` on the server.
- Check UI changes at phone width and desktop width before opening a pull request.
- Don't put secrets in the repo (no real passwords in example files).
