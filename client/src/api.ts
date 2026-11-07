import type { AdminUser, AuditEntry, Person, ShoppingItem, Task, TaskInput, TaskRepeat, Upcoming, User } from './types';
import type { WeatherReport } from './weather';

export interface NotificationPrefs {
  shared: boolean;
  morning: boolean;
  /** 'HH:MM' */
  morningTime: string;
}

export class ApiError extends Error {
  constructor(
    /** HTTP status, or 0 when the server couldn't be reached at all. */
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }

  /** Worth trying again: rate-limited, a server/gateway hiccup, or no connection. */
  get retryable(): boolean {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

/** A readable message when the response didn't come with one from Questlog itself. */
function fallbackMessage(status: number): string {
  if (status === 429) return 'The hosting service is limiting requests right now (429). Questlog will try again.';
  if (status === 502 || status === 503 || status === 504) return `Questlog isn't responding right now (${status}). It will try again.`;
  return `Something went wrong (${status}).`;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers,
    });
  } catch {
    throw new ApiError(0, "Can't reach Questlog. Check your connection.");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? fallbackMessage(res.status));
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

  shopping: {
    list: () => request<{ items: ShoppingItem[]; retentionHours: number }>('/shopping'),
    add: (title: string, parentId: string | null) =>
      request<ShoppingItem>('/shopping', json('POST', { title, parentId })),
    check: (id: string) => request<{ ok: true }>(`/shopping/${id}/check`, json('POST')),
    uncheck: (id: string) => request<{ ok: true }>(`/shopping/${id}/uncheck`, json('POST')),
    remove: (id: string) => request<void>(`/shopping/${id}`, json('DELETE')),
  },

  push: {
    config: () =>
      request<
        | { enabled: false }
        | { enabled: true; publicKey: string; devices: number; prefs: NotificationPrefs }
      >('/push/config'),
    subscribe: (sub: PushSubscriptionJSON) => request<{ ok: true }>('/push/subscribe', json('POST', sub)),
    unsubscribe: (endpoint: string) => request<{ ok: true }>('/push/unsubscribe', json('POST', { endpoint })),
    setPrefs: (prefs: Partial<NotificationPrefs>) => request<NotificationPrefs>('/push/prefs', json('PATCH', prefs)),
    test: () => request<{ delivered: number }>('/push/test', json('POST')),
  },

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
  weather: (lat: number, lon: number) => request<WeatherReport>(`/weather?lat=${lat}&lon=${lon}`),

  day: (date: string) =>
    request<{
      date: string;
      today: string;
      open: Task[];
      done: Task[];
      missed: Task[];
      dueElsewhere: Task[];
      upcoming: Upcoming[];
    }>(
      `/tasks/day/${date}`,
    ),
  backlog: () => request<{ tasks: Task[] }>('/tasks/backlog'),
  history: (from: string, to: string) =>
    request<{ from: string; to: string; tasks: Task[] }>(`/tasks/history?from=${from}&to=${to}`),

  calendar: (from: string, to: string) =>
    request<{
      from: string;
      to: string;
      today: string;
      done: Task[];
      open: Task[];
      due: Task[];
      missed: Task[];
      upcoming: Upcoming[];
    }>(
      `/tasks/calendar?from=${from}&to=${to}`,
    ),

  create: (input: TaskInput) => request<Task>('/tasks', json('POST', input)),
  update: (id: string, patch: Partial<TaskInput>) => request<Task>(`/tasks/${id}`, json('PATCH', patch)),
  complete: (id: string) => request<Task>(`/tasks/${id}/complete`, json('POST')),
  reopen: (id: string) => request<Task>(`/tasks/${id}/reopen`, json('POST')),
  setRepeat: (id: string, repeat: TaskRepeat) => request<Task>(`/tasks/${id}/repeat`, json('PUT', repeat)),
  stopRepeat: (id: string) => request<Task>(`/tasks/${id}/repeat`, json('DELETE')),
  remove: (id: string) => request<void>(`/tasks/${id}`, json('DELETE')),
};
