import { normalizeChars, phraseRegex } from "./text.js";

/**
 * Hedge lexicon. Weight = how much the phrase signals imprecision.
 * Memory disclaimers weigh most; approximators ("around 7") least.
 */
const HEDGES: Array<[RegExp, string, number]> = [
  ...[
    "i don't remember",
    "i don't recall",
    "i can't remember",
    "i can't recall",
    "i'm not sure",
    "not exactly",
    "i don't know exactly",
  ].map((p) => [phraseRegex(p), p, 0.5] as [RegExp, string, number]),
  ...["maybe", "might", "i think", "i believe", "probably", "i guess", "i don't think", "perhaps", "or something"].map(
    (p) => [phraseRegex(p), p, 0.35] as [RegExp, string, number],
  ),
  // Approximators only count before a number or time word, so "talk about him" isn't a hedge.
  [/\b(around|about|approximately|roughly)\s+(?=\d|noon|midnight|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)/i, "approximately", 0.25],
  [/\b(or so|-ish|ish)\b/i, "or so", 0.25],
  [phraseRegex("sort of"), "sort of", 0.25],
  [phraseRegex("kind of"), "kind of", 0.25],
];

const ABSOLUTES = [
  "never",
  "not once",
  "at no point",
  "at all",
  "all evening",
  "all night",
  "all day",
  "the whole",
  "entire",
  "nobody",
  "no one",
  "nothing",
  "alone",
  "always",
  "every",
  "definitely",
  "absolutely",
  "certain",
];

const NEGATION = /(?<![a-z'])(no|not|never|nobody|none|nothing|neither|nor|no one)(?![a-z'])|n't\b/i;

export function hedgeScore(text: string): { score: number; terms: string[] } {
  const terms: string[] = [];
  let keep = 1;
  for (const [re, label, w] of HEDGES) {
    if (re.test(text)) {
      terms.push(label);
      keep *= 1 - w; // independent-evidence combination: 1 - Π(1 - w)
    }
  }
  return { score: 1 - keep, terms };
}

export function absolutes(text: string): string[] {
  return ABSOLUTES.filter((p) => phraseRegex(p).test(text));
}

export function isNegated(text: string): boolean {
  return NEGATION.test(normalizeChars(text));
}
