import { api } from './api.ts';

// Web Push for the daily-goal reminder. On iOS this only exists once Horu is on the Home Screen (iOS 16.4+).

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const registration = () => navigator.serviceWorker.ready;

/** True when this device has a live subscription and permission. */
export async function pushEnabled(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return Boolean(await (await registration()).pushManager.getSubscription());
}

export async function enablePush(): Promise<void> {
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked. Allow them for Horu in iOS Settings.');
  const reg = await registration();
  const { key } = await api.pushInfo();
  const padded = (key + '='.repeat((4 - (key.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const applicationServerKey = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }));
  await api.pushSubscribe(sub.toJSON());
}

export async function disablePush(): Promise<void> {
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
