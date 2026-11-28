import type { Provenance } from "../types";

const PROVENANCE_META: Record<Provenance, { label: string; dot: string }> = {
  Official_Fact: { label: "Official rule", dot: "#38bdf8" },
  Synthetic_Fact: { label: "Scenario fact", dot: "#34d399" },
  Inferred_Fact: { label: "Inferred rule", dot: "#f59e0b" },
  Unlabelled: { label: "Schema", dot: "#737a87" },
  Predicted_Link: { label: "Unverified prediction", dot: "#818cf8" },
};

export function ProvenanceBadge({
  kind,
  extra,
}: {
  kind: Provenance | "AI_Generated";
  extra?: string;
}) {
  if (kind === "AI_Generated") {
    return (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs text-[#737a87]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" />
        <span>{extra ?? "AI summary"}</span>
      </span>
    );
  }
  const meta = PROVENANCE_META[kind] ?? PROVENANCE_META.Unlabelled;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-[#f0f2f5]/[0.09] bg-[#1e222b] px-2 py-0.5 text-xs text-[#a1a7b3]">
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.dot }} />
      <span>{meta.label}</span>
      {extra && <span className="font-mono text-[#737a87]">· {extra}</span>}
    </span>
  );
}
