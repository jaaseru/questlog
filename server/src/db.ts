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

export type Queryable = Db | pg.PoolClient;

export async function withTransaction<T>(db: Db, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
