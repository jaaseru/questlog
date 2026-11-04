import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AuditLog } from './audit.js';
import type { AppConfig } from './config.js';
import { HttpError } from './errors.js';
import { UserError, type User, type UserRepo } from './users.js';

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

export interface SessionClaims {
  uid: string;
  /** Must match users.session_version; bumping that column revokes every token. */
  ver: number;
}

export function createSessionToken(claims: SessionClaims, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: now + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** Returns the claims of a valid, unexpired token, otherwise null. */
export function verifySessionToken(token: string | undefined, secret: string, now = Date.now()): SessionClaims | null {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || !safeEqual(signature, sign(payload, secret))) return null;
  try {
    const { uid, ver, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof uid !== 'string' || typeof ver !== 'number' || typeof exp !== 'number' || exp <= now) return null;
    return { uid, ver };
  } catch {
    return null;
  }
}

/** Counts events per key in a fixed window. In memory: fine for a single small instance. */
export class Throttle {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Seconds until the key may try again, or 0 if it isn't blocked. */
  blockedFor(key: string, now = Date.now()): number {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now || entry.count < this.max) return 0;
    return Math.ceil((entry.resetAt - now) / 1000);
  }

  hit(key: string, now = Date.now()): void {
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.hits.size > 10_000) this.prune(now);
    } else {
      entry.count += 1;
    }
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(now: number) {
    for (const [key, entry] of this.hits) if (entry.resetAt <= now) this.hits.delete(key);
  }
}

const WINDOW_MS = 15 * 60 * 1000;

export interface LoginLimits {
  /** Sign-in attempts allowed per network address per 15 minutes. */
  attemptsPerIp: number;
  /** Failed sign-ins allowed per username per 15 minutes. */
  failuresPerUsername: number;
}

export const DEFAULT_LOGIN_LIMITS: LoginLimits = { attemptsPerIp: 20, failuresPerUsername: 10 };

export interface AuthDeps {
  config: AppConfig;
  users: UserRepo;
  audit: AuditLog;
  limits?: LoginLimits;
}

export class Sessions {
  private readonly cookieOptions;

  constructor(private readonly deps: AuthDeps) {
    this.cookieOptions = {
      httpOnly: true,
      secure: deps.config.isProduction,
      sameSite: 'lax' as const,
      path: '/',
    };
  }

  issue(res: Response, user: Pick<User, 'id' | 'sessionVersion'>) {
    const token = createSessionToken({ uid: user.id, ver: user.sessionVersion }, this.deps.config.sessionSecret);
    res.cookie(SESSION_COOKIE, token, { ...this.cookieOptions, maxAge: SESSION_TTL_MS });
  }

  clear(res: Response) {
    res.clearCookie(SESSION_COOKIE, this.cookieOptions);
  }

  /** The active user behind the request's session cookie, if the session is still valid. */
  async current(req: Request): Promise<User | null> {
    const claims = verifySessionToken(req.cookies?.[SESSION_COOKIE], this.deps.config.sessionSecret);
    if (!claims) return null;
    const user = await this.deps.users.get(claims.uid);
    if (!user || user.disabled || user.sessionVersion !== claims.ver) return null;
    return user;
  }
}

/** Rejects requests without a valid session for an active user; sets req.user otherwise. */
export function requireAuth(sessions: Sessions): RequestHandler {
  return async (req, res, next) => {
    const user = await sessions.current(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });
    req.user = user;
    next();
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'Admins only' });
  next();
};

/**
 * Defence in depth against cross-site requests (on top of SameSite cookies): any
 * state-changing request that a browser marks with an Origin must come from this site.
 */
export const sameOriginOnly: RequestHandler = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin && origin !== `${req.protocol}://${req.get('host')}`) {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  next();
};

export function publicUser(user: User) {
  return { id: user.id, username: user.username, displayName: user.displayName, isAdmin: user.isAdmin };
}

const passwordField = z.string().max(1000);

export function authRouter({ users, audit, limits = DEFAULT_LOGIN_LIMITS }: AuthDeps, sessions: Sessions): Router {
  const router = Router();
  const credentials = z.object({ username: z.string().max(100), password: passwordField });
  // Per network: all attempts. Per username: failures only, so one account can't be guessed at
  // from many addresses. Both reset after the window.
  const byIp = new Throttle(limits.attemptsPerIp, WINDOW_MS);
  const byUsername = new Throttle(limits.failuresPerUsername, WINDOW_MS);

  router.post('/login', async (req, res) => {
    const parsed = credentials.safeParse(req.body);
    const username = parsed.success ? parsed.data.username.trim().toLowerCase() : '';
    const ip = req.ip ?? 'unknown';

    const wait = Math.max(byIp.blockedFor(ip), byUsername.blockedFor(username));
    if (wait > 0) {
      await audit.record({ action: 'login_blocked', ip, detail: { username } });
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    }
    byIp.hit(ip);

    const user = parsed.success ? await users.checkCredentials(username, parsed.data.password) : null;
    if (!user || user.disabled) {
      byUsername.hit(username);
      await audit.record({
        action: 'login_failed',
        targetUserId: user?.id ?? null,
        ip,
        detail: { username, reason: user ? 'disabled' : 'bad_credentials' },
      });
      // Same answer for unknown users, wrong passwords and disabled accounts.
      return res.status(401).json({ error: 'Wrong username or password' });
    }

    byUsername.reset(username);
    await users.recordLogin(user.id);
    await audit.record({ action: 'login_succeeded', actorId: user.id, ip });
    sessions.issue(res, user);
    res.json({ user: publicUser(user) });
  });

  router.post('/logout', (_req, res) => {
    sessions.clear(res);
    res.json({ ok: true });
  });

  router.get('/me', async (req, res) => {
    const user = await sessions.current(req);
    res.json(user ? { signedIn: true, user: publicUser(user) } : { signedIn: false });
  });

  return router;
}

/** The signed-in user's own account: change password, sign out other devices. */
export function accountRouter({ users, audit, limits = DEFAULT_LOGIN_LIMITS }: AuthDeps, sessions: Sessions): Router {
  const router = Router();
  const changePassword = z.object({ currentPassword: passwordField, newPassword: passwordField });
  // Guessing the current password through this endpoint gets the same treatment as login.
  const failures = new Throttle(limits.failuresPerUsername, WINDOW_MS);

  router.post('/password', async (req, res) => {
    const me = req.user!;
    const { currentPassword, newPassword } = changePassword.parse(req.body);
    if (failures.blockedFor(me.id)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    if (!(await users.checkCredentials(me.username, currentPassword))) {
      failures.hit(me.id);
      throw new HttpError(400, 'Your current password is not correct');
    }
    if (newPassword === currentPassword) throw new HttpError(400, 'Choose a password you are not using now');
    try {
      const ver = await users.setPassword(me.id, newPassword);
      failures.reset(me.id);
      await audit.record({ action: 'password_changed', actorId: me.id, targetUserId: me.id, ip: req.ip });
      // Other devices are signed out; keep this one signed in.
      sessions.issue(res, { id: me.id, sessionVersion: ver });
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof UserError) throw new HttpError(400, err.message);
      throw err;
    }
  });

  router.post('/signout-others', async (req, res) => {
    const me = req.user!;
    const ver = await users.signOutEverywhere(me.id);
    await audit.record({ action: 'signed_out_everywhere', actorId: me.id, targetUserId: me.id, ip: req.ip });
    sessions.issue(res, { id: me.id, sessionVersion: ver });
    res.json({ ok: true });
  });

  return router;
}
