-- Repeating tasks. A series is a template plus a rule; each occurrence is an ordinary task
-- row (series_id + occurrence_date), created when its day arrives.
CREATE TABLE task_series (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  notes              text NOT NULL DEFAULT '',
  priority           text NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  frequency          text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  repeat_every       integer NOT NULL DEFAULT 1 CHECK (repeat_every BETWEEN 1 AND 365),
  weekdays           smallint[] NOT NULL DEFAULT '{}',
  kind               text NOT NULL CHECK (kind IN ('optional', 'fixed', 'variable')),
  -- Fixed/optional: occurrences are computed from start_date; generated_through is the last
  -- day already turned into tasks. Variable: next_date is when the next one is due.
  start_date         date NOT NULL,
  generated_through  date NOT NULL,
  next_date          date,
  member_ids         uuid[] NOT NULL,
  created_by         uuid REFERENCES users (id) ON DELETE SET NULL,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX task_series_active_idx ON task_series (id) WHERE active;

ALTER TABLE tasks
  ADD COLUMN series_id       uuid REFERENCES task_series (id) ON DELETE SET NULL,
  ADD COLUMN occurrence_date date;

CREATE UNIQUE INDEX tasks_series_occurrence_idx ON tasks (series_id, occurrence_date) WHERE series_id IS NOT NULL;

-- Occurrences that went undone are kept as "missed" for the journal.
ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK (status IN ('open', 'done', 'missed'));
CREATE INDEX tasks_missed_idx ON tasks (scheduled_date) WHERE status = 'missed';

ALTER TABLE task_events DROP CONSTRAINT task_events_type_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_type_check CHECK (type IN (
  'created', 'completed', 'reopened', 'rescheduled', 'rolled_over', 'members_changed',
  'missed', 'repeat_set', 'repeat_stopped'
));
