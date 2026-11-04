export const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

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
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: Priority;
  scheduledDate?: string | null;
  dueDate?: string | null;
}
