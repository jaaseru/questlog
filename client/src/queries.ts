import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './api';
import type { Task, TaskInput, User } from './types';

/** The signed-in user. Only call below the login gate in App. */
export function useMe(): User {
  const { data } = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: Infinity });
  return data!.user!;
}

/** Everyone who can be shared with, keyed by id for quick name lookups. */
export function useUsers() {
  const query = useQuery({ queryKey: ['users'], queryFn: api.users, staleTime: 5 * 60 * 1000 });
  const byId = useMemo(() => new Map((query.data?.users ?? []).map((u) => [u.id, u])), [query.data]);
  return { users: query.data?.users ?? [], byId };
}

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

export const useCalendar = (from: string, to: string) =>
  useQuery({
    queryKey: ['tasks', 'calendar', from, to],
    queryFn: () => api.calendar(from, to),
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
