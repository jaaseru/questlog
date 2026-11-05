import type { Db } from './db.js';
import { todayIn } from './dates.js';
import { SeriesRepo } from './series.js';

/**
 * Moves every open task scheduled before `today` onto `today`.
 * Idempotent: running it twice on the same day moves nothing the second time.
 * Returns the number of tasks moved.
 */
export async function rolloverTasks(db: Db, today: string): Promise<number> {
  const { rowCount } = await db.query(
    `WITH stale AS (
       SELECT id, scheduled_date FROM tasks
       WHERE status = 'open' AND scheduled_date < $1
         -- Occurrences of active repeating series follow their own rules (see series.ts).
         AND NOT EXISTS (SELECT 1 FROM task_series s WHERE s.id = tasks.series_id AND s.active)
       FOR UPDATE
     ),
     moved AS (
       UPDATE tasks t
       SET scheduled_date = $1, rollover_count = t.rollover_count + 1, updated_at = now()
       FROM stale
       WHERE t.id = stale.id
       RETURNING t.id, stale.scheduled_date AS from_date
     )
     INSERT INTO task_events (task_id, type, from_date, to_date)
     SELECT id, 'rolled_over', from_date, $1 FROM moved`,
    [today],
  );
  return rowCount ?? 0;
}

export interface RolloverScheduler {
  /** Runs the rollover if it hasn't run yet for the current day. Cheap to call often. */
  ensure(): Promise<void>;
  start(intervalMs?: number): void;
  stop(): void;
}

export function createRolloverScheduler(
  db: Db,
  timeZone: string,
  log: (msg: string) => void = () => {},
  clock: () => Date = () => new Date(),
): RolloverScheduler {
  const series = new SeriesRepo(db);
  let lastRunFor: string | null = null;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  async function ensure(): Promise<void> {
    const today = todayIn(timeZone, clock());
    if (lastRunFor === today) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        const moved = await rolloverTasks(db, today);
        await series.processAll(today);
        lastRunFor = today;
        if (moved > 0) log(`Rolled over ${moved} open task(s) to ${today}`);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  return {
    ensure,
    start(intervalMs = 60_000) {
      timer = setInterval(() => ensure().catch((err) => log(`Rollover failed: ${err}`)), intervalMs);
      timer.unref();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}
