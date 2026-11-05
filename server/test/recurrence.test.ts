import { describe, expect, it } from 'vitest';
import { addMonths, addPeriod, describeRule, isoWeekday, occurrencesBetween, type Schedule } from '../src/recurrence.js';

const s = (over: Partial<Schedule>): Schedule => ({
  frequency: 'daily',
  every: 1,
  weekdays: [],
  startDate: '2026-11-02', // a Monday
  ...over,
});

describe('isoWeekday', () => {
  it('numbers Monday 1 to Sunday 7', () => {
    expect(isoWeekday('2026-11-02')).toBe(1);
    expect(isoWeekday('2026-11-08')).toBe(7);
  });
});

describe('occurrencesBetween', () => {
  it('daily, every N days, never before the start', () => {
    expect(occurrencesBetween(s({}), '2026-10-30', '2026-11-04')).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    expect(occurrencesBetween(s({ every: 3 }), '2026-11-02', '2026-11-12')).toEqual([
      '2026-11-02',
      '2026-11-05',
      '2026-11-08',
      '2026-11-11',
    ]);
  });

  it("weekly defaults to the start date's weekday", () => {
    expect(occurrencesBetween(s({ frequency: 'weekly' }), '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
    ]);
  });

  it('every other week', () => {
    expect(occurrencesBetween(s({ frequency: 'weekly', every: 2 }), '2026-11-01', '2026-11-30')).toEqual([
      '2026-11-02',
      '2026-11-16',
      '2026-11-30',
    ]);
  });

  it('on several weekdays (twice a week), including every other week', () => {
    expect(occurrencesBetween(s({ frequency: 'weekly', weekdays: [1, 4] }), '2026-11-02', '2026-11-15')).toEqual([
      '2026-11-02',
      '2026-11-05',
      '2026-11-09',
      '2026-11-12',
    ]);
    // Starts on a Thursday: that week's Monday is before the start, so it's skipped.
    expect(
      occurrencesBetween(s({ frequency: 'weekly', every: 2, weekdays: [1, 4], startDate: '2026-11-05' }), '2026-11-01', '2026-11-30'),
    ).toEqual(['2026-11-05', '2026-11-16', '2026-11-19', '2026-11-30']);
  });

  it('monthly clamps to short months and keeps the original day afterwards', () => {
    expect(occurrencesBetween(s({ frequency: 'monthly', startDate: '2026-01-31' }), '2026-01-01', '2026-05-31')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ]);
    expect(occurrencesBetween(s({ frequency: 'monthly', every: 3, startDate: '2026-11-15' }), '2026-11-01', '2027-06-30')).toEqual([
      '2026-11-15',
      '2027-02-15',
      '2027-05-15',
    ]);
  });

  it('yearly, including 29 February', () => {
    expect(occurrencesBetween(s({ frequency: 'yearly', startDate: '2028-02-29' }), '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });
});

describe('addPeriod (flexible series)', () => {
  it('adds one period from the given day', () => {
    expect(addPeriod({ frequency: 'daily', every: 2, weekdays: [] }, '2026-11-05')).toBe('2026-11-07');
    expect(addPeriod({ frequency: 'weekly', every: 2, weekdays: [] }, '2026-11-05')).toBe('2026-11-19');
    expect(addPeriod({ frequency: 'monthly', every: 1, weekdays: [] }, '2026-01-31')).toBe('2026-02-28');
    expect(addPeriod({ frequency: 'yearly', every: 1, weekdays: [] }, '2028-02-29')).toBe('2029-02-28');
  });

  it('addMonths crosses year boundaries', () => {
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  });
});

describe('describeRule', () => {
  it('reads naturally', () => {
    expect(describeRule({ frequency: 'daily', every: 1, weekdays: [] })).toBe('Every day');
    expect(describeRule({ frequency: 'weekly', every: 2, weekdays: [4, 1] })).toBe('Every 2 weeks on Mon, Thu');
    expect(describeRule({ frequency: 'yearly', every: 1, weekdays: [] })).toBe('Every year');
  });
});
