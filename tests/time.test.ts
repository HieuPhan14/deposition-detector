import { describe, expect, it } from "vitest";
import { compareTimes, extractTimes } from "../server/analysis/time";

describe("extractTimes", () => {
  it("reads explicit and bare clock times", () => {
    expect(extractTimes("I ordered pizza around 7pm")).toEqual([[1140]]);
    expect(extractTimes("maybe 7:30")).toHaveLength(1);
    expect(extractTimes("Midnight maybe.")).toEqual([[1440]]);
  });

  it("ignores numbers that are not times", () => {
    expect(extractTimes("On November 3rd, 2023")).toEqual([]);
    expect(extractTimes("No one was there.")).toEqual([]);
    expect(extractTimes("I had 2 beers")).toEqual([]);
  });
});

describe("compareTimes", () => {
  it("treats 'around 8' vs '8:05' as within tolerance (the brief's false-positive example)", () => {
    const t = compareTimes("around 8 in the evening", "8:05 pm", true, false)!;
    expect(t.gapMinutes).toBe(5);
    expect(t.withinTolerance).toBe(true);
  });

  it("flags 10-10:30 vs midnight as beyond tolerance (the brief's inferential example)", () => {
    const t = compareTimes("Around 10, maybe 10:30.", "Midnight maybe.", true, true)!;
    expect(t.minutesA).toEqual([1320, 1350]);
    expect(t.gapMinutes).toBe(90);
    expect(t.toleranceMinutes).toBe(45);
    expect(t.withinTolerance).toBe(false);
  });

  it("resolves AM/PM ambiguity charitably rather than inventing a conflict", () => {
    // "7" could be 7am; we must pick 7pm to compare with 7:15pm.
    const t = compareTimes("at 7", "7:15pm", false, false)!;
    expect(t.gapMinutes).toBe(15);
    expect(t.withinTolerance).toBe(true);
  });

  it("widens tolerance only for hedged statements", () => {
    expect(compareTimes("at 8pm", "8:25pm", false, false)!.withinTolerance).toBe(false);
    expect(compareTimes("around 8pm", "8:25pm", true, false)!.withinTolerance).toBe(true);
  });

  it("returns null when either side has no time", () => {
    expect(compareTimes("I was home", "8pm", false, false)).toBeNull();
  });
});
