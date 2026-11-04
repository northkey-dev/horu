import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcess } from 'node:child_process';
import { TOOLS_DIR, VENV_PYTHON } from './config.ts';
import { log } from './log.ts';

// A long-running Python process speaking JSON lines (tools/*_worker.py).
// Started on first use, jobs run one at a time, stopped after a while idle so
// the models do not occupy memory while nothing happens.

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class PyWorker {
  private proc: ChildProcess | undefined;
  private ready: Promise<void> | undefined;
  private idleTimer: NodeJS.Timeout | undefined;
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly name: string;
  private readonly script: string;
  private readonly args: () => string[];
  private readonly idleMs: number;

  constructor(name: string, script: string, args: () => string[] = () => [], idleMs = 10 * 60_000) {
    this.name = name;
    this.script = path.join(TOOLS_DIR, script);
    this.args = args;
    this.idleMs = idleMs;
  }

  available(): boolean {
    return fs.existsSync(VENV_PYTHON) && fs.existsSync(this.script);
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    const proc = spawn(VENV_PYTHON, [this.script, ...this.args()], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
    });
    this.proc = proc;
    proc.stderr?.setEncoding('utf8').on('data', (d: string) => log.debug(`${this.name}:`, d.trim()));
    this.ready = new Promise((resolve, reject) => {
      const rl = readline.createInterface({ input: proc.stdout! });
      rl.on('line', (line) => {
        let msg: { ready?: boolean; id?: string; error?: string; [k: string]: unknown };
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg.ready) return resolve();
        const p = msg.id ? this.pending.get(msg.id) : undefined;
        if (!p) return;
        this.pending.delete(msg.id!);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg);
      });
      proc.on('exit', (code) => {
        log.info(`${this.name} worker exited (${code})`);
        reject(new Error(`${this.name} worker exited`));
        for (const p of this.pending.values()) p.reject(new Error(`${this.name} worker exited`));
        this.pending.clear();
        if (this.proc === proc) {
          this.proc = undefined;
          this.ready = undefined;
        }
      });
    });
    return this.ready;
  }

  private touch(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.proc?.kill(), this.idleMs);
  }

  /** Sends one request (serialised with other requests) and resolves with the response line. */
  request<T>(payload: Record<string, unknown>): Promise<T> {
    const job = this.queue.then(async () => {
      await this.start();
      this.touch();
      const id = Math.random().toString(36).slice(2);
      const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
      this.proc!.stdin!.write(JSON.stringify({ ...payload, id }) + '\n');
      try {
        return (await result) as T;
      } finally {
        this.touch();
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  stop(): void {
    this.proc?.kill();
  }
}
