export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface User {
  id: string;
  username: string;
  displayName: string;
}

export interface Task {
  id: string;
  title: string;
  notes: string;
  status: 'open' | 'done';
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
