import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { initials } from '../components/SharePicker';
import { useMe } from '../queries';

export function AccountPage() {
  const me = useMe();
  return (
    <section className="page">
      <header className="page-header">
        <h1>Account</h1>
      </header>

      <div className="card account-card">
        <span className="avatar avatar--lg" aria-hidden>
          {initials(me.displayName)}
        </span>
        <div>
          <strong>{me.displayName}</strong>
          <p className="muted">
            Signed in as <code>{me.username}</code>
            {me.isAdmin && ' · Admin'}
          </p>
        </div>
      </div>

      {me.isAdmin && (
        <Link to="/admin" className="card card--link">
          <strong>Admin</strong>
          <span className="muted">Add people, reset passwords, see sign-in activity</span>
        </Link>
      )}

      <ChangePassword />
      <SignOutOthers />
    </section>
  );
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const change = useMutation({ mutationFn: () => api.changePassword(current, next) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (next !== repeat) return setMismatch(true);
    setMismatch(false);
    change.mutate(undefined, {
      onSuccess: () => {
        setCurrent('');
        setNext('');
        setRepeat('');
      },
    });
  };

  return (
    <form className="card form-stack" onSubmit={submit}>
      <h2 className="card__title">Change password</h2>
      {/* Hidden username helps password managers save the new password for the right account. */}
      <input type="text" autoComplete="username" value={useMe().username} readOnly hidden />
      <label className="field">
        <span className="field__label">Current password</span>
        <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
      </label>
      <label className="field">
        <span className="field__label">New password (at least 8 characters)</span>
        <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} maxLength={200} required />
      </label>
      <label className="field">
        <span className="field__label">Repeat new password</span>
        <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
      </label>
      {mismatch && <p className="form-error">The new passwords don't match.</p>}
      {change.isError && <p className="form-error">{change.error.message}</p>}
      {change.isSuccess && <p className="form-ok">Password changed. Your other devices have been signed out.</p>}
      <button type="submit" className="btn btn--primary" disabled={change.isPending}>
        {change.isPending ? 'Saving…' : 'Change password'}
      </button>
    </form>
  );
}

function SignOutOthers() {
  const signOut = useMutation({ mutationFn: api.signOutOthers });
  return (
    <div className="card form-stack">
      <h2 className="card__title">Other devices</h2>
      <p className="muted">Lost a phone, or signed in on a shared computer? End every session except this one.</p>
      {signOut.isError && <p className="form-error">{signOut.error.message}</p>}
      {signOut.isSuccess && <p className="form-ok">Done. Everywhere else is signed out.</p>}
      <button className="btn" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        Sign out other devices
      </button>
    </div>
  );
}
