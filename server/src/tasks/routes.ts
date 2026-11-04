import { Router, type Request } from 'express';
import { z } from 'zod';
import { addDays, isIsoDate, todayIn } from '../dates.js';
import type { RolloverScheduler } from '../rollover.js';
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
});

const updateSchema = createSchema.partial().strict();

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function notFound(): never {
  throw new HttpError(404, 'Task not found');
}

function idParam(req: Request): string {
  const parsed = taskId.safeParse(req.params.id);
  if (!parsed.success) notFound();
  return parsed.data;
}

export function tasksRouter(repo: TaskRepo, scheduler: RolloverScheduler, timeZone: string): Router {
  const router = Router();
  const today = () => todayIn(timeZone);

  // Make sure yesterday's leftovers have moved before anything reads or writes tasks.
  router.use(async (_req, _res, next) => {
    await scheduler.ensure();
    next();
  });

  router.get('/day/:date', async (req, res) => {
    const date = isoDate.parse(req.params.date);
    res.json({ date, today: today(), ...(await repo.listForDay(date)) });
  });

  router.get('/backlog', async (_req, res) => {
    res.json({ tasks: await repo.listBacklog() });
  });

  router.get('/history', async (req, res) => {
    const to = req.query.to ? isoDate.parse(req.query.to) : today();
    const from = req.query.from ? isoDate.parse(req.query.from) : addDays(to, -29);
    if (from > to) throw new HttpError(400, '"from" must not be after "to"');
    res.json({ from, to, tasks: await repo.listCompleted(from, to) });
  });

  router.get('/calendar', async (req, res) => {
    const from = isoDate.parse(req.query.from);
    const to = isoDate.parse(req.query.to);
    if (from > to) throw new HttpError(400, '"from" must not be after "to"');
    if (addDays(from, MAX_CALENDAR_DAYS - 1) < to) {
      throw new HttpError(400, `A calendar range can span at most ${MAX_CALENDAR_DAYS} days`);
    }
    res.json({ from, to, today: today(), ...(await repo.listCalendar(from, to)) });
  });

  router.get('/:id', async (req, res) => {
    res.json((await repo.get(idParam(req))) ?? notFound());
  });

  router.post('/', async (req, res) => {
    const input = createSchema.parse(req.body);
    const scheduledDate = input.scheduledDate === undefined ? today() : input.scheduledDate;
    if (scheduledDate !== null && scheduledDate < today()) {
      throw new HttpError(400, 'Open tasks cannot be scheduled on a past day');
    }
    res.status(201).json(await repo.create({ ...input, scheduledDate }));
  });

  router.patch('/:id', async (req, res) => {
    const id = idParam(req);
    const patch = updateSchema.parse(req.body);
    if (patch.scheduledDate) {
      const existing = (await repo.get(id)) ?? notFound();
      if (existing.status === 'open' && patch.scheduledDate < today()) {
        throw new HttpError(400, 'Open tasks cannot be scheduled on a past day');
      }
    }
    res.json((await repo.update(id, patch)) ?? notFound());
  });

  router.post('/:id/complete', async (req, res) => {
    const id = idParam(req);
    const task = await repo.complete(id, today());
    if (task) return res.json(task);
    const existing = (await repo.get(id)) ?? notFound();
    res.json(existing); // already done: completing is idempotent
  });

  router.post('/:id/reopen', async (req, res) => {
    const id = idParam(req);
    const task = await repo.reopen(id, today());
    if (task) return res.json(task);
    res.json((await repo.get(id)) ?? notFound());
  });

  router.delete('/:id', async (req, res) => {
    if (!(await repo.delete(idParam(req)))) notFound();
    res.status(204).end();
  });

  return router;
}
