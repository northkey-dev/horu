import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import webpush, { type PushSubscription } from 'web-push';
import { DATA_DIR, getSettings, writeJsonAtomic } from './config.ts';
import { analytics, dayKey, refreshAnki } from './analytics.ts';
import { log } from './log.ts';
import { inboxMoments } from './store.ts';

// Daily-goal reminder: a Web Push to every subscribed device once a day, at the chosen time, if the goal
// is still open. Delivery goes through Apple's / Google's free push service; the laptop has to be on.

const FILE = path.join(DATA_DIR, 'push.json');
const SUBJECT = process.env.HORU_PUSH_SUBJECT ?? 'https://github.com/northkey-dev/horu';
const CHECK_MS = 5 * 60_000;

type PushDb = { vapid: { publicKey: string; privateKey: string }; subs: PushSubscription[]; lastSent?: string; lastInboxSent?: string };

const db: PushDb = (() => {
  try {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')) as PushDb;
    if (saved.vapid?.publicKey) return { ...saved, subs: saved.subs ?? [] };
  } catch {
    // first run
  }
  const fresh: PushDb = { vapid: webpush.generateVAPIDKeys(), subs: [] };
  writeJsonAtomic(FILE, fresh);
  return fresh;
})();
webpush.setVapidDetails(SUBJECT, db.vapid.publicKey, db.vapid.privateKey);

const save = () => writeJsonAtomic(FILE, db);

async function broadcast(payload: { title: string; body: string; tag?: string }): Promise<number> {
  let sent = 0;
  for (const sub of [...db.subs]) {
    try {
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        db.subs = db.subs.filter((s) => s.endpoint !== sub.endpoint); // uninstalled or permission revoked
        save();
      } else log.warn('Push failed:', status ?? (err as Error).message);
    }
  }
  return sent;
}

const INBOX_AGE_MS = 2 * 86400_000;
const INBOX_MIN = 3;

/** Marked moments lose their value when they sit for days: nudge once a day when several have been waiting. */
async function checkInbox(day: string): Promise<void> {
  if (db.lastInboxSent === day) return;
  const waiting = inboxMoments().filter((m) => m.status === 'ready' || m.status === 'error');
  const old = waiting.filter((m) => Date.now() - Date.parse(m.createdAt) >= INBOX_AGE_MS);
  if (!old.length || waiting.length < INBOX_MIN) return;
  const days = Math.floor((Date.now() - Math.min(...old.map((m) => Date.parse(m.createdAt)))) / 86400_000);
  if (await broadcast({ title: 'Horu', body: `${waiting.length} marked moments are waiting in your inbox, the oldest for ${days} days.`, tag: 'horu-inbox' })) {
    db.lastInboxSent = day;
    save();
    log.info(`Inbox reminder sent (${waiting.length} waiting)`);
  }
}

async function check(): Promise<void> {
  const { reminderEnabled, reminderTime } = getSettings();
  if (!reminderEnabled || !db.subs.length) return;
  const now = new Date();
  const [h, m] = reminderTime.split(':').map(Number);
  if (!(h >= 0 && h < 24 && m >= 0 && m < 60)) return;
  const day = dayKey(now.getTime());
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) return;

  await checkInbox(day);
  if (db.lastSent === day) return;

  let a = await analytics();
  if (a.goal - a.days[a.days.length - 1].xp > 0) {
    // Reviews done on the phone only count once Anki has synced: start it (hidden) and read again before nagging.
    await Promise.race([refreshAnki(true).catch((e) => log.warn('Reminder: Anki refresh failed:', (e as Error).message)), new Promise((res) => setTimeout(res, 150_000))]);
    a = await analytics();
  }
  const left = a.goal - a.days[a.days.length - 1].xp;
  if (left <= 0) {
    db.lastSent = day; // goal reached, nothing to remind about today
    return save();
  }
  const streak = !a.streak.activeToday && a.streak.current > 0 ? ` Keep your ${a.streak.current}-day streak.` : '';
  if (await broadcast({ title: 'Horu', body: `${left} XP to today's goal.${streak}` })) {
    db.lastSent = day;
    save();
    log.info(`Goal reminder sent (${left} XP left)`);
  }
}

let checking = false;

export function startReminders(): void {
  const run = () => {
    if (checking) return;
    checking = true;
    void check()
      .catch((e) => log.warn('Reminder:', (e as Error).message))
      .finally(() => (checking = false));
  };
  setTimeout(run, 30_000).unref();
  setInterval(run, CHECK_MS).unref();
}

const h =
  (fn: (req: Request) => unknown) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await fn(req));
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
    }
  };

export function pushRouter(): express.Router {
  const r = express.Router();
  r.use(express.json());
  r.get('/', h(() => ({ key: db.vapid.publicKey, devices: db.subs.length })));
  r.post(
    '/subscribe',
    h((req) => {
      const sub = req.body?.subscription as PushSubscription | undefined;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error('Invalid subscription');
      db.subs = [...db.subs.filter((s) => s.endpoint !== sub.endpoint), sub];
      save();
      return { devices: db.subs.length };
    }),
  );
  r.post(
    '/unsubscribe',
    h((req) => {
      db.subs = db.subs.filter((s) => s.endpoint !== req.body?.endpoint);
      save();
      return { devices: db.subs.length };
    }),
  );
  r.post(
    '/test',
    h(async () => {
      const sent = await broadcast({ title: 'Horu', body: 'Reminders work.' });
      if (!sent) throw new Error('No device received it. Enable reminders on the phone first.');
      return { sent };
    }),
  );
  return r;
}
