import type { TimeAnalysis } from "../../shared/types.js";
import { normalizeChars } from "./text.js";

/** Each mention is the set of clock readings (minutes after midnight) it could mean. */
type Mention = number[];

const WORD_HOURS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

const TIME_CONTEXT = /\b(am|pm|a\.m\.|p\.m\.|o'clock|noon|midnight|sleep|slept|bed|night|evening|morning|afternoon|clock|time|late|early)\b/;
const CUE_BEFORE = /\b(at|around|about|by|until|till|til|maybe|or|approximately|roughly|before|after|past)\s*$/;

export const BASE_TOLERANCE_MIN = 15;
export const HEDGE_TOLERANCE_MIN = 15;

/** Extract every clock-time mention in a piece of testimony. */
export function extractTimes(raw: string): Mention[] {
  const text = normalizeChars(raw);
  const mentions: Mention[] = [];
  const hasContext = TIME_CONTEXT.test(text);

  if (/\bnoon\b/.test(text)) mentions.push([720]);
  if (/\bmidnight\b/.test(text)) mentions.push([1440]);

  const re = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?|o'clock)?(?![\d:]|st\b|nd\b|rd\b|th\b)/g;
  for (const m of text.matchAll(re)) {
    const hourRaw = m[1];
    const hour = WORD_HOURS[hourRaw] ?? Number(hourRaw);
    const minute = m[2] ? Number(m[2]) : 0;
    const suffix = m[3]?.replace(/\./g, "");
    const before = text.slice(0, m.index);
    const explicit = Boolean(m[2] || suffix);
    // A bare number is only a time if the sentence is about time.
    // Spelled-out hours ("one", "ten") need a direct cue, or "no one" would read as 1 o'clock.
    const isWord = hourRaw in WORD_HOURS;
    if (!explicit && !(isWord ? CUE_BEFORE.test(before) : hasContext || CUE_BEFORE.test(before))) continue;
    if (minute > 59 || hour > 23) continue;

    if (suffix === "am") mentions.push([(hour % 12) * 60 + minute]);
    else if (suffix === "pm") mentions.push([((hour % 12) + 12) * 60 + minute]);
    else if (hour > 12 || hour === 0) mentions.push([hour * 60 + minute]);
    else mentions.push([(hour % 12) * 60 + minute, ((hour % 12) + 12) * 60 + minute]);
  }
  // Early-morning readings may continue the previous evening (1am ≈ 25:00).
  return mentions.map((opts) => [...new Set(opts.flatMap((v) => (v < 360 ? [v, v + 1440] : [v])))]);
}

/** All internally consistent ranges a list of mentions could describe. */
function readings(mentions: Mention[]): Array<[number, number]> {
  let combos: number[][] = [[]];
  for (const opts of mentions) combos = combos.flatMap((c) => opts.map((o) => [...c, o]));
  return combos.map((c) => [Math.min(...c), Math.max(...c)] as [number, number]);
}

function intervalGap(a: [number, number], b: [number, number]): number {
  return Math.max(0, Math.max(a[0], b[0]) - Math.min(a[1], b[1]));
}

/**
 * Compare the times in two statements. Ambiguous readings (AM/PM) are
 * resolved charitably: we pick the pairing with the SMALLEST gap, so the
 * system never manufactures a contradiction out of an ambiguity.
 */
export function compareTimes(textA: string, textB: string, hedgedA: boolean, hedgedB: boolean): TimeAnalysis | null {
  const ma = extractTimes(textA);
  const mb = extractTimes(textB);
  if (ma.length === 0 || mb.length === 0) return null;

  let best: { gap: number; a: [number, number]; b: [number, number]; width: number } | null = null;
  for (const a of readings(ma))
    for (const b of readings(mb)) {
      const gap = intervalGap(a, b);
      // Ties go to the tightest reading, so "10, maybe 10:30" stays 10–10:30pm, not 10am–10:30pm.
      const width = a[1] - a[0] + (b[1] - b[0]);
      if (!best || gap < best.gap || (gap === best.gap && width < best.width)) best = { gap, a, b, width };
    }

  const tolerance = BASE_TOLERANCE_MIN + (hedgedA ? HEDGE_TOLERANCE_MIN : 0) + (hedgedB ? HEDGE_TOLERANCE_MIN : 0);
  return {
    minutesA: best!.a,
    minutesB: best!.b,
    gapMinutes: best!.gap,
    toleranceMinutes: tolerance,
    withinTolerance: best!.gap <= tolerance,
  };
}

export function formatMinutes(m: number): string {
  const mm = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  const suffix = h >= 12 ? "pm" : "am";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(min).padStart(2, "0")}${suffix}`;
}
