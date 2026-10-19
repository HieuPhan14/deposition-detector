import type { Transcript, Turn } from "../../shared/types.js";

const Q_LINE = /^\s*Q[:.]\s*(.*)$/i;
const A_LINE = /^\s*A[:.]\s*(.*)$/i;

/**
 * Split a raw deposition into question/answer turns.
 * Handles the common "Q: ... / A: ..." format, multi-line answers, and
 * free-text headers. If no Q/A markers exist, each paragraph becomes a turn
 * so pasted prose still gets stable, citable IDs.
 */
export function parseTranscript(raw: string, label: string): Transcript {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const turns: Turn[] = [];
  const headerLines: string[] = [];
  let current: { question: string; answer: string } | null = null;
  let mode: "q" | "a" | null = null;

  const flush = () => {
    if (current && (current.question || current.answer)) {
      const index = turns.length + 1;
      turns.push({
        id: `${label}${index}`,
        index,
        question: current.question.trim(),
        answer: current.answer.trim(),
      });
    }
    current = null;
    mode = null;
  };

  for (const line of lines) {
    const q = line.match(Q_LINE);
    const a = line.match(A_LINE);
    if (q) {
      flush();
      current = { question: q[1], answer: "" };
      mode = "q";
    } else if (a) {
      if (!current) current = { question: "", answer: "" };
      current.answer += (current.answer ? " " : "") + a[1];
      mode = "a";
    } else if (line.trim() === "") {
      continue;
    } else if (current && mode === "q") {
      current.question += " " + line.trim();
    } else if (current && mode === "a") {
      current.answer += " " + line.trim();
    } else {
      headerLines.push(line.trim());
    }
  }
  flush();

  if (turns.length === 0) {
    raw
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean)
      .forEach((p, i) => turns.push({ id: `${label}${i + 1}`, index: i + 1, question: "", answer: p }));
  }

  return { label, title: headerLines[0] ?? `Transcript ${label}`, turns };
}

/** Render turns with their IDs so the LLM can cite them precisely. */
export function renderForPrompt(t: Transcript): string {
  return t.turns
    .map((turn) => `[${turn.id}]\nQ: ${turn.question}\nA: ${turn.answer}`)
    .join("\n\n");
}
