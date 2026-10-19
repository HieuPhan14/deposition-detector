import express from "express";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { extractCandidates, LlmError } from "./llm.js";
import { analyze, type Extractor } from "./pipeline.js";
import { DEMO_SAMPLES, SAMPLE_A, SAMPLE_B } from "./samples.js";

const MAX_CHARS = 60_000;

const AnalyzeBody = z.object({
  transcriptA: z.string().trim().min(20, "Transcript A is empty").max(MAX_CHARS, "Transcript A is too long"),
  transcriptB: z.string().trim().min(20, "Transcript B is empty").max(MAX_CHARS, "Transcript B is too long"),
});

export interface AppConfig {
  model: string;
  samples: number;
  demoMode: boolean;
  /** Override the model call (tests). */
  extractor?: Extractor;
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim();

export function createApp(cfg: AppConfig) {
  const app = express();
  app.use(express.json({ limit: "512kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/config", (_req, res) => {
    res.json({ demoMode: cfg.demoMode, model: cfg.model, samples: cfg.samples, sampleA: SAMPLE_A, sampleB: SAMPLE_B });
  });

  app.post("/api/analyze", rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }), async (req, res) => {
    const body = AnalyzeBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.issues.map((i) => i.message).join("; ") });
      return;
    }
    const { transcriptA, transcriptB } = body.data;

    let extractor: Extractor;
    if (cfg.extractor) {
      extractor = cfg.extractor;
    } else if (cfg.demoMode) {
      if (squash(transcriptA) !== squash(SAMPLE_A) || squash(transcriptB) !== squash(SAMPLE_B)) {
        res.status(400).json({ error: "Demo mode can only analyse the sample transcripts. Set ANTHROPIC_API_KEY to analyse your own." });
        return;
      }
      extractor = async () => DEMO_SAMPLES;
    } else {
      extractor = (a, b) => extractCandidates(a, b, { model: cfg.model, samples: cfg.samples });
    }

    try {
      const result = await analyze(transcriptA, transcriptB, extractor, {
        model: cfg.demoMode ? `${cfg.model} (demo fixture)` : cfg.model,
        samples: cfg.samples,
        demoMode: cfg.demoMode,
      });
      res.json(result);
    } catch (err) {
      const status = err instanceof LlmError ? err.status : 500;
      const message = err instanceof LlmError ? err.message : "Unexpected server error.";
      console.error("[analyze]", err);
      res.status(status).json({ error: message });
    }
  });

  // Serve the built client in production.
  const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));

  return app;
}
