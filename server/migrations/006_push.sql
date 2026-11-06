-- Web Push: one row per device that opted in, per-user notification preferences,
-- and app-wide settings (the server's VAPID key pair is generated once and kept here).
CREATE TABLE push_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint         text NOT NULL UNIQUE,
  p256dh           text NOT NULL,
  auth             text NOT NULL,
  user_agent       text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_success_at  timestamptz
);

CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);

ALTER TABLE users
  ADD COLUMN notify_shared     boolean NOT NULL DEFAULT true,
  ADD COLUMN notify_morning    boolean NOT NULL DEFAULT true,
  ADD COLUMN morning_time      text NOT NULL DEFAULT '07:30' CHECK (morning_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD COLUMN last_morning_sent date;

CREATE TABLE app_settings (
  key    text PRIMARY KEY,
  value  text NOT NULL
);
