const STOPWORDS = new Set(
  ("a an the and or but if of to in on at by for with from as is was were be been being " +
    "i you he she it we they me him her them my your his its our their this that these those " +
    "do did does done have had has q a so then there what when where who how why about " +
    "just like um uh yes no").split(" "),
);

/** Lowercase, unify curly quotes/dashes. Same length as input so offsets stay valid. */
export function normalizeChars(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-");
}

export function tokens(s: string): string[] {
  return normalizeChars(s).match(/[a-z0-9']+/g) ?? [];
}

export function contentWords(s: string): Set<string> {
  return new Set(tokens(s).filter((t) => !STOPWORDS.has(t) && t.length > 1));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Find an LLM-supplied quote in the source text.
 * Exact (case/punctuation-insensitive) match → grounding 1 with offsets.
 * Otherwise → fraction of the quote's tokens present in the source, scaled
 * below 1 because a paraphrase is weaker evidence than verbatim testimony.
 */
export function locateQuote(quote: string, source: string): { grounding: number; start: number | null; end: number | null } {
  const q = normalizeChars(quote).replace(/\s+/g, " ").trim().replace(/^["'.\s]+|["'.\s]+$/g, "");
  if (!q) return { grounding: 0, start: null, end: null };
  const src = normalizeChars(source);
  const idx = src.indexOf(q);
  if (idx >= 0) return { grounding: 1, start: idx, end: idx + q.length };

  const qt = tokens(q);
  if (qt.length === 0) return { grounding: 0, start: null, end: null };
  const pool = new Map<string, number>();
  for (const t of tokens(source)) pool.set(t, (pool.get(t) ?? 0) + 1);
  let hit = 0;
  for (const t of qt) {
    const n = pool.get(t) ?? 0;
    if (n > 0) {
      hit++;
      pool.set(t, n - 1);
    }
  }
  return { grounding: (hit / qt.length) * 0.85, start: null, end: null };
}

/** Escape a phrase for use inside a RegExp with word boundaries. */
export function phraseRegex(phrase: string): RegExp {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![a-z'])${esc}(?![a-z'])`, "i");
}
