import type { WebSocket } from 'ws';
import { dayKey } from './analytics.ts';
import { log } from './log.ts';
import { activeSession, addWatchTime } from './store.ts';
import type { ExtToServer, ServerToExt } from '../../shared/types.ts';

// The Chrome extension's offscreen document keeps one WebSocket open to us.

const HEARTBEAT_SECONDS = 5; // matches the extension's interval

let socket: WebSocket | undefined;
let recording = false;

export function attachExtension(ws: WebSocket): void {
  socket?.close();
  socket = ws;
  recording = false;
  log.info('Extension connected');
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as ExtToServer;
      if (msg.type === 'hello' || msg.type === 'recording') {
        recording = msg.recording;
        log.info(`Extension recording: ${recording}`);
      } else if (msg.type === 'playing' && recording) {
        const session = activeSession();
        if (session) addWatchTime(session.id, dayKey(Date.now()), HEARTBEAT_SECONDS);
      }
    } catch (err) {
      log.warn('Bad extension message', err);
    }
  });
  ws.on('close', () => {
    if (socket === ws) {
      socket = undefined;
      recording = false;
      log.info('Extension disconnected');
    }
  });
}

export function extensionState(): { connected: boolean; recording: boolean } {
  return { connected: socket !== undefined, recording };
}

export function sendToExtension(msg: ServerToExt): boolean {
  if (!socket || !recording) return false;
  socket.send(JSON.stringify(msg));
  return true;
}
