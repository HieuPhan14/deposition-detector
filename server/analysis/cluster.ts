import type { Candidate } from "../llm.js";
import { contentWords, jaccard } from "./text.js";

export interface Cluster {
  members: Candidate[];
  samples: Set<number>;
}

const MIN_SIMILARITY = 0.3;
/** Samples sometimes cite a neighbouring answer for the same claim; demand more overlap then. */
const MIN_SIMILARITY_ONE_TURN = 0.4;

const norm = (id: string) => id.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const words = (c: Candidate) => contentWords(`${c.quote_a} ${c.quote_b} ${c.topic}`);

/**
 * Group the same finding across independent samples. Two candidates match
 * when they share at least one cited turn AND talk about the same thing
 * (word overlap of quotes + topic; a stricter bar when only one turn is
 * shared), so two distinct conflicts inside one pair of answers stay
 * separate. A cluster takes at most one member per sample.
 */
export function clusterCandidates(samples: Candidate[][]): Cluster[] {
  const clusters: Cluster[] = [];
  samples.forEach((cands, sampleIdx) => {
    for (const c of cands) {
      const cw = words(c);
      let best: { cl: Cluster; sim: number } | null = null;
      for (const cl of clusters) {
        if (cl.samples.has(sampleIdx)) continue;
        const head = cl.members[0];
        const sameA = norm(head.turn_a) === norm(c.turn_a);
        const sameB = norm(head.turn_b) === norm(c.turn_b);
        if (!sameA && !sameB) continue;
        const need = sameA && sameB ? MIN_SIMILARITY : MIN_SIMILARITY_ONE_TURN;
        const sim = Math.max(...cl.members.map((m) => jaccard(words(m), cw)));
        if (sim >= need && (!best || sim > best.sim)) best = { cl, sim };
      }
      if (best) {
        best.cl.members.push(c);
        best.cl.samples.add(sampleIdx);
      } else {
        clusters.push({ members: [c], samples: new Set([sampleIdx]) });
      }
    }
  });
  return clusters;
}

/** Most common relation among members and the share of members that chose it. */
export function majorityRelation(cl: Cluster): { relation: Candidate["relation"]; share: number } {
  const counts = new Map<Candidate["relation"], number>();
  for (const m of cl.members) counts.set(m.relation, (counts.get(m.relation) ?? 0) + 1);
  // Ties break toward the more conservative relation (benign before contradiction).
  const order: Candidate["relation"][] = ["imprecision_or_compatible", "incompatible_by_inference", "explicit_negation"];
  let best = order[0];
  let bestN = -1;
  for (const r of order) {
    const n = counts.get(r) ?? 0;
    if (n > bestN) {
      best = r;
      bestN = n;
    }
  }
  return { relation: best, share: bestN / cl.members.length };
}
