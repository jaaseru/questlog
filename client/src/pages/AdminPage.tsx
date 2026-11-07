import { QueryError } from '../components/QueryError';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router';
import { api } from '../api';
import { initials } from '../components/SharePicker';
import { timeAgo } from '../dates';
import { generatePassword } from '../passwordGen';
import { useMe } from '../queries';
import type { AdminUser, AuditEntry } from '../types';

export function AdminPage() {
  const me = useMe();
  if (!me.isAdmin) return <Navigate to="/" replace />;
  return (
    <section className="page">
      <header className="page-header">
        <h1>Admin</h1>
        <p className="muted">Only you can see this page.</p>
      </header>
      <People />
      <AddPerson />
      <Activity />
    </section>
  );
}

function useAdminMutation<V>(fn: (vars: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin'] });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

function People() {
  const { data, error } = useQuery({ queryKey: ['admin', 'users'], queryFn: api.admin.users });
  return (
    <>
      <h2 className="section-title">People · {data?.users.length ?? '…'}</h2>
      <QueryError error={error} hasData={Boolean(data)} />
      <ul className="people">
        {data?.users.map((u) => <Person key={u.id} user={u} />)}
      </ul>
    </>
  );
}

function Person({ user }: { user: AdminUser }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const isMe = user.id === me.id;

  return (
    <li className={`card person${user.disabled ? ' is-disabled' : ''}`}>
      <button className="person__summary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="avatar avatar--lg" aria-hidden>
          {initials(user.displayName)}
        </span>
        <span className="person__text">
          <strong>
            {user.displayName}
            {isMe && <span className="muted"> (you)</span>}
          </strong>
          <span className="muted">
            {user.username} · {user.lastLoginAt ? `signed in ${timeAgo(user.lastLoginAt)}` : 'never signed in'}
          </span>
        </span>
        {user.isAdmin && <span className="chip chip--shared">Admin</span>}
        {user.disabled && <span className="chip chip--overdue">Disabled</span>}
      </button>
      {open && <PersonActions user={user} isMe={isMe} />}
    </li>
  );
}

function PersonActions({ user, isMe }: { user: AdminUser; isMe: boolean }) {
  const [name, setName] = useState(user.displayName);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const rename = useAdminMutation(() => api.admin.update(user.id, { displayName: name }));
  const reset = useAdminMutation(() => api.admin.resetPassword(user.id, password));
  const signOut = useAdminMutation(() => api.admin.signOut(user.id));
  const toggle = useAdminMutation(() => api.admin.update(user.id, { disabled: !user.disabled }));
  const error = rename.error ?? reset.error ?? signOut.error ?? toggle.error;

  const done = (msg: string) => () => setNotice(msg);

  return (
    <div className="person__actions">
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          rename.mutate(undefined, { onSuccess: done('Name updated.') });
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Display name" maxLength={100} required />
        <button className="btn" disabled={rename.isPending || name.trim() === user.displayName}>
          Rename
        </button>
      </form>

      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          reset.mutate(undefined, {
            onSuccess: done(`Password set. ${isMe ? 'Your other devices' : `${user.displayName}`} ${isMe ? 'are' : 'is'} signed out; share the new password with them securely.`),
          });
        }}
      >
        <input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label={`New password for ${user.displayName}`}
          placeholder="New password"
          autoComplete="off"
          spellCheck={false}
          minLength={8}
          maxLength={200}
          required
        />
        <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
          Generate
        </button>
        <button className="btn" disabled={reset.isPending || password.length < 8}>
          Reset password
        </button>
      </form>

      <div className="row">
        <button className="btn" onClick={() => signOut.mutate(undefined, { onSuccess: done('Signed out on every device.') })} disabled={signOut.isPending}>
          Sign out everywhere
        </button>
        {!user.isAdmin && (
          <button
            className={`btn ${user.disabled ? '' : 'btn--danger-ghost'}`}
            onClick={() => {
              if (user.disabled || confirm(`Disable ${user.displayName}? They are signed out at once. Their tasks are kept.`)) {
                toggle.mutate(undefined, { onSuccess: done(user.disabled ? 'Enabled. They can sign in again.' : 'Disabled and signed out.') });
              }
            }}
            disabled={toggle.isPending}
          >
            {user.disabled ? 'Enable' : 'Disable'}
          </button>
        )}
      </div>

      {error && <p className="form-error">{error.message}</p>}
      {notice && !error && <p className="form-ok">{notice}</p>}
    </div>
  );
}

function AddPerson() {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const create = useAdminMutation(() => api.admin.create({ username, displayName, password }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    create.mutate(undefined, {
      onSuccess: () => {
        setCreated({ username: username.trim().toLowerCase(), password });
        setUsername('');
        setDisplayName('');
        setPassword('');
      },
    });
  };

  return (
    <form className="card form-stack" onSubmit={submit}>
      <h2 className="card__title">Add a person</h2>
      <label className="field">
        <span className="field__label">Username (what they type to sign in)</span>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          pattern="[A-Za-z0-9._\-]{2,32}"
          title="2-32 characters: letters, digits, . _ or -"
          required
        />
      </label>
      <label className="field">
        <span className="field__label">Display name (what others see)</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={100} placeholder="Optional" />
      </label>
      <label className="field">
        <span className="field__label">Password (at least 8 characters)</span>
        <div className="row">
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            minLength={8}
            maxLength={200}
            required
          />
          <button type="button" className="btn" onClick={() => setPassword(generatePassword())}>
            Generate
          </button>
        </div>
      </label>
      {create.isError && <p className="form-error">{create.error.message}</p>}
      {created && (
        <div className="form-ok credentials">
          <p>
            Added. Send these to them through a different channel than the site address, and ask them to change the password
            under <strong>Account</strong>:
          </p>
          <code>
            username: {created.username}
            <br />
            password: {created.password}
          </code>
        </div>
      )}
      <button type="submit" className="btn btn--primary" disabled={create.isPending}>
        Add person
      </button>
    </form>
  );
}

function describe(e: AuditEntry): string {
  const who = e.actor ?? (e.detail.via === 'cli' ? 'Command line' : 'Someone');
  const target = e.target ?? 'a user';
  switch (e.action) {
    case 'login_succeeded':
      return `${who} signed in`;
    case 'login_failed':
      return e.detail.reason === 'disabled'
        ? `Sign-in refused for disabled account "${e.detail.username}"`
        : `Failed sign-in for "${e.detail.username}"`;
    case 'login_blocked':
      return `Sign-in blocked after too many attempts ("${e.detail.username}")`;
    case 'password_changed':
      return `${who} changed their password`;
    case 'signed_out_everywhere':
      return e.actor && e.actor === e.target ? `${who} signed out their other devices` : `${who} signed ${target} out everywhere`;
    case 'user_created':
      return `${who} added ${target}`;
    case 'user_renamed':
      return `${who} renamed ${e.detail.from ?? target} to ${e.detail.to ?? target}`;
    case 'user_disabled':
      return `${who} disabled ${target}`;
    case 'user_enabled':
      return `${who} enabled ${target}`;
    case 'password_reset':
      return `${who} reset the password for ${target}`;
    case 'admin_granted':
      return `${who} made ${target} an admin`;
    case 'admin_revoked':
      return `${who} removed admin rights from ${target}`;
    default:
      return e.action;
  }
}

const WARNING_ACTIONS = new Set(['login_failed', 'login_blocked']);

function Activity() {
  const { data, error } = useQuery({
    queryKey: ['admin', 'audit'],
    queryFn: () => api.admin.audit(100),
    refetchInterval: 60_000,
  });
  return (
    <>
      <h2 className="section-title">Recent activity</h2>
      <QueryError error={error} hasData={Boolean(data)} />
      {data && data.entries.length === 0 && <p className="empty">Nothing yet.</p>}
      {data && data.entries.length > 0 && (
        <ul className="card activity">
          {data.entries.map((e) => (
            <li key={e.id} className={WARNING_ACTIONS.has(e.action) ? 'is-warning' : ''}>
              <span>{describe(e)}</span>
              <span className="muted" title={new Date(e.at).toLocaleString()}>
                {timeAgo(e.at)}
                {e.ip && ` · ${e.ip}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
