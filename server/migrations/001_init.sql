-- Core task storage.
-- A task lives on a day list (scheduled_date) or in the backlog (scheduled_date IS NULL).
-- Open tasks left on a past day are rolled over to "today" by the server.
CREATE TABLE tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  notes           text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  priority        text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  scheduled_date  date,
  original_date   date,
  due_date        date,
  rollover_count  integer NOT NULL DEFAULT 0,
  completed_at    timestamptz,
  completed_on    date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'done') = (completed_at IS NOT NULL AND completed_on IS NOT NULL))
);

CREATE INDEX tasks_open_scheduled_idx ON tasks (scheduled_date) WHERE status = 'open';
CREATE INDEX tasks_completed_on_idx ON tasks (completed_on) WHERE status = 'done';

-- Append-only activity log: feeds the journal/calendar and, later, the nightly AI review.
CREATE TABLE task_events (
  id          bigserial PRIMARY KEY,
  task_id     uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('created', 'completed', 'reopened', 'rescheduled', 'rolled_over')),
  from_date   date,
  to_date     date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_events_task_idx ON task_events (task_id, created_at);
