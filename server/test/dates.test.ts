import { describe, expect, it } from 'vitest';
import { addDays, isIsoDate, todayIn } from '../src/dates.js';

describe('todayIn', () => {
  const instant = new Date('2026-11-04T23:30:00Z');

  it('uses the given time zone, not UTC', () => {
    expect(todayIn('UTC', instant)).toBe('2026-11-04');
    expect(todayIn('Europe/Oslo', instant)).toBe('2026-11-05');
    expect(todayIn('America/Los_Angeles', instant)).toBe('2026-11-04');
  });
});

describe('isIsoDate', () => {
  it.each(['2026-01-31', '2028-02-29'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
  it.each(['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1', ''])('rejects %s', (d) =>
    expect(isIsoDate(d)).toBe(false),
  );
});

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
