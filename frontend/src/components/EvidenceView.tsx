import { ArrowUpRight, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import type { EvidenceBundle, PredictedLink } from "../types";
import { EmptyState, shortName } from "./Common";
import { ProvenanceBadge } from "./ProvenanceBadge";

export function EvidenceView({
  evidence,
  predictedLinks,
  collapsible = true,
  defaultOpen = false,
  title = "Verified KG proof",
  onAnimatePath,
}: {
  evidence: EvidenceBundle | null;
  predictedLinks?: PredictedLink[];
  collapsible?: boolean;
  defaultOpen?: boolean;
  title?: string;
  onAnimatePath?: (pathId: string) => void;
}) {
  const [open, setOpen] = useState(defaultOpen);

  if (!evidence) return <EmptyState message="No evidence loaded yet" />;

  const summaryCounts = `${evidence.explicit_facts.length} known · ${evidence.inferred_facts.length} inferred · ${evidence.access_paths.length} paths`;

  const body = (
    <div className="anim-rise grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="surface-card rounded-xl p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-[#f0f2f5] tabular-nums">
            Explicit facts ({evidence.explicit_facts.length})
          </h3>
          <span className="font-mono text-xs text-[#737a87]">asserted</span>
        </div>
        {evidence.explicit_facts.length === 0 ? (
          <EmptyState message="No explicit facts matched" />
        ) : (
          <div className="max-h-56 divide-y divide-[#f0f2f5]/[0.06] overflow-y-auto pr-1">
            {evidence.explicit_facts.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 font-mono text-xs">
                <span className="text-[#a1a7b3]">
                  <span className="text-[#f0f2f5]">{shortName(f.triple[0])}</span>{" "}
                  <span className="text-[#737a87]">{shortName(f.triple[1])}</span>{" "}
                  <span className="text-[#f0f2f5]">{shortName(f.triple[2])}</span>
                </span>
                <ProvenanceBadge kind={f.provenance} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="surface-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-[#f0f2f5] tabular-nums">
            Inferred facts ({evidence.inferred_facts.length})
          </h3>
          <span className="font-mono text-xs text-[#737a87]">OWL-RL + Rules A–E</span>
        </div>

        {evidence.applied_rules.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {evidence.applied_rules.map((r) => (
              <span
                key={r}
                className="rounded border border-[#f0f2f5]/[0.09] bg-[#1e222b] px-2 py-0.5 font-mono text-[11px] text-[#a1a7b3]"
              >
                {r}
              </span>
            ))}
          </div>
        )}

        {evidence.inferred_facts.length === 0 ? (
          <EmptyState message="No rule derivations involved" />
        ) : (
          <div className="max-h-48 divide-y divide-[#f0f2f5]/[0.06] overflow-y-auto pr-1">
            {evidence.inferred_facts.map((inf, i) => (
              <div key={i} className="py-2.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[#f0f2f5]">
                  <span>{inf.triple.map(shortName).join(" ")}</span>
                  <span className="text-[#f59e0b]">{inf.rule_id}</span>
                </div>
                {inf.derived_from.length > 0 && (
                  <div className="font-mono text-[11px] text-[#737a87]">
                    From {inf.derived_from.map((t) => t.map(shortName).join(" ")).join(" ; ")}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {evidence.access_paths.length > 0 && (
        <section className="surface-card rounded-xl p-5 lg:col-span-2">
          <h3 className="mb-3 text-sm font-medium text-[#f0f2f5] tabular-nums">
            Access chains ({evidence.access_paths.length})
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {evidence.access_paths.map((ap) => (
              <div
                key={ap.path_id}
                className="rounded-lg border border-[#f0f2f5]/[0.07] bg-[#0f1115] p-3.5 text-xs space-y-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 font-medium text-[#f0f2f5]">
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ backgroundColor: ap.excessive_exposure ? "#f43f5e" : "#34d399" }}
                    />
                    {shortName(ap.agent)} → {shortName(ap.target)}
                  </span>
                  <div className="flex items-center gap-3">
                    {ap.excessive_exposure && <span className="font-mono text-[11px] text-[#f43f5e]">excessive</span>}
                    {onAnimatePath && (
                      <button
                        type="button"
                        onClick={() => onAnimatePath(ap.path_id)}
                        className="inline-flex items-center gap-1 text-[11px] text-[#38bdf8] transition-colors duration-150 hover:text-[#f0f2f5]"
                      >
                        <span>Animate</span>
                        <ArrowUpRight size={13} strokeWidth={1.5} />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-[#737a87]">
                  {ap.triples.map((t, j) => (
                    <div key={j}>
                      {j + 1}. <span className="text-[#a1a7b3]">{shortName(t.triple[0])}</span>{" "}
                      {shortName(t.triple[1])}{" "}
                      <span className="text-[#a1a7b3]">{shortName(t.triple[2])}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {predictedLinks && predictedLinks.length > 0 && (
        <section className="surface-card rounded-xl p-5 lg:col-span-2 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium text-[#f0f2f5] tabular-nums">
              Predicted candidates ({predictedLinks.length})
            </h3>
            <ProvenanceBadge kind="Predicted_Link" />
          </div>
          <div className="divide-y divide-[#f0f2f5]/[0.06]">
            {predictedLinks.map((pl, idx) => (
              <div key={idx} className="py-2.5 text-xs space-y-1">
                <div className="flex flex-wrap items-center justify-between gap-2 font-mono">
                  <span className="text-[#f0f2f5]">
                    ({shortName(pl.head)}, {shortName(pl.relation)}, {shortName(pl.tail)})
                  </span>
                  <span className="text-[#737a87] tabular-nums">
                    {pl.model} · {(pl.confidence * 100).toFixed(1)}% ·{" "}
                    <span className="text-[#f0f2f5]">{pl.symbolic_audit?.risk_level ?? "UNAUDITED"}</span>
                  </span>
                </div>
                {pl.symbolic_audit?.summary && (
                  <p className="text-[#a1a7b3]">{pl.symbolic_audit.summary}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  if (!collapsible) return body;

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="surface-card flex w-full items-center justify-between rounded-xl px-5 py-3.5 text-left text-sm transition-colors duration-150 hover:bg-[#1c2029]"
      >
        <div className="flex items-center gap-2.5">
          {open ? (
            <ChevronDown size={16} strokeWidth={1.5} className="text-[#737a87]" />
          ) : (
            <ChevronRight size={16} strokeWidth={1.5} className="text-[#737a87]" />
          )}
          <span className="font-medium text-[#f0f2f5]">{title}</span>
        </div>
        <span className="font-mono text-xs text-[#737a87] tabular-nums">{summaryCounts}</span>
      </button>
      {open && body}
    </div>
  );
}
