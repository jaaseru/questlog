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
