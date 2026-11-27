import { ArrowUpRight } from "lucide-react";
import type { AccessPath, EvidenceBundle, PredictedLink } from "../types";
import { shortName } from "./Common";

const HOP_COLORS: Record<string, string> = {
  agent: "#38bdf8",
  task: "#60a5fa",
  tool: "#2dd4bf",
  role: "#2dd4bf",
  perm: "#f59e0b",
  resource: "#818cf8",
  category: "#f43f5e",
  policy: "#a78bfa",
  control: "#a1a7b3",
  user: "#34d399",
};

function colorForEntity(id: string): string {
  const prefix = id.includes(":") ? id.split(":")[0] : "";
  return HOP_COLORS[prefix] ?? "#a1a7b3";
}

function shortPred(pred: string): string {
  const local = shortName(pred);
  const map: Record<string, string> = {
    usesTool: "uses",
    hasRole: "role",
    hasPermission: "grants",
    accessesResource: "accesses",
    containsSensitiveData: "contains",
    assignedTask: "task",
    requiresPermission: "requires",
    governedByPolicy: "policy",
    implementsControl: "control",
    supervisedBy: "supervisor",
    prohibitsPermission: "blocks",
  };
  return map[local] ?? local;
}

/**
 * Circular SVG telemetry ring (GPU stroke-dashoffset, zero glow).
 */
export function TelemetryRing({
  percent,
  color,
  label,
  size = 44,
}: {
  percent: number;
  color: string;
  label: string;
  size?: number;
}) {
  const r = (size - 6) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = c - (clamped / 100) * c;

  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#252a36"
          strokeWidth={3}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.22, 1, 0.36, 1)" }}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-medium text-[#f0f2f5] tabular-nums">{label}</span>
    </div>
  );
}

/**
 * Slim animated segmented horizontal bar showing Official / Scenario / Inferred / Predicted provenance counts.
 */
export function ProvenanceBar({
  evidence,
  predictedLinks,
}: {
  evidence: EvidenceBundle | null;
  predictedLinks?: PredictedLink[];
}) {
  const official = evidence?.explicit_facts.filter((f) => f.provenance === "Official_Fact").length ?? 0;
  const synthetic = evidence?.explicit_facts.filter((f) => f.provenance === "Synthetic_Fact").length ?? 0;
  const otherExplicit = (evidence?.explicit_facts.length ?? 0) - official - synthetic;
  const inferred = evidence?.inferred_facts.length ?? 0;
  const predicted = predictedLinks?.length ?? 0;

  const segments = [
    { key: "Official", count: official, color: "#38bdf8" },
    { key: "Scenario", count: synthetic + otherExplicit, color: "#34d399" },
    { key: "Inferred", count: inferred, color: "#f59e0b" },
    { key: "Predicted", count: predicted, color: "#818cf8" },
  ].filter((s) => s.count > 0);

  const total = segments.reduce((acc, s) => acc + s.count, 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-[#a1a7b3]">Provenance mix</span>
        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] tabular-nums">
          {total === 0 ? (
            <span className="text-[#737a87]">0 verified triples</span>
          ) : (
            segments.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[#a1a7b3]">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
                <span>{s.key}</span>
                <span className="text-[#f0f2f5]">{s.count}</span>
              </span>
            ))
          )}
        </div>
      </div>

      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[#0f1115] border border-[#f0f2f5]/[0.06]">
        {total === 0 ? (
          <div className="h-full w-full bg-[#1e222b]" />
        ) : (
          segments.map((s, idx) => (
            <div
              key={s.key}
              className="anim-bar h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${(s.count / total) * 100}%`,
                backgroundColor: s.color,
                animationDelay: `${idx * 70}ms`,
              }}
            />
          ))
        )}
      </div>
    </div>
  );
}

/**
 * Compact live animated horizontal hop-chain rendered directly inside LLM + KG & Compare cards.
 */
export function MiniHopChain({
  path,
  onExpand,
}: {
  path: AccessPath | { path_id: string; route: string; target: string; excessive_exposure: boolean; triples: AccessPath["triples"] };
  onExpand?: (pathId: string) => void;
}) {
  if (!path.triples || path.triples.length === 0) return null;
  const nodes = [path.triples[0].triple[0], ...path.triples.map((t) => t.triple[2])];

  return (
    <div className="rounded-xl border border-[#f0f2f5]/[0.08] bg-[#0f1115] p-3.5 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: path.excessive_exposure ? "#f43f5e" : "#34d399" }}
          />
          <span className="font-medium text-[#f0f2f5]">
            {path.triples.length}-hop {path.route} chain
          </span>
          {path.excessive_exposure && (
            <span className="font-mono text-[11px] text-[#f43f5e]">excessive exposure</span>
          )}
        </div>
        {onExpand && (
          <button
            type="button"
            onClick={() => onExpand(path.path_id)}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[#38bdf8] transition-colors duration-150 hover:text-[#f0f2f5]"
          >
            <span>Expand in full graph</span>
            <ArrowUpRight size={13} strokeWidth={1.5} />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-y-2 gap-x-1.5 overflow-x-auto pb-0.5">
        {nodes.map((nodeId, idx) => (
          <div
            key={`${nodeId}-${idx}`}
            className="anim-rise inline-flex items-center gap-1.5"
            style={{ animationDelay: `${idx * 75}ms` }}
          >
            <span className="inline-flex items-center gap-1.5 rounded-md border border-[#f0f2f5]/[0.1] bg-[#161920] px-2.5 py-1 font-mono text-[11px] text-[#f0f2f5]">
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ backgroundColor: colorForEntity(nodeId) }}
              />
              <span>{shortName(nodeId)}</span>
            </span>
            {idx < path.triples.length && (
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#737a87]">
                <span className="h-px w-2.5 bg-[#38bdf8]/40" />
                <span>{shortPred(path.triples[idx].triple[1])}</span>
                <span>→</span>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Visual 10-CQ + 2-Trap Pass/Fail Dot Matrix for instant scannability on Compare both.
 */
export function DotMatrix10({
  cqResults,
  ieResults,
}: {
  cqResults: Array<{ cq: string; correct_a: boolean; correct_b: boolean }>;
  ieResults: Array<{ cq: string; refused_a: boolean; refused_b: boolean }>;
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-[#a1a7b3]">Per-CQ pass matrix</span>
        <span className="font-mono text-[10px] text-[#737a87]">10 CQs + 2 traps</span>
      </div>

      {/* Condition A Row */}
      <div className="flex items-center justify-between gap-2">
        <span className="w-16 font-mono text-[11px] text-[#737a87]">LLM only</span>
        <div className="flex flex-1 items-center gap-1.5">
          {cqResults.map((r, i) => (
            <span
              key={r.cq}
              title={`${r.cq}: ${r.correct_a ? "Pass" : "Fail"}`}
              className="anim-rise h-2.5 flex-1 rounded-sm"
              style={{
                backgroundColor: r.correct_a ? "#34d399" : "#f43f5e",
                opacity: r.correct_a ? 0.9 : 0.45,
                animationDelay: `${i * 25}ms`,
              }}
            />
          ))}
          <span className="mx-0.5 h-3 w-px bg-[#f0f2f5]/[0.12]" />
          {ieResults.map((ie, i) => (
            <span
              key={ie.cq}
              title={`${ie.cq}: ${ie.refused_a ? "Refused" : "Guessed"}`}
              className="anim-rise h-2.5 flex-1 rounded-sm"
              style={{
                backgroundColor: ie.refused_a ? "#34d399" : "#f59e0b",
                opacity: ie.refused_a ? 0.9 : 0.45,
                animationDelay: `${(10 + i) * 25}ms`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Condition B Row */}
      <div className="flex items-center justify-between gap-2">
        <span className="w-16 font-mono text-[11px] text-[#f0f2f5]">LLM + KG</span>
        <div className="flex flex-1 items-center gap-1.5">
          {cqResults.map((r, i) => (
            <span
              key={r.cq}
              title={`${r.cq}: ${r.correct_b ? "Pass" : "Fail"}`}
              className="anim-rise h-2.5 flex-1 rounded-sm"
              style={{
                backgroundColor: r.correct_b ? "#34d399" : "#f43f5e",
                animationDelay: `${i * 30 + 120}ms`,
              }}
            />
          ))}
          <span className="mx-0.5 h-3 w-px bg-[#f0f2f5]/[0.12]" />
          {ieResults.map((ie, i) => (
            <span
              key={ie.cq}
              title={`${ie.cq}: ${ie.refused_b ? "Safe refusal" : "Guessed"}`}
              className="anim-rise h-2.5 flex-1 rounded-sm"
              style={{
                backgroundColor: ie.refused_b ? "#38bdf8" : "#f43f5e",
                animationDelay: `${(10 + i) * 30 + 120}ms`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
