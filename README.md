# Deposition Contradiction Detector

Compares two depositions from the same witness and classifies each inconsistency as **direct**, **inferential** or **false positive**, with a confidence score computed by deterministic code, not taken from the LLM.

## Run it

```bash
git clone https://github.com/HieuPhan14/deposition-detector.git
cd deposition-detector
docker compose up --build
```

Then open http://localhost:3001.

To use Claude, first create a file named `.env` in the project folder containing your key (see `.env.example`):

```
ANTHROPIC_API_KEY=your-key-here
```

On macOS/Linux you can instead pass the key inline: `ANTHROPIC_API_KEY=your-key-here docker compose up --build`.

Without Docker (Node 20+): `npm install && npm start`. This reads the same `.env` file.

With no key, the app starts in **demo mode**. It runs the full verification, classification and scoring pipeline on the sample transcripts, using fixture LLM output.

Tests: `npm test`

## How it works

```
transcripts ──► parse into cited turns (A1…, B1…)
            ──► Claude × 3 independent samples → candidate pairs + verbatim quotes
                (schema has no confidence/severity/type field)
            ──► verify every quote against the record; re-anchor mis-citations; drop fabrications
            ──► merge samples (same turns + same subject)
            ──► measure signals: hedging, absolutes, negation flip, clock-time gap vs tolerance,
                question overlap, cross-sample agreement
            ──► rule-based classifier  → DIRECT / INFERENTIAL / FALSE_POSITIVE (+ reason)
            ──► weighted confidence × grounding gate (each factor shown in the UI)
```

| Path | Responsibility |
| --- | --- |
| `server/llm.ts` | Prompt, Zod output schema, parallel sampling, typed API errors |
| `server/pipeline.ts` | Orchestration, quote grounding |
| `server/analysis/classify.ts` | Type decision rules |
| `server/analysis/confidence.ts` | Confidence formula |
| `server/analysis/time.ts` | Clock-time extraction and hedge-aware tolerance |
| `server/analysis/linguistic.ts` | Hedge / absolute / negation lexicons |
| `src/App.tsx` | UI |
