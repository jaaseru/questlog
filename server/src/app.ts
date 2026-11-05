import { existsSync } from 'node:fs';
import path from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { adminRouter } from './admin.js';
import { AuditLog } from './audit.js';
import {
  accountRouter,
  authRouter,
  requireAdmin,
  requireAuth,
  sameOriginOnly,
  Sessions,
  type LoginLimits,
} from './auth.js';
import type { AppConfig } from './config.js';
import { todayIn } from './dates.js';
import type { Db } from './db.js';
import { HttpError } from './errors.js';
import type { RolloverScheduler } from './rollover.js';
import { SeriesRepo } from './series.js';
import { TaskRepo } from './tasks/repo.js';
import { tasksRouter } from './tasks/routes.js';
import { UserRepo } from './users.js';

export interface AppDeps {
  db: Db;
  config: AppConfig;
  scheduler: RolloverScheduler;
  /** Directory with the built client. Served with an SPA fallback when present. */
  clientDir?: string;
  /** Override sign-in throttling (tests sign in far more often than people do). */
  loginLimits?: LoginLimits;
}

export function createApp({ db, config, scheduler, clientDir, loginLimits }: AppDeps) {
  const app = express();
  app.set('trust proxy', 1); // Railway terminates TLS at its proxy
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/api/health', async (_req, res) => {
    await db.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api', sameOriginOnly);
  app.use('/api', (_req, res, next) => {
    // API responses are per-user; never let a shared cache keep them.
    res.set('Cache-Control', 'no-store');
    next();
  });

  const users = new UserRepo(db);
  const audit = new AuditLog(db);
  const deps = { config, users, audit, limits: loginLimits };
  const sessions = new Sessions(deps);
  app.use('/api/auth', authRouter(deps, sessions));
  app.use('/api', requireAuth(sessions));
  app.use('/api/account', accountRouter(deps, sessions));
  app.use('/api/admin', requireAdmin, adminRouter(users, audit, sessions));
  // Active users, for picking who to share a task with.
  app.get('/api/users', async (_req, res) => {
    // Just what's needed to pick people; who the admin is stays private.
    res.json({ users: (await users.list()).map(({ id, username, displayName }) => ({ id, username, displayName })) });
  });
  app.get('/api/meta', (_req, res) => {
    res.json({ today: todayIn(config.timezone), timezone: config.timezone });
  });
  app.use('/api/tasks', tasksRouter(new TaskRepo(db), new SeriesRepo(db), scheduler, config.timezone));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (clientDir && existsSync(clientDir)) {
    // Vite fingerprints everything under /assets, so it can be cached forever.
    app.use('/assets', express.static(path.join(clientDir, 'assets'), { maxAge: '1y', immutable: true }));
    app.use(express.static(clientDir, { index: false }));
    app.get('/{*splat}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(clientDir, 'index.html'));
    });
  }

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof ZodError) {
      return res.status(400).json({ error: 'Invalid request', issues: err.issues });
    }
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Malformed JSON' });
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong' });
  };
  app.use(errorHandler);

  return app;
}
