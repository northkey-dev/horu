/** Before 0.18 there was one key and one model, for whichever AI was chosen. They now belong to that AI. */
export function migrateAi(raw: Record<string, unknown>): Record<string, unknown> {
  const { aiApiKey, aiModel, ...rest } = raw;
  const engine = String(rest.aiEngine ?? 'claude');
  const cap = engine.charAt(0).toUpperCase() + engine.slice(1);
  if (typeof aiApiKey === 'string' && aiApiKey && ['Gemini', 'Anthropic', 'Openai'].includes(cap) && !rest[`aiKey${cap}`]) rest[`aiKey${cap}`] = aiApiKey;
  if (typeof aiModel === 'string' && aiModel && ['Gemini', 'Anthropic', 'Openai', 'Ollama'].includes(cap) && !rest[`aiModel${cap}`]) rest[`aiModel${cap}`] = aiModel;
  return rest;
}
