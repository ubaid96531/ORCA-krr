import { ChevronDown, ChevronRight, GitCompare } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import {
  AnimatedNumber,
  DEMO_PRESETS,
  EmptyState,
  EntityChipText,
  ErrorBanner,
  FormattedProse,
  Loading,
  shortName,
} from "../components/Common";
import { EvidenceView } from "../components/EvidenceView";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import { DotMatrix10, MiniHopChain, TelemetryRing } from "../components/VisualWidgets";
import type { CompareResponse, EvaluationPayload, ExplainabilityPayload } from "../types";

function cleanPreview(text: string): string {
  return text.replace(/[*_`]/g, "");
}

export function ComparePage({
  question,
  onQuestionChange,
  onAnimatePath,
}: {
  question: string;
  onQuestionChange: (q: string) => void;
  onAnimatePath: (pathId: string) => void;
}) {
  const [liveLoading, setLiveLoading] = useState(false);
  const [liveRes, setLiveRes] = useState<CompareResponse | null>(null);
  const [liveRun, setLiveRun] = useState(0);

  const [evalData, setEvalData] = useState<EvaluationPayload | null>(null);
  const [explainData, setExplainData] = useState<ExplainabilityPayload | null>(null);
  const [evalLoading, setEvalLoading] = useState(true);
  const [bottomTab, setBottomTab] = useState<"cqs" | "traces">("cqs");
  const [expandedCq, setExpandedCq] = useState<string | null>(null);
  const [activeTraceId, setActiveTraceId] = useState<string>("Trace-1");
  const [error, setError] = useState<string | null>(null);

  const runLiveCompare = async (qText: string) => {
    const trimmed = qText.trim();
    if (!trimmed) return;
    setLiveLoading(true);
    setError(null);
    try {
      const res = await api.compareAssistant(trimmed);
      setLiveRes(res);
      setLiveRun((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveLoading(false);
    }
  };

  useEffect(() => {
    setEvalLoading(true);
    Promise.all([
      api.getLlmVsKgEvaluation(),
      api.getExplainability().catch(() => null),
    ])
      .then(([d, ex]) => {
        setEvalData(d);
        setExplainData(ex);
        if (ex?.traces?.[0]) setActiveTraceId(ex.traces[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setEvalLoading(false));
  }, []);

  const factCount =
    (liveRes?.evidence?.explicit_facts.length ?? 0) + (liveRes?.evidence?.inferred_facts.length ?? 0);
  const firstLivePath = liveRes?.evidence?.access_paths?.[0] ?? null;

  const chartMetrics = evalData
    ? [
        {
          label: "Correctness",
          a: (evalData.summary.correct_a / Math.max(1, evalData.summary.total_cqs)) * 100,
          b: (evalData.summary.correct_b / Math.max(1, evalData.summary.total_cqs)) * 100,
        },
        {
          label: "Entity recall",
          a: evalData.summary.avg_recall_a * 100,
          b: evalData.summary.avg_recall_b * 100,
        },
        {
          label: "Verified proof",
          a: (evalData.summary.evidence_a / Math.max(1, evalData.summary.total_cqs)) * 100,
          b: (evalData.summary.evidence_b / Math.max(1, evalData.summary.total_cqs)) * 100,
        },
        {
          label: "Safe refusal",
          a: (evalData.summary.refusal_a / Math.max(1, evalData.summary.total_ie)) * 100,
          b: (evalData.summary.refusal_b / Math.max(1, evalData.summary.total_ie)) * 100,
        },
      ]
    : [];

  const activeTrace =
    explainData?.traces.find((t) => t.id === activeTraceId) ?? explainData?.traces[0] ?? null;

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-[30px] font-normal leading-[1.15] tracking-[-0.02em] text-[#f0f2f5]">
          Compare both <span className="text-[#737a87]">LLM only vs LLM + KG</span>
        </h1>
        <p className="mt-1.5 text-sm text-[#a1a7b3]">
          Live side-by-side arena on the identical LLM, 10-CQ benchmark, and 4 end-to-end provenance traces
        </p>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* ── SECTION 1: LIVE SIDE-BY-SIDE ARENA ── */}
      <section className="surface-card rounded-2xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {DEMO_PRESETS.map((p) => {
              const active = question === p.q;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    onQuestionChange(p.q);
                    void runLiveCompare(p.q);
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
          <span className="font-mono text-xs text-[#737a87]">live paired test</span>
        </div>

        <div className="flex flex-col gap-2.5 sm:flex-row">
          <input
            type="text"
            value={question}
            onChange={(e) => onQuestionChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && question.trim()) void runLiveCompare(question);
            }}
            placeholder="Compare LLM only against LLM + KG on any question"
            className="h-10 flex-1 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3.5 text-sm text-[#f0f2f5] placeholder-[#737a87] focus:border-[#38bdf8]/60 focus:outline-none"
          />
          <button
            type="button"
            disabled={liveLoading || !question.trim()}
            onClick={() => void runLiveCompare(question)}
            className="btn-press inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#f0f2f5] px-4 text-sm font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white disabled:opacity-50"
          >
            <GitCompare size={15} strokeWidth={1.5} />
            <span>Compare live</span>
          </button>
        </div>

        {liveLoading && <Loading label="Running Condition A and Condition B on the identical model" />}

        {!liveLoading && liveRes && (
          <div key={liveRun} className="space-y-4 pt-2">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Condition A */}
              <div className="anim-rise rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-5 space-y-4">
                <div className="flex items-center justify-between gap-3 border-b border-[#f0f2f5]/[0.07] pb-3.5">
                  <div className="flex items-center gap-3">
                    <TelemetryRing percent={4} color="#f43f5e" label="0" size={38} />
                    <div>
                      <div className="text-xs font-medium text-[#f0f2f5]">Condition A · LLM only</div>
                      <div className="font-mono text-[11px] text-[#f43f5e]">0 verified facts</div>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-[#737a87] tabular-nums">
                    {liveRes.llm_only_latency_ms} ms
                  </span>
                </div>
                <div className="text-sm leading-relaxed text-[#a1a7b3] whitespace-pre-wrap">
                  <FormattedProse text={liveRes.llm_only_text} />
                </div>
              </div>

              {/* Condition B */}
              <div
                className="anim-rise rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-5 space-y-4"
                style={{ animationDelay: "70ms" }}
              >
                <div className="flex items-center justify-between gap-3 border-b border-[#f0f2f5]/[0.07] pb-3.5">
                  <div className="flex items-center gap-3">
                    <TelemetryRing
                      percent={liveRes.sufficient_evidence ? 100 : 0}
                      color={liveRes.sufficient_evidence ? "#34d399" : "#f59e0b"}
                      label={liveRes.sufficient_evidence ? String(factCount) : "0"}
                      size={38}
                    />
                    <div>
                      <div className="text-xs font-medium text-[#f0f2f5]">
                        Condition B · LLM + KG
                        {!liveRes.sufficient_evidence && (
                          <span className="ml-1.5 font-normal text-[#f59e0b]">(safe refusal)</span>
                        )}
                      </div>
                      <div className="font-mono text-[11px] text-[#34d399] tabular-nums">
                        {liveRes.sufficient_evidence ? `${factCount} verified facts` : "out-of-KG blocked"}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-[#737a87] tabular-nums">
                    {liveRes.kg_grounded_latency_ms} ms
                  </span>
                </div>

                {firstLivePath && <MiniHopChain path={firstLivePath} onExpand={onAnimatePath} />}

                <div className="text-sm leading-relaxed text-[#f0f2f5] whitespace-pre-wrap">
                  <EntityChipText text={liveRes.kg_grounded_text} />
                </div>
              </div>
            </div>

            {liveRes.evidence && (
              <EvidenceView
                evidence={liveRes.evidence}
                predictedLinks={liveRes.predicted_links}
                collapsible
                defaultOpen={false}
                title="Verified KG proof for Condition B"
                onAnimatePath={onAnimatePath}
              />
            )}
          </div>
        )}
      </section>

      {/* ── SECTION 2: ASYMMETRIC BENCHMARK MOMENT (8-col SVG Chart + 4-col Dot Matrix & Ledger) ── */}
      {evalLoading && !evalData ? (
        <Loading label="Loading 10-CQ benchmark" />
      ) : !evalData ? (
        <EmptyState message="Run python -m evaluation.eval_llm_vs_kg to generate benchmark results" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* Animated Vertical SVG Grouped Bar Chart (8 cols) */}
            <section className="surface-card rounded-2xl p-6 lg:col-span-8 flex flex-col justify-between space-y-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <h2 className="text-base font-medium text-[#f0f2f5]">10-CQ &amp; trap benchmark</h2>
                  <p className="mt-0.5 font-mono text-xs text-[#737a87]">{evalData.model_name}</p>
                </div>
                <div className="flex items-center gap-5 text-xs text-[#a1a7b3]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#525866]" />
                    LLM only (A)
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-[#38bdf8]" />
                    LLM + KG (B)
                  </span>
                </div>
              </div>

              <svg viewBox="0 0 640 248" className="w-full h-[248px]">
                {[0, 25, 50, 75, 100].map((pct) => {
                  const y = 204 - (pct / 100) * 160;
                  return (
                    <g key={pct}>
                      <line
                        x1={44}
                        y1={y}
                        x2={624}
                        y2={y}
                        stroke="#f0f2f5"
                        strokeOpacity={pct === 0 ? 0.14 : 0.06}
                        strokeDasharray={pct === 0 ? undefined : "3 5"}
                      />
                      <text
                        x={36}
                        y={y + 3}
                        textAnchor="end"
                        fill="#737a87"
                        fontSize={10.5}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {pct}%
                      </text>
                    </g>
                  );
                })}

                {chartMetrics.map((m, idx) => {
                  const cx = 118 + idx * 144;
                  const hA = Math.max(4, (m.a / 100) * 160);
                  const hB = Math.max(4, (m.b / 100) * 160);
                  return (
                    <g key={m.label}>
                      <rect
                        x={cx - 34}
                        y={204 - hA}
                        width={28}
                        height={hA}
                        rx={5}
                        fill="#525866"
                        className="anim-bar-y"
                        style={{ animationDelay: `${idx * 70}ms` }}
                      />
                      <text
                        x={cx - 20}
                        y={204 - hA - 9}
                        textAnchor="middle"
                        fill="#737a87"
                        fontSize={10.5}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {m.a.toFixed(0)}%
                      </text>

                      <rect
                        x={cx + 4}
                        y={204 - hB}
                        width={28}
                        height={hB}
                        rx={5}
                        fill="#38bdf8"
                        className="anim-bar-y"
                        style={{ animationDelay: `${idx * 70 + 110}ms` }}
                      />
                      <text
                        x={cx + 18}
                        y={204 - hB - 12}
                        textAnchor="middle"
                        fill="#f0f2f5"
                        fontSize={10.5}
                        fontWeight={500}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {m.b.toFixed(0)}%
                      </text>

                      <text
                        x={cx - 1}
                        y={228}
                        textAnchor="middle"
                        fill="#a1a7b3"
                        fontSize={12}
                        fontFamily="IBM Plex Sans, sans-serif"
                      >
                        {m.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </section>

            {/* Right Column: 10-CQ Dot Matrix + Big Tabular Ledger (4 cols) */}
            <aside className="surface-card rounded-2xl p-6 lg:col-span-4 flex flex-col justify-between divide-y divide-[#f0f2f5]/[0.07]">
              <div className="pb-4">
                <div className="text-xs text-[#737a87]">KG-grounded score</div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[32px] font-medium leading-none text-[#f0f2f5] tabular-nums">
                    <AnimatedNumber value={evalData.summary.correct_b} /> / {evalData.summary.total_cqs}
                  </span>
                  <span className="font-mono text-xs text-[#34d399] tabular-nums">
                    vs {evalData.summary.correct_a}/{evalData.summary.total_cqs} LLM only
                  </span>
                </div>
              </div>

              <div className="py-4">
                <DotMatrix10
                  cqResults={evalData.cq_results}
                  ieResults={evalData.insufficient_evidence_results}
                />
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <div>
                  <div className="text-xs text-[#737a87]">Entity recall</div>
                  <div className="mt-1 text-[22px] font-medium leading-none text-[#f0f2f5] tabular-nums">
                    <AnimatedNumber value={evalData.summary.avg_recall_b * 100} decimals={1} suffix="%" />
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#737a87]">
                    vs {(evalData.summary.avg_recall_a * 100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[#737a87]">Safe refusal</div>
                  <div className="mt-1 text-[22px] font-medium leading-none text-[#f0f2f5] tabular-nums">
                    <AnimatedNumber value={evalData.summary.refusal_b} /> / {evalData.summary.total_ie}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-[#737a87]">IE-01 · IE-02</div>
                </div>
              </div>
            </aside>
          </div>

          {/* ── SECTION 3: TOGGLE BETWEEN 10-CQ TABLE & 4 EXPLAINABILITY TRACES ── */}
          <section className="surface-card rounded-2xl overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f2f5]/[0.08] bg-[#11141b] px-5 py-3">
              <div className="inline-flex rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setBottomTab("cqs")}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
                    bottomTab === "cqs" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  10 CQs &amp; 2 traps
                </button>
                <button
                  type="button"
                  onClick={() => setBottomTab("traces")}
                  className={`rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
                    bottomTab === "traces" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  Explainability traces ({explainData?.traces.length ?? 0})
                </button>
              </div>
              <span className="text-xs text-[#737a87]">
                {bottomTab === "cqs"
                  ? "Click any row to inspect full Condition A vs Condition B replies"
                  : "Strict separation: Explicit · Inferred · Generated text · Predicted"}
              </span>
            </div>

            {bottomTab === "cqs" ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#f0f2f5]/[0.08] bg-[#0f1115] text-[#737a87]">
                    <tr>
                      <th className="px-5 py-3 font-medium">ID</th>
                      <th className="px-4 py-3 font-medium">Question &amp; expected</th>
                      <th className="px-4 py-3 font-medium">LLM only (A)</th>
                      <th className="px-4 py-3 font-medium">LLM + KG (B)</th>
                      <th className="px-4 py-3 font-medium text-right whitespace-nowrap">Correct (A / B)</th>
                      <th className="px-5 py-3 font-medium text-right whitespace-nowrap">Proof (A / B)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f2f5]/[0.06]">
                    {evalData.cq_results.map((r) => {
                      const isOpen = expandedCq === r.cq;
                      return (
                        <tr
                          key={r.cq}
                          onClick={() => setExpandedCq(isOpen ? null : r.cq)}
                          className={`cursor-pointer align-top transition-colors duration-150 ${
                            isOpen ? "bg-[#1e222b]" : "hover:bg-[#1a1e26]"
                          }`}
                        >
                          <td className="px-5 py-3.5 font-mono text-[#f0f2f5] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {isOpen ? (
                                <ChevronDown size={13} strokeWidth={1.5} className="text-[#737a87]" />
                              ) : (
                                <ChevronRight size={13} strokeWidth={1.5} className="text-[#737a87]" />
                              )}
                              {r.cq}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 max-w-xs space-y-1">
                            <div className="text-[#f0f2f5]">{r.question}</div>
                            <div className="text-[11px] text-[#737a87]">{r.expected_summary}</div>
                          </td>
                          <td className="px-4 py-3.5 max-w-xs text-[#737a87]">
                            {cleanPreview(isOpen ? r.llm_only_answer : `${r.llm_only_answer.slice(0, 88)}…`)}
                          </td>
                          <td className="px-4 py-3.5 max-w-xs text-[#f0f2f5]">
                            {cleanPreview(isOpen ? r.kg_grounded_answer : `${r.kg_grounded_answer.slice(0, 96)}…`)}
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono tabular-nums">
                            <span className={r.correct_a ? "text-[#34d399]" : "text-[#f43f5e]"}>
                              {r.correct_a ? "Yes" : "No"}
                            </span>
                            <span className="text-[#737a87]"> / </span>
                            <span className={r.correct_b ? "text-[#34d399]" : "text-[#f43f5e]"}>
                              {r.correct_b ? "Yes" : "No"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono tabular-nums">
                            <span className="text-[#737a87]">{r.evidence_a ? "Yes" : "No"}</span>
                            <span className="text-[#737a87]"> / </span>
                            <span className="text-[#38bdf8]">{r.evidence_b ? "Yes" : "No"}</span>
                          </td>
                        </tr>
                      );
                    })}

                    {evalData.insufficient_evidence_results.map((ie) => {
                      const isOpen = expandedCq === ie.cq;
                      return (
                        <tr
                          key={ie.cq}
                          onClick={() => setExpandedCq(isOpen ? null : ie.cq)}
                          className={`cursor-pointer align-top transition-colors duration-150 ${
                            isOpen ? "bg-[#1e222b]" : "hover:bg-[#1a1e26]"
                          }`}
                        >
                          <td className="px-5 py-3.5 font-mono text-[#f59e0b] whitespace-nowrap">
                            <span className="inline-flex items-center gap-1.5">
                              {isOpen ? (
                                <ChevronDown size={13} strokeWidth={1.5} className="text-[#737a87]" />
                              ) : (
                                <ChevronRight size={13} strokeWidth={1.5} className="text-[#737a87]" />
                              )}
                              {ie.cq}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 max-w-xs space-y-1">
                            <div className="text-[#f0f2f5]">{ie.question}</div>
                            <div className="text-[11px] text-[#737a87]">{ie.expected_summary}</div>
                          </td>
                          <td className="px-4 py-3.5 max-w-xs text-[#737a87]">
                            {cleanPreview(isOpen ? ie.llm_only_answer : `${ie.llm_only_answer.slice(0, 88)}…`)}
                          </td>
                          <td className="px-4 py-3.5 max-w-xs text-[#f0f2f5]">
                            {cleanPreview(isOpen ? ie.kg_grounded_answer : `${ie.kg_grounded_answer.slice(0, 96)}…`)}
                          </td>
                          <td className="px-4 py-3.5 text-right whitespace-nowrap font-mono tabular-nums">
                            <span className={ie.refused_a ? "text-[#34d399]" : "text-[#f43f5e]"}>
                              {ie.refused_a ? "Refused" : "Guessed"}
                            </span>
                            <span className="text-[#737a87]"> / </span>
                            <span className={ie.refused_b ? "text-[#34d399]" : "text-[#f43f5e]"}>
                              {ie.refused_b ? "Refused" : "Guessed"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono text-[#737a87]">
                            trap
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : !activeTrace ? (
              <div className="p-6">
                <EmptyState message="Run python -m evaluation.generate_explainability to generate traces" />
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {/* 4 Trace Selector Pills */}
                <div className="flex flex-wrap gap-1.5">
                  {explainData!.traces.map((tr) => {
                    const active = tr.id === activeTrace.id;
                    return (
                      <button
                        key={tr.id}
                        type="button"
                        onClick={() => setActiveTraceId(tr.id)}
                        className={`btn-press h-8 rounded-lg px-3 text-xs transition-colors duration-150 ${
                          active
                            ? "surface-active font-medium text-[#f0f2f5]"
                            : "text-[#a1a7b3] hover:bg-[#1e222b] hover:text-[#f0f2f5]"
                        }`}
                      >
                        <span className="font-mono text-[#38bdf8] mr-1.5">{tr.id}</span>
                        <span>{tr.title.split("(")[0].trim()}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Selected Explainability Trace Breakdown */}
                <div key={activeTrace.id} className="anim-rise space-y-4">
                  <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-[#f0f2f5]">{activeTrace.title}</div>
                      <ProvenanceBadge kind="AI_Generated" extra={explainData?.model_name ?? "LLM"} />
                    </div>
                    <div className="text-xs text-[#737a87]">Q: {activeTrace.question}</div>
                    <div className="pt-2 text-sm leading-relaxed text-[#f0f2f5]">
                      <EntityChipText text={activeTrace.generated_text} />
                    </div>
                  </div>

                  {activeTrace.access_paths?.[0] && (
                    <MiniHopChain path={activeTrace.access_paths[0]} onExpand={onAnimatePath} />
                  )}

                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#f0f2f5]">
                          Explicit knowledge ({activeTrace.explicit_facts.length})
                        </span>
                        <ProvenanceBadge kind="Synthetic_Fact" />
                      </div>
                      {activeTrace.explicit_facts.length === 0 ? (
                        <div className="text-xs text-[#737a87]">None (out-of-KG refusal)</div>
                      ) : (
                        <div className="max-h-44 divide-y divide-[#f0f2f5]/[0.05] overflow-y-auto font-mono text-[11px] text-[#a1a7b3]">
                          {activeTrace.explicit_facts.map((f, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 py-1.5">
                              <span>{f.triple.map(shortName).join(" ")}</span>
                              <span className="text-[#737a87]">{f.provenance === "Official_Fact" ? "Official" : "Scenario"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#f0f2f5]">
                          Inferred knowledge ({activeTrace.inferred_facts.length})
                        </span>
                        <ProvenanceBadge kind="Inferred_Fact" />
                      </div>
                      {activeTrace.inferred_facts.length === 0 ? (
                        <div className="text-xs text-[#737a87]">No inferred facts involved</div>
                      ) : (
                        <div className="max-h-44 divide-y divide-[#f0f2f5]/[0.05] overflow-y-auto font-mono text-[11px] text-[#a1a7b3]">
                          {activeTrace.inferred_facts.map((inf, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 py-1.5">
                              <span className="text-[#f0f2f5]">{inf.triple.map(shortName).join(" ")}</span>
                              <span className="text-[#f59e0b]">{inf.rule_id}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {activeTrace.predicted_links.length > 0 && (
                    <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-[#f0f2f5]">
                          Predicted links ({activeTrace.predicted_links.length})
                        </span>
                        <ProvenanceBadge kind="Predicted_Link" />
                      </div>
                      <div className="divide-y divide-[#f0f2f5]/[0.05] font-mono text-[11px]">
                        {activeTrace.predicted_links.map((pl, i) => (
                          <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                            <span className="text-[#f0f2f5]">
                              ({shortName(pl.head)}, {shortName(pl.relation)}, {shortName(pl.tail)})
                            </span>
                            <span className="text-[#a1a7b3]">
                              {pl.model} · {(pl.confidence * 100).toFixed(1)}% · {pl.symbolic_audit?.risk_level ?? "UNAUDITED"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
