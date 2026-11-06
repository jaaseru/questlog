export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface ShoppingItem {
  id: string;
  /** The item this is a sub-item of, if any (one level deep). */
  parentId: string | null;
  title: string;
  checkedAt: string | null;
  checkedBy: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  isAdmin: boolean;
}

/** Someone you can share with (from /api/users). */
export type Person = Omit<User, 'isAdmin'>;

export interface AdminUser extends User {
  disabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actor: string | null;
  target: string | null;
  ip: string | null;
  detail: { username?: string; reason?: string; via?: string; from?: string; to?: string };
}

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export const KINDS = ['optional', 'fixed', 'variable'] as const;
export type RepeatKind = (typeof KINDS)[number];

export interface TaskRepeat {
  frequency: Frequency;
  /** Every N days/weeks/months/years. */
  every: number;
  /** ISO weekdays (1 = Monday … 7 = Sunday); weekly only. Empty = the task's own weekday. */
  weekdays: number[];
  kind: RepeatKind;
  /** Last day an occurrence may fall on (inclusive); null = forever. */
  until: string | null;
}

/** A future occurrence of a repeating task; becomes a real task on its day. */
export interface Upcoming extends TaskRepeat {
  seriesId: string;
  date: string;
  title: string;
  priority: Priority;
  /** Flexible series whose current occurrence is still open: the date may move. */
  estimated: boolean;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done' | 'missed';
  priority: Priority;
  scheduledDate: string | null;
  originalDate: string | null;
  dueDate: string | null;
  rolloverCount: number;
  completedAt: string | null;
  completedOn: string | null;
  completedBy: string | null;
  createdBy: string | null;
  /** Users who can see and work on the task. More than one means it's shared. */
  memberIds: string[];
  seriesId: string | null;
  occurrenceDate: string | null;
  repeat: TaskRepeat | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  scheduledDate?: string | null;
  dueDate?: string | null;
  /** On create: other users to share with. On update: the complete member list. */
  memberIds?: string[];
}
