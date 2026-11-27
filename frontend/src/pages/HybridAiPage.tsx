import { Play, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorBanner, Loading, shortName } from "../components/Common";
import { ProvenanceBadge } from "../components/ProvenanceBadge";
import type {
  EmbeddingMetricsResponse,
  EntitySummary,
  HybridCandidateGroup,
  PredictedLink,
  SimilarEntity,
} from "../types";

const RELATIONS = [
  { id: "usesTool", label: "uses tool" },
  { id: "hasPermission", label: "has permission" },
  { id: "hasRole", label: "has role" },
  { id: "assignedTask", label: "assigned task" },
  { id: "requiresPermission", label: "requires permission" },
  { id: "accessesResource", label: "accesses resource" },
  { id: "containsSensitiveData", label: "contains sensitive data" },
  { id: "governedByPolicy", label: "governed by policy" },
  { id: "implementsControl", label: "implements control" },
  { id: "supervisedBy", label: "supervised by" },
];

const PREDICT_PRESETS = [
  { label: "TimetableAssistant · usesTool", head: "TimetableAssistant", relation: "usesTool" },
  { label: "AdmissionsReviewAgent · usesTool", head: "AdmissionsReviewAgent", relation: "usesTool" },
  { label: "HelpdeskAgent · hasPermission", head: "HelpdeskAgent", relation: "hasPermission" },
];

const RISK_META: Record<string, { label: string; dot: string; text: string }> = {
  SAFE_REMEDIATION: { label: "Safe fix", dot: "#34d399", text: "text-[#34d399]" },
  REMEDIATION_WITH_EXCESS: { label: "Fixes gap · adds excess", dot: "#f59e0b", text: "text-[#f59e0b]" },
  POLICY_VIOLATION: { label: "Blocked by policy", dot: "#f43f5e", text: "text-[#f43f5e]" },
  EXCESSIVE_EXPOSURE: { label: "Adds risky exposure", dot: "#f59e0b", text: "text-[#f59e0b]" },
  OWL_TYPE_VIOLATION: { label: "OWL type mismatch", dot: "#f43f5e", text: "text-[#f43f5e]" },
  LOW_RISK: { label: "Low risk", dot: "#38bdf8", text: "text-[#38bdf8]" },
};

interface EntityGroup {
  group: string;
  items: EntitySummary[];
}

export function HybridAiPage() {
  const [metrics, setMetrics] = useState<EmbeddingMetricsResponse | null>(null);
  const [candidates, setCandidates] = useState<HybridCandidateGroup[]>([]);
  const [entityGroups, setEntityGroups] = useState<EntityGroup[]>([]);

  const [chartMetric, setChartMetric] = useState<"mrr" | "hits_at_10">("mrr");

  const [predHead, setPredHead] = useState("TimetableAssistant");
  const [predRelation, setPredRelation] = useState("usesTool");
  const [predModel, setPredModel] = useState<"TransE" | "DistMult">("TransE");
  const [enforceOwl, setEnforceOwl] = useState(true);
  const [customPreds, setCustomPreds] = useState<PredictedLink[]>([]);
  const [predRun, setPredRun] = useState(0);

  const [similarAnchor, setSimilarAnchor] = useState("AdvisingAgent");
  const [similarPeers, setSimilarPeers] = useState<SimilarEntity[]>([]);
  const [simRun, setSimRun] = useState(0);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getEmbeddingMetrics(),
      api.getHybridCandidates("TransE"),
      api.getSimilarEntities("AdvisingAgent", "TransE", 5),
      api.predictHybridLinks({
        head: "TimetableAssistant",
        relation: "usesTool",
        model_name: "TransE",
        top_k: 4,
        enforce_owl_types: true,
      }),
      api.listCollection("agents"),
      api.listCollection("tasks"),
      api.listCollection("tools"),
      api.listCollection("permissions"),
      api.listCollection("resources"),
      api.listCollection("policies"),
    ])
      .then(([m, c, sim, preds, ag, tk, tl, pr, rs, pl]) => {
        setMetrics(m);
        setCandidates(c);
        setSimilarPeers(sim);
        setCustomPreds(preds);
        setEntityGroups([
          { group: "AI Agents", items: ag },
          { group: "Tasks", items: tk },
          { group: "Tools", items: tl },
          { group: "Permissions", items: pr },
          { group: "Resources", items: rs },
          { group: "Policies", items: pl },
        ]);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  const runPredict = async (headArg = predHead, relArg = predRelation, modelArg = predModel, owlArg = enforceOwl) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.predictHybridLinks({
        head: headArg,
        relation: relArg,
        model_name: modelArg,
        top_k: 5,
        enforce_owl_types: owlArg,
      });
      setCustomPreds(res);
      setPredRun((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runSimilar = async (entity: string) => {
    setError(null);
    try {
      const res = await api.getSimilarEntities(entity, predModel, 5);
      setSimilarPeers(res);
      setSimRun((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading && !metrics) return <Loading label="Loading KG embeddings and symbolic audits" />;

  const models = ["Random", "TransE", "DistMult"] as const;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-normal leading-[1.15] tracking-[-0.02em] text-[#f0f2f5]">
            Hybrid AI <span className="text-[#737a87]">Option D · TransE &amp; DistMult</span>
          </h1>
          <p className="mt-1.5 text-sm text-[#a1a7b3]">
            Neural embeddings rank candidate links while OWL-RL and ORCA Rules A–E audit every prediction
          </p>
        </div>
        <ProvenanceBadge kind="Predicted_Link" />
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Asymmetric Benchmark Visual: 7-col Chart + 5-col Metrics Ledger */}
      {metrics && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <section className="surface-card rounded-2xl p-6 lg:col-span-7 flex flex-col justify-between space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-medium text-[#f0f2f5]">Global vs OWL-constrained ranking</h2>
                <p className="mt-0.5 font-mono text-xs text-[#737a87]">
                  {metrics.dataset.train_triples} train · {metrics.dataset.test_triples} test asserted triples
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setChartMetric("mrr")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors duration-150 ${
                    chartMetric === "mrr" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  MRR
                </button>
                <button
                  type="button"
                  onClick={() => setChartMetric("hits_at_10")}
                  className={`rounded-md px-2.5 py-1 font-medium transition-colors duration-150 ${
                    chartMetric === "hits_at_10" ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  Hits@10
                </button>
              </div>
            </div>

            <svg key={chartMetric} viewBox="0 0 560 236" className="w-full h-[236px]">
              {[0, 0.25, 0.5, 0.75, 1.0].map((v) => {
                const y = 196 - v * 158;
                return (
                  <g key={v}>
                    <line
                      x1={44}
                      y1={y}
                      x2={544}
                      y2={y}
                      stroke="#f0f2f5"
                      strokeOpacity={v === 0 ? 0.14 : 0.06}
                      strokeDasharray={v === 0 ? undefined : "3 5"}
                    />
                    <text
                      x={36}
                      y={y + 3}
                      textAnchor="end"
                      fill="#737a87"
                      fontSize={10.5}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {chartMetric === "mrr" ? v.toFixed(2) : `${Math.round(v * 100)}%`}
                    </text>
                  </g>
                );
              })}

              {models.map((mKey, idx) => {
                const gVal = metrics.global_filtered[mKey][chartMetric];
                const oVal = metrics.ontology_constrained_filtered[mKey][chartMetric];
                const cx = 132 + idx * 164;
                const hG = Math.max(4, gVal * 158);
                const hO = Math.max(4, oVal * 158);
                const fmt = (n: number) => (chartMetric === "mrr" ? n.toFixed(3) : `${(n * 100).toFixed(1)}%`);
                return (
                  <g key={mKey}>
                    <rect
                      x={cx - 38}
                      y={196 - hG}
                      width={32}
                      height={hG}
                      rx={5}
                      fill="#4b5263"
                      className="anim-bar-y"
                      style={{ animationDelay: `${idx * 70}ms` }}
                    />
                    <text
                      x={cx - 22}
                      y={196 - hG - 8}
                      textAnchor="middle"
                      fill="#737a87"
                      fontSize={10.5}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {fmt(gVal)}
                    </text>

                    <rect
                      x={cx + 6}
                      y={196 - hO}
                      width={32}
                      height={hO}
                      rx={5}
                      fill={mKey === "DistMult" ? "#38bdf8" : "#818cf8"}
                      className="anim-bar-y"
                      style={{ animationDelay: `${idx * 70 + 110}ms` }}
                    />
                    <text
                      x={cx + 22}
                      y={196 - hO - 8}
                      textAnchor="middle"
                      fill="#f0f2f5"
                      fontSize={10.5}
                      fontWeight={500}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {fmt(oVal)}
                    </text>

                    <text
                      x={cx}
                      y={220}
                      textAnchor="middle"
                      fill="#a1a7b3"
                      fontSize={12}
                      fontFamily="IBM Plex Mono, monospace"
                    >
                      {mKey}
                    </text>
                  </g>
                );
              })}
            </svg>

            <div className="flex items-center gap-5 text-xs text-[#737a87]">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#4b5263]" />
                Global ranking
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#38bdf8]" />
                OWL-constrained leader
              </span>
            </div>
          </section>

          <aside className="surface-card rounded-2xl p-6 lg:col-span-5 flex flex-col justify-between space-y-4">
            <div>
              <h2 className="text-base font-medium text-[#f0f2f5]">OWL-constrained metrics</h2>
              <p className="mt-0.5 text-xs text-[#737a87]">
                Domain and range filtering lifts DistMult MRR nearly 3×
              </p>
            </div>

            <table className="w-full text-left font-mono text-xs tabular-nums">
              <thead className="border-b border-[#f0f2f5]/[0.08] text-[#737a87]">
                <tr>
                  <th className="py-2 font-normal">Model</th>
                  <th className="py-2 text-right font-normal">MRR</th>
                  <th className="py-2 text-right font-normal">Hits@1</th>
                  <th className="py-2 text-right font-normal">Hits@10</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f2f5]/[0.06]">
                {models.map((m) => {
                  const row = metrics.ontology_constrained_filtered[m];
                  return (
                    <tr key={m}>
                      <td className={`py-3 ${m === "DistMult" ? "font-medium text-[#f0f2f5]" : "text-[#a1a7b3]"}`}>
                        {m}
                      </td>
                      <td className={`py-3 text-right ${m === "DistMult" ? "text-[#38bdf8]" : "text-[#f0f2f5]"}`}>
                        {row.mrr.toFixed(3)}
                      </td>
                      <td className="py-3 text-right text-[#a1a7b3]">{(row.hits_at_1 * 100).toFixed(1)}%</td>
                      <td className="py-3 text-right text-[#f0f2f5]">{(row.hits_at_10 * 100).toFixed(1)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="border-t border-[#f0f2f5]/[0.07] pt-3 font-mono text-[11px] text-[#737a87]">
              Dim {metrics.dataset.embedding_dim} · {metrics.dataset.epochs} epochs · seed {metrics.dataset.seed}
            </div>
          </aside>
        </div>
      )}

      {/* Predict & Symbolic Audit + Nearest Entities */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="surface-card rounded-2xl p-6 space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medium text-[#f0f2f5]">Predict &amp; symbolically audit</h2>
            <span className="font-mono text-xs text-[#737a87]">isolated Predicted_Link</span>
          </div>

          <div className="flex flex-wrap gap-1">
            {PREDICT_PRESETS.map((p) => {
              const active = predHead === p.head && predRelation === p.relation;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => {
                    setPredHead(p.head);
                    setPredRelation(p.relation);
                    void runPredict(p.head, p.relation, predModel, enforceOwl);
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

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={predHead}
              onChange={(e) => setPredHead(e.target.value)}
              className="h-9 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
            >
              {entityGroups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <select
              value={predRelation}
              onChange={(e) => setPredRelation(e.target.value)}
              className="h-9 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
            >
              {RELATIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>

            <div className="inline-flex h-9 items-center rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 text-xs font-mono">
              {(["TransE", "DistMult"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPredModel(m)}
                  className={`rounded-md px-2.5 py-1 transition-colors duration-150 ${
                    predModel === m ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <label className="inline-flex cursor-pointer items-center gap-1.5 px-1 text-xs text-[#a1a7b3]">
              <input
                type="checkbox"
                checked={enforceOwl}
                onChange={(e) => setEnforceOwl(e.target.checked)}
                className="accent-[#38bdf8]"
              />
              <span>OWL types</span>
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => void runPredict()}
              className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-3.5 text-xs font-medium text-[#090b0f] hover:bg-white disabled:opacity-50"
            >
              <Play size={13} strokeWidth={1.75} />
              <span>Predict</span>
            </button>
          </div>

          <div key={predRun} className="divide-y divide-[#f0f2f5]/[0.07]">
            {customPreds.map((pl, idx) => {
              const riskKey = pl.symbolic_audit?.risk_level ?? "LOW_RISK";
              const rm = RISK_META[riskKey] ?? RISK_META.LOW_RISK;
              return (
                <div
                  key={`${pl.head}-${pl.relation}-${pl.tail}-${idx}`}
                  className="anim-rise py-3.5 space-y-2"
                  style={{ animationDelay: `${idx * 50}ms` }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-mono text-xs text-[#f0f2f5]">
                      {shortName(pl.head)} <span className="text-[#737a87]">{shortName(pl.relation)}</span>{" "}
                      <span className="font-medium">{shortName(pl.tail)}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 text-xs ${rm.text}`}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rm.dot }} />
                      {rm.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11px]">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1e222b]">
                      <div
                        className="anim-bar h-full rounded-full bg-[#818cf8]"
                        style={{
                          width: `${Math.max(4, Math.min(100, pl.confidence * 100))}%`,
                          animationDelay: `${idx * 60 + 80}ms`,
                        }}
                      />
                    </div>
                    <span className="w-12 text-right font-mono text-[#a1a7b3] tabular-nums">
                      {(pl.confidence * 100).toFixed(1)}%
                    </span>
                  </div>

                  {pl.symbolic_audit?.summary && (
                    <p className="text-xs text-[#737a87]">{pl.symbolic_audit.summary}</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="surface-card rounded-2xl p-6 space-y-4 lg:col-span-5">
          <div>
            <h2 className="text-base font-medium text-[#f0f2f5]">Nearest entities</h2>
            <p className="mt-0.5 text-xs text-[#737a87]">Cosine similarity in learned {predModel} space</p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={similarAnchor}
              onChange={(e) => {
                setSimilarAnchor(e.target.value);
                void runSimilar(e.target.value);
              }}
              className="h-9 flex-1 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
            >
              {entityGroups.map((g) => (
                <optgroup key={g.group} label={g.group}>
                  {g.items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.id}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void runSimilar(similarAnchor)}
              className="btn-press surface-raised inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs text-[#f0f2f5] hover:bg-[#252a36]"
            >
              <Search size={13} strokeWidth={1.5} />
              <span>Find</span>
            </button>
          </div>

          <div key={simRun} className="divide-y divide-[#f0f2f5]/[0.06]">
            {similarPeers.map((peer, idx) => {
              const pct = Math.max(0, Math.min(100, peer.cosine_similarity * 100));
              return (
                <div
                  key={`${peer.entity_id}-${idx}`}
                  className="anim-rise py-3 space-y-2"
                  style={{ animationDelay: `${idx * 45}ms` }}
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-mono text-[#f0f2f5]">{shortName(peer.entity_id)}</span>
                      <span className="ml-2 text-[11px] text-[#737a87]">{peer.entity_class}</span>
                    </div>
                    <span className="font-mono text-[#a1a7b3] tabular-nums">{peer.cosine_similarity.toFixed(3)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[#1e222b]">
                    <div
                      className="anim-bar h-full rounded-full bg-[#38bdf8]"
                      style={{ width: `${Math.max(4, pct)}%`, animationDelay: `${idx * 50 + 70}ms` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Audited Discovery Ledger */}
      {candidates.length > 0 && (
        <section className="surface-card rounded-2xl p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-medium text-[#f0f2f5]">Audited missing-link discoveries</h2>
            <span className="text-xs text-[#737a87]">Top neural suggestions gated by symbolic policy rules</span>
          </div>

          <div className="divide-y divide-[#f0f2f5]/[0.07]">
            {candidates.map((grp, gIdx) => {
              const top = grp.candidates[0];
              if (!top) return null;
              const rk = top.symbolic_audit?.risk_level ?? "LOW_RISK";
              const rm = RISK_META[rk] ?? RISK_META.LOW_RISK;
              return (
                <div
                  key={gIdx}
                  className="anim-rise flex flex-col gap-1.5 py-3.5 md:flex-row md:items-center md:justify-between"
                  style={{ animationDelay: `${gIdx * 50}ms` }}
                >
                  <div className="space-y-1">
                    <div className="text-xs font-medium text-[#f0f2f5]">{grp.query_title}</div>
                    <div className="font-mono text-xs text-[#a1a7b3]">
                      ({shortName(top.head)}, {shortName(top.relation)}, {shortName(top.tail)}) ·{" "}
                      <span className="text-[#737a87] tabular-nums">{(top.confidence * 100).toFixed(1)}%</span>
                    </div>
                    {top.symbolic_audit?.summary && (
                      <p className="text-xs text-[#737a87]">{top.symbolic_audit.summary}</p>
                    )}
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs ${rm.text}`}>
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: rm.dot }} />
                    {rm.label}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
