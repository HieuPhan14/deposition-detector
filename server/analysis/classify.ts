import type { ContradictionType, Signals } from "../../shared/types.js";
import type { Candidate } from "../llm.js";
import { formatMinutes } from "./time.js";

export interface Classification {
  type: ContradictionType;
  reason: string;
}

/** Times this far beyond tolerance override a model's "just imprecision" call. */
export const TIME_OVERRIDE_FACTOR = 2;

const describeRange = (r: [number, number]) =>
  r[0] === r[1] ? formatMinutes(r[0]) : `${formatMinutes(r[0])}–${formatMinutes(r[1])}`;

/**
 * Decide the type from the model's proposed relation plus OUR measured
 * signals. Rules run in priority order; measured evidence beats the
 * model's opinion, and each rule records why it fired.
 */
export function classify(relation: Candidate["relation"], dimension: string, s: Signals): Classification {
  const t = s.time;
  const timeDesc = t
    ? `A says ${describeRange(t.minutesA!)}, B says ${describeRange(t.minutesB!)}: a ${t.gapMinutes}-minute gap against a ${t.toleranceMinutes}-minute tolerance`
    : "";

  // 1. Time claims we can measure: within tolerance is ordinary imprecision.
  if (dimension === "time" && t?.withinTolerance) {
    return { type: "FALSE_POSITIVE", reason: `${timeDesc}. Within tolerance, so this is imprecise recall, not a changed story.` };
  }

  // 2. Measured time conflict: two different times for one event cannot both hold.
  if (dimension === "time" && t && !t.withinTolerance) {
    if (relation === "imprecision_or_compatible" && t.gapMinutes! <= t.toleranceMinutes * TIME_OVERRIDE_FACTOR) {
      return { type: "FALSE_POSITIVE", reason: `${timeDesc}. Slightly outside tolerance, but the model judged it reconcilable and the gap is under ${TIME_OVERRIDE_FACTOR}× tolerance.` };
    }
    const override = relation === "imprecision_or_compatible" ? " The model called this imprecision; the measured gap overrides it." : "";
    return { type: "INFERENTIAL", reason: `${timeDesc}. Neither answer denies the other, but both cannot be true.${override}` };
  }

  // 3. The model judged it reconcilable and we have no measurement saying otherwise.
  if (relation === "imprecision_or_compatible") {
    return { type: "FALSE_POSITIVE", reason: "Reconcilable as added detail or loose phrasing. No negation or measurable conflict found." };
  }

  // 4. Direct contradictions must show it on the surface of the text.
  if (relation === "explicit_negation") {
    const abs = [...s.absolutesA, ...s.absolutesB];
    if (s.polarityFlip || abs.length > 0) {
      const why = [
        s.polarityFlip ? "one statement is negated and the other is not" : null,
        abs.length ? `absolute language (${[...new Set(abs)].map((x) => `"${x}"`).join(", ")}) leaves no room for an exception` : null,
      ].filter(Boolean);
      return { type: "DIRECT", reason: `Explicit conflict: ${why.join("; ")}.` };
    }
    return {
      type: "INFERENTIAL",
      reason: "The model proposed an explicit negation, but neither statement is negated or absolute. Downgraded to inferential.",
    };
  }

  return { type: "INFERENTIAL", reason: "Each statement stands on its own, but together they are incompatible." };
}
