import { useEffect, useMemo, useState } from "react";
import type { AnalysisResult, Contradiction, ContradictionType, Transcript } from "../shared/types";

interface Config {
  demoMode: boolean;
  model: string;
  samples: number;
  sampleA: string;
  sampleB: string;
}

const TYPE_META: Record<ContradictionType, { label: string; blurb: string }> = {
  DIRECT: { label: "Direct", blurb: "One statement expressly denies the other." },
  INFERENTIAL: { label: "Inferential", blurb: "Each is plausible alone; both cannot be true." },
  FALSE_POSITIVE: { label: "False positive", blurb: "Looks different, but it's ordinary imprecision." },
};
const TYPES: ContradictionType[] = ["DIRECT", "INFERENTIAL", "FALSE_POSITIVE"];

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [filter, setFilter] = useState<Set<ContradictionType>>(new Set(TYPES));
  const [focus, setFocus] = useState<Contradiction | null>(null);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((c: Config) => {
        setConfig(c);
        setTextA(c.sampleA);
        setTextB(c.sampleB);
      })
      .catch(() => setError("Could not reach the server."));
  }, []);

  async function analyze() {
    setLoading(true);
    setError(null);
    setFocus(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcriptA: textA, transcriptB: textB }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Request failed (${res.status})`);
      setResult(body as AnalysisResult);
    } catch (e) {
      setResult(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const counts = useMemo(() => {
    const c = { DIRECT: 0, INFERENTIAL: 0, FALSE_POSITIVE: 0 } as Record<ContradictionType, number>;
    result?.contradictions.forEach((x) => c[x.type]++);
    return c;
  }, [result]);

  const visible = result?.contradictions.filter((c) => filter.has(c.type)) ?? [];
  const toggle = (t: ContradictionType) =>
    setFilter((f) => {
      const n = new Set(f);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Deposition Contradiction Detector</h1>
          <p className="sub">Compare two depositions from the same witness. Every flag shows its classification and how its confidence was calculated.</p>
        </div>
        {config && (
          <span className={`mode ${config.demoMode ? "demo" : ""}`}>
            {config.demoMode ? "Demo mode: fixture output" : `${config.model} · ${config.samples} samples`}
          </span>
        )}
      </header>

      <section className="legend" aria-label="Contradiction types">
        {TYPES.map((t) => (
          <div key={t} className="legend-item">
            <span className={`chip chip-${t}`}>{TYPE_META[t].label}</span>
            <span>{TYPE_META[t].blurb}</span>
          </div>
        ))}
      </section>

      <section className="transcripts">
        <TranscriptPane
          label="Transcript A"
          value={textA}
          onChange={setTextA}
          parsed={result?.transcriptA}
          focus={focus}
          side="A"
        />
        <TranscriptPane
          label="Transcript B"
          value={textB}
          onChange={setTextB}
          parsed={result?.transcriptB}
          focus={focus}
          side="B"
        />
      </section>

      <div className="actions">
        <button className="primary" onClick={analyze} disabled={loading || !config}>
          {loading ? "Analysing…" : "Find contradictions"}
        </button>
        {config && (
          <button
            className="ghost"
            onClick={() => {
              setTextA(config.sampleA);
              setTextB(config.sampleB);
              setResult(null);
            }}
            disabled={loading}
          >
            Reset to sample
          </button>
        )}
        {loading && <span className="muted">Running {config?.samples ?? 3} independent samples, then verifying and scoring…</span>}
      </div>

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

      {result && (
        <section className="results">
          <div className="summary">
            <h2>
              {counts.DIRECT + counts.INFERENTIAL} contradiction{counts.DIRECT + counts.INFERENTIAL === 1 ? "" : "s"}
              <span className="muted"> · {counts.FALSE_POSITIVE} dismissed as false positive</span>
            </h2>
            <div className="filters" role="group" aria-label="Filter by type">
              {TYPES.map((t) => (
                <button key={t} className={`chip chip-${t} filter ${filter.has(t) ? "on" : "off"}`} aria-pressed={filter.has(t)} onClick={() => toggle(t)}>
                  {TYPE_META[t].label} {counts[t]}
                </button>
              ))}
            </div>
          </div>
          <p className="muted small">
            {result.meta.samples} samples · {(result.meta.durationMs / 1000).toFixed(1)}s
            {result.meta.droppedUnverified > 0 &&
              ` · ${result.meta.droppedUnverified} candidate${result.meta.droppedUnverified === 1 ? "" : "s"} discarded because the quoted testimony does not appear in the transcripts`}
          </p>
          {visible.length === 0 && <p className="muted">Nothing to show for the selected filters.</p>}
          {visible.map((c) => (
            <ResultCard key={c.id} c={c} active={focus?.id === c.id} onFocus={() => setFocus(c)} />
          ))}
        </section>
      )}
    </div>
  );
}

function TranscriptPane(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  parsed?: Transcript;
  focus: Contradiction | null;
  side: "A" | "B";
}) {
  const { label, value, onChange, parsed, focus, side } = props;
  const [editing, setEditing] = useState(true);
  useEffect(() => {
    if (parsed) setEditing(false);
  }, [parsed]);

  const q = focus ? (side === "A" ? focus.quoteA : focus.quoteB) : null;
  useEffect(() => {
    if (q) document.getElementById(`turn-${q.turnId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [q]);

  return (
    <div className="pane">
      <div className="pane-head">
        <h3>{label}</h3>
        {parsed && (
          <button className="link" onClick={() => setEditing((e) => !e)}>
            {editing ? "View parsed" : "Edit"}
          </button>
        )}
      </div>
      {editing || !parsed ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} aria-label={label} />
      ) : (
        <div className="parsed">
          <div className="title">{parsed.title}</div>
          {parsed.turns.map((t) => {
            const hit = q && q.turnId === t.id;
            return (
              <div key={t.id} id={`turn-${t.id}`} className={`turn ${hit ? "hit" : ""}`}>
                <span className="tid">{t.id}</span>
                <div>
                  <div className="q">Q: {t.question}</div>
                  <div className="a">A: {hit && q.start !== null ? highlight(t.answer, q.start, q.end!) : t.answer}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function highlight(text: string, start: number, end: number) {
  return (
    <>
      {text.slice(0, start)}
      <mark>{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function ResultCard({ c, active, onFocus }: { c: Contradiction; active: boolean; onFocus: () => void }) {
  const [open, setOpen] = useState(false);
  const pct = Math.round(c.confidence.score * 100);
  return (
    <article className={`card card-${c.type} ${active ? "active" : ""}`}>
      <div className="card-head">
        <span className={`chip chip-${c.type}`}>{TYPE_META[c.type].label}</span>
        <span className="topic">{c.topic}</span>
        <span className="dim">{c.dimension}</span>
        <div className="conf" title={`Confidence in this classification: ${pct}%`}>
          <div className="bar">
            <div className={`fill band-${c.confidence.band}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="pct">
            {pct}% <span className="muted">{c.confidence.band.toLowerCase()}</span>
          </span>
        </div>
      </div>

      {!c.verified && <div className="warn">Quote not found verbatim in the cited answer. Check it against the record before relying on it.</div>}

      <button className="quotes" onClick={onFocus} aria-label="Show these statements in the transcripts">
        <div className="quote">
          <span className="tid">{c.quoteA.turnId}</span>"{c.quoteA.text}"
        </div>
        <div className="quote">
          <span className="tid">{c.quoteB.turnId}</span>"{c.quoteB.text}"
        </div>
      </button>

      <p className="reason">
        <strong>Classification: </strong>
        {c.classificationReason}
      </p>
      <p className="expl">{c.explanation}</p>

      <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide" : "Why this score?"}
      </button>
      {open && (
        <table className="factors">
          <thead>
            <tr>
              <th>Signal</th>
              <th>Value</th>
              <th>Weight</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {c.confidence.factors.map((f) => (
              <tr key={f.name}>
                <td>{f.name}</td>
                <td>{f.value.toFixed(2)}</td>
                <td>{f.weight.toFixed(2)}</td>
                <td>{f.note}</td>
              </tr>
            ))}
            <tr>
              <td>Grounding gate</td>
              <td>×{c.confidence.groundingGate.toFixed(2)}</td>
              <td />
              <td>{c.verified ? "Both quotes found verbatim in the record" : "Penalty: quote is paraphrased or mis-cited"}</td>
            </tr>
          </tbody>
          <tfoot>
            <tr>
              <td>Score</td>
              <td colSpan={3}>
                Σ(value × weight) × gate = <strong>{c.confidence.score.toFixed(2)}</strong>. The model proposed "
                {c.llmRelation.replace(/_/g, " ")}". The score uses no number from the model.
              </td>
            </tr>
          </tfoot>
        </table>
      )}
    </article>
  );
}
