import type { Confidence, ConfidenceFactor, ContradictionType, Signals } from "../../shared/types.js";

export const WEIGHTS = {
  agreement: 0.3,
  evidence: 0.3,
  specificity: 0.2,
  relationConsistency: 0.1,
  questionAlignment: 0.1,
} as const;

const MAX_SCORE = 0.97;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const round = (x: number) => Math.round(x * 100) / 100;

/** Quotes we found verbatim pass untouched; paraphrases are discounted; fabrications go to 0. */
export function groundingGate(groundA: number, groundB: number): number {
  const g = Math.min(groundA, groundB);
  return g >= 0.95 ? 1 : clamp01((g - 0.5) / 0.45);
}

/** How strongly the measurable evidence supports the assigned type. */
function evidence(type: ContradictionType, s: Signals): { value: number; note: string } {
  const abs = s.absolutesA.length + s.absolutesB.length > 0;
  const t = s.time;
  if (type === "DIRECT") {
    if (s.polarityFlip && abs) return { value: 1, note: "Polarity flip and absolute language" };
    if (s.polarityFlip) return { value: 0.75, note: "Polarity flip (one side negated)" };
    if (abs) return { value: 0.75, note: "Absolute claim contradicted" };
    return { value: 0.4, note: "No surface marker of negation" };
  }
  if (type === "INFERENTIAL") {
    if (t && !t.withinTolerance) {
      const over = (t.gapMinutes! - t.toleranceMinutes) / t.toleranceMinutes;
      return { value: clamp01(0.5 + 0.5 * over), note: `Times ${t.gapMinutes} min apart (tolerance ${t.toleranceMinutes})` };
    }
    return { value: 0.5, note: "Conflict rests on inference we cannot measure. Neutral." };
  }
  // FALSE_POSITIVE
  if (t?.withinTolerance) {
    return { value: clamp01(1 - (t.gapMinutes! / t.toleranceMinutes) * 0.5), note: `Times only ${t.gapMinutes} min apart (tolerance ${t.toleranceMinutes})` };
  }
  if (s.polarityFlip) return { value: 0.3, note: "One side is negated, which argues against a benign reading" };
  return { value: 0.5, note: "No measurable conflict. Neutral." };
}

/**
 * Confidence that the assigned label is correct. Computed entirely from
 * signals we measure ourselves — the LLM is never asked for a score.
 */
export function scoreConfidence(type: ContradictionType, s: Signals, groundA: number, groundB: number, totalSamples: number): Confidence {
  const ev = evidence(type, s);
  const avgHedge = (s.hedgeA + s.hedgeB) / 2;
  const found = Math.round(s.sampleAgreement * totalSamples);
  const hedgeTerms = [...new Set([...s.hedgeTermsA, ...s.hedgeTermsB])];

  const factors: ConfidenceFactor[] = [
    {
      name: "Sample agreement",
      value: s.sampleAgreement,
      weight: WEIGHTS.agreement,
      note: `Surfaced in ${found} of ${totalSamples} independent samples`,
    },
    { name: "Evidence strength", value: ev.value, weight: WEIGHTS.evidence, note: ev.note },
    type === "FALSE_POSITIVE"
      ? {
          name: "Imprecision",
          value: Math.max(s.hedgeA, s.hedgeB),
          weight: WEIGHTS.specificity,
          note: hedgeTerms.length ? `Hedged: ${hedgeTerms.join(", ")}` : "No hedging. Statements are precise.",
        }
      : {
          name: "Specificity",
          value: 1 - avgHedge,
          weight: WEIGHTS.specificity,
          note: hedgeTerms.length ? `Hedges weaken it: ${hedgeTerms.join(", ")}` : "Both statements are unhedged",
        },
    {
      name: "Label agreement",
      value: s.relationAgreement,
      weight: WEIGHTS.relationConsistency,
      note: `${Math.round(s.relationAgreement * 100)}% of samples proposed the same relation`,
    },
    {
      name: "Same question",
      value: Math.sqrt(s.questionSimilarity),
      weight: WEIGHTS.questionAlignment,
      note: `Question overlap ${Math.round(s.questionSimilarity * 100)}%`,
    },
  ];

  const gate = groundingGate(groundA, groundB);
  const raw = factors.reduce((sum, f) => sum + f.value * f.weight, 0);
  const score = round(Math.min(MAX_SCORE, raw * gate));
  return {
    score,
    band: score >= 0.75 ? "HIGH" : score >= 0.5 ? "MEDIUM" : "LOW",
    factors: factors.map((f) => ({ ...f, value: round(f.value) })),
    groundingGate: round(gate),
  };
}
