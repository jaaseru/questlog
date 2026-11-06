import { Router, type Request } from 'express';
import { z } from 'zod';
import { addDays, isIsoDate, todayIn } from '../dates.js';
import { HttpError } from '../errors.js';
import { FREQUENCIES, KINDS } from '../recurrence.js';
import type { PushService } from '../push.js';
import type { RolloverScheduler } from '../rollover.js';
import { SeriesRepo } from '../series.js';
import { PRIORITIES, TaskRepo } from './repo.js';

const isoDate = z.string().refine(isIsoDate, 'Expected a date as YYYY-MM-DD');
const taskId = z.uuid();
// A month grid is at most 6 weeks; leave some room for other views.
const MAX_CALENDAR_DAYS = 62;

const createSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(10_000).optional(),
  priority: z.enum(PRIORITIES).optional(),
  // Omitted → today's list. null → backlog.
  scheduledDate: isoDate.nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  // Other users to share with; the creator is always a member.
  memberIds: z.array(z.uuid()).max(50).optional(),
});

const repeatSchema = z
  .object({
    frequency: z.enum(FREQUENCIES),
    every: z.number().int().min(1).max(365).default(1),
    weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
    kind: z.enum(KINDS),
    // Last day an occurrence may fall on; null or omitted = forever.
    until: isoDate.nullable().default(null),
  })
  .strict();

// On update, memberIds is the complete list of members (it may drop the caller: "leave task").
const updateSchema = createSchema.partial().strict();

function notFound(): never {
  throw new HttpError(404, 'Task not found');
}

function idParam(req: Request): string {
  const parsed = taskId.safeParse(req.params.id);
  if (!parsed.success) notFound();
  return parsed.data;
}

function currentUserId(req: Request): string {
  return req.user!.id;
}

export function tasksRouter(
  repo: TaskRepo,
  series: SeriesRepo,
  scheduler: RolloverScheduler,
  timeZone: string,
  push?: PushService,
): Router {
  const router = Router();
  const today = () => todayIn(timeZone);
  const actor = (req: Request) => ({ id: req.user!.id, displayName: req.user!.displayName });
  const isShared = (t: { memberIds: string[] } | null) => (t?.memberIds.length ?? 0) > 1;

  // Make sure yesterday's leftovers have moved before anything reads or writes tasks.
  router.use(async (_req, _res, next) => {
    await scheduler.ensure();
    next();
  });

  router.get('/day/:date', async (req, res) => {
    const date = isoDate.parse(req.params.date);
    const userId = currentUserId(req);
    const now = today();
    res.json({
      date,
      today: now,
      ...(await repo.listForDay(userId, date)),
      upcoming: await series.upcoming(userId, date, date, now),
    });
  });

  router.get('/backlog', async (req, res) => {
    res.json({ tasks: await repo.listBacklog(currentUserId(req)) });
  });

  router.get('/history', async (req, res) => {
    const to = req.query.to ? isoDate.parse(req.query.to) : today();
    const from = req.query.from ? isoDate.parse(req.query.from) : addDays(to, -29);
    if (from > to) throw new HttpError(400, '"from" must not be after "to"');
    res.json({ from, to, tasks: await repo.listCompleted(currentUserId(req), from, to) });
  });

  router.get('/calendar', async (req, res) => {
    const from = isoDate.parse(req.query.from);
    const to = isoDate.parse(req.query.to);
    if (from > to) throw new HttpError(400, '"from" must not be after "to"');
    if (addDays(from, MAX_CALENDAR_DAYS - 1) < to) {
      throw new HttpError(400, `A calendar range can span at most ${MAX_CALENDAR_DAYS} days`);
    }
    const userId = currentUserId(req);
    const now = today();
    res.json({
      from,
      to,
      today: now,
      ...(await repo.listCalendar(userId, from, to)),
      upcoming: await series.upcoming(userId, from, to, now),
    });
  });

  router.get('/:id', async (req, res) => {
    res.json((await repo.get(currentUserId(req), idParam(req))) ?? notFound());
  });

  router.post('/', async (req, res) => {
    const input = createSchema.parse(req.body);
    const scheduledDate = input.scheduledDate === undefined ? today() : input.scheduledDate;
    if (scheduledDate !== null && scheduledDate < today()) {
      throw new HttpError(400, 'Open tasks cannot be scheduled on a past day');
    }
    const task = await repo.create(currentUserId(req), { ...input, scheduledDate });
    if (push && isShared(task)) push.background(() => push.taskCreated(actor(req), task, today()));
    res.status(201).json(task);
  });

  router.patch('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const id = idParam(req);
    const patch = updateSchema.parse(req.body);
    const before = (await repo.get(userId, id)) ?? notFound();
    if (patch.scheduledDate && before.status === 'open' && patch.scheduledDate < today()) {
      throw new HttpError(400, 'Open tasks cannot be scheduled on a past day');
    }
    const after = (await repo.update(userId, id, patch)) ?? notFound();
    if (push && (isShared(before) || isShared(after))) {
      push.background(() => push.taskUpdated(actor(req), before, after, patch, today()));
    }
    res.json(after);
  });

  router.post('/:id/complete', async (req, res) => {
    const userId = currentUserId(req);
    const id = idParam(req);
    // Completing an already-done task is a no-op that returns its current state.
    const done = await repo.complete(userId, id, today());
    if (push && done && isShared(done)) push.background(() => push.taskCompleted(actor(req), done, today()));
    res.json(done ?? (await repo.get(userId, id)) ?? notFound());
  });

  router.post('/:id/reopen', async (req, res) => {
    const userId = currentUserId(req);
    const id = idParam(req);
    const reopened = await repo.reopen(userId, id, today());
    if (push && reopened && isShared(reopened)) {
      push.background(() => push.taskCompleted(actor(req), reopened, today(), true));
    }
    res.json(reopened ?? (await repo.get(userId, id)) ?? notFound());
  });

  // Make a task repeat, or change its rule. The task becomes the first occurrence.
  router.put('/:id/repeat', async (req, res) => {
    const userId = currentUserId(req);
    const id = idParam(req);
    await series.setRepeat(userId, id, repeatSchema.parse(req.body));
    res.json((await repo.get(userId, id)) ?? notFound());
  });

  // Stop repeating. Past occurrences stay; the current one becomes an ordinary task.
  router.delete('/:id/repeat', async (req, res) => {
    const userId = currentUserId(req);
    const id = idParam(req);
    await series.stopRepeat(userId, id);
    res.json((await repo.get(userId, id)) ?? notFound());
  });

  router.delete('/:id', async (req, res) => {
    const userId = currentUserId(req);
    const before = await repo.get(userId, idParam(req));
    const result = await repo.delete(userId, idParam(req), today());
    if (push && result === 'deleted' && before && isShared(before)) {
      push.background(() => push.taskDeleted(actor(req), before));
    }
    if (result === 'not_found') notFound();
    if (result === 'forbidden') {
      throw new HttpError(403, 'Only the person who created a shared task can delete it. You can leave it instead.');
    }
    res.status(204).end();
  });

  return router;
}
