# Architecture

How the pieces fit together at runtime. See also: [Tech stack](tech-stack.md) · [Data model](data-model.md) · [Flows](flows.md)

## System overview

```mermaid
flowchart TB
  user(["Julian & co."])
  user --> spa

  subgraph device["Phone or computer"]
    spa["Questlog web app<br/>React SPA, opened from the Home Screen"]
    sw["Service worker<br/>sw.js"]
  end

  subgraph railway["Railway"]
    server["Questlog server · Node 22 + Express<br/>serves the app and /api/*<br/>runs the minute jobs"]
    db[("PostgreSQL")]
  end

  met["MET Norway<br/>weather forecasts"]
  pushsvc["Push services<br/>Apple · Google · Mozilla · Microsoft"]

  spa -- "HTTPS: app files, JSON API,<br/>session cookie" --> server
  server -- "SQL" --> db
  server -- "forecasts, cached" --> met
  server -- "encrypted notifications" --> pushsvc
  pushsvc -- "delivers" --> sw
  sw -- "tap opens the right page" --> spa
```

| Box | What runs there |
| --- | --- |
| Web app | All screens; caches server data (TanStack Query); keeps the weather opt-in and rounded location in `localStorage` on this device only |
| Service worker | Shows push notifications and opens the app when one is tapped |
| Server | Static app files, the JSON API, minute jobs (roll-over, repeats, morning summary, shopping clean-up), in-memory weather cache and sign-in throttles; also the `users.js` CLI via `railway ssh` |
| PostgreSQL | All durable data (see [Data model](data-model.md)) |

- **One container** serves both the built SPA and the JSON API from the same origin, so cookies are first-party and there's no CORS.
- **The database is the only durable state.** In-memory state (weather cache, sign-in throttles) is fine to lose on restart.
- **Outbound calls** go only to MET Norway and the four push services.

## Request pipeline

Every `/api` request passes through the same middleware, in this order:

```mermaid
flowchart TD
  req([HTTP request]) --> helmet["helmet<br/>security headers"]
  helmet --> json["express.json<br/>100 kB limit"]
  json --> cookies["cookie-parser"]
  cookies --> health{"/api/health?"}
  health -- yes --> h200["SELECT 1 → 200"]
  health -- no --> origin{"sameOriginOnly<br/>write from another site?"}
  origin -- yes --> o403["403"]
  origin -- no --> nostore["Cache-Control: no-store"]
  nostore --> authr{"/api/auth/*?"}
  authr -- yes --> auth["login · logout · me<br/>(throttled)"]
  authr -- no --> requireAuth{"requireAuth<br/>valid cookie, user active,<br/>session_version matches?"}
  requireAuth -- no --> a401["401"]
  requireAuth -- yes --> route{"route"}
  route --> tasks["/api/tasks<br/>(runs roll-over first if a new day)"]
  route --> shopping["/api/shopping"]
  route --> push["/api/push"]
  route --> account["/api/account"]
  route --> weather["/api/weather"]
  route --> adminq{"/api/admin<br/>is_admin?"}
  adminq -- no --> d403["403"]
  adminq -- yes --> admin["admin routes"]
  tasks & shopping & push & account & weather & admin --> errors["error handler<br/>zod → 400, HttpError → status,<br/>anything else → 500"]
```

## API map

| Prefix | Who | Endpoints |
| --- | --- | --- |
| `/api/health` | anyone | `GET` database check (Railway health check) |
| `/api/auth` | anyone | `POST login`, `POST logout`, `GET me` |
| `/api/meta` | signed in | `GET` today's date and time zone |
| `/api/users` | signed in | `GET` people you can share with |
| `/api/tasks` | signed in, own/shared tasks only | `GET day/:date`, `GET backlog`, `GET history`, `GET calendar`, `GET :id`, `POST`, `PATCH :id`, `POST :id/complete`, `POST :id/reopen`, `PUT/DELETE :id/repeat`, `DELETE :id` |
| `/api/shopping` | signed in, one shared list | `GET`, `POST`, `POST :id/check`, `POST :id/uncheck`, `DELETE :id` |
| `/api/weather` | signed in | `GET ?lat&lon` |
| `/api/push` | signed in | `GET config`, `POST subscribe`, `POST unsubscribe`, `PATCH prefs`, `POST test` |
| `/api/account` | signed in | `POST password`, `POST signout-others` |
| `/api/admin` | admin | `GET/POST users`, `PATCH users/:id`, `POST users/:id/password`, `POST users/:id/signout`, `GET audit` |

## Server modules

```mermaid
flowchart TD
  index["index.ts<br/>entry point"] --> app["app.ts<br/>middleware & routes"]
  index --> migrate["migrate.ts"]
  index --> rollover["rollover.ts<br/>scheduler"]
  index --> pushsvc["push.ts<br/>PushService"]
  index --> usersb["users.ts<br/>bootstrapFirstUser"]

  app --> auth["auth.ts"]
  app --> admin["admin.ts"]
  app --> taskroutes["tasks/routes.ts"]
  app --> pushroutes["pushRoutes.ts"]
  app --> shopping["shopping.ts"]
  app --> weather["weather.ts"]

  taskroutes --> taskrepo["tasks/repo.ts<br/>TaskRepo"]
  taskroutes --> series["series.ts<br/>SeriesRepo"]
  taskroutes --> pushsvc
  taskrepo --> series
  rollover --> series
  series --> recurrence["recurrence.ts<br/>pure date rules"]

  auth --> users["users.ts<br/>UserRepo"]
  auth --> audit["audit.ts"]
  admin --> users
  admin --> audit
  users --> passwords["passwords.ts<br/>scrypt"]

  taskrepo & series & users & audit & shopping & pushsvc --> db["db.ts<br/>pg Pool, withTransaction"]
```

## Client structure

```mermaid
flowchart TD
  main["main.tsx<br/>QueryClient, Router,<br/>registers sw.js"] --> App["App.tsx<br/>sign-in gate"]
  App -->|signed out| Login["LoginPage"]
  App -->|signed in| Layout["Layout<br/>top bar · tab bar / sidebar"]
  Layout --> Day["DayPage<br/>/ and /day/:date"]
  Layout --> Cal["CalendarPage"]
  Layout --> Back["BacklogPage"]
  Layout --> Hist["HistoryPage"]
  Layout --> Shop["ShoppingPage"]
  Layout --> Acc["AccountPage"]
  Layout --> Adm["AdminPage (admin only)"]

  Day --> DayTasks["DayTasks"]
  DayTasks --> QuickAdd & TaskItem & TaskEditor & WeatherCard
  TaskEditor --> RepeatPicker & SharePicker
  QuickAdd --> SharePicker
  Acc --> NotificationSettings

  subgraph data["Data layer"]
    queries["queries.ts<br/>TanStack Query hooks"] --> apiTs["api.ts<br/>fetch wrapper"]
  end
  Day & Cal & Back & Hist & Shop & Acc & Adm --> queries
```

Server data lives in the TanStack Query cache. Mutations invalidate the `['tasks']` (or `['shopping']`, `['push', …]`) keys so every view refreshes; a few (checking off, preference switches) update the cache optimistically first.

## Background jobs

All run inside the web process. "Today" is always the date in `APP_TIMEZONE`.

| Job | Trigger | Does |
| --- | --- | --- |
| Roll-over | Once per new day, checked every minute and before every `/api/tasks` request | Moves open, non-repeating tasks from past days onto today |
| Repeating tasks | Same trigger | Creates occurrences that have come due; rolls over or marks missed per class |
| Morning summary | Every minute | Sends each opted-in user their day's tasks at their chosen time, once a day |
| Shopping clean-up | Every minute, and on each list load | Deletes entries checked off more than 12 hours ago |

Because the jobs live in the web process, the Railway service must stay running (no app sleeping) for summaries to go out on time. The roll-over still catches up on the first request after a wake.
