import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AppConfig } from './config.js';

export const SESSION_COOKIE = 'ql_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  // Hash first so inputs of different lengths can still be compared in constant time.
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

export function createSessionToken(secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): boolean {
  if (!token) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && exp > now;
  } catch {
    return false;
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

export function requireAuth(config: AppConfig): RequestHandler {
  return (req, res, next) => {
    if (verifySessionToken(req.cookies?.[SESSION_COOKIE], config.sessionSecret)) return next();
    res.status(401).json({ error: 'Not signed in' });
  };
}

export function authRouter(config: AppConfig): Router {
  const router = Router();
  const cookieOptions = {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax' as const,
    path: '/',
  };

  router.post('/login', loginLimiter(), (req, res) => {
    const parsed = z.object({ password: z.string().max(1000) }).safeParse(req.body);
    if (!parsed.success || !safeEqual(parsed.data.password, config.appPassword)) {
      return res.status(401).json({ error: 'Wrong password' });
    }
    res.cookie(SESSION_COOKIE, createSessionToken(config.sessionSecret), {
      ...cookieOptions,
      maxAge: SESSION_TTL_MS,
    });
    res.json({ ok: true });
  });

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOptions);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ signedIn: verifySessionToken(req.cookies?.[SESSION_COOKIE], config.sessionSecret) });
  });

  return router;
}
