import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Network,
  Send,
  ShieldAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { DEMO_PRESETS, EntityChipText, ErrorBanner, Loading } from "../components/Common";
import { EvidenceView } from "../components/EvidenceView";
import { MiniHopChain, ProvenanceBar, TelemetryRing } from "../components/VisualWidgets";
import type { AssistantResponse, PageId } from "../types";

const ALL_ORCA_RULES = ["ORCA-A", "ORCA-B", "ORCA-C", "ORCA-D", "ORCA-E", "owl:inverseOf"];

export function LlmKgPage({
  question,
  onQuestionChange,
  onNavigate,
  onAnimatePath,
}: {
  question: string;
  onQuestionChange: (q: string) => void;
  onNavigate: (page: PageId) => void;
  onAnimatePath: (pathId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AssistantResponse | null>(null);
  const [runCount, setRunCount] = useState(0);
  const [showContext, setShowContext] = useState(false);
  const [showTemplate, setShowTemplate] = useState(false);

  const runGrounded = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed) return;
    setLoading(true);
    setPipelineStep(1);
    setError(null);

    const t1 = window.setTimeout(() => setPipelineStep(2), 260);
    const t2 = window.setTimeout(() => setPipelineStep(3), 580);

    try {
      const res = await api.askAssistant(trimmed);
      setResult(res);
      setPipelineStep(4);
      setRunCount((c) => c + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPipelineStep(0);
    } finally {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      setLoading(false);
    }
  };

  useEffect(() => {
    void runGrounded(question);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const firstPath = result?.evidence?.access_paths?.[0] ?? null;
  const totalFacts =
    (result?.evidence?.explicit_facts.length ?? 0) + (result?.evidence?.inferred_facts.length ?? 0);
  const appliedSet = new Set(result?.evidence?.applied_rules ?? []);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-normal leading-[1.15] tracking-[-0.02em] text-[#f0f2f5]">
            LLM + KG <span className="text-[#737a87]">Condition B</span>
          </h1>
          <p className="mt-1.5 text-sm text-[#a1a7b3]">
            Live KG-RAG grounding with verified RDF proof, multi-hop chains, and refusal guardrails
          </p>
        </div>

        <button
          type="button"
          onClick={() => onNavigate("compare")}
          className="inline-flex items-center gap-1.5 text-sm text-[#a1a7b3] transition-colors duration-150 hover:text-[#f0f2f5]"
        >
          <span>Compare against LLM only</span>
          <ArrowRight size={15} strokeWidth={1.5} />
        </button>
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
                  void runGrounded(p.q);
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
              if (e.key === "Enter" && question.trim()) void runGrounded(question);
            }}
            placeholder="Ask about an agent, permission, policy, or out-of-graph entity"
            className="h-10 flex-1 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#090b0f]/90 px-3.5 text-sm text-[#f0f2f5] placeholder-[#737a87] transition-colors duration-150 focus:border-[#38bdf8]/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={loading || !question.trim()}
            onClick={() => void runGrounded(question)}
            className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-4 text-sm font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white disabled:opacity-50"
          >
            <Send size={15} strokeWidth={1.5} />
            <span>Ask with KG</span>
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1 font-mono text-xs text-[#737a87]">
          {[
            {
              step: 1,
              label: result?.question_type ? `01 Linked (${result.question_type})` : "01 Entity linking",
            },
            {
              step: 2,
              label: result?.evidence
                ? `02 Retrieved (${result.evidence.explicit_facts.length} explicit · ${result.evidence.inferred_facts.length} inferred)`
                : "02 Graph retrieval",
            },
            {
              step: 3,
              label: result
                ? result.sufficient_evidence
                  ? "03 Verified"
                  : "03 Refusal enforced"
                : "03 Grounded check",
            },
          ].map((s, idx) => {
            const done = pipelineStep > s.step || (pipelineStep === 4 && !loading);
            const active = loading && pipelineStep === s.step;
            const isRefusal = s.step === 3 && result && !result.sufficient_evidence;
            const dotColor = isRefusal
              ? "#f59e0b"
              : done
              ? "#34d399"
              : active
              ? "#38bdf8"
              : "#2f3542";
            return (
              <div key={s.step} className="inline-flex items-center gap-3">
                <span className={`inline-flex items-center gap-1.5 ${done || active ? "text-[#f0f2f5]" : "text-[#737a87]"}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
                  <span>{s.label}</span>
                </span>
                {idx < 2 && <span className="h-px w-6 bg-[#f0f2f5]/[0.12]" />}
              </div>
            );
          })}
        </div>
      </section>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />
      {loading && <Loading label="Retrieving KG evidence and checking grounded synthesis" />}

      {/* Asymmetric 8/4 Grounded Workspace */}
      {!loading && result && (
        <div key={runCount} className="space-y-4">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Left (8 cols): Connected KG-RAG Pipeline SVG + Hop Chain + Grounded Answer */}
            <section className="anim-rise surface-card rounded-2xl p-6 lg:col-span-8 space-y-5">
              {/* Visual Connected KG-RAG Pipeline SVG */}
              <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#090b0f]/90 px-4 py-3 overflow-x-auto">
                <svg viewBox="0 0 660 66" className="w-full min-w-[500px] h-[66px]">
                  {/* Node 1: Prompt */}
                  <rect x={4} y={12} width={118} height={42} rx={8} fill="#161920" stroke="#f0f2f5" strokeOpacity={0.18} />
                  <circle cx={19} cy={33} r={3.5} fill="#38bdf8" />
                  <text x={30} y={29} fill="#f0f2f5" fontSize={11} fontWeight={500} fontFamily="IBM Plex Sans, sans-serif">
                    Prompt
                  </text>
                  <text x={30} y={44} fill="#737a87" fontSize={9.5} fontFamily="IBM Plex Mono, monospace">
                    entity linked
                  </text>

                  {/* Edge 1 -> 2 */}
                  <path d="M 122 33 L 166 33" stroke="#38bdf8" strokeWidth={1.75} pathLength={100} className="anim-edge-draw" />
                  <polygon points="166,29 174,33 166,37" fill="#38bdf8" />

                  {/* Node 2: ORCA KG */}
                  <rect
                    x={176}
                    y={12}
                    width={168}
                    height={42}
                    rx={8}
                    fill="#161920"
                    stroke={result.sufficient_evidence ? "#34d399" : "#f59e0b"}
                    strokeOpacity={0.65}
                  />
                  <circle cx={191} cy={33} r={3.5} fill={result.sufficient_evidence ? "#34d399" : "#f59e0b"} />
                  <text x={202} y={29} fill="#f0f2f5" fontSize={11} fontWeight={500} fontFamily="IBM Plex Sans, sans-serif">
                    ORCA KG retrieval
                  </text>
                  <text x={202} y={44} fill="#a1a7b3" fontSize={9.5} fontFamily="IBM Plex Mono, monospace">
                    {totalFacts} facts · {result.evidence?.access_paths.length ?? 0} paths
                  </text>

                  {/* Edge 2 -> 3 */}
                  <path
                    d="M 344 33 L 388 33"
                    stroke={result.sufficient_evidence ? "#34d399" : "#f59e0b"}
                    strokeWidth={1.75}
                    pathLength={100}
                    className="anim-edge-draw"
                  />
                  <polygon
                    points="388,29 396,33 388,37"
                    fill={result.sufficient_evidence ? "#34d399" : "#f59e0b"}
                  />

                  {/* Node 3: Guardrail & LLM */}
                  <rect
                    x={398}
                    y={12}
                    width={258}
                    height={42}
                    rx={8}
                    fill="#161920"
                    stroke={result.sufficient_evidence ? "#38bdf8" : "#f59e0b"}
                    strokeOpacity={0.55}
                  />
                  <circle cx={414} cy={33} r={3.5} fill={result.sufficient_evidence ? "#34d399" : "#f59e0b"} />
                  <text x={426} y={29} fill="#f0f2f5" fontSize={11} fontWeight={500} fontFamily="IBM Plex Sans, sans-serif">
                    {result.sufficient_evidence ? "Verified grounded synthesis" : "Insufficient-evidence refusal gate"}
                  </text>
                  <text x={426} y={44} fill="#737a87" fontSize={9.5} fontFamily="IBM Plex Mono, monospace">
                    {result.model_name ?? result.llm_mode} · {result.sufficient_evidence ? "verdict checked" : "hallucination blocked"}
                  </text>
                </svg>
              </div>

              {/* Refusal Visual State */}
              {!result.sufficient_evidence && (
                <div className="anim-verdict flex items-start gap-3 rounded-xl border border-[#f59e0b]/25 bg-[#0c1017]/85 px-4 py-3.5 text-xs">
                  <ShieldAlert size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#f59e0b]" />
                  <div className="space-y-0.5">
                    <div className="font-medium text-[#f0f2f5]">Entity not found in KG — refusal enforced</div>
                    <div className="text-[#a1a7b3]">
                      0 matched triples in ORCA. The assistant refused instead of fabricating permissions or supervisors.
                    </div>
                  </div>
                </div>
              )}

              {/* Inline Animated Mini Hop-Chain */}
              {firstPath && <MiniHopChain path={firstPath} onExpand={onAnimatePath} />}

              {/* Clean Grounded Answer */}
              <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#0c1017]/80 p-5 text-[15px] leading-[1.7] text-[#f0f2f5] whitespace-pre-wrap">
                <EntityChipText text={result.ai_generated_text ?? result.answer} />
              </div>

              {/* Collapsible Context & Rule Summary */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#f0f2f5]/[0.07] pt-4 text-xs text-[#737a87]">
                <div className="flex flex-wrap gap-5">
                  <button
                    type="button"
                    onClick={() => setShowTemplate((v) => !v)}
                    className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-[#f0f2f5]"
                  >
                    {showTemplate ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                    <span>Deterministic rule summary</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowContext((v) => !v)}
                    className="inline-flex items-center gap-1 transition-colors duration-150 hover:text-[#f0f2f5]"
                  >
                    {showContext ? <ChevronDown size={14} strokeWidth={1.5} /> : <ChevronRight size={14} strokeWidth={1.5} />}
                    <span>Retrieved KG prompt context</span>
                  </button>
                </div>
                {result.notes.length > 0 && <span className="font-mono text-[11px]">{result.notes[0]}</span>}
              </div>

              {showTemplate && (
                <div className="anim-rise rounded-lg border border-[#f0f2f5]/[0.07] bg-[#0f1115] p-3.5 text-xs leading-relaxed text-[#a1a7b3] whitespace-pre-wrap">
                  <EntityChipText text={result.answer} />
                </div>
              )}

              {showContext && (
                <pre className="anim-rise max-h-60 overflow-auto rounded-lg border border-[#f0f2f5]/[0.07] bg-[#090b0f] p-3.5 font-mono text-[11px] text-[#a1a7b3]">
                  {result.retrieved_context}
                </pre>
              )}
            </section>

            {/* Right (4 cols): Live Evidence Telemetry & Fired Rules Panel */}
            <aside
              className="anim-rise surface-card rounded-2xl p-6 lg:col-span-4 flex flex-col justify-between space-y-5"
              style={{ animationDelay: "70ms" }}
            >
              <div className="space-y-5">
                {/* Ring + Status */}
                <div className="flex items-center gap-3.5 border-b border-[#f0f2f5]/[0.07] pb-4">
                  <TelemetryRing
                    percent={result.sufficient_evidence ? 100 : 0}
                    color={result.sufficient_evidence ? "#34d399" : "#f59e0b"}
                    label={result.sufficient_evidence ? String(totalFacts) : "0"}
                    size={48}
                  />
                  <div>
                    <div className="text-sm font-medium text-[#f0f2f5]">
                      {result.sufficient_evidence ? "Verified KG grounding" : "Safe out-of-KG refusal"}
                    </div>
                    <div className="mt-0.5 font-mono text-xs text-[#737a87]">
                      {result.evidence?.explicit_facts.length ?? 0} explicit · {result.evidence?.inferred_facts.length ?? 0} inferred
                    </div>
                  </div>
                </div>

                {/* Segmented Provenance Bar */}
                <ProvenanceBar evidence={result.evidence} predictedLinks={result.predicted_links} />

                {/* Fired Symbolic Rules Matrix */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#a1a7b3]">Symbolic rules fired</span>
                    <span className="font-mono text-[11px] text-[#737a87] tabular-nums">
                      {result.evidence?.applied_rules.length ?? 0} active
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {ALL_ORCA_RULES.map((rule) => {
                      const active = appliedSet.has(rule);
                      return (
                        <div
                          key={rule}
                          className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 font-mono text-[11px] ${
                            active
                              ? "border-[#f0f2f5]/[0.14] bg-[#0c1017]/90 text-[#f0f2f5]"
                              : "border-[#f0f2f5]/[0.05] bg-[#0f1115]/50 text-[#525866]"
                          }`}
                        >
                          <span
                            className="h-1.5 w-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: active ? "#f59e0b" : "#2f3542" }}
                          />
                          <span className="truncate">{rule}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="space-y-2 pt-2">
                {firstPath && (
                  <button
                    type="button"
                    onClick={() => onAnimatePath(firstPath.path_id)}
                    className="btn-press inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-4 text-xs font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white"
                  >
                    <Network size={14} strokeWidth={1.5} />
                    <span>Animate path in Knowledge graph</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onNavigate("compare")}
                  className="btn-press surface-raised inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-4 text-xs font-medium text-[#f0f2f5] transition-colors duration-150 hover:bg-[#252a36]"
                >
                  <span>Compare against LLM only</span>
                  <ArrowRight size={14} strokeWidth={1.5} />
                </button>
              </div>
            </aside>
          </div>

          {result.evidence && (
            <EvidenceView
              evidence={result.evidence}
              predictedLinks={result.predicted_links}
              collapsible
              defaultOpen={false}
              title="Inspect explicit facts, inferred rules & chains"
              onAnimatePath={onAnimatePath}
            />
          )}
        </div>
      )}
    </div>
  );
}
