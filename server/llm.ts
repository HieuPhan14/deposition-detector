import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Transcript } from "../shared/types.js";
import { renderForPrompt } from "./analysis/transcript.js";

export const DIMENSIONS = ["time", "location", "presence", "contact", "relationship", "possession", "action", "other"] as const;
export const RELATIONS = ["explicit_negation", "incompatible_by_inference", "imprecision_or_compatible"] as const;

/**
 * What we accept from the model. Note what is NOT here: no confidence, no
 * severity, no final type. The model proposes candidates and evidence; our
 * own code verifies, classifies and scores them.
 */
export const CandidateSchema = z.object({
  turn_a: z.string().describe("ID of the turn in transcript A, e.g. A3"),
  turn_b: z.string().describe("ID of the turn in transcript B, e.g. B4"),
  quote_a: z.string().describe("Shortest VERBATIM excerpt from that turn's answer in A that carries the claim"),
  quote_b: z.string().describe("Shortest VERBATIM excerpt from that turn's answer in B that carries the claim"),
  topic: z.string().describe("2-6 word label, e.g. 'Time went to sleep'"),
  dimension: z.enum(DIMENSIONS),
  relation: z.enum(RELATIONS),
  explanation: z.string().describe("One or two sentences: why these statements conflict, or why they only appear to"),
  reconciliation: z.string().describe("The most plausible innocent way both statements could be true, or 'none'"),
});
export const CandidatesSchema = z.object({ candidates: z.array(CandidateSchema) });
export type Candidate = z.infer<typeof CandidateSchema>;

const SYSTEM = `You assist litigation attorneys by comparing two deposition transcripts given by the same witness at different times.

Your job is to surface CANDIDATE inconsistencies between transcript A and transcript B. Downstream software verifies your quotes, classifies each candidate and scores it, so favour recall: include borderline cases and label them honestly rather than omitting them.

For each candidate, choose a relation:
- explicit_negation: one statement asserts what the other expressly denies ("I was home all night" vs "I stepped out around 7").
- incompatible_by_inference: neither statement denies the other outright, but they cannot both be true given ordinary facts about the world ("I went to sleep at 10" vs "I was up until midnight").
- imprecision_or_compatible: they look different but are reconcilable as ordinary imprecision, added detail, or a narrower/broader framing ("around 8" vs "8:05").

Rules:
- Cite turns by the bracketed IDs. quote_a must come from a turn in A and quote_b from a turn in B.
- Quotes must be copied character-for-character from the witness's ANSWER, never from the question, and never paraphrased.
- A topic that appears in only one transcript is an omission, not a contradiction. Do not report it.
- One candidate per distinct pair of claims. If one answer conflicts with another in two separate ways, report two candidates.`;

export interface LlmConfig {
  model: string;
  samples: number;
}

export class LlmError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  client ??= new Anthropic({ maxRetries: 3, timeout: 120_000 });
  return client;
}

async function sampleOnce(a: Transcript, b: Transcript, model: string): Promise<Candidate[]> {
  const response = await getClient().beta.messages.parse({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium", format: zodOutputFormat(CandidatesSchema) },
    system: SYSTEM,
    messages: [
      {
        role: "user",
        content: `<transcript id="A" title="${a.title}">\n${renderForPrompt(a)}\n</transcript>\n\n<transcript id="B" title="${b.title}">\n${renderForPrompt(b)}\n</transcript>`,
      },
    ],
  });

  console.log(`[llm] ${response.model} in=${response.usage.input_tokens} out=${response.usage.output_tokens} stop=${response.stop_reason}`);
  if (response.stop_reason === "refusal") throw new LlmError("The model declined to analyse these transcripts.", 422);
  if (response.stop_reason === "max_tokens") throw new LlmError("Model output was truncated; try shorter transcripts.", 502);
  if (!response.parsed_output) throw new LlmError("Model returned output that did not match the expected schema.", 502);
  return response.parsed_output.candidates;
}

/**
 * Run several independent samples in parallel. How often a candidate recurs
 * across samples becomes one of OUR confidence signals (self-consistency).
 * Individual sample failures are tolerated as long as one succeeds.
 */
export async function extractCandidates(a: Transcript, b: Transcript, cfg: LlmConfig): Promise<Candidate[][]> {
  const settled = await Promise.allSettled(Array.from({ length: cfg.samples }, () => sampleOnce(a, b, cfg.model)));
  const ok = settled.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
  if (ok.length > 0) return ok;

  const err = (settled[0] as PromiseRejectedResult).reason;
  if (err instanceof LlmError) throw err;
  if (err instanceof Anthropic.AuthenticationError) throw new LlmError("Invalid Anthropic API key.", 500);
  if (err instanceof Anthropic.RateLimitError) throw new LlmError("Rate limited by the Anthropic API. Try again shortly.", 429);
  if (err instanceof Anthropic.APIConnectionError) throw new LlmError("Could not reach the Anthropic API.", 503);
  if (err instanceof Anthropic.APIError) throw new LlmError(`Anthropic API error: ${err.message}`, 502);
  throw new LlmError(`Analysis failed: ${(err as Error)?.message ?? String(err)}`, 500);
}
