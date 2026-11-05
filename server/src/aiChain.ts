// Asks the AIs of Settings in order: the first that answers wins, the others are the fallback for when it is down,
// out of quota or not set up.

export class ChainError extends Error {
  failures: { engine: string; message: string }[];
  constructor(failures: { engine: string; message: string }[]) {
    super(`No AI answered. ${failures.map((f) => `${f.engine}: ${f.message}`).join(' · ')}`);
    this.failures = failures;
  }
}

/**
 * Runs `run` for each engine until one succeeds. `notReady` names why an engine cannot be asked at all (for
 * example no key), which skips it without a call. With a single engine its own error comes back unchanged,
 * so the messages and checks that already exist for it keep working.
 */
export async function runChain<T>(
  engines: string[],
  run: (engine: string) => Promise<T>,
  notReady: (engine: string) => string | undefined = () => undefined,
  onFallback: (engine: string, message: string) => void = () => undefined,
): Promise<{ engine: string; result: T }> {
  const failures: { engine: string; message: string }[] = [];
  let first: unknown;
  for (const engine of engines) {
    const reason = notReady(engine);
    if (reason) {
      failures.push({ engine, message: reason });
      first ??= new Error(reason);
      continue;
    }
    try {
      return { engine, result: await run(engine) };
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      failures.push({ engine, message });
      first ??= err;
      onFallback(engine, message);
    }
  }
  if (engines.length === 1) throw first;
  throw new ChainError(failures);
}
