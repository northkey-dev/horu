import { spawn } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

/** Runs a command without a shell. Rejects on non-zero exit unless `allowFail`. */
export function run(
  cmd: string,
  args: string[],
  opts: { input?: string; timeoutMs?: number; allowFail?: boolean; cwd?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(Object.assign(new Error(`${cmd} timed out after ${Math.round(opts.timeoutMs! / 1000)} s`), { code: 'ETIMEDOUT', stdout }));
        }, opts.timeoutMs)
      : undefined;
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const result = { code: code ?? -1, stdout, stderr };
      if (code !== 0 && !opts.allowFail) reject(Object.assign(new Error(`${cmd} exited ${code}: ${stderr.slice(-500)}`), result));
      else resolve(result);
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}
