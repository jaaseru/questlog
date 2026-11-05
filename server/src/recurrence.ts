/**
 * Pure date logic for repeating tasks. Dates are 'YYYY-MM-DD' strings; all math is in UTC
 * so there are no daylight-saving surprises.
 */
import { addDays } from './dates.js';

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * - optional: not done on its day → missed
 * - fixed: rolls over until the next occurrence arrives, then the old one is missed
 * - variable: rolls over; the next occurrence is one period after it is completed
 */
export const KINDS = ['optional', 'fixed', 'variable'] as const;
export type RepeatKind = (typeof KINDS)[number];

export interface RepeatRule {
  frequency: Frequency;
  /** Every N days/weeks/months/years. */
  every: number;
  /** ISO weekdays (1 = Monday … 7 = Sunday). Weekly only; empty means the start date's weekday. */
  weekdays: number[];
}

export interface Schedule extends RepeatRule {
  startDate: string;
}

const DAY_MS = 86_400_000;

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return ((utc(date).getUTCDay() + 6) % 7) + 1;
}

function daysBetween(a: string, b: string): number {
  return Math.round((utc(b).getTime() - utc(a).getTime()) / DAY_MS);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Adds months, clamping to the month's last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(date: string, months: number, preferredDay?: number): string {
  const d = utc(date);
  const day = preferredDay ?? d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const dim = daysInMonth(target.getUTCFullYear(), target.getUTCMonth());
  target.setUTCDate(Math.min(day, dim));
  return iso(target);
}

export function weekdaysOf(schedule: Schedule): number[] {
  return schedule.weekdays.length ? schedule.weekdays : [isoWeekday(schedule.startDate)];
}

/** Whether `date` is one of the schedule's occurrence dates. */
export function isOccurrence(schedule: Schedule, date: string): boolean {
  const { startDate, every } = schedule;
  if (date < startDate) return false;
  const s = utc(startDate);
  const d = utc(date);
  switch (schedule.frequency) {
    case 'daily':
      return daysBetween(startDate, date) % every === 0;
    case 'weekly': {
      if (!weekdaysOf(schedule).includes(isoWeekday(date))) return false;
      const startMonday = addDays(startDate, -(isoWeekday(startDate) - 1));
      const weeks = Math.floor(daysBetween(startMonday, date) / 7);
      return weeks % every === 0;
    }
    case 'monthly': {
      const months = (d.getUTCFullYear() - s.getUTCFullYear()) * 12 + (d.getUTCMonth() - s.getUTCMonth());
      if (months % every !== 0) return false;
      const dim = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
      return d.getUTCDate() === Math.min(s.getUTCDate(), dim);
    }
    case 'yearly': {
      const years = d.getUTCFullYear() - s.getUTCFullYear();
      if (years % every !== 0 || d.getUTCMonth() !== s.getUTCMonth()) return false;
      const dim = daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
      return d.getUTCDate() === Math.min(s.getUTCDate(), dim);
    }
  }
}

/** Occurrence dates within [from, to], oldest first. Ranges are short (≤ a few months). */
export function occurrencesBetween(schedule: Schedule, from: string, to: string, limit = 400): string[] {
  const out: string[] = [];
  let d = from < schedule.startDate ? schedule.startDate : from;
  while (d <= to && out.length < limit) {
    if (isOccurrence(schedule, d)) out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

/** One period after `date`: what a flexible (variable) series uses after each completion. */
export function addPeriod(rule: RepeatRule, date: string): string {
  switch (rule.frequency) {
    case 'daily':
      return addDays(date, rule.every);
    case 'weekly':
      return addDays(date, 7 * rule.every);
    case 'monthly':
      return addMonths(date, rule.every);
    case 'yearly':
      return addMonths(date, 12 * rule.every);
  }
}

/** Human summary, e.g. "Every 2 weeks on Mon, Thu". */
export function describeRule(rule: RepeatRule): string {
  const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.frequency];
  const base = rule.every === 1 ? `Every ${unit}` : `Every ${rule.every} ${unit}s`;
  if (rule.frequency !== 'weekly' || rule.weekdays.length === 0) return base;
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return `${base} on ${[...rule.weekdays].sort().map((d) => names[d - 1]).join(', ')}`;
}
