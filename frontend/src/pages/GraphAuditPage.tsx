import {
  ArrowRight,
  CheckCircle2,
  Code2,
  Play,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AnimatedGraphCanvas } from "../components/AnimatedGraphCanvas";
import { EmptyState, ErrorBanner, Loading, shortName } from "../components/Common";
import { EvidenceView } from "../components/EvidenceView";
import type {
  AccessPath,
  AgentExcessSummary,
  AnalysisResponse,
  AuthorizationDecision,
  EntitySummary,
  ExcessiveResult,
  GraphResponse,
  LeastPrivilegeResult,
  SparqlPreset,
  SparqlResponse,
  WhatIfResult,
} from "../types";

function formatPathOption(p: AccessPath): string {
  const agent = shortName(p.agent);
  const target = shortName(p.target);
  const via = p.triples.length > 1 ? ` via ${shortName(p.triples[0].triple[2])}` : "";
  return `${agent} → ${target}${via}${p.excessive_exposure ? " (excessive)" : ""}`;
}

const AUTH_PRESETS = [
  { label: "HelpdeskAgent · Reset passwords", agent: "HelpdeskAgent", task: "ResetStudentPasswords" },
  { label: "AdvisingAgent · Recommend courses", agent: "AdvisingAgent", task: "RecommendCourses" },
  { label: "TimetableAssistant · Publish timetable", agent: "TimetableAssistant", task: "PublishExamTimetable" },
  { label: "AdmissionsReviewAgent · Screen applications", agent: "AdmissionsReviewAgent", task: "ScreenApplications" },
];

export function GraphAuditPage({ initialPathId }: { initialPathId?: string | null }) {
  const [graphData, setGraphData] = useState<GraphResponse | null>(null);
  const [paths, setPaths] = useState<AccessPath[]>([]);
  const [agentFilter, setAgentFilter] = useState<string>("ALL");
  const [selectedPathId, setSelectedPathId] = useState<string>("");
  const [viewMode, setViewMode] = useState<"path" | "wave">("path");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [toolTab, setToolTab] = useState<"auth" | "whatif" | "sparql">("auth");

  const [agents, setAgents] = useState<EntitySummary[]>([]);
  const [tasks, setTasks] = useState<EntitySummary[]>([]);
  const [authAgent, setAuthAgent] = useState("HelpdeskAgent");
  const [authTask, setAuthTask] = useState("ResetStudentPasswords");
  const [authRes, setAuthRes] = useState<AnalysisResponse<AuthorizationDecision> | null>(null);
  const [authBusy, setAuthBusy] = useState(false);

  const [excessSummaries, setExcessSummaries] = useState<AgentExcessSummary[]>([]);
  const [whatIfAgent, setWhatIfAgent] = useState("ResearchSummaryAgent");
  const [excessRes, setExcessRes] = useState<AnalysisResponse<ExcessiveResult> | null>(null);
  const [lpRes, setLpRes] = useState<AnalysisResponse<LeastPrivilegeResult> | null>(null);
  const [whatIfRes, setWhatIfRes] = useState<AnalysisResponse<WhatIfResult> | null>(null);
  const [whatIfBusy, setWhatIfBusy] = useState(false);

  const [presets, setPresets] = useState<SparqlPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [sparqlQuery, setSparqlQuery] = useState("");
  const [sparqlRes, setSparqlRes] = useState<SparqlResponse | null>(null);
  const [sparqlBusy, setSparqlBusy] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.getGraph(false),
      api.getAccessPaths(),
      api.listCollection("agents"),
      api.listCollection("tasks"),
      api.getExcessiveAll(),
      api.getSparqlPresets(),
    ])
      .then(([g, p, ag, tk, exAll, sp]) => {
        setGraphData(g);
        setPaths(p);
        setAgents(ag);
        setTasks(tk);
        setExcessSummaries(exAll.result);
        setPresets(sp);
        if (sp.length > 0) {
          setSelectedPreset(sp[0].id);
          setSparqlQuery(sp[0].query);
        }

        const requested = initialPathId ? p.find((x) => x.path_id === initialPathId) : null;
        const preferred =
          requested ??
          p.find((x) => x.path_id === "path~LibraryHelpBot~tool~LibraryTool~ReadLibraryLoans~LibraryLoansDB~StudentPII") ??
          p.find((x) => x.excessive_exposure) ??
          p[0];
        if (preferred) setSelectedPathId(preferred.path_id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [initialPathId]);

  useEffect(() => {
    void runAuth("HelpdeskAgent", "ResetStudentPasswords");
  }, []);

  useEffect(() => {
    if (toolTab !== "whatif") return;
    setWhatIfRes(null);
    Promise.all([api.getExcessiveAgent(whatIfAgent), api.getLeastPrivilege(whatIfAgent)])
      .then(([ex, lp]) => {
        setExcessRes(ex);
        setLpRes(lp);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [whatIfAgent, toolTab]);

  const runAuth = async (a: string, t: string) => {
    setAuthBusy(true);
    setError(null);
    try {
      setAuthRes(await api.evaluateAuthorization(a, t));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuthBusy(false);
    }
  };

  const runWhatIf = async (permId: string) => {
    setWhatIfBusy(true);
    setError(null);
    try {
      setWhatIfRes(await api.whatIfRemove(whatIfAgent, shortName(permId)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWhatIfBusy(false);
    }
  };

  const runSparql = async (q = sparqlQuery) => {
    setSparqlBusy(true);
    setError(null);
    try {
      setSparqlRes(await api.runSparql(q));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSparqlBusy(false);
    }
  };

  const agentOptions = useMemo(
    () => Array.from(new Set(paths.map((p) => shortName(p.agent)))).sort(),
    [paths]
  );

  const filteredPaths = useMemo(() => {
    if (agentFilter === "ALL") return paths;
    return paths.filter((p) => shortName(p.agent) === agentFilter);
  }, [paths, agentFilter]);

  const activePath = useMemo(
    () => paths.find((p) => p.path_id === selectedPathId) ?? filteredPaths[0] ?? null,
    [paths, filteredPaths, selectedPathId]
  );

  const featuredChains = useMemo(() => {
    const picks: AccessPath[] = [];
    const want = ["LibraryHelpBot", "AdvisingAgent", "ResearchSummaryAgent", "HelpdeskAgent"];
    for (const agentName of want) {
      const found =
        paths.find((p) => shortName(p.agent) === agentName && p.excessive_exposure) ??
        paths.find((p) => shortName(p.agent) === agentName);
      if (found) picks.push(found);
    }
    return picks;
  }, [paths]);

  if (loading && !graphData) return <Loading label="Loading knowledge graph and access chains" />;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-normal leading-[1.15] tracking-[-0.02em] text-[#f0f2f5]">
            Knowledge graph <span className="text-[#737a87]">Multi-hop &amp; audit</span>
          </h1>
          <p className="mt-1.5 text-sm text-[#a1a7b3]">
            Watch each node spawn hop by hop, scrub radial hop waves, or test symbolic rules A–E and SPARQL below
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Filter by agent"
            value={agentFilter}
            onChange={(e) => {
              const next = e.target.value;
              setAgentFilter(next);
              const first = next === "ALL" ? paths[0] : paths.find((p) => shortName(p.agent) === next);
              if (first) setSelectedPathId(first.path_id);
              setViewMode("path");
            }}
            className="h-9 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#161920] px-3 text-xs text-[#f0f2f5] focus:border-[#38bdf8]/60 focus:outline-none"
          >
            <option value="ALL">All agents ({agentOptions.length})</option>
            {agentOptions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          <select
            aria-label="Select access path"
            value={activePath?.path_id ?? ""}
            onChange={(e) => {
              setSelectedPathId(e.target.value);
              setViewMode("path");
            }}
            className="h-9 max-w-[340px] rounded-lg border border-[#f0f2f5]/[0.1] bg-[#161920] px-3 text-xs text-[#f0f2f5] focus:border-[#38bdf8]/60 focus:outline-none"
          >
            {filteredPaths.map((p) => (
              <option key={p.path_id} value={p.path_id}>
                {formatPathOption(p)}
              </option>
            ))}
          </select>
        </div>
      </header>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Quick Demo Chains */}
      {featuredChains.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {featuredChains.map((p) => {
            const active = activePath?.path_id === p.path_id && viewMode === "path";
            return (
              <button
                key={p.path_id}
                type="button"
                onClick={() => {
                  setAgentFilter("ALL");
                  setSelectedPathId(p.path_id);
                  setViewMode("path");
                }}
                className={`btn-press inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs transition-colors duration-150 ${
                  active
                    ? "surface-active font-medium text-[#f0f2f5]"
                    : "text-[#a1a7b3] hover:bg-[#161920] hover:text-[#f0f2f5]"
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: p.excessive_exposure ? "#f43f5e" : "#34d399" }}
                />
                <span>
                  {shortName(p.agent)} → {shortName(p.target)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* HERO: Animated Node-Spawning Graph Canvas */}
      {graphData && (
        <AnimatedGraphCanvas
          graphData={graphData}
          activePath={activePath}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}

      {/* Symbolic Audit Toolkit */}
      <section className="surface-card rounded-2xl overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#f0f2f5]/[0.08] bg-[#11141b] px-5 py-3">
          <div className="inline-flex rounded-lg border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-0.5 text-xs">
            {[
              { id: "auth" as const, label: "Access check", Icon: ShieldCheck },
              { id: "whatif" as const, label: "Extra access & what-if", Icon: SlidersHorizontal },
              { id: "sparql" as const, label: "SPARQL (13 CQs)", Icon: Code2 },
            ].map(({ id, label, Icon }) => {
              const active = toolTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setToolTab(id)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 font-medium transition-colors duration-150 ${
                    active ? "surface-active text-[#f0f2f5]" : "text-[#737a87] hover:text-[#f0f2f5]"
                  }`}
                >
                  <Icon size={14} strokeWidth={1.5} />
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
          <span className="font-mono text-xs text-[#737a87]">OWL-RL + ORCA Rules A–E</span>
        </div>

        <div className="p-5">
          {toolTab === "auth" && (
            <div className="anim-rise space-y-4">
              <div className="flex flex-wrap gap-1">
                {AUTH_PRESETS.map((p) => {
                  const active = authAgent === p.agent && authTask === p.task;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setAuthAgent(p.agent);
                        setAuthTask(p.task);
                        void runAuth(p.agent, p.task);
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

              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={authAgent}
                  onChange={(e) => setAuthAgent(e.target.value)}
                  className="h-9 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
                >
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}
                    </option>
                  ))}
                </select>
                <ArrowRight size={14} strokeWidth={1.5} className="text-[#737a87]" />
                <select
                  value={authTask}
                  onChange={(e) => setAuthTask(e.target.value)}
                  className="h-9 rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
                >
                  {tasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={authBusy}
                  onClick={() => void runAuth(authAgent, authTask)}
                  className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-4 text-xs font-medium text-[#090b0f] hover:bg-white disabled:opacity-50"
                >
                  <span>Check authorization</span>
                </button>
              </div>

              {authRes && (
                <div
                  key={authRes.result.result_id}
                  className="anim-verdict rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-5 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-[#f0f2f5]">
                      {authRes.result.verdict === "AUTHORIZED" ? (
                        <CheckCircle2 size={16} strokeWidth={1.5} className="text-[#34d399]" />
                      ) : (
                        <XCircle size={16} strokeWidth={1.5} className="text-[#f43f5e]" />
                      )}
                      <span>
                        {shortName(authRes.result.agent_id)} → {shortName(authRes.result.task_id)}
                      </span>
                    </div>
                    <span
                      className={`font-mono text-xs font-medium ${
                        authRes.result.verdict === "AUTHORIZED" ? "text-[#34d399]" : "text-[#f43f5e]"
                      }`}
                    >
                      {authRes.result.verdict}
                    </span>
                  </div>

                  <p className="text-xs leading-relaxed text-[#a1a7b3]">{authRes.explanation}</p>

                  {(authRes.result.missing_permissions.length > 0 || authRes.result.violated_policies.length > 0) && (
                    <div className="flex flex-wrap gap-3 font-mono text-xs">
                      {authRes.result.missing_permissions.map((p) => (
                        <span key={p} className="text-[#f59e0b]">
                          Missing {shortName(p)}
                        </span>
                      ))}
                      {authRes.result.violated_policies.map((pol) => (
                        <span key={pol} className="text-[#f43f5e]">
                          Violates {shortName(pol)}
                        </span>
                      ))}
                    </div>
                  )}

                  <EvidenceView
                    evidence={authRes.evidence}
                    collapsible
                    defaultOpen={false}
                    title="Symbolic proof"
                    onAnimatePath={(pid) => {
                      setSelectedPathId(pid);
                      setViewMode("path");
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  />
                </div>
              )}
            </div>
          )}

          {toolTab === "whatif" && (
            <div className="anim-rise space-y-4">
              <div className="flex flex-wrap items-center gap-1">
                {excessSummaries.map((s) => {
                  const id = shortName(s.agent_id);
                  const active = whatIfAgent === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setWhatIfAgent(id)}
                      className={`btn-press inline-flex h-8 items-center gap-2 rounded-lg px-3 text-xs transition-colors duration-150 ${
                        active
                          ? "surface-active font-medium text-[#f0f2f5]"
                          : "text-[#a1a7b3] hover:bg-[#1e222b] hover:text-[#f0f2f5]"
                      }`}
                    >
                      <span>{id}</span>
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          s.excessive_count > 0 ? "text-[#f43f5e]" : "text-[#737a87]"
                        }`}
                      >
                        {s.excessive_count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {excessRes && (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-medium text-[#f0f2f5]">
                        Excess permissions on {whatIfAgent} ({excessRes.result.findings.length})
                      </h3>
                      <span className="font-mono text-[11px] text-[#737a87]">least privilege</span>
                    </div>
                    {excessRes.result.findings.length === 0 ? (
                      <EmptyState message={`${whatIfAgent} has 0 excess permissions`} />
                    ) : (
                      <div className="divide-y divide-[#f0f2f5]/[0.06]">
                        {excessRes.result.findings.map((f) => (
                          <div key={f.permission_id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs">
                            <div className="space-y-0.5">
                              <div className="font-mono text-[#f0f2f5]">{shortName(f.permission_id)}</div>
                              <div className="text-[11px] text-[#737a87]">
                                Exposes:{" "}
                                {f.extra_categories.length > 0
                                  ? f.extra_categories.map(shortName).join(", ")
                                  : "none"}
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={whatIfBusy}
                              onClick={() => void runWhatIf(f.permission_id)}
                              className="btn-press surface-raised inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs text-[#f0f2f5] hover:bg-[#252a36]"
                            >
                              <Play size={11} strokeWidth={1.75} />
                              <span>Simulate</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-4 space-y-3">
                    <h3 className="text-xs font-medium text-[#f0f2f5]">What-if impact</h3>
                    {whatIfRes ? (
                      <div key={whatIfRes.result.result_id} className="anim-verdict space-y-3 text-xs">
                        <div className="font-mono text-[#f0f2f5]">
                          Remove <span className="text-[#f59e0b]">{shortName(whatIfRes.result.permission_id)}</span>{" "}
                          from {shortName(whatIfRes.result.agent_id)}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {whatIfRes.result.categories_before.map((cat) => {
                            const removed = !whatIfRes.result.categories_after.includes(cat);
                            return (
                              <span
                                key={cat}
                                className={`rounded border px-2 py-0.5 font-mono text-[11px] ${
                                  removed
                                    ? "border-[#34d399]/35 bg-[#1e222b] text-[#34d399] line-through"
                                    : "border-[#f0f2f5]/[0.08] bg-[#161920] text-[#a1a7b3]"
                                }`}
                              >
                                {shortName(cat)}
                              </span>
                            );
                          })}
                        </div>
                        <div className="text-[11px]">
                          {whatIfRes.result.tasks_losing_authorization.length === 0 ? (
                            <span className="text-[#34d399]">Safe removal · 0 assigned tasks lose authorization</span>
                          ) : (
                            <span className="text-[#f43f5e]">
                              Breaks tasks: {whatIfRes.result.tasks_losing_authorization.map(shortName).join(", ")}
                            </span>
                          )}
                        </div>
                        <p className="text-[#a1a7b3]">{whatIfRes.explanation}</p>
                      </div>
                    ) : lpRes ? (
                      <div className="space-y-2 text-xs text-[#a1a7b3]">
                        <p>
                          Minimum required permissions ({lpRes.result.minimum_permission_set.length}):{" "}
                          <span className="font-mono text-[#f0f2f5]">
                            {lpRes.result.minimum_permission_set.map(shortName).join(", ") || "none"}
                          </span>
                        </p>
                        <p className="text-[#737a87]">
                          Click Simulate on any excess permission to preview before and after data exposure.
                        </p>
                      </div>
                    ) : (
                      <EmptyState message="Select an excess permission to simulate removal" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {toolTab === "sparql" && (
            <div className="anim-rise space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <select
                  value={selectedPreset}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedPreset(id);
                    const found = presets.find((p) => p.id === id);
                    if (found) setSparqlQuery(found.query);
                  }}
                  className="h-9 flex-1 min-w-[260px] rounded-lg border border-[#f0f2f5]/[0.1] bg-[#0f1115] px-3 text-xs text-[#f0f2f5]"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.id} — {p.title}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={sparqlBusy || !sparqlQuery.trim()}
                  onClick={() => void runSparql(sparqlQuery)}
                  className="btn-press inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#f0f2f5] px-4 text-xs font-medium text-[#090b0f] hover:bg-white disabled:opacity-50"
                >
                  <Play size={13} strokeWidth={1.75} />
                  <span>Run query</span>
                </button>
              </div>

              <textarea
                rows={6}
                value={sparqlQuery}
                onChange={(e) => setSparqlQuery(e.target.value)}
                spellCheck={false}
                className="w-full rounded-xl border border-[#f0f2f5]/[0.08] bg-[#090b0f] p-3.5 font-mono text-xs text-[#a1a7b3] focus:border-[#38bdf8]/60 focus:outline-none"
              />

              {sparqlRes && (
                <div className="anim-rise rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] overflow-x-auto">
                  {sparqlRes.query_type === "ASK" ? (
                    <div className="p-4 font-mono text-xs text-[#f0f2f5]">
                      ASK result: <span className="text-[#34d399]">{String(sparqlRes.boolean)}</span>
                    </div>
                  ) : sparqlRes.rows.length === 0 ? (
                    <div className="p-4 text-xs text-[#737a87]">0 rows returned</div>
                  ) : (
                    <table className="w-full text-left font-mono text-xs">
                      <thead className="border-b border-[#f0f2f5]/[0.08] bg-[#161920] text-[#737a87]">
                        <tr>
                          {sparqlRes.vars.map((v) => (
                            <th key={v} className="px-4 py-2.5 font-medium">
                              ?{v}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#f0f2f5]/[0.05]">
                        {sparqlRes.rows.slice(0, 30).map((row, idx) => (
                          <tr key={idx} className="hover:bg-[#1a1e26]">
                            {sparqlRes.vars.map((v) => (
                              <td key={v} className="px-4 py-2 text-[#f0f2f5]">
                                {row[v] ? shortName(row[v]!) : "—"}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
