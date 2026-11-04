import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import type { User, UserRepo } from './users.js';

export const SESSION_COOKIE = 'ql_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so inputs of different lengths can still be compared in constant time.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSessionToken(userId: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the user id in a valid, unexpired token, otherwise null. */
export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): string | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const { uid, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof uid === 'string' && typeof exp === 'number' && exp > now ? uid : null;
  } catch {
    return null;
  }
}

/** Small in-memory limiter: enough to blunt password guessing on a single-instance app. */
function loginLimiter(maxAttempts = 10, windowMs = 15 * 60 * 1000): RequestHandler {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    if (entry.count >= maxAttempts) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    entry.count += 1;
    next();
  };
}

async function sessionUser(token: string | undefined, config: AppConfig, users: UserRepo): Promise<User | null> {
  const uid = verifySessionToken(token, config.sessionSecret);
  if (!uid) return null;
  const user = await users.get(uid);
  return user && !user.disabled ? user : null;
}

/** Rejects requests without a session for an active user; sets req.user otherwise. */
export function requireAuth(config: AppConfig, users: UserRepo): RequestHandler {
  return async (req, res, next) => {
    const user = await sessionUser(req.cookies?.[SESSION_COOKIE], config, users);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  };
}

export function authRouter(config: AppConfig, users: UserRepo): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };
  const credentials = z.object({ username: z.string().max(100), password: z.string().max(1000) });

  router.post('/login', loginLimiter(), async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    const user = parsed.success ? await users.authenticate(parsed.data.username, parsed.data.password) : null;
    if (!user) return res.status(401).json({ error: 'Wrong username or password' });
    res.cookie(SESSION_COOKIE, createSessionToken(user.id, config.sessionSecret), {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const user = await sessionUser(req.cookies?.[SESSION_COOKIE], config, users);
    res.json(user ? { signedIn: true, user: publicUser(user) } : { signedIn: false });
  });

  return router;
}

export function publicUser(user: User) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}
