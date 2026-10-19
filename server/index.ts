import "dotenv/config";
import { createApp } from "./app.js";

const port = Number(process.env.PORT ?? 3001);
const model = process.env.CLAUDE_MODEL ?? "claude-opus-5-5";
const samples = Math.min(5, Math.max(1, Number(process.env.LLM_SAMPLES ?? 3)));
const demoMode = process.env.DEMO_MODE === "true" || !process.env.ANTHROPIC_API_KEY;

createApp({ model, samples, demoMode }).listen(port, () => {
  console.log(`Deposition Contradiction Detector → http://localhost:${port}`);
  console.log(demoMode ? "Demo mode: no ANTHROPIC_API_KEY set, using fixture output." : `Model: ${model}, samples: ${samples}`);
});
