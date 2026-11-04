import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AuditLog } from './audit.js';
import type { Sessions } from './auth.js';
import { HttpError } from './errors.js';
import { UserError, type User, type UserRepo } from './users.js';

const userId = z.uuid();

const createUser = z.object({
  username: z.string().max(100),
  displayName: z.string().max(100).optional(),
  password: z.string().max(1000),
});

const updateUser = z
  .object({
    displayName: z.string().max(100).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

const resetPassword = z.object({ password: z.string().max(1000) });

function adminView(u: User) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    disabled: u.disabled,
    isAdmin: u.isAdmin,
    lastLoginAt: u.lastLoginAt,
    createdAt: u.createdAt,
  };
}

/** Turns validation problems from the user store into 400s with their message. */
async function userAction<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UserError) throw new HttpError(400, err.message);
    throw err;
  }
}

/** Account management for admins. Mount behind requireAuth + requireAdmin. */
export function adminRouter(users: UserRepo, audit: AuditLog, sessions: Sessions): Router {
  const router = Router();

  async function target(req: Request): Promise<User> {
    const parsed = userId.safeParse(req.params.id);
    const user = parsed.success ? await users.get(parsed.data) : null;
    if (!user) throw new HttpError(404, 'User not found');
    return user;
  }

  router.get('/users', async (_req, res) => {
    res.json({ users: (await users.list(true)).map(adminView) });
  });

  router.post('/users', async (req, res) => {
    const input = createUser.parse(req.body);
    const user = await userAction(() => users.create(input));
    await audit.record({
      action: 'user_created',
      actorId: req.user!.id,
      targetUserId: user.id,
      ip: req.ip,
      detail: { username: user.username },
    });
    res.status(201).json(adminView(user));
  });

  router.patch('/users/:id', async (req, res) => {
    const user = await target(req);
    const patch = updateUser.parse(req.body);
    const actor = { actorId: req.user!.id, targetUserId: user.id, ip: req.ip };

    if (patch.displayName !== undefined && patch.displayName.trim() !== user.displayName) {
      await userAction(() => users.rename(user.id, patch.displayName!));
      await audit.record({ action: 'user_renamed', ...actor, detail: { from: user.displayName, to: patch.displayName.trim() } });
    }
    if (patch.disabled !== undefined && patch.disabled !== user.disabled) {
      if (patch.disabled && user.isAdmin) {
        throw new HttpError(400, 'Admin accounts cannot be disabled here, so nobody gets locked out.');
      }
      await users.setDisabled(user.id, patch.disabled);
      await audit.record({ action: patch.disabled ? 'user_disabled' : 'user_enabled', ...actor });
    }
    res.json(adminView((await users.get(user.id))!));
  });

  router.post('/users/:id/password', async (req, res) => {
    const user = await target(req);
    const { password } = resetPassword.parse(req.body);
    const ver = await userAction(() => users.setPassword(user.id, password));
    await audit.record({ action: 'password_reset', actorId: req.user!.id, targetUserId: user.id, ip: req.ip });
    // Resetting your own password shouldn't sign you out of the page you're on.
    if (user.id === req.user!.id) sessions.issue(res, { id: user.id, sessionVersion: ver });
    res.json({ ok: true });
  });

  router.post('/users/:id/signout', async (req, res) => {
    const user = await target(req);
    const ver = await users.signOutEverywhere(user.id);
    await audit.record({ action: 'signed_out_everywhere', actorId: req.user!.id, targetUserId: user.id, ip: req.ip });
    if (user.id === req.user!.id) sessions.issue(res, { id: user.id, sessionVersion: ver });
    res.json({ ok: true });
  });

  router.get('/audit', async (req, res) => {
    const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit);
    res.json({ entries: await audit.recent(limit) });
  });

  return router;
}
