-- Admin role, revocable sessions, sign-in tracking and an audit trail.
ALTER TABLE users
  ADD COLUMN is_admin        boolean NOT NULL DEFAULT false,
  -- Embedded in session tokens; bumping it signs the user out everywhere.
  ADD COLUMN session_version integer NOT NULL DEFAULT 1,
  ADD COLUMN last_login_at   timestamptz;

-- The first account (the owner, created from APP_PASSWORD or the CLI) becomes the admin.
UPDATE users SET is_admin = true
WHERE id = (SELECT id FROM users ORDER BY created_at, id LIMIT 1);

CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  at              timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  action          text NOT NULL,
  target_user_id  uuid REFERENCES users (id) ON DELETE SET NULL,
  ip              text,
  detail          jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX audit_log_at_idx ON audit_log (at DESC);
