import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { createRolloverScheduler } from './rollover.js';

const config = loadConfig();
const db = createPool(config.databaseUrl, config.databaseSsl);
const log = (msg: string) => console.log(`[questlog] ${msg}`);

await migrate(db, log);

const scheduler = createRolloverScheduler(db, config.timezone, log);
await scheduler.ensure();
scheduler.start();

const app = createApp({
  db,
  config,
  scheduler,
  clientDir: path.resolve(import.meta.dirname, '..', '..', 'client', 'dist'),
});

const server = app.listen(config.port, () => {
  log(`Listening on port ${config.port} (time zone ${config.timezone})`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    scheduler.stop();
    server.close(() => db.end().then(() => process.exit(0)));
  });
}
