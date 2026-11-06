import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, type NotificationPrefs } from '../api';
import { currentSubscription, disablePush, enablePush, pushSupport } from '../push';

/** Account page: turn push on/off for this device, choose what to receive, send a test. */
export function NotificationSettings() {
  const qc = useQueryClient();
  const config = useQuery({ queryKey: ['push', 'config'], queryFn: api.push.config });
  const support = pushSupport();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [permission, setPermission] = useState(() => ('Notification' in window ? Notification.permission : 'default'));

  // Check this device; if it's subscribed, make sure the server knows (e.g. after a reinstall).
  useEffect(() => {
    if (support !== 'supported') return setSubscribed(false);
    currentSubscription()
      .then(async (sub) => {
        setSubscribed(Boolean(sub));
        if (sub && config.data?.enabled) await api.push.subscribe(sub.toJSON()).catch(() => {});
      })
      .catch(() => setSubscribed(false));
  }, [support, config.data?.enabled]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['push', 'config'] });
  const turnOn = useMutation({
    mutationFn: () => enablePush((config.data as { publicKey: string }).publicKey),
    onSuccess: () => setSubscribed(true),
    onSettled: () => {
      setPermission(Notification.permission);
      refresh();
    },
  });
  const turnOff = useMutation({ mutationFn: disablePush, onSuccess: () => setSubscribed(false), onSettled: refresh });
  const test = useMutation({ mutationFn: api.push.test });
  type Config = { enabled: true; publicKey: string; devices: number; prefs: NotificationPrefs };
  const prefs = useMutation({
    mutationFn: (patch: Partial<NotificationPrefs>) => api.push.setPrefs(patch),
    // Show the change at once; roll back if the server says no.
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ['push', 'config'] });
      const previous = qc.getQueryData<Config>(['push', 'config']);
      if (previous) qc.setQueryData<Config>(['push', 'config'], { ...previous, prefs: { ...previous.prefs, ...patch } });
      return { previous };
    },
    onError: (_err, _patch, ctx) => ctx?.previous && qc.setQueryData(['push', 'config'], ctx.previous),
    onSettled: refresh,
  });

  if (!config.data || !config.data.enabled) return null;
  const p = config.data.prefs;
  const error = turnOn.error ?? turnOff.error ?? test.error ?? prefs.error;

  return (
    <div className="card form-stack notifications">
      <h2 className="card__title">Notifications</h2>

      {support === 'needs-install' && (
        <p className="muted">
          On iPhone and iPad, notifications only work from the Home Screen app. In Safari, tap <strong>Share</strong> →{' '}
          <strong>Add to Home Screen</strong>, then open Questlog from its icon and come back here.
        </p>
      )}
      {support === 'unsupported' && <p className="muted">This browser can't receive notifications.</p>}

      {support === 'supported' && subscribed === false && (
        <>
          <p className="muted">
            Get a note when someone shares or changes a task with you, and a summary of your day each morning.
          </p>
          {permission === 'denied' ? (
            <p className="form-error">Notifications are blocked for Questlog. Allow them in your phone or browser settings, then try again.</p>
          ) : null}
          <button className="btn btn--primary" onClick={() => turnOn.mutate()} disabled={turnOn.isPending}>
            {turnOn.isPending ? 'Turning on…' : 'Turn on notifications on this device'}
          </button>
        </>
      )}

      {support === 'supported' && subscribed && (
        <>
          <p className="form-ok">On for this device.</p>
          <label className="check-row">
            <input type="checkbox" checked={p.shared} onChange={(e) => prefs.mutate({ shared: e.target.checked })} />
            <span>
              <strong>Shared tasks</strong>
              <span className="muted">When someone creates, changes, completes or deletes a task shared with you</span>
            </span>
          </label>
          <label className="check-row">
            <input type="checkbox" checked={p.morning} onChange={(e) => prefs.mutate({ morning: e.target.checked })} />
            <span>
              <strong>Morning summary</strong>
              <span className="muted">Your tasks for the day (skipped when there are none)</span>
            </span>
          </label>
          {p.morning && (
            <label className="row check-row__time">
              <span className="muted">Send at</span>
              <input
                type="time"
                value={p.morningTime}
                onChange={(e) => e.target.value && prefs.mutate({ morningTime: e.target.value })}
                aria-label="Morning summary time"
              />
            </label>
          )}
          <div className="row">
            <button className="btn" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? 'Sending…' : 'Send a test'}
            </button>
            <button className="btn btn--ghost" onClick={() => turnOff.mutate()} disabled={turnOff.isPending}>
              Turn off on this device
            </button>
          </div>
          {test.isSuccess && <p className="form-ok">Sent. It should appear in a few seconds.</p>}
          <p className="muted small">
            These choices apply to all your devices. {config.data.devices > 1 && `You're signed up on ${config.data.devices} devices.`}
          </p>
        </>
      )}

      {error && <p className="form-error">{error.message}</p>}
    </div>
  );
}
