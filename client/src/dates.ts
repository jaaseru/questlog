export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function asUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** "Today", "Tomorrow", "Yesterday", or e.g. "Thursday". */
export function relativeDayName(date: string, today: string): string {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  if (date === addDays(today, -1)) return 'Yesterday';
  return asUtc(date).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

/** e.g. "Friday" */
export function weekdayName(date: string): string {
  return asUtc(date).toLocaleDateString(undefined, { weekday: 'long', timeZone: 'UTC' });
}

/** e.g. "4 November 2026" (the year is dropped when it's the current one). */
export function longDate(date: string, today: string): string {
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return asUtc(date).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: sameYear ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

/** e.g. "4 Nov" */
export function shortDate(date: string): string {
  return asUtc(date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** 'YYYY-MM' → 'YYYY-MM' shifted by `months`. */
export function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + months, 1));
  return d.toISOString().slice(0, 7);
}

export function isIsoMonth(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

/** Days shown in a Monday-first month grid: whole weeks covering the month (5 or 6 rows). */
export function monthGrid(month: string): string[] {
  const first = `${month}-01`;
  const weekday = (asUtc(first).getUTCDay() + 6) % 7; // Monday = 0
  const start = addDays(first, -weekday);
  const last = addDays(`${addMonths(month, 1)}-01`, -1);
  const days: string[] = [];
  for (let d = start; d <= last || days.length % 7 !== 0; d = addDays(d, 1)) days.push(d);
  return days;
}

/** Short weekday names, Monday first, in the user's locale. */
export function weekdayNames(): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({ length: 7 }, (_, i) =>
    asUtc(addDays('2024-01-01', i)).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
  );
}

/** e.g. "November 2026" */
export function monthLabel(month: string): string {
  return asUtc(`${month}-01`).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** e.g. "5 minutes ago", "yesterday", "3 days ago". */
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

/** ISO 8601 week number (weeks start on Monday; week 1 contains the year's first Thursday). */
export function isoWeek(date: string): number {
  const d = asUtc(date);
  // Move to the Thursday of this week: its year is the week's year.
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((d.getTime() - yearStart) / 86_400_000 / 7) + 1;
}
