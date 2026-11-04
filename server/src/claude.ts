import { DATA_DIR, getSettings } from './config.ts';
import { run } from './proc.ts';
import { log } from './log.ts';
import { buildPrompt, parseTranslation, SCHEMA, translatePrompt, TRANSLATE_SCHEMA, type ExplainInput, type Explanation, type TranslateInput, type Translation } from '../../shared/ai.ts';

// Card explanations and translations via Claude Code in headless mode (`claude -p`). Uses the
// user's Claude subscription, so there are no API costs.

export type { Explanation };

// A card usually takes 5-20 s; much longer means an outage or rate limit, and
// the user is better served by a quick, clear error they can retry.
const TIMEOUT_MS = 90_000;

export class ClaudeError extends Error {
  readonly timedOut: boolean;
  constructor(message: string, timedOut = false) {
    super(message);
    this.timedOut = timedOut;
  }
}

type Envelope = { is_error?: boolean; result?: string; structured_output?: unknown };

function parseEnvelope(stdout: string): Envelope | undefined {
  try {
    return JSON.parse(stdout) as Envelope;
  } catch {
    return undefined;
  }
}

function describeFailure(err: Error & { code?: string; stdout?: string }): string {
  if (err.code === 'ENOENT') return 'Claude Code is not installed (the "claude" command was not found).';
  if (err.code === 'ETIMEDOUT') {
    return `Claude Code did not answer within ${TIMEOUT_MS / 1000} s (outage or usage limit?). Try again later, or create the card without AI.`;
  }
  // `claude -p` reports login/limit problems in its JSON envelope even on a non-zero exit.
  const reason = parseEnvelope(err.stdout ?? '')?.result;
  if (reason) return `Claude Code: ${reason}`;
  return `Claude Code failed: ${err.message.slice(0, 300)}`;
}

export async function explain(input: ExplainInput): Promise<Explanation> {
  const data = (await ask(buildPrompt(input, getSettings().learnerProfile), SCHEMA)) as Explanation | undefined;
  if (!data?.explanation) throw new Error('Claude returned no explanation');
  return data;
}

export async function translate(input: TranslateInput): Promise<Translation> {
  const data = parseTranslation(JSON.stringify((await ask(translatePrompt(input, getSettings().learnerProfile), TRANSLATE_SCHEMA)) ?? {}));
  if (!data) throw new Error('Claude returned no translation');
  return data;
}

/** Runs `claude -p` with a JSON schema and returns the structured answer. */
async function ask(prompt: string, schema: object): Promise<unknown> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(schema),
    '--tools',
    '',
    '--model',
    getSettings().claudeModel,
    '--no-session-persistence',
  ];
  let stdout: string;
  try {
    ({ stdout } = await run('claude', args, { input: prompt, timeoutMs: TIMEOUT_MS, cwd: DATA_DIR }));
  } catch (err) {
    throw new ClaudeError(describeFailure(err as Error & { code?: string; stdout?: string }), (err as { code?: string }).code === 'ETIMEDOUT');
  }
  const envelope = parseEnvelope(stdout);
  if (!envelope) throw new ClaudeError(`Claude Code returned unreadable output: ${stdout.slice(0, 200)}`);
  if (envelope.is_error) throw new ClaudeError(`Claude Code: ${envelope.result ?? 'unknown error'}`);
  const data = envelope.structured_output ?? extractJson(envelope.result ?? '');
  if (!data) log.warn('Unexpected claude output', stdout.slice(0, 500));
  return data;
}

function extractJson(text: string): unknown {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return undefined;
  try {
    return JSON.parse(match[0]);
  } catch {
    return undefined;
  }
}

export async function claudeAvailable(): Promise<boolean> {
  try {
    await run('claude', ['--version'], { timeoutMs: 15_000 });
    return true;
  } catch {
    return false;
  }
}
