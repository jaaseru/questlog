import path from 'node:path';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { migrate } from './migrate.js';
import { loadVapidKeys, PushService, webPushSender } from './push.js';
import { createRolloverScheduler } from './rollover.js';
import { ShoppingRepo } from './shopping.js';
import { TaskRepo } from './tasks/repo.js';
import { bootstrapFirstUser, UserRepo } from './users.js';

const config = loadConfig();
const db = createPool(config.databaseUrl, config.databaseSsl);
const log = (msg: string) => console.log(`[questlog] ${msg}`);

await migrate(db, log);
await bootstrapFirstUser(new UserRepo(db), { username: config.adminUsername, password: config.appPassword }, log);

const scheduler = createRolloverScheduler(db, config.timezone, log);
await scheduler.ensure();
scheduler.start();

// Web Push: keys come from VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY, or are generated once and kept in the database.
const vapid = await loadVapidKeys(db);
const push = new PushService(
  db,
  vapid.publicKey,
  webPushSender(vapid, process.env.VAPID_SUBJECT?.trim() || 'https://github.com/jaaseru/questlog'),
  log,
);
const tasks = new TaskRepo(db);
const shopping = new ShoppingRepo(db);
const morningTimer = setInterval(() => {
  scheduler
    .ensure() // make sure today's roll-overs and repeats exist first
    .then(() => push.sendMorningSummaries(config.timezone, new Date(), (userId, day) => tasks.listForDay(userId, day)))
    .then((n) => n && log(`Sent ${n} morning summary notification(s)`))
    .then(() => shopping.purgeExpired())
    .catch((err) => log(`Morning summaries failed: ${err}`));
}, 60_000);
morningTimer.unref();

const app = createApp({
  db,
  config,
  scheduler,
  push,
  clientDir: path.resolve(import.meta.dirname, '..', '..', 'client', 'dist'),
});

const server = app.listen(config.port, () => {
  log(`Listening on port ${config.port} (time zone ${config.timezone})`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    log(`${signal} received, shutting down`);
    scheduler.stop();
    clearInterval(morningTimer);
    server.close(() => db.end().then(() => process.exit(0)));
  });
}
