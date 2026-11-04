import pg from 'pg';

// Return DATE columns as 'YYYY-MM-DD' strings instead of JS Dates shifted into local time.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Db = pg.Pool;

export function createPool(connectionString: string, ssl = false): Db {
  return new pg.Pool({
    connectionString,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
}
