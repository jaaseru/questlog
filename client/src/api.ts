import type { AdminUser, AuditEntry, Person, Task, TaskInput, User } from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: 'same-origin',
    headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  return body as T;
}

const json = (method: string, data?: unknown): RequestInit => ({
  method,
  body: data === undefined ? undefined : JSON.stringify(data),
});

export const api = {
  me: () => request<{ signedIn: boolean; user?: User }>('/auth/me'),
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', json('POST', { username, password })),
  users: () => request<{ users: Person[] }>('/users'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/account/password', json('POST', { currentPassword, newPassword })),
  signOutOthers: () => request<{ ok: true }>('/account/signout-others', json('POST')),

  admin: {
    users: () => request<{ users: AdminUser[] }>('/admin/users'),
    create: (input: { username: string; displayName?: string; password: string }) =>
      request<AdminUser>('/admin/users', json('POST', input)),
    update: (id: string, patch: { displayName?: string; disabled?: boolean }) =>
      request<AdminUser>(`/admin/users/${id}`, json('PATCH', patch)),
    resetPassword: (id: string, password: string) =>
      request<{ ok: true }>(`/admin/users/${id}/password`, json('POST', { password })),
    signOut: (id: string) => request<{ ok: true }>(`/admin/users/${id}/signout`, json('POST')),
    audit: (limit = 100) => request<{ entries: AuditEntry[] }>(`/admin/audit?limit=${limit}`),
  },
  logout: () => request<{ ok: true }>('/auth/logout', json('POST')),
  meta: () => request<{ today: string; timezone: string }>('/meta'),

  day: (date: string) => request<{ date: string; today: string; open: Task[]; done: Task[] }>(`/tasks/day/${date}`),
  backlog: () => request<{ tasks: Task[] }>('/tasks/backlog'),
  history: (from: string, to: string) =>
    request<{ from: string; to: string; tasks: Task[] }>(`/tasks/history?from=${from}&to=${to}`),

  calendar: (from: string, to: string) =>
    request<{ from: string; to: string; today: string; done: Task[]; open: Task[]; due: Task[] }>(
      `/tasks/calendar?from=${from}&to=${to}`,
    ),

  create: (input: TaskInput) => request<Task>('/tasks', json('POST', input)),
  update: (id: string, patch: Partial<TaskInput>) => request<Task>(`/tasks/${id}`, json('PATCH', patch)),
  complete: (id: string) => request<Task>(`/tasks/${id}/complete`, json('POST')),
  reopen: (id: string) => request<Task>(`/tasks/${id}/reopen`, json('POST')),
  remove: (id: string) => request<void>(`/tasks/${id}`, json('DELETE')),
};
