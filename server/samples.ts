import type { Candidate } from "./llm.js";

// Two depositions from the same witness, 6 months apart.
export const SAMPLE_A = `Deposition of Marcus Webb — March 14, 2023

Q: Where were you on the evening of November 3rd?
A: I was at home all evening. I ordered pizza around 7pm and watched TV.

Q: Did you speak to anyone that night?
A: No, I was alone. My wife was visiting her sister in Portland.

Q: What time did you go to sleep?
A: Around 10, maybe 10:30. I had work the next morning.

Q: Have you ever been to the Hargrove Street warehouse?
A: No, never. I don't even know where that is.

Q: Do you own a grey Honda Civic?
A: I did at the time, yes. I sold it in January.

Q: Had you met Daniel Cho before November 3rd?
A: No. I'd never heard of him before this whole thing started.
`;

export const SAMPLE_B = `Deposition of Marcus Webb — September 9, 2023

Q: Walk me through the evening of November 3rd again.
A: I was home. I think I went out briefly to get some groceries, maybe around 7:30, but came right back.

Q: You mentioned last time you ordered pizza. Now you're saying groceries?
A: I might have done both. I don't remember exactly, it was almost a year ago.

Q: Did anyone see you that evening?
A: My neighbor, Tom, might have seen me. We waved or something in the parking lot.

Q: What time did you go to sleep?
A: It was late. Midnight maybe. I had trouble sleeping.

Q: Had you ever visited the Hargrove Street area?
A: I mean, I've driven through that part of town. I didn't say I'd never been in that general area.

Q: And Daniel Cho — did you know him?
A: I knew of him. We had mutual friends. I don't think I'd met him face to face.
`;

const c = (x: Candidate) => x;

const homeAllEvening = c({
  turn_a: "A1", turn_b: "B1",
  quote_a: "I was at home all evening",
  quote_b: "I went out briefly to get some groceries",
  topic: "Whereabouts on Nov 3 evening",
  dimension: "presence",
  relation: "explicit_negation",
  explanation: "In March he was home all evening; in September he left the house to buy groceries.",
  reconciliation: "A brief errand may not have registered as 'going out'.",
});
const pizzaTime = c({
  turn_a: "A1", turn_b: "B1",
  quote_a: "I ordered pizza around 7pm",
  quote_b: "maybe around 7:30",
  topic: "Time of evening activity",
  dimension: "time",
  relation: "imprecision_or_compatible",
  explanation: "Pizza around 7pm vs groceries around 7:30. The times are close and both are hedged.",
  reconciliation: "He could have ordered pizza and then run out for groceries.",
});
const alone = c({
  turn_a: "A2", turn_b: "B3",
  quote_a: "No, I was alone.",
  quote_b: "We waved or something in the parking lot.",
  topic: "Contact with others that night",
  dimension: "contact",
  relation: "explicit_negation",
  explanation: "He first said he spoke to no one and was alone; later he describes an interaction with a neighbor.",
  reconciliation: "A wave may not count as speaking to someone.",
});
const sleep = c({
  turn_a: "A3", turn_b: "B4",
  quote_a: "Around 10, maybe 10:30.",
  quote_b: "Midnight maybe.",
  topic: "Time went to sleep",
  dimension: "time",
  relation: "incompatible_by_inference",
  explanation: "Asleep by 10–10:30 cannot be squared with being up until around midnight.",
  reconciliation: "none",
});
const hargrove = c({
  turn_a: "A4", turn_b: "B5",
  quote_a: "No, never. I don't even know where that is.",
  quote_b: "I've driven through that part of town.",
  topic: "Familiarity with Hargrove Street",
  dimension: "location",
  relation: "explicit_negation",
  explanation: "He denied knowing where the warehouse is, then said he has driven through that area.",
  reconciliation: "The warehouse and the surrounding area are different places.",
});
const choKnew = c({
  turn_a: "A6", turn_b: "B6",
  quote_a: "I'd never heard of him before this whole thing started.",
  quote_b: "I knew of him. We had mutual friends.",
  topic: "Prior knowledge of Daniel Cho",
  dimension: "relationship",
  relation: "explicit_negation",
  explanation: "'Never heard of him' is directly contradicted by 'I knew of him' through mutual friends.",
  reconciliation: "none",
});
const choMet = c({
  turn_a: "A6", turn_b: "B6",
  quote_a: "No.",
  quote_b: "I don't think I'd met him face to face.",
  topic: "Having met Daniel Cho",
  dimension: "relationship",
  relation: "imprecision_or_compatible",
  explanation: "Both answers say he had not met Cho in person; the second is only more hedged.",
  reconciliation: "Both say they never met.",
});

/**
 * Representative model output used when no API key is configured, so the
 * app (and every deterministic stage) can be exercised offline. Samples vary
 * the way real samples do: a missed finding, a disagreeing label, a
 * mis-cited turn and one fabricated quote that verification must reject.
 */
export const DEMO_SAMPLES: Candidate[][] = [
  [homeAllEvening, pizzaTime, alone, sleep, hargrove, choKnew, choMet],
  [
    { ...homeAllEvening, turn_b: "B2" }, // mis-cited turn; grounding re-anchors it to B1
    pizzaTime,
    { ...alone, relation: "incompatible_by_inference" },
    sleep,
    hargrove,
    choKnew,
    choMet,
  ],
  [
    homeAllEvening,
    { ...pizzaTime, relation: "incompatible_by_inference" },
    alone,
    sleep,
    { ...hargrove, relation: "incompatible_by_inference" },
    choKnew,
    c({
      turn_a: "A5", turn_b: "B5",
      quote_a: "I sold it in January.",
      quote_b: "I still drive the Civic.",
      topic: "Ownership of the Honda Civic",
      dimension: "possession",
      relation: "explicit_negation",
      explanation: "Claims to have sold the car, later says he still drives it.",
      reconciliation: "none",
    }),
  ],
];
