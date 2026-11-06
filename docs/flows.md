# Flows

How the main things happen, step by step. See also: [Tech stack](tech-stack.md) · [Architecture](architecture.md) · [Data model](data-model.md)

- [Signing in and sessions](#signing-in-and-sessions)
- [A task's life](#a-tasks-life)
- [The daily cycle](#the-daily-cycle)
- [Repeating tasks](#repeating-tasks)
- [Sharing a task and notifying others](#sharing-a-task-and-notifying-others)
- [Turning on notifications](#turning-on-notifications)
- [Weather](#weather)
- [Shopping list](#shopping-list)
- [Admin: resetting a password](#admin-resetting-a-password)

## Signing in and sessions

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App (browser)
  participant S as Server
  participant DB as PostgreSQL

  U->>A: Username + password
  A->>S: POST /api/auth/login
  S->>S: Throttle check (per network address, per username)
  S->>DB: Look up user
  S->>S: scrypt verify (dummy hash if no such user, so timing matches)
  alt wrong password, unknown user or disabled
    S->>DB: audit_log: login_failed
    S-->>A: 401 "Wrong username or password"
  else correct
    S->>DB: last_login_at = now(), audit_log: login_succeeded
    S-->>A: 200 + cookie ql_session = signed {uid, ver: session_version, exp: +30 days}
  end

  Note over A,S: Every later /api request
  A->>S: GET /api/tasks/day/… (cookie)
  S->>S: Verify HMAC signature and expiry
  S->>DB: Load user by uid
  alt user disabled, or ver ≠ session_version
    S-->>A: 401, app shows the sign-in page
  else valid
    S-->>A: 200 data
  end
```

Changing a password, resetting one, disabling an account or "sign out everywhere" increments `session_version`, which makes every existing cookie for that user invalid on its next request.

## A task's life

```mermaid
stateDiagram-v2
  direction LR
  [*] --> Backlog: create without a day
  [*] --> Planned: create on a day (default today)
  Backlog --> Planned: pick a day / "Today"
  Planned --> Backlog: move to backlog
  Planned --> Planned: reschedule, or roll-over to today at midnight
  Planned --> Done: complete
  Backlog --> Done: complete
  Done --> Planned: reopen (past day → today)
  Planned --> Missed: repeating routine/chore not done (see below)
  Missed --> Done: complete late
  Missed --> Planned: reopen
  Done --> [*]: delete
  Planned --> [*]: delete
  Backlog --> [*]: delete

  state "Open, on a day<br/>(status open, scheduled_date set)" as Planned
  state "Open, backlog<br/>(status open, scheduled_date NULL)" as Backlog
  state "Done<br/>(completed_on = local date)" as Done
  state "Missed<br/>(repeating tasks only)" as Missed
```

Every transition writes a row to `task_events`.

## The daily cycle

The server checks every minute, and before every `/api/tasks` request, whether the date in `APP_TIMEZONE` has changed. The first check on a new day runs the roll-over and repeats; the other jobs run every minute.

```mermaid
flowchart TD
  tick([Every minute, or a /api/tasks request]) --> newday{"New day in<br/>APP_TIMEZONE?"}
  newday -- no --> summary
  newday -- yes --> roll["Roll-over: open, non-repeating tasks<br/>on past days → today<br/>(rollover_count + 1, event rolled_over)"]
  roll --> series["Repeating series, one transaction each:<br/>create due occurrences,<br/>roll over or mark missed per class"]
  series --> summary{"Anyone's morning time reached,<br/>not sent today, has a device,<br/>within 3 hours of their time?"}
  summary -- yes --> send["Claim the day (last_morning_sent),<br/>list today's open tasks,<br/>send 'Today: N tasks' if any"]
  summary -- no --> shop
  send --> shop["Delete shopping entries<br/>checked off > 12 hours ago"]
  shop --> done([wait for next minute])
```

## Repeating tasks

A task becomes the first occurrence of a series when you set **Repeat**. On each new day, every active series is processed according to its class:

```mermaid
flowchart TD
  start([New day: process a series]) --> kind{Class}

  kind -- "Routine (optional)" --> gen1["Create occurrences for days since last run"]
  gen1 --> opt["Any occurrence still open<br/>on an earlier day → missed"]

  kind -- "Chore · fixed day" --> gen2["Create occurrences for days since last run"]
  gen2 --> fixedq{"Open occurrence on an earlier day:<br/>has a newer occurrence arrived?"}
  fixedq -- yes --> fmiss["Old one → missed"]
  fixedq -- no --> froll["Roll it over to today"]

  kind -- "Chore · flexible (variable)" --> vroll["Open occurrence on an earlier day → roll over to today"]
  vroll --> vnext{"No open occurrence,<br/>and next_date ≤ today<br/>(and ≤ repeat-until)?"}
  vnext -- yes --> vcreate["Create the next occurrence on today"]
  vnext -- no --> vwait([wait])

  opt & fmiss & froll & vcreate --> stop([done])
```

Completing a flexible occurrence sets `next_date` = completion day + one period (and clears it if that's past the end date), so the whole series shifts. Deleting the open occurrence counts as skipping it.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant S as Server
  participant DB as PostgreSQL

  U->>S: PUT /api/tasks/:id/repeat {weekly, every 2, kind fixed, until …}
  S->>DB: INSERT task_series (template = task, start_date = task's day)
  S->>DB: UPDATE task: series_id, occurrence_date
  Note over S,DB: Calendar and future day pages show<br/>computed previews, nothing stored yet
  loop Each new day
    S->>DB: processAll(today): create / roll / miss
  end
  U->>S: POST /api/tasks/:id/complete
  S->>DB: status done, flexible series → next_date = today + period
```

## Sharing a task and notifying others

```mermaid
sequenceDiagram
  autonumber
  actor J as Julian
  participant S as Server
  participant DB as PostgreSQL
  participant P as Push service
  participant B as Bob's phone

  J->>S: POST /api/tasks {title, memberIds: [Bob]}
  S->>DB: INSERT task, task_members (Julian, Bob), event created
  S-->>J: 201 task (response doesn't wait for push)
  S-)S: background: recipients = members − Julian,<br/>with notify_shared on
  S->>DB: Bob's push_subscriptions
  S->>P: encrypted payload (VAPID-signed)
  P->>B: wake service worker
  B->>B: "Julian shared a task with you · Book venue · today"
  Note over B: Tap → opens the task's day

  J->>S: PATCH /api/tasks/:id {scheduledDate: tomorrow}
  S->>DB: UPDATE, event rescheduled
  S-)P: "Julian updated a shared task: Book venue: moved to tomorrow"
  alt push service answers 404/410
    S->>DB: delete that subscription
  end
```

Complete, reopen and delete on a shared task notify the other members the same way. The person making the change is never notified, and edits that change nothing send nothing.

## Turning on notifications

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant SW as Service worker
  participant PM as Browser push manager
  participant S as Server

  A->>SW: register /sw.js (on every load)
  U->>A: Account → "Turn on notifications"
  A->>S: GET /api/push/config
  S-->>A: VAPID public key, preferences
  A->>A: Notification.requestPermission() (needs the tap)
  A->>PM: subscribe(public key)
  PM-->>A: endpoint + device keys
  A->>S: POST /api/push/subscribe
  S->>S: endpoint must be Apple/Google/Mozilla/Microsoft
  S-->>A: 201
  U->>A: "Send a test"
  A->>S: POST /api/push/test
  S-)SW: push → showNotification("Notifications are working…")
```

On iPhone and iPad this only works from the Home Screen app (iOS 16.4+); in a Safari tab the Account page explains how to add it.

## Weather

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant A as App
  participant S as Server
  participant C as Weather cache (memory)
  participant M as MET Norway

  U->>A: Today page → "Use my location" (once per device)
  A->>A: geolocation → round to 2 decimals (~1 km),<br/>remember on this device
  A->>S: GET /api/weather?lat=59.91&lon=10.75
  S->>C: fresh forecast for this spot?
  alt cached and not past Expires
    C-->>S: forecast
  else stale or missing
    S->>M: GET locationforecast (User-Agent, If-Modified-Since)
    alt 200
      M-->>S: hourly + 6-hourly time series, Expires
    else 304
      M-->>S: not modified, new Expires
    else error
      S->>S: use last good forecast if any
    end
    S->>C: store until Expires
  end
  S->>S: summarise per local day: now, min/max,<br/>rain, wind, midday symbol
  S-->>A: {now, days[4]}
  A->>U: Today: now + today. Next 3 days' pages: that day.
```

Coordinates are never stored on the server.

## Shopping list

One list shared by everyone. Rules for items and sub-items:

```mermaid
stateDiagram-v2
  direction LR
  state "Item open" as IO
  state "Item checked off" as IC
  state "Sub-item open" as SO
  state "Sub-item checked off" as SC

  [*] --> IO: add item
  IO --> IC: check item<br/>(also checks all its sub-items)
  IC --> IO: uncheck item<br/>(also reopens its sub-items)
  IC --> IO: a sub-item is unchecked,<br/>or a new sub-item is added
  IC --> [*]: 12 hours after checked off<br/>(sub-items go with it)

  [*] --> SO: add sub-item
  SO --> SC: check sub-item<br/>(item stays open)
  SC --> SO: uncheck sub-item
  SC --> [*]: 12 hours after checked off
```

An item is only checked off when someone checks it itself, even if all its sub-items are done; it then shows "N of N checked off". The page polls every 15 seconds so other people's changes appear.

## Admin: resetting a password

```mermaid
sequenceDiagram
  autonumber
  actor J as Julian (admin)
  participant S as Server
  participant DB as PostgreSQL
  actor B as Bob's devices

  J->>S: POST /api/admin/users/:bob/password {new password}
  S->>S: requireAuth + is_admin
  S->>S: scrypt hash (min 8 chars)
  S->>DB: UPDATE users SET password_hash, session_version + 1
  S->>DB: audit_log: password_reset (actor Julian, target Bob)
  S-->>J: 200
  B->>S: any request with an old cookie
  S-->>B: 401 (ver ≠ session_version) → sign-in page
```

Disabling, "sign out everywhere" and the `users.js` CLI commands follow the same pattern; the CLI writes its audit entries with no actor (`via: cli`).
