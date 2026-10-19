// Types shared by the server pipeline and the React client.

export type ContradictionType = "DIRECT" | "INFERENTIAL" | "FALSE_POSITIVE";

/** One question/answer exchange in a transcript, with a stable ID the LLM must cite. */
export interface Turn {
  id: string; // e.g. "A3" = 3rd exchange of transcript A
  index: number;
  question: string;
  answer: string;
}

export interface Transcript {
  label: string; // "A" | "B"
  title: string;
  turns: Turn[];
}

/** A quote after we have located it in the source transcript ourselves. */
export interface GroundedQuote {
  turnId: string;
  text: string;
  /** 0..1 — how much of the quote we found verbatim in the cited answer. */
  grounding: number;
  /** Character offsets inside the turn's answer, when found. */
  start: number | null;
  end: number | null;
}

export interface ConfidenceFactor {
  name: string;
  /** 0..1 raw value of the signal. */
  value: number;
  /** Weight in the final score (0 for gates). */
  weight: number;
  note: string;
}

export interface Confidence {
  score: number; // 0..1, computed by our code — never taken from the LLM
  band: "HIGH" | "MEDIUM" | "LOW";
  factors: ConfidenceFactor[];
  /** Multiplier applied for unverifiable quotes (1 = no penalty). */
  groundingGate: number;
}

export interface TimeAnalysis {
  minutesA: [number, number] | null; // earliest/latest plausible reading
  minutesB: [number, number] | null;
  gapMinutes: number | null;
  toleranceMinutes: number;
  withinTolerance: boolean | null;
}

export interface Signals {
  hedgeA: number;
  hedgeB: number;
  hedgeTermsA: string[];
  hedgeTermsB: string[];
  absolutesA: string[];
  absolutesB: string[];
  negatedA: boolean;
  negatedB: boolean;
  polarityFlip: boolean;
  questionSimilarity: number;
  time: TimeAnalysis | null;
  /** Fraction of independent LLM samples that surfaced this candidate. */
  sampleAgreement: number;
  /** Fraction of those samples that proposed the same relation. */
  relationAgreement: number;
}

export interface Contradiction {
  id: string;
  type: ContradictionType;
  topic: string;
  dimension: string;
  quoteA: GroundedQuote;
  quoteB: GroundedQuote;
  explanation: string;
  /** Why our classifier picked this type (human-readable rule trace). */
  classificationReason: string;
  /** What the LLM proposed, kept for transparency. */
  llmRelation: string;
  signals: Signals;
  confidence: Confidence;
  verified: boolean;
}

export interface AnalysisResult {
  transcriptA: Transcript;
  transcriptB: Transcript;
  contradictions: Contradiction[];
  meta: {
    model: string;
    samples: number;
    demoMode: boolean;
    durationMs: number;
    droppedUnverified: number;
  };
}
