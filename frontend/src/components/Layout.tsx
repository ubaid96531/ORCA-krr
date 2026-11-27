import { Cpu, GitBranch, GitCompare, Network, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { KGStats, PageId } from "../types";
import { AnimatedNumber } from "./Common";
import { OceanBackdrop } from "./OceanBackdrop";
import { OrcaMark } from "./OrcaMark";

interface NavItem {
  id: PageId;
  label: string;
  Icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: "llm-only", label: "LLM only", Icon: Cpu },
  { id: "llm-kg", label: "LLM + KG", Icon: ShieldCheck },
  { id: "compare", label: "Compare both", Icon: GitCompare },
  { id: "graph", label: "Knowledge graph", Icon: Network },
  { id: "hybrid", label: "Hybrid AI", Icon: GitBranch },
];

export function Layout({
  activePage,
  onSelect,
  stats,
  children,
}: {
  activePage: PageId;
  onSelect: (page: PageId) => void;
  stats: KGStats | null;
  children: ReactNode;
}) {
  const isHome = activePage === "home";

  return (
    <div className="relative min-h-screen bg-[#0c1017] text-[#f0f2f5] flex flex-col">
      {/* Persistent underwater bubbles & drifting light-wave contours across all workspace tabs */}
      {!isHome && <OceanBackdrop opacity={1} />}

      {/* Quiet Arctic Obsidian top navigation */}
      <header className="sticky top-0 z-40 border-b border-[#f0f2f5]/[0.08] bg-[#090b0f]/90 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6 lg:px-8">
          {/* Flat Orca whale emblem — returns to scroll-dive home */}
          <button
            type="button"
            onClick={() => onSelect("home")}
            className="flex items-center gap-2.5 text-left shrink-0 transition-opacity duration-150 hover:opacity-85"
            title="Return to ORCA home"
          >
            <OrcaMark size={26} />
            <span className="text-[16px] font-semibold leading-none tracking-[-0.01em] text-[#f0f2f5]">
              ORCA
            </span>
          </button>

          {/* 5 focused workspace tabs */}
          <nav aria-label="Primary" className="flex items-center gap-1 overflow-x-auto">
            {NAV_ITEMS.map(({ id, label, Icon }) => {
              const active = activePage === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSelect(id)}
                  className={`btn-press flex h-8 items-center gap-2 rounded-lg px-3 text-[13px] whitespace-nowrap transition-colors duration-150 ${
                    active
                      ? "surface-active font-medium text-[#f0f2f5]"
                      : "border border-transparent font-normal text-[#a1a7b3] hover:bg-[#161920] hover:text-[#f0f2f5]"
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.5}
                    className={active ? "text-[#38bdf8]" : "text-[#737a87]"}
                  />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          {/* Quiet mono KG telemetry */}
          <div className="hidden md:flex items-center gap-2 shrink-0 font-mono text-xs text-[#737a87] tabular-nums">
            {stats ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
                <span className="text-[#f0f2f5]">
                  <AnimatedNumber value={stats.asserted_triples} />
                </span>
                <span>facts</span>
                <span className="text-[#2f3542]">·</span>
                <span className="text-[#f0f2f5]">
                  <AnimatedNumber value={stats.inferred_triples} />
                </span>
                <span>inferred</span>
              </>
            ) : (
              <span>Connecting</span>
            )}
          </div>
        </div>
      </header>

      {/* Full-bleed for Scroll-Dive Home, structured container for Workspace */}
      <main className="relative z-10 flex-1">
        {isHome ? (
          children
        ) : (
          <div
            key={activePage}
            className="anim-page mx-auto max-w-[1440px] px-6 py-8 lg:px-8 space-y-8"
          >
            {children}
          </div>
        )}
      </main>
    </div>
  );
}
