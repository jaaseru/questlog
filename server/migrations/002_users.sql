-- Multi-user: accounts, task membership (private = one member, shared = several),
-- and who did what.
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username       text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{2,32}$'),
  display_name   text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 100),
  password_hash  text NOT NULL,
  disabled       boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE task_members (
  task_id   uuid NOT NULL REFERENCES tasks (id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX task_members_user_idx ON task_members (user_id, task_id);

ALTER TABLE tasks
  ADD COLUMN created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN completed_by uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE task_events
  ADD COLUMN user_id uuid REFERENCES users (id) ON DELETE SET NULL;

ALTER TABLE task_events DROP CONSTRAINT task_events_type_check;
ALTER TABLE task_events ADD CONSTRAINT task_events_type_check
  CHECK (type IN ('created', 'completed', 'reopened', 'rescheduled', 'rolled_over', 'members_changed'));
