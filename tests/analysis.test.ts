import { describe, expect, it } from "vitest";
import { classify } from "../server/analysis/classify";
import { groundingGate, scoreConfidence } from "../server/analysis/confidence";
import { absolutes, hedgeScore, isNegated } from "../server/analysis/linguistic";
import { parseTranscript } from "../server/analysis/transcript";
import { CandidateSchema } from "../server/llm";
import { groundQuote } from "../server/pipeline";
import { SAMPLE_A } from "../server/samples";
import type { Signals } from "../shared/types";

const baseSignals = (over: Partial<Signals> = {}): Signals => ({
  hedgeA: 0, hedgeB: 0, hedgeTermsA: [], hedgeTermsB: [],
  absolutesA: [], absolutesB: [], negatedA: false, negatedB: false, polarityFlip: false,
  questionSimilarity: 1, time: null, sampleAgreement: 1, relationAgreement: 1,
  ...over,
});

describe("parseTranscript", () => {
  it("splits Q/A pairs into citable turns", () => {
    const t = parseTranscript(SAMPLE_A, "A");
    expect(t.turns).toHaveLength(6);
    expect(t.turns[2]).toMatchObject({ id: "A3", question: "What time did you go to sleep?" });
    expect(t.title).toMatch(/Marcus Webb/);
  });

  it("falls back to paragraphs when there are no Q/A markers", () => {
    expect(parseTranscript("First para.\n\nSecond para.", "B").turns.map((t) => t.id)).toEqual(["B1", "B2"]);
  });
});

describe("linguistic signals", () => {
  it("scores hedges, and only counts approximators before numbers", () => {
    expect(hedgeScore("I don't remember exactly").score).toBeGreaterThan(0.4);
    expect(hedgeScore("around 7pm").terms).toContain("approximately");
    expect(hedgeScore("We talked about him").score).toBe(0);
  });

  it("detects absolutes and negation", () => {
    expect(absolutes("I was at home all evening")).toContain("all evening");
    expect(isNegated("No, never.")).toBe(true);
    expect(isNegated("I don't think so")).toBe(true);
    expect(isNegated("I knew of him.")).toBe(false);
  });
});

describe("groundQuote", () => {
  const A = parseTranscript(SAMPLE_A, "A");
  it("verifies verbatim quotes and records offsets", () => {
    const g = groundQuote("I was at home all evening", "A1", A);
    expect(g).toMatchObject({ turnId: "A1", grounding: 1, start: 0 });
  });
  it("re-anchors a verbatim quote cited to the wrong turn, with a small penalty", () => {
    const g = groundQuote("I sold it in January", "A2", A);
    expect(g).toMatchObject({ turnId: "A5", grounding: 0.9 });
    expect(groundingGate(1, g.grounding)).toBeLessThan(1);
  });
  it("gives fabricated testimony near-zero grounding", () => {
    expect(groundQuote("I still drive the Civic every day", "A5", A).grounding).toBeLessThan(0.5);
  });
  it("does not accept the attorney's question as testimony", () => {
    const g = groundQuote("Do you own a grey Honda Civic?", "A5", A);
    expect(g.grounding).toBe(0.3);
    expect(groundingGate(1, g.grounding)).toBe(0); // dropped, not just discounted
  });
});

describe("classify", () => {
  it("requires a surface marker for DIRECT, otherwise downgrades to INFERENTIAL", () => {
    expect(classify("explicit_negation", "action", baseSignals({ polarityFlip: true })).type).toBe("DIRECT");
    expect(classify("explicit_negation", "action", baseSignals({ absolutesA: ["never"] })).type).toBe("DIRECT");
    const down = classify("explicit_negation", "action", baseSignals());
    expect(down.type).toBe("INFERENTIAL");
    expect(down.reason).toMatch(/Downgraded/);
  });

  it("overrides the model when measured times prove imprecision or conflict", () => {
    const within = baseSignals({ time: { minutesA: [480, 480], minutesB: [485, 485], gapMinutes: 5, toleranceMinutes: 30, withinTolerance: true } });
    expect(classify("incompatible_by_inference", "time", within).type).toBe("FALSE_POSITIVE");
    const far = baseSignals({ time: { minutesA: [600, 600], minutesB: [1440, 1440], gapMinutes: 840, toleranceMinutes: 15, withinTolerance: false } });
    expect(classify("imprecision_or_compatible", "time", far).type).toBe("INFERENTIAL");
  });

  it("only applies time rules to time claims", () => {
    const within = baseSignals({ polarityFlip: true, time: { minutesA: [480, 480], minutesB: [485, 485], gapMinutes: 5, toleranceMinutes: 30, withinTolerance: true } });
    expect(classify("explicit_negation", "presence", within).type).toBe("DIRECT");
  });
});

describe("confidence", () => {
  it("never accepts a confidence value from the model: the schema has no such field", () => {
    const keys = Object.keys(CandidateSchema.shape);
    expect(keys.some((k) => /confiden|score|severity|probab/i.test(k))).toBe(false);
  });

  it("is bounded, and drops with disagreement, hedging and weak grounding", () => {
    const strong = scoreConfidence("DIRECT", baseSignals({ polarityFlip: true, absolutesA: ["never"] }), 1, 1, 3);
    expect(strong.score).toBeLessThanOrEqual(0.97);
    expect(strong.band).toBe("HIGH");

    const weak = scoreConfidence("DIRECT", baseSignals({ polarityFlip: true, hedgeA: 0.6, hedgeB: 0.6, sampleAgreement: 1 / 3, relationAgreement: 0.5 }), 1, 1, 3);
    expect(weak.score).toBeLessThan(strong.score - 0.3);

    const paraphrased = scoreConfidence("DIRECT", baseSignals({ polarityFlip: true }), 1, 0.7, 3);
    expect(paraphrased.groundingGate).toBeLessThan(1);
    expect(paraphrased.score).toBeLessThan(scoreConfidence("DIRECT", baseSignals({ polarityFlip: true }), 1, 1, 3).score);
  });

  it("gates out quotes that are not in the record", () => {
    expect(groundingGate(1, 0.4)).toBe(0);
    expect(groundingGate(1, 1)).toBe(1);
  });

  it("weights sum to 1 so the score is a weighted average", () => {
    const c = scoreConfidence("INFERENTIAL", baseSignals(), 1, 1, 3);
    expect(c.factors.reduce((s, f) => s + f.weight, 0)).toBeCloseTo(1);
  });
});
