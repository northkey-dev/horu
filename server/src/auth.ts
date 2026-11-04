import type { NextFunction, Request, Response } from 'express';
import { ACCESS_TOKEN, APP_ORIGIN } from './config.ts';

// Requests from this machine (including `tailscale serve`, which proxies from
// localhost) and from Tailscale addresses are trusted. Everything else (e.g. the
// phone over plain Wi-Fi) needs the access token once; it is then kept in a cookie.

export function isLoopback(req: Request): boolean {
  const ip = req.socket.remoteAddress ?? '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function isTailscale(req: Request): boolean {
  const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
  const [a, b] = ip.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/** The access token, from the header, the query or the cookie (a browser extension or phone on the home Wi-Fi). */
export function hasToken(req: Pick<Request, 'headers' | 'query'>): boolean {
  const query = typeof req.query?.t === 'string' ? req.query.t : undefined;
  const cookie = /(?:^|;\s*)horu_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  return query === ACCESS_TOKEN || cookie === ACCESS_TOKEN || req.headers['x-horu-token'] === ACCESS_TOKEN;
}

function cookieToken(req: Request): string | undefined {
  const match = /(?:^|;\s*)horu_token=([^;]+)/.exec(req.headers.cookie ?? '');
  return match?.[1];
}

export const isTrustedNetwork = (req: Request) => isLoopback(req) || isTailscale(req);

export function requireAccess(req: Request, res: Response, next: NextFunction): void {
  if (isTrustedNetwork(req)) return next();
  const queryToken = typeof req.query.t === 'string' ? req.query.t : undefined;
  if (queryToken === ACCESS_TOKEN) {
    res.setHeader('Set-Cookie', `horu_token=${ACCESS_TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax`);
    return next();
  }
  if (cookieToken(req) === ACCESS_TOKEN || req.headers['x-horu-token'] === ACCESS_TOKEN) return next();
  res.status(401).type('text').send('Horu: open the pairing link from http://localhost:7317/pair on the laptop first.');
}

// A copy of the app hosted elsewhere (HORU_APP_URL) calls this service across origins. Browsers send the calling
// page's origin, so only the app itself (and the Vite dev server and the Chrome extension) may call in. Without this,
// any website open on the phone could send requests to the laptop over Tailscale.
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

export function crossOrigin(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  if (!origin || origin === 'null') return next();
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return void res.status(403).end();
  }
  if (host === req.headers.host) return next(); // the laptop serving the app itself
  const allowed = origin === APP_ORIGIN || DEV_ORIGINS.has(origin) || (origin.startsWith('chrome-extension://') && (isTrustedNetwork(req) || hasToken(req)));
  if (!allowed) return void res.status(403).type('text').send(`Horu: requests from ${origin} are not allowed.`);
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Filename, X-Horu-Token');
    // Chrome asks before a public page may reach a private address (Tailscale's 100.x range counts).
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');
    return void res.status(204).end();
  }
  next();
}

export function localOnly(req: Request, res: Response, next: NextFunction): void {
  if (isLoopback(req)) return next();
  res.status(403).end();
}

/** This computer, or anyone with the access token (Horu in a container: its own address is not loopback). */
export function localOrToken(req: Request, res: Response, next: NextFunction): void {
  if (isLoopback(req) || hasToken(req)) return next();
  res.status(403).type('text').send('Horu: open this page with the access token (?t=…) or through the Tailscale address.');
}
