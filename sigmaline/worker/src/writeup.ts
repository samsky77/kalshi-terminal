/**
 * WRITEUP_PROVIDER switch (spec §9). `template` (default) is free and deterministic.
 * `llm` is a placeholder: wire a model here later, and it must receive ONLY the structured
 * `facts` object, with a system instruction never to add facts that aren't in it. Until then it
 * falls back to the template so nothing unverified is ever published.
 */
import { buildWriteup, type Writeup, type WriteupFacts } from '@sigmaline/core';

export const LLM_INSTRUCTION =
  'Rewrite these betting-pick facts as 2-4 short sentences in a friendly analyst voice. Use ONLY the facts in the JSON. ' +
  'Never add injuries, statistics, trends, names or numbers that are not present. If a fact is missing, leave it out.';

export async function writeup(facts: WriteupFacts, provider = process.env.WRITEUP_PROVIDER ?? 'template'): Promise<Writeup> {
  const t = buildWriteup(facts);
  if (provider !== 'llm') return t;
  // No LLM is configured in the MVP; keep the template output (never guess).
  return t;
}
