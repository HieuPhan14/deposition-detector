import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../server/app";
import { LlmError } from "../server/llm";
import { analyze } from "../server/pipeline";
import { DEMO_SAMPLES, SAMPLE_A, SAMPLE_B } from "../server/samples";

const meta = { model: "test", samples: 3, demoMode: true };

describe("pipeline on the Marcus Webb depositions", async () => {
  const result = await analyze(SAMPLE_A, SAMPLE_B, async () => DEMO_SAMPLES, meta);
  const byTopic = Object.fromEntries(result.contradictions.map((c) => [c.topic, c]));

  it("separates direct, inferential and false-positive findings", () => {
    expect(byTopic["Whereabouts on Nov 3 evening"].type).toBe("DIRECT");
    expect(byTopic["Prior knowledge of Daniel Cho"].type).toBe("DIRECT");
    expect(byTopic["Time went to sleep"].type).toBe("INFERENTIAL");
    expect(byTopic["Time of evening activity"].type).toBe("FALSE_POSITIVE");
    expect(byTopic["Having met Daniel Cho"].type).toBe("FALSE_POSITIVE");
  });

  it("merges a mis-cited sample with the others instead of duplicating it", () => {
    expect(result.contradictions.filter((c) => c.topic === "Whereabouts on Nov 3 evening")).toHaveLength(1);
    expect(byTopic["Whereabouts on Nov 3 evening"].signals.sampleAgreement).toBe(1);
  });

  it("merges samples that cite neighbouring answers for the same claim (seen in a real run)", async () => {
    const pizza = { turn_a: "A1", quote_a: "I ordered pizza around 7pm and watched TV.", dimension: "action" as const, relation: "imprecision_or_compatible" as const, explanation: "", reconciliation: "" };
    const viaB1 = { ...pizza, turn_b: "B1", quote_b: "I think I went out briefly to get some groceries, maybe around 7:30", topic: "Pizza versus grocery trip" };
    const viaB2 = { ...pizza, turn_b: "B2", quote_b: "I might have done both.", topic: "Pizza versus groceries" };
    const r = await analyze(SAMPLE_A, SAMPLE_B, async () => [[viaB1], [viaB2], [viaB2]], meta);
    expect(r.contradictions).toHaveLength(1);
    expect(r.contradictions[0].signals.sampleAgreement).toBe(1);
  });

  it("discards a candidate whose quote is not in the record", () => {
    expect(result.meta.droppedUnverified).toBe(1);
    expect(result.contradictions.some((c) => c.topic.includes("Civic"))).toBe(false);
  });

  it("sorts contradictions before false positives", () => {
    const types = result.contradictions.map((c) => c.type);
    expect(types.lastIndexOf("DIRECT")).toBeLessThan(types.indexOf("FALSE_POSITIVE"));
  });

  it("scores lower when fewer samples agree", async () => {
    const oneSample = await analyze(SAMPLE_A, SAMPLE_B, async () => [DEMO_SAMPLES[0], [], []], meta);
    const sleep = oneSample.contradictions.find((c) => c.topic === "Time went to sleep")!;
    expect(sleep.confidence.score).toBeLessThan(byTopic["Time went to sleep"].confidence.score);
  });
});

describe("API", () => {
  const app = createApp({ model: "test", samples: 3, demoMode: true });

  it("validates input", async () => {
    const res = await request(app).post("/api/analyze").send({ transcriptA: "", transcriptB: "x" });
    expect(res.status).toBe(400);
  });

  it("in demo mode, analyses the samples and refuses other transcripts", async () => {
    const ok = await request(app).post("/api/analyze").send({ transcriptA: SAMPLE_A, transcriptB: SAMPLE_B });
    expect(ok.status).toBe(200);
    expect(ok.body.contradictions.length).toBeGreaterThan(0);
    const no = await request(app).post("/api/analyze").send({ transcriptA: SAMPLE_A + " Q: x? A: y.", transcriptB: SAMPLE_B });
    expect(no.status).toBe(400);
  });

  it("surfaces model errors with a clear message and status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // the server logs the simulated failure
    const failing = createApp({
      model: "test", samples: 3, demoMode: false,
      extractor: async () => {
        throw new LlmError("Rate limited by the Anthropic API. Try again shortly.", 429);
      },
    });
    const res = await request(failing).post("/api/analyze").send({ transcriptA: SAMPLE_A, transcriptB: SAMPLE_B });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Rate limited/);
  });
});
