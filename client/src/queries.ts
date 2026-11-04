import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { Task, TaskInput } from './types';

export function useMeta() {
  return useQuery({
    queryKey: ['meta'],
    queryFn: api.meta,
    // Keep "today" fresh so the app follows the date change at midnight.
    refetchInterval: 5 * 60 * 1000,
  });
}

/** The server's notion of today, in the app's configured time zone. */
export function useToday(): string | undefined {
  return useMeta().data?.today;
}

export const useDay = (date: string) => useQuery({ queryKey: ['tasks', 'day', date], queryFn: () => api.day(date) });
export const useBacklog = () => useQuery({ queryKey: ['tasks', 'backlog'], queryFn: api.backlog });
export const useHistory = (from: string, to: string) =>
  useQuery({
    queryKey: ['tasks', 'history', from, to],
    queryFn: () => api.history(from, to),
    placeholderData: keepPreviousData,
  });

function useTaskMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
}

export const useCreateTask = () => useTaskMutation((input: TaskInput) => api.create(input));
export const useUpdateTask = () =>
  useTaskMutation(({ id, patch }: { id: string; patch: Partial<TaskInput> }) => api.update(id, patch));
export const useDeleteTask = () => useTaskMutation((id: string) => api.remove(id));
export const useToggleTask = () =>
  useTaskMutation((task: Task) => (task.status === 'open' ? api.complete(task.id) : api.reopen(task.id)));
