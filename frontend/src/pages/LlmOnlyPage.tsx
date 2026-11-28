import { ArrowRight, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { DEMO_PRESETS, ErrorBanner, FormattedProse, Loading } from "../components/Common";
import { TelemetryRing } from "../components/VisualWidgets";
import type { EvaluationPayload, LLMOnlyResponse, PageId } from "../types";

const HEDGE_PATTERNS = [
  "cannot verify",
  "do not have",
  "don't have",
  "without querying",
  "generally",
  "depends on",
  "consult",
  "typically",
  "may ",
  "might ",
  "likely",
  "not available",
];

function analyzeUngroundedText(text: string) {
  const lower = text.toLowerCase();
  const matchedCues = HEDGE_PATTERNS.filter((p) => lower.includes(p));
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const isHedging = matchedCues.length > 0;
  return {
    wordCount,
    cueCount: matchedCues.length,
    status: isHedging ? "Generic / hedging" : "Unverified claim",
    note: isHedging
      ? "Model fell back to generic security advice because it cannot see ORCA's graph."
      : "Model asserted specific names with zero RDF or rule verification.",
  };
}

export function LlmOnlyPage({
  question,
  onQuestionChange,
  onNavigate,
}: {
  question: string;
  onQuestionChange: (q: string) => void;
  onNavigate: (page: PageId) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LLMOnlyResponse | null>(null);
  const [evalSummary, setEvalSummary] = useState<EvaluationPayload["summary"] | null>(null);
  const [runCount, setRunCount] = useState(0);

  const runLlmOnly = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.askLlmOnly(trimmed);
      setResult(res);
      setRunCount((c) => c + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void runLlmOnly(question);
    api.getLlmVsKgEvaluation().then((d) => setEvalSummary(d.summary)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const diag = useMemo(
    () => (result ? analyzeUngroundedText(result.llm_only_text) : null),
    [result]
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-normal leading-[1.15] tracking-[-0.02em] text-[#f0f2f5]">
            LLM only <span className="text-[#737a87]">Condition A</span>
          </h1>
          <p className="mt-1.5 text-sm text-[#a1a7b3]">
            Direct baseline prompt with the knowledge graph completely disconnected
          </p>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <button
            type="button"
            onClick={() => onNavigate("llm-kg")}
            className="inline-flex items-center gap-1.5 text-[#f0f2f5] transition-colors duration-150 hover:text-[#38bdf8]"
          >
            <span>Verify in LLM + KG</span>
            <ArrowRight size={15} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate("compare")}
            className="text-[#a1a7b3] transition-colors duration-150 hover:text-[#f0f2f5]"
          >
            Compare side-by-side
          </button>
        </div>
      </header>

      {/* Query Composer */}
      <section className="surface-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-1">
          {DEMO_PRESETS.map((p) => {
            const active = question === p.q;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onQuestionChange(p.q);
                  void runLlmOnly(p.q);
                }}
                className={`btn-press h-8 rounded-lg px-3 text-xs transition-colors duration-150 ${
                  active
                    ? "surface-active font-medium text-[#f0f2f5]"
                    : "text-[#a1a7b3] hover:bg-[#1e222b] hover:text-[#f0f2f5]"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="text"
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim()) void runLlmOnly(question);
            }}
            placeholder="Ask a question without knowledge graph context"
            className="h-10 flex-1 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#090b0f]/90 px-3.5 text-sm text-[#f0f2f5] placeholder-[#737a87] transition-colors duration-150 focus:border-[#38bdf8]/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={loading || !question.trim()}
            onClick={() => void runLlmOnly(question)}
            className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-4 text-sm font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white disabled:opacity-50"
          >
            <Send size={15} strokeWidth={1.5} />
            <span>Run prompt</span>
          </button>
        </div>
      </section>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {loading && <Loading label="Waiting for ungrounded model reply (no knowledge graph)" />}

      {/* Asymmetric 8/4 Visual Diagnostic Workspace */}
      {!loading && result && diag && (
        <div key={runCount} className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Left (8 cols): Disconnected Pipeline Diagram + Formatted Answer */}
          <section className="anim-rise surface-card rounded-2xl p-6 lg:col-span-8 flex flex-col justify-between space-y-5">
            <div className="space-y-5">
              {/* Visual Disconnected Pipeline SVG */}
              <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#090b0f]/90 px-4 py-3 overflow-x-auto">
                <svg viewBox="0 0 660 66" className="w-full min-w-[500px] h-[66px]">
                  {/* Node 1: User Prompt */}
                  <rect x={4} y={12} width={144} height={42} rx={8} fill="#161920" stroke="#f0f2f5" strokeOpacity={0.18} />
                  <circle cx={20} cy={33} r={3.5} fill="#38bdf8" />
                  <text x={32} y={29} fill="#f0f2f5" fontSize={11.5} fontWeight={500} fontFamily="IBM Plex Sans, sans-serif">
                    User prompt
                  </text>
                  <text x={32} y={44} fill="#737a87" fontSize={10} fontFamily="IBM Plex Mono, monospace">
                    direct input
                  </text>

                  {/* Edge 1 -> 2 */}
                  <path
                    d="M 148 33 L 222 33"
                    stroke="#38bdf8"
                    strokeWidth={1.75}
                    pathLength={100}
                    className="anim-edge-draw"
                  />
                  <polygon points="222,29 230,33 222,37" fill="#38bdf8" />

                  {/* Node 2: Raw LLM */}
                  <rect x={232} y={12} width={174} height={42} rx={8} fill="#161920" stroke="#f43f5e" strokeOpacity={0.55} />
                  <circle cx={248} cy={33} r={3.5} fill="#f43f5e" />
                  <text x={260} y={29} fill="#f0f2f5" fontSize={11.5} fontWeight={500} fontFamily="IBM Plex Sans, sans-serif">
                    Raw LLM (no context)
                  </text>
                  <text x={260} y={44} fill="#737a87" fontSize={10} fontFamily="IBM Plex Mono, monospace">
                    {result.model_name ?? "configured LLM"}
                  </text>

                  {/* Disconnected dashed break line 2 -X- 3 */}
                  <line x1={406} y1={33} x2={444} y2={33} stroke="#f43f5e" strokeOpacity={0.6} strokeWidth={1.5} strokeDasharray="4 4" />
                  <circle cx={455} cy={33} r={9} fill="#090b0f" stroke="#f43f5e" strokeWidth={1.4} />
                  <path d="M 451.5 29.5 L 458.5 36.5 M 458.5 29.5 L 451.5 36.5" stroke="#f43f5e" strokeWidth={1.5} strokeLinecap="round" />
                  <line x1={466} y1={33} x2={502} y2={33} stroke="#737a87" strokeOpacity={0.35} strokeWidth={1.5} strokeDasharray="4 4" />

                  {/* Node 3: Disconnected ORCA KG */}
                  <rect x={504} y={12} width={152} height={42} rx={8} fill="#0f1115" stroke="#f0f2f5" strokeOpacity={0.12} strokeDasharray="3 3" />
                  <circle cx={520} cy={33} r={3.5} fill="#4b5263" />
                  <text x={532} y={29} fill="#737a87" fontSize={11.5} fontFamily="IBM Plex Sans, sans-serif">
                    ORCA KG offline
                  </text>
                  <text x={532} y={44} fill="#525866" fontSize={10} fontFamily="IBM Plex Mono, monospace">
                    574 triples skipped
                  </text>
                </svg>
              </div>

              {/* Clean Formatted Reply (Zero Raw Markdown Asterisks) */}
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="inline-flex items-center gap-2 font-medium text-[#f0f2f5]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#f43f5e]" />
                    <span>Ungrounded output</span>
                  </span>
                  <span className="font-mono text-[#737a87] tabular-nums">
                    {diag.wordCount} words · {result.latency_ms} ms
                  </span>
                </div>

                <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#0c1017]/80 p-5 text-[15px] leading-[1.7] text-[#f0f2f5] whitespace-pre-wrap">
                  <FormattedProse text={result.llm_only_text} />
                </div>
              </div>
            </div>

            {/* Bottom Verification Gap Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f2f5]/[0.07] pt-4 font-mono text-xs text-[#737a87]">
              <span>0 / 574 triples consulted · 0 rules fired · 0 hop paths</span>
              <button
                type="button"
                onClick={() => onNavigate("compare")}
                className="font-sans text-xs font-medium text-[#38bdf8] transition-colors duration-150 hover:text-[#f0f2f5]"
              >
                Run side-by-side comparison →
              </button>
            </div>
          </section>

          {/* Right (4 cols): Live Grounding Diagnostic Panel */}
          <aside
            className="anim-rise surface-card rounded-2xl p-6 lg:col-span-4 flex flex-col justify-between space-y-5"
            style={{ animationDelay: "70ms" }}
          >
            <div className="space-y-5">
              {/* Top Diagnostic Ring & Status */}
              <div className="flex items-center gap-3.5 border-b border-[#f0f2f5]/[0.07] pb-4">
                <TelemetryRing percent={4} color="#f43f5e" label="0%" size={48} />
                <div>
                  <div className="text-sm font-medium text-[#f0f2f5]">{diag.status}</div>
                  <div className="mt-0.5 text-xs text-[#737a87]">{diag.note}</div>
                </div>
              </div>

              {/* 3 Live Grounding Meters */}
              <div className="space-y-3 text-xs">
                {[
                  { label: "RDF triples verified", val: "0 / 574", pct: 0 },
                  { label: "OWL-RL / Rules A–E checked", val: "0 / 5", pct: 0 },
                  { label: "Multi-hop access chains", val: "0 traced", pct: 0 },
                ].map((m) => (
                  <div key={m.label} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[#a1a7b3]">{m.label}</span>
                      <span className="font-mono text-[#f43f5e] tabular-nums">{m.val}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0f1115] border border-[#f0f2f5]/[0.06]">
                      <div className="h-full rounded-full bg-[#f43f5e]" style={{ width: `${Math.max(2, m.pct)}%` }} />
                    </div>
                  </div>
                ))}
              </div>

              {/* Real 10-CQ Condition A Track Record */}
              {evalSummary && (
                <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#0c1017]/80 p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#a1a7b3]">10-CQ baseline record</span>
                    <span className="font-mono text-[#f43f5e] tabular-nums">
                      {evalSummary.correct_a} / {evalSummary.total_cqs} pass
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e222b]">
                    <div
                      className="anim-bar h-full rounded-full bg-[#f43f5e]"
                      style={{
                        width: `${Math.max(4, (evalSummary.correct_a / Math.max(1, evalSummary.total_cqs)) * 100)}%`,
                      }}
                    />
                  </div>
                  <div className="font-mono text-[11px] text-[#737a87] tabular-nums">
                    Avg recall {(evalSummary.avg_recall_a * 100).toFixed(1)}% · Proof {evalSummary.evidence_a}/{evalSummary.total_cqs}
                  </div>
                </div>
              )}
            </div>

            {/* Direct Action Button */}
            <button
              type="button"
              onClick={() => onNavigate("llm-kg")}
              className="btn-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-4 text-xs font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white"
            >
              <span>Test same prompt with ORCA KG</span>
              <ArrowRight size={14} strokeWidth={1.5} />
            </button>
          </aside>
        </div>
      )}
    </div>
  );
}
