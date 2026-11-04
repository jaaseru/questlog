import { describe, expect, it } from 'vitest';
import { describeDatabaseUrlProblem, loadConfig } from '../src/config.js';

describe('describeDatabaseUrlProblem', () => {
  it('accepts real Postgres URLs', () => {
    expect(describeDatabaseUrlProblem('postgresql://u:p@postgres.railway.internal:5432/railway')).toBeNull();
    expect(describeDatabaseUrlProblem('postgres://localhost/questlog')).toBeNull();
  });

  it('flags unresolved Railway references', () => {
    expect(describeDatabaseUrlProblem('${{Postgres.DATABASE_URL}}')).toMatch(/unresolved Railway reference/);
  });

  it('flags quotes and whitespace', () => {
    expect(describeDatabaseUrlProblem('"postgresql://u:p@h/db"')).toMatch(/quotes/);
    expect(describeDatabaseUrlProblem(' postgresql://u:p@h/db')).toMatch(/whitespace/);
  });

  it('flags non-URLs and wrong schemes without echoing secrets', () => {
    expect(describeDatabaseUrlProblem('my-db-host')).toMatch(/not a valid URL/);
    const msg = describeDatabaseUrlProblem('mysql://u:secret@h/db')!;
    expect(msg).toMatch(/postgresql:\/\//);
    expect(msg).not.toContain('secret');
  });
});

describe('loadConfig', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@h:5432/db',
    APP_PASSWORD: 'pw',
    SESSION_SECRET: 'x'.repeat(32),
  };

  it('loads a valid environment', () => {
    expect(loadConfig({ ...valid, APP_TIMEZONE: 'Europe/Oslo' })).toMatchObject({ timezone: 'Europe/Oslo' });
  });

  it('rejects a malformed DATABASE_URL at startup', () => {
    expect(() => loadConfig({ ...valid, DATABASE_URL: '${{Postgres.DATABASE_URL}}' })).toThrow(/unresolved/);
  });
});
