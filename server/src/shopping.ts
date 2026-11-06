/**
 * The shared shopping list. Every signed-in user sees and edits the same list.
 *
 * Rules:
 * - Items can have sub-items, one level deep.
 * - Checking an item checks all its sub-items; checking its last open sub-item checks the item.
 * - Unchecking an item unchecks its sub-items; unchecking a sub-item reopens its item.
 * - Adding a sub-item to a checked item reopens the item.
 * - Checked-off entries are deleted CHECKED_RETENTION_HOURS after being checked off.
 */
import { Router, type Request } from 'express';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction, type Db } from './db.js';
import { HttpError } from './errors.js';

export const CHECKED_RETENTION_HOURS = 12;

export interface ShoppingItem {
  id: string;
  parentId: string | null;
  title: string;
  checkedAt: string | null;
  checkedBy: string | null;
  createdBy: string | null;
  createdAt: string;
}

const COLUMNS = `
  id, parent_id AS "parentId", title, checked_at AS "checkedAt", checked_by AS "checkedBy",
  created_by AS "createdBy", created_at AS "createdAt"`;

export class ShoppingRepo {
  constructor(private readonly db: Db) {}

  /** Deletes entries checked off more than 12 hours before `now`. Returns how many went. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM shopping_items WHERE checked_at < $1::timestamptz - make_interval(hours => $2)`,
      [now.toISOString(), CHECKED_RETENTION_HOURS],
    );
    return rowCount ?? 0;
  }

  async list(): Promise<ShoppingItem[]> {
    const { rows } = await this.db.query<ShoppingItem>(
      `SELECT ${COLUMNS} FROM shopping_items ORDER BY created_at, id`,
    );
    return rows;
  }

  async add(userId: string, title: string, parentId: string | null): Promise<ShoppingItem> {
    return withTransaction(this.db, async (c) => {
      if (parentId) {
        const parent = await this.lock(c, parentId);
        if (parent.parent_id) throw new HttpError(400, 'Sub-items can’t have their own sub-items');
        // A new sub-item means the item isn't done after all.
        if (parent.checked_at) await c.query('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = $1', [parentId]);
      }
      const { rows } = await c.query<ShoppingItem>(
        `INSERT INTO shopping_items (parent_id, title, created_by) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
        [parentId, title, userId],
      );
      return rows[0]!;
    });
  }

  async check(userId: string, id: string): Promise<void> {
    await withTransaction(this.db, async (c) => {
      const item = await this.lock(c, id);
      if (item.parent_id === null) {
        // The item and every sub-item still open.
        await c.query(
          `UPDATE shopping_items SET checked_at = now(), checked_by = $2
           WHERE (id = $1 OR parent_id = $1) AND checked_at IS NULL`,
          [id, userId],
        );
        return;
      }
      await c.query('UPDATE shopping_items SET checked_at = now(), checked_by = $2 WHERE id = $1 AND checked_at IS NULL', [
        id,
        userId,
      ]);
      // Last open sub-item: the item is done too.
      await c.query(
        `UPDATE shopping_items p SET checked_at = now(), checked_by = $2
         WHERE p.id = $1 AND p.checked_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM shopping_items s WHERE s.parent_id = p.id AND s.checked_at IS NULL)`,
        [item.parent_id, userId],
      );
    });
  }

  async uncheck(id: string): Promise<void> {
    await withTransaction(this.db, async (c) => {
      const item = await this.lock(c, id);
      if (item.parent_id === null) {
        await c.query('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = $1 OR parent_id = $1', [id]);
      } else {
        await c.query('UPDATE shopping_items SET checked_at = NULL, checked_by = NULL WHERE id = $1 OR id = $2', [
          id,
          item.parent_id,
        ]);
      }
    });
  }

  /** Removes an item (and its sub-items). */
  async remove(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM shopping_items WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  private async lock(c: pg.PoolClient, id: string) {
    const { rows } = await c.query<{ id: string; parent_id: string | null; checked_at: string | null }>(
      'SELECT id, parent_id, checked_at FROM shopping_items WHERE id = $1 FOR UPDATE',
      [id],
    );
    if (!rows[0]) throw new HttpError(404, 'Item not found');
    return rows[0];
  }
}

const itemId = z.uuid();
const addSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    parentId: z.uuid().nullable().optional(),
  })
  .strict();

function idParam(req: Request): string {
  const parsed = itemId.safeParse(req.params.id);
  if (!parsed.success) throw new HttpError(404, 'Item not found');
  return parsed.data;
}

/** /api/shopping. Mount behind requireAuth: every signed-in user shares the one list. */
export function shoppingRouter(repo: ShoppingRepo): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    await repo.purgeExpired();
    res.json({ items: await repo.list(), retentionHours: CHECKED_RETENTION_HOURS });
  });

  router.post('/', async (req, res) => {
    const { title, parentId } = addSchema.parse(req.body);
    res.status(201).json(await repo.add(req.user!.id, title, parentId ?? null));
  });

  router.post('/:id/check', async (req, res) => {
    await repo.check(req.user!.id, idParam(req));
    res.json({ ok: true });
  });

  router.post('/:id/uncheck', async (req, res) => {
    await repo.uncheck(idParam(req));
    res.json({ ok: true });
  });

  router.delete('/:id', async (req, res) => {
    if (!(await repo.remove(idParam(req)))) throw new HttpError(404, 'Item not found');
    res.status(204).end();
  });

  return router;
}
