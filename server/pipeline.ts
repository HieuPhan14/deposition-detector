import type { AnalysisResult, Contradiction, ContradictionType, GroundedQuote, Signals, Transcript, Turn } from "../shared/types.js";
import { classify } from "./analysis/classify.js";
import { clusterCandidates, majorityRelation, type Cluster } from "./analysis/cluster.js";
import { groundingGate, scoreConfidence } from "./analysis/confidence.js";
import { absolutes, hedgeScore, isNegated } from "./analysis/linguistic.js";
import { contentWords, jaccard, locateQuote, normalizeChars } from "./analysis/text.js";
import { compareTimes, extractTimes } from "./analysis/time.js";
import { parseTranscript } from "./analysis/transcript.js";
import type { Candidate } from "./llm.js";

export type Extractor = (a: Transcript, b: Transcript) => Promise<Candidate[][]>;

/** Quotes from the attorney's question are not testimony. */
const QUESTION_ONLY_GROUNDING = 0.3;
/** Verbatim, but the model cited the wrong turn. */
const MISCITED_GROUNDING = 0.95;

/**
 * Verify a quote against the transcript ourselves. If the model cited the
 * wrong turn but the quote exists verbatim elsewhere, re-anchor it.
 */
export function groundQuote(quote: string, citedId: string, t: Transcript): GroundedQuote {
  const id = citedId.trim().toUpperCase();
  const cited = t.turns.find((x) => x.id.toUpperCase() === id);
  if (cited) {
    const hit = locateQuote(quote, cited.answer);
    if (hit.grounding === 1) return { turnId: cited.id, text: quote, ...hit };
  }
  for (const turn of t.turns) {
    const hit = locateQuote(quote, turn.answer);
    if (hit.grounding === 1) return { turnId: turn.id, text: quote, ...hit, grounding: MISCITED_GROUNDING };
  }
  const q = normalizeChars(quote).trim();
  if (q && t.turns.some((turn) => normalizeChars(turn.question).includes(q))) {
    return { turnId: cited?.id ?? t.turns[0]?.id ?? id, text: quote, grounding: QUESTION_ONLY_GROUNDING, start: null, end: null };
  }
  // Best fuzzy match across the transcript.
  let best: GroundedQuote = { turnId: cited?.id ?? id, text: quote, grounding: 0, start: null, end: null };
  for (const turn of t.turns) {
    const hit = locateQuote(quote, turn.answer);
    if (hit.grounding > best.grounding) best = { turnId: turn.id, text: quote, ...hit };
  }
  return best;
}

function buildSignals(rep: Candidate, cl: Cluster, turnA: Turn | undefined, turnB: Turn | undefined, totalSamples: number): Signals {
  // Hedging is judged over the whole answer (the witness's overall certainty);
  // negation and absolutes over the quote (the specific claim).
  const ha = hedgeScore(turnA?.answer ?? rep.quote_a);
  const hb = hedgeScore(turnB?.answer ?? rep.quote_b);
  const negA = isNegated(rep.quote_a);
  const negB = isNegated(rep.quote_b);
  const timeSrcA = extractTimes(rep.quote_a).length ? rep.quote_a : (turnA?.answer ?? "");
  const timeSrcB = extractTimes(rep.quote_b).length ? rep.quote_b : (turnB?.answer ?? "");
  return {
    hedgeA: ha.score,
    hedgeB: hb.score,
    hedgeTermsA: ha.terms,
    hedgeTermsB: hb.terms,
    absolutesA: absolutes(rep.quote_a),
    absolutesB: absolutes(rep.quote_b),
    negatedA: negA,
    negatedB: negB,
    polarityFlip: negA !== negB,
    questionSimilarity: jaccard(contentWords(turnA?.question ?? ""), contentWords(turnB?.question ?? "")),
    time: compareTimes(timeSrcA, timeSrcB, ha.score > 0, hb.score > 0),
    sampleAgreement: cl.samples.size / totalSamples,
    relationAgreement: majorityRelation(cl).share,
  };
}

const TYPE_ORDER: Record<ContradictionType, number> = { DIRECT: 0, INFERENTIAL: 1, FALSE_POSITIVE: 2 };

export async function analyze(
  rawA: string,
  rawB: string,
  extract: Extractor,
  meta: { model: string; samples: number; demoMode: boolean },
): Promise<AnalysisResult> {
  const started = Date.now();
  const A = parseTranscript(rawA, "A");
  const B = parseTranscript(rawB, "B");
  const samples = await extract(A, B);
  const total = samples.length;

  // Verify quotes BEFORE clustering, so a mis-cited turn is re-anchored and
  // still merges with the samples that cited it correctly.
  const grounding = new WeakMap<Candidate, { qa: GroundedQuote; qb: GroundedQuote }>();
  const anchored = samples.map((cands) =>
    cands.map((m) => {
      const qa = groundQuote(m.quote_a, m.turn_a, A);
      const qb = groundQuote(m.quote_b, m.turn_b, B);
      const fixed = { ...m, turn_a: qa.turnId, turn_b: qb.turnId };
      grounding.set(fixed, { qa, qb });
      return fixed;
    }),
  );

  let dropped = 0;
  const contradictions: Contradiction[] = [];

  for (const cl of clusterCandidates(anchored)) {
    const { relation } = majorityRelation(cl);
    // Representative: the best-grounded member among those that chose the majority relation.
    const scored = cl.members
      .filter((m) => m.relation === relation)
      .map((m) => {
        const { qa, qb } = grounding.get(m)!;
        return { m, qa, qb, g: Math.min(qa.grounding, qb.grounding) };
      })
      .sort((x, y) => y.g - x.g);
    const { m: rep, qa, qb } = scored[0];

    const gate = groundingGate(qa.grounding, qb.grounding);
    if (gate === 0) {
      dropped++; // Neither quote exists in the record — never show fabricated testimony.
      continue;
    }

    const turnA = A.turns.find((t) => t.id === qa.turnId);
    const turnB = B.turns.find((t) => t.id === qb.turnId);
    const signals = buildSignals(rep, cl, turnA, turnB, total);
    const { type, reason } = classify(relation, rep.dimension, signals);
    const confidence = scoreConfidence(type, signals, qa.grounding, qb.grounding, total);

    contradictions.push({
      id: `${qa.turnId}-${qb.turnId}-${contradictions.length}`,
      type,
      topic: rep.topic,
      dimension: rep.dimension,
      quoteA: qa,
      quoteB: qb,
      explanation: rep.explanation,
      classificationReason: reason,
      llmRelation: relation,
      signals,
      confidence,
      verified: gate === 1,
    });
  }

  contradictions.sort((x, y) => TYPE_ORDER[x.type] - TYPE_ORDER[y.type] || y.confidence.score - x.confidence.score);

  return {
    transcriptA: A,
    transcriptB: B,
    contradictions,
    meta: { ...meta, samples: total, durationMs: Date.now() - started, droppedUnverified: dropped },
  };
}
