import type { RepeatKind, TaskRepeat } from './types';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Routine = optional; chore = mandatory (fixed or flexible day).
export const KIND_LABEL: Record<RepeatKind, string> = {
  optional: 'Routine',
  fixed: 'Chore · fixed day',
  variable: 'Chore · flexible',
};

export const KIND_SHORT: Record<RepeatKind, string> = {
  optional: 'routine',
  fixed: 'chore',
  variable: 'flexible chore',
};

export const KIND_HELP: Record<RepeatKind, string> = {
  optional: "If it isn't done on its day, it's marked missed. It doesn't move to the next day.",
  fixed:
    "If it isn't done, it moves to the next day, until the next one is due. Then the old one is marked missed. The dates never change.",
  variable:
    "If it isn't done, it moves to the next day. The next one is always one full period after you complete it, so the whole series shifts.",
};

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

export function weekdayShort(day: number): string {
  return WEEKDAY_SHORT[day - 1]!;
}

/** e.g. "Daily", "Every 2 weeks on Mon, Thu", "Monthly on the 15th", "Yearly on 4 November". */
export function describeRepeat(
  r: Pick<TaskRepeat, 'frequency' | 'every' | 'weekdays'> & { until?: string | null },
  anchor?: string | null,
): string {
  const rule = describeRule(r, anchor);
  if (!r.until) return rule;
  const end = new Date(`${r.until}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return `${rule}, until ${end}`;
}

function describeRule(r: Pick<TaskRepeat, 'frequency' | 'every' | 'weekdays'>, anchor?: string | null): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[r.frequency];
  const plain = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' }[r.frequency];
  const base = r.every === 1 ? plain : `Every ${r.every} ${unit}s`;
  const anchorDate = anchor ? new Date(`${anchor}T00:00:00Z`) : null;

  if (r.frequency === 'weekly') {
    const days = r.weekdays.length ? r.weekdays : anchor ? [isoWeekday(anchor)] : [];
    return days.length ? `${base} on ${[...days].sort().map(weekdayShort).join(', ')}` : base;
  }
  if (r.frequency === 'monthly' && anchorDate) return `${base} on day ${anchorDate.getUTCDate()}`;
  if (r.frequency === 'yearly' && anchorDate) {
    return `${base} on ${anchorDate.toLocaleDateString(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' })}`;
  }
  return base;
}

/** Short label for chips: "Weekly", "Every 2 days". */
export function repeatChip(r: Pick<TaskRepeat, 'frequency' | 'every'>): string {
  return describeRule({ ...r, weekdays: [] });
}

export function sameRepeat(a: TaskRepeat | null, b: TaskRepeat | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.frequency === b.frequency &&
    a.every === b.every &&
    a.kind === b.kind &&
    a.until === b.until &&
    a.weekdays.length === b.weekdays.length &&
    [...a.weekdays].sort().every((d, i) => d === [...b.weekdays].sort()[i])
  );
}
