import type { Db, Queryable } from './db.js';

export type AuditAction =
  | 'login_succeeded'
  | 'login_failed'
  | 'login_blocked'
  | 'password_changed'
  | 'signed_out_everywhere'
  | 'user_created'
  | 'user_renamed'
  | 'user_disabled'
  | 'user_enabled'
  | 'admin_granted'
  | 'admin_revoked'
  | 'password_reset';

export interface AuditEntry {
  id: number;
  at: string;
  action: AuditAction;
  actor: string | null;
  target: string | null;
  ip: string | null;
  detail: Record<string, unknown>;
}

export interface AuditInput {
  action: AuditAction;
  actorId?: string | null;
  targetUserId?: string | null;
  ip?: string | null;
  detail?: Record<string, unknown>;
}

export class AuditLog {
  constructor(private readonly db: Db) {}

  async record(entry: AuditInput, db: Queryable = this.db): Promise<void> {
    await db.query(
      'INSERT INTO audit_log (action, actor_id, target_user_id, ip, detail) VALUES ($1, $2, $3, $4, $5)',
      [entry.action, entry.actorId ?? null, entry.targetUserId ?? null, entry.ip ?? null, entry.detail ?? {}],
    );
  }

  async recent(limit = 100): Promise<AuditEntry[]> {
    const { rows } = await this.db.query<AuditEntry>(
      `SELECT a.id::int, a.at, a.action, actor.display_name AS actor, target.display_name AS target, a.ip, a.detail
       FROM audit_log a
       LEFT JOIN users actor ON actor.id = a.actor_id
       LEFT JOIN users target ON target.id = a.target_user_id
       ORDER BY a.at DESC, a.id DESC
       LIMIT $1`,
      [limit],
    );
    return rows;
  }
}
