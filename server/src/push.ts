/**
 * Web Push: device subscriptions, sending, and the two kinds of notification
 * (shared-task changes and the morning summary).
 */
import webpush from 'web-push';
import { addDays, todayIn } from './dates.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import type { Task, TaskPatch } from './tasks/repo.js';

export interface PushMessage {
  title: string;
  body: string;
  /** Page to open when the notification is tapped. */
  url: string;
  /** Notifications with the same tag replace each other on the device. */
  tag: string;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** Sends one encrypted message to one device. Swappable in tests. */
export type Sender = (
  sub: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: { TTL: number; topic?: string; urgency?: 'normal' | 'high' },
) => Promise<{ statusCode: number }>;

/**
 * The server only ever POSTs to these push services, so a crafted subscription can't
 * make it call arbitrary URLs.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /(^|\.)push\.apple\.com$/, /^updates\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];

export function isAllowedEndpoint(endpoint: string, extraHosts: RegExp[] = []): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'https:' && [...PUSH_HOSTS, ...extraHosts].some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** Uses VAPID keys from the environment if set, otherwise generates a pair once and keeps it in the database. */
export async function loadVapidKeys(db: Db, env: NodeJS.ProcessEnv = process.env): Promise<VapidKeys> {
  if (env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  }
  const generated = webpush.generateVAPIDKeys();
  await db.query(
    `INSERT INTO app_settings (key, value) VALUES ('vapid_public_key', $1), ('vapid_private_key', $2)
     ON CONFLICT (key) DO NOTHING`,
    [generated.publicKey, generated.privateKey],
  );
  const { rows } = await db.query<{ key: string; value: string }>(
    `SELECT key, value FROM app_settings WHERE key IN ('vapid_public_key', 'vapid_private_key')`,
  );
  const get = (k: string) => rows.find((r) => r.key === k)!.value;
  return { publicKey: get('vapid_public_key'), privateKey: get('vapid_private_key') };
}

export function webPushSender(keys: VapidKeys, subject: string): Sender {
  return (sub, payload, options) =>
    webpush.sendNotification(sub, payload, {
      ...options,
      vapidDetails: { subject, publicKey: keys.publicKey, privateKey: keys.privateKey },
    });
}

export interface NotificationPrefs {
  shared: boolean;
  morning: boolean;
  /** 'HH:MM' in the app's time zone. */
  morningTime: string;
}

type Log = (msg: string) => void;

export class PushService {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly db: Db,
    readonly publicKey: string,
    private readonly send: Sender,
    private readonly log: Log = () => {},
    private readonly extraHosts: RegExp[] = [],
  ) {}

  /** Runs a notification job without making the request wait; errors are logged, never thrown. */
  background(job: () => Promise<unknown>): void {
    const p = job()
      .catch((err) => this.log(`Notification failed: ${(err as Error).message}`))
      .finally(() => this.pending.delete(p));
    this.pending.add(p);
  }

  /** Waits for background jobs to finish (tests, shutdown). */
  async flush(): Promise<void> {
    while (this.pending.size) await Promise.all([...this.pending]);
  }

  // ---------- Devices ----------

  async subscribe(userId: string, input: SubscriptionInput, userAgent: string): Promise<void> {
    if (!isAllowedEndpoint(input.endpoint, this.extraHosts)) {
      throw new HttpError(400, 'Unsupported push service');
    }
    // A device belongs to whoever subscribed last on it.
    await this.db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (endpoint) DO UPDATE SET user_id = $1, p256dh = $3, auth = $4, user_agent = $5`,
      [userId, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent.slice(0, 300)],
    );
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.db.query('DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2', [userId, endpoint]);
  }

  async deviceCount(userId: string): Promise<number> {
    const { rows } = await this.db.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM push_subscriptions WHERE user_id = $1',
      [userId],
    );
    return rows[0]!.n;
  }

  // ---------- Preferences ----------

  async prefs(userId: string): Promise<NotificationPrefs> {
    const { rows } = await this.db.query<NotificationPrefs>(
      `SELECT notify_shared AS shared, notify_morning AS morning, morning_time AS "morningTime" FROM users WHERE id = $1`,
      [userId],
    );
    return rows[0]!;
  }

  /** Changes only the fields given, so quick successive changes can't overwrite each other. */
  async setPrefs(userId: string, patch: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const { rows } = await this.db.query<NotificationPrefs>(
      `UPDATE users SET
         notify_shared = COALESCE($2, notify_shared),
         notify_morning = COALESCE($3, notify_morning),
         morning_time = COALESCE($4, morning_time),
         -- A new time should be able to fire today.
         last_morning_sent = CASE WHEN $4::text IS NULL OR morning_time = $4 THEN last_morning_sent ELSE NULL END
       WHERE id = $1
       RETURNING notify_shared AS shared, notify_morning AS morning, morning_time AS "morningTime"`,
      [userId, patch.shared ?? null, patch.morning ?? null, patch.morningTime ?? null],
    );
    return rows[0]!;
  }

  // ---------- Sending ----------

  /** Sends to every device of the given users. Returns how many devices accepted it. */
  async sendTo(userIds: string[], message: PushMessage): Promise<number> {
    if (userIds.length === 0) return 0;
    const { rows } = await this.db.query<StoredSubscription>(
      'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::uuid[])',
      [userIds],
    );
    const payload = JSON.stringify(message);
    const results = await Promise.all(
      rows.map(async (s) => {
        try {
          await this.send({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
            TTL: 12 * 3600,
            topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined,
            urgency: 'normal',
          });
          await this.db.query('UPDATE push_subscriptions SET last_success_at = now() WHERE id = $1', [s.id]);
          return 1;
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            // The device unsubscribed or the app was removed: forget it.
            await this.db.query('DELETE FROM push_subscriptions WHERE id = $1', [s.id]);
          } else {
            this.log(`Push to ${new URL(s.endpoint).hostname} failed: ${status ?? (err as Error).message}`);
          }
          return 0;
        }
      }),
    );
    return results.reduce<number>((a, b) => a + b, 0);
  }

  /** Users (other than the actor) who are on the task and want shared-task notifications. */
  private async recipients(memberIds: string[], actorId: string): Promise<string[]> {
    const others = memberIds.filter((id) => id !== actorId);
    if (others.length === 0) return [];
    const { rows } = await this.db.query<{ id: string }>(
      'SELECT id FROM users WHERE id = ANY($1::uuid[]) AND notify_shared AND NOT disabled',
      [others],
    );
    return rows.map((r) => r.id);
  }

  // ---------- Shared-task events ----------

  async taskCreated(actor: Actor, task: Task, today: string) {
    const to = await this.recipients(task.memberIds, actor.id);
    await this.sendTo(to, {
      title: `${actor.displayName} shared a task with you`,
      body: `${task.title}${task.scheduledDate ? ` · ${dayLabel(task.scheduledDate, today)}` : ' · Backlog'}`,
      url: taskUrl(task, today),
      tag: `task-${task.id}`,
    });
  }

  async taskUpdated(actor: Actor, before: Task, after: Task, patch: TaskPatch, today: string) {
    const added = after.memberIds.filter((id) => !before.memberIds.includes(id));
    const stayed = after.memberIds.filter((id) => before.memberIds.includes(id));
    const changes = describeChanges(before, after, patch, today);

    if (added.length) await this.taskCreated(actor, { ...after, memberIds: [actor.id, ...added] }, today);
    if (!changes || after.memberIds.length < 2) return;
    await this.sendTo(await this.recipients(stayed, actor.id), {
      title: `${actor.displayName} updated a shared task`,
      body: `${after.title}: ${changes}`,
      url: taskUrl(after, today),
      tag: `task-${after.id}`,
    });
  }

  async taskCompleted(actor: Actor, task: Task, today: string, reopened = false) {
    await this.sendTo(await this.recipients(task.memberIds, actor.id), {
      title: `${actor.displayName} ${reopened ? 'reopened' : 'completed'} a shared task`,
      body: task.title,
      url: taskUrl(task, today),
      tag: `task-${task.id}`,
    });
  }

  async taskDeleted(actor: Actor, task: Task) {
    await this.sendTo(await this.recipients(task.memberIds, actor.id), {
      title: `${actor.displayName} deleted a shared task`,
      body: task.title,
      url: '/',
      tag: `task-${task.id}`,
    });
  }

  // ---------- Morning summary ----------

  /**
   * Sends each opted-in user their summary once a day, at or after their chosen time
   * (within three hours of it, so a late start doesn't send a "morning" note in the evening).
   */
  async sendMorningSummaries(
    timeZone: string,
    now: Date,
    listToday: (userId: string, today: string) => Promise<{ open: Task[] }>,
  ): Promise<number> {
    const today = todayIn(timeZone, now);
    const minutes = localMinutes(now, timeZone);
    const { rows: due } = await this.db.query<{ id: string; morning_time: string }>(
      `SELECT u.id, u.morning_time FROM users u
       WHERE u.notify_morning AND NOT u.disabled
         AND (u.last_morning_sent IS NULL OR u.last_morning_sent < $1)
         AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.user_id = u.id)`,
      [today],
    );
    let sent = 0;
    for (const u of due) {
      const [h, m] = u.morning_time.split(':').map(Number);
      const at = h! * 60 + m!;
      if (minutes < at || minutes > at + 180) continue;
      // Claim the day first so two runs can't both send.
      const { rowCount } = await this.db.query(
        `UPDATE users SET last_morning_sent = $2 WHERE id = $1 AND (last_morning_sent IS NULL OR last_morning_sent < $2)`,
        [u.id, today],
      );
      if (!rowCount) continue;
      const { open } = await listToday(u.id, today);
      if (open.length === 0) continue; // nothing to say: stay quiet
      await this.sendTo([u.id], morningMessage(open, today));
      sent++;
    }
    return sent;
  }
}

export interface Actor {
  id: string;
  displayName: string;
}

export function morningMessage(open: Task[], today: string): PushMessage {
  const carried = open.filter((t) => t.rolloverCount > 0).length;
  const due = open.filter((t) => t.dueDate === today).length;
  const names = open.slice(0, 3).map((t) => t.title);
  const more = open.length > 3 ? ` +${open.length - 3} more` : '';
  const extras = [carried && `${carried} carried over`, due && `${due} due today`].filter(Boolean).join(' · ');
  return {
    title: `Today: ${open.length} ${open.length === 1 ? 'task' : 'tasks'}`,
    body: `${names.join(', ')}${more}${extras ? `\n${extras}` : ''}`,
    url: '/',
    tag: `morning-${today}`,
  };
}

function describeChanges(before: Task, after: Task, patch: TaskPatch, today: string): string | null {
  const parts: string[] = [];
  if (patch.title !== undefined && before.title !== after.title) parts.push(`renamed from "${before.title}"`);
  if (patch.scheduledDate !== undefined && before.scheduledDate !== after.scheduledDate) {
    parts.push(after.scheduledDate ? `moved to ${dayLabel(after.scheduledDate, today)}` : 'moved to the backlog');
  }
  if (patch.priority !== undefined && before.priority !== after.priority) parts.push(`priority ${after.priority}`);
  if (patch.dueDate !== undefined && before.dueDate !== after.dueDate) {
    parts.push(after.dueDate ? `due ${dayLabel(after.dueDate, today)}` : 'no due date');
  }
  if (patch.notes !== undefined && before.notes !== after.notes) parts.push('notes edited');
  return parts.length ? parts.join(', ') : null;
}

function dayLabel(date: string, today: string): string {
  if (date === today) return 'today';
  if (date === addDays(today, 1)) return 'tomorrow';
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function taskUrl(task: Task, today: string): string {
  if (!task.scheduledDate) return '/backlog';
  return task.scheduledDate === today ? '/' : `/day/${task.scheduledDate}`;
}

function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return get('hour') * 60 + get('minute');
}
