import { api } from './api';

export type PushSupport =
  | 'supported'
  /** iPhone/iPad in a Safari tab: push only works from the Home Screen app. */
  | 'needs-install'
  | 'unsupported';

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function pushSupport(): PushSupport {
  const capable = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  if (isIos() && !isStandalone()) return 'needs-install';
  return capable ? 'supported' : 'unsupported';
}

/** Registers the service worker that shows notifications. Safe to call on every load. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    /* not fatal: notifications just won't be available */
  });
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== 'supported') return null;
  return (await registration()).pushManager.getSubscription();
}

/** Asks for permission (must follow a tap), subscribes this device and tells the server. */
export async function enablePush(publicKey: string): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for Questlog. Allow them in your phone or browser settings.'
        : 'Notifications were not allowed.',
    );
  }
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  const key = keyBytes(publicKey);
  if (sub && !sameKey(sub, key)) {
    // Subscribed with an older server key: start over.
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await api.push.subscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.push.unsubscribe(sub.endpoint).catch(() => {});
  await sub.unsubscribe();
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}
