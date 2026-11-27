import {
  ArrowDown,
  ArrowRight,
  Cpu,
  GitBranch,
  GitCompare,
  Network,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { AnimatedNumber } from "../components/Common";
import { OceanBackdrop } from "../components/OceanBackdrop";
import { OrcaHeroIllustration } from "../components/OrcaMark";
import { TelemetryRing } from "../components/VisualWidgets";
import type { EmbeddingMetricsResponse, EvaluationPayload, KGStats, PageId } from "../types";

function clamp(v: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, v));
}

const BUBBLES = [
  { cx: 61, r: 4, startY: 78, speed: 52, delay: 0.42 },
  { cx: 65, r: 6.5, startY: 84, speed: 64, delay: 0.44 },
  { cx: 69, r: 3.5, startY: 76, speed: 46, delay: 0.46 },
  { cx: 73, r: 5, startY: 88, speed: 58, delay: 0.45 },
  { cx: 58, r: 3, startY: 86, speed: 42, delay: 0.48 },
  { cx: 76, r: 4.5, startY: 80, speed: 54, delay: 0.49 },
  { cx: 48, r: 3.5, startY: 90, speed: 48, delay: 0.52 },
  { cx: 34, r: 4, startY: 92, speed: 44, delay: 0.54 },
];

export function HomePage({
  stats,
  onNavigate,
}: {
  stats: KGStats | null;
  onNavigate: (page: PageId) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [evalSummary, setEvalSummary] = useState<EvaluationPayload["summary"] | null>(null);
  const [embMetrics, setEmbMetrics] = useState<EmbeddingMetricsResponse | null>(null);

  useEffect(() => {
    api.getLlmVsKgEvaluation().then((d) => setEvalSummary(d.summary)).catch(() => {});
    api.getEmbeddingMetrics().then(setEmbMetrics).catch(() => {});
  }, []);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const maxScroll = Math.max(1, el.offsetHeight - window.innerHeight);
      const scrolled = clamp(-rect.top / maxScroll, 0, 1);
      setProgress(scrolled);
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, []);

  const scrollToLaunchpad = () => {
    const el = containerRef.current;
    if (!el) return;
    const target = el.offsetTop + el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  };

  // Smooth phase curves driven directly by scroll progress (0 -> 1)
  const heroFade = 1 - clamp((progress - 0.14) / 0.24, 0, 1);
  const heroLift = clamp(progress / 0.36, 0, 1) * -44;

  // Orca parabolic breach & dive trajectory
  const diveT = clamp(progress / 0.72, 0, 1);
  const orcaX = diveT * 52;
  const orcaArcUp = Math.sin(Math.min(1, diveT * 1.45) * Math.PI) * -58;
  const orcaPlunge = Math.pow(diveT, 2.05) * 440;
  const orcaY = orcaArcUp + orcaPlunge;
  const orcaRotate = -14 + diveT * 68;
  const orcaScale = 1 - diveT * 0.22;
  const orcaOpacity = 1 - clamp((progress - 0.54) / 0.18, 0, 1);

  // Waterline rises over viewport as camera submerges into deep ocean
  const submergeT = clamp((progress - 0.32) / 0.42, 0, 1);
  const waterShiftVh = submergeT * -68;
  const waveOpacity = 1 - clamp((progress - 0.68) / 0.2, 0, 1);

  // Splash ripples at entry (0.36 -> 0.64)
  const splashT = clamp((progress - 0.35) / 0.28, 0, 1);
  const splashOpacity = splashT > 0 && splashT < 1 ? Math.sin(splashT * Math.PI) * 0.85 : 0;

  // Underwater Command Deck reveal (0.64 -> 0.92)
  const deckT = clamp((progress - 0.62) / 0.26, 0, 1);
  const deckY = (1 - deckT) * 28;

  const depthMeters = Math.round(progress * 120);
  const distMultOwl = embMetrics?.ontology_constrained_filtered.DistMult.mrr ?? 0.605;
  const distMultGlobal = embMetrics?.global_filtered.DistMult.mrr ?? 0.213;

  return (
    <div ref={containerRef} className="relative h-[225vh] bg-[#090b0f]">
      {/* Sticky Full-Viewport Choreographed Ocean Stage */}
      <div className="sticky top-14 h-[calc(100vh-56px)] w-full overflow-hidden bg-[#090b0f]">
        {/* Subtle Arctic Telemetry Grid (zero glow) */}
        <div
          className="pointer-events-none absolute inset-0 graph-stage"
          style={{ opacity: 0.75 - submergeT * 0.35 }}
        />

        {/* Deep Ocean Floor Subtle Depth Band (emerges underwater) */}
        <div
          className="pointer-events-none absolute inset-0 bg-[#0c1017]"
          style={{ opacity: submergeT * 0.92 }}
        />

        {/* Ambient rising bubbles, waves & miniature swimming Orcas once submerged */}
        {submergeT > 0.1 && (
          <OceanBackdrop opacity={Math.min(1, submergeT * 1.15)} showSwimmers={deckT > 0.2} />
        )}

        {/* ── PHASE 1: SKY HERO CONTENT (0% -> 38%) ── */}
        <div
          className="relative z-20 mx-auto flex h-full max-w-[1440px] items-start px-6 pt-12 sm:pt-16 lg:px-8"
          style={{
            opacity: heroFade,
            transform: `translateY(${heroLift}px)`,
            pointerEvents: heroFade > 0.15 ? "auto" : "none",
          }}
        >
          <div className="max-w-xl space-y-6">
            <div className="inline-flex items-center gap-2 font-mono text-xs text-[#737a87]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#38bdf8]" />
              <span>AI-3001 Knowledge Representation &amp; Reasoning · Team krr-34-orca</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-[48px] sm:text-[62px] font-normal leading-[1.03] tracking-[-0.03em] text-[#f0f2f5]">
                ORCA
              </h1>
              <p className="max-w-lg text-[17px] sm:text-[19px] font-normal leading-[1.48] text-[#a1a7b3]">
                Knowledge-grounded authorization, multi-hop graph reasoning, and hybrid link auditing for university AI agents
              </p>
            </div>

            {/* Live Compact Telemetry Strip */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-y border-[#f0f2f5]/[0.08] py-3 font-mono text-xs tabular-nums">
              <span>
                <span className="text-[#f0f2f5]">
                  <AnimatedNumber value={stats?.asserted_triples ?? 574} />
                </span>{" "}
                <span className="text-[#737a87]">asserted triples</span>
              </span>
              <span>
                <span className="text-[#f59e0b]">
                  <AnimatedNumber value={stats?.inferred_triples ?? 139} />
                </span>{" "}
                <span className="text-[#737a87]">inferred facts</span>
              </span>
              <span>
                <span className="text-[#34d399]">
                  {evalSummary ? `${evalSummary.correct_b}/${evalSummary.total_cqs}` : "10/10"}
                </span>{" "}
                <span className="text-[#737a87]">KG-grounded</span>
              </span>
              <span>
                <span className="text-[#38bdf8]">{distMultOwl.toFixed(3)}</span>{" "}
                <span className="text-[#737a87]">OWL MRR</span>
              </span>
            </div>

            {/* Primary & Secondary Actions */}
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => onNavigate("llm-only")}
                className="btn-press inline-flex h-11 items-center gap-2 rounded-lg bg-[#f0f2f5] px-5 text-sm font-medium text-[#090b0f] transition-colors duration-150 hover:bg-white"
              >
                <span>Enter workspace</span>
                <ArrowRight size={16} strokeWidth={1.5} />
              </button>
              <button
                type="button"
                onClick={scrollToLaunchpad}
                className="btn-press surface-raised inline-flex h-11 items-center gap-2 rounded-lg px-5 text-sm font-medium text-[#f0f2f5] transition-colors duration-150 hover:bg-[#252a36]"
              >
                <span>Dive into modules</span>
                <ArrowDown size={15} strokeWidth={1.5} />
              </button>
            </div>
          </div>
        </div>

        {/* ── PHASE 2: SCROLL-CHOREOGRAPHED DIVING ORCA WHALE ── */}
        <div
          className="pointer-events-none absolute right-[4%] top-[16%] z-10 w-[300px] sm:right-[7%] sm:w-[410px] lg:right-[10%] lg:w-[480px]"
          style={{
            opacity: orcaOpacity,
            transform: `translate3d(${orcaX}px, ${orcaY}px, 0) rotate(${orcaRotate}deg) scale(${orcaScale})`,
            transformOrigin: "55% 45%",
            willChange: "transform, opacity",
          }}
        >
          <OrcaHeroIllustration className="w-full h-auto" />
        </div>

        {/* ── PHASE 3: MULTI-LAYERED ANIMATED SVG OCEAN SURFACE & GEOMETRIC SPLASH ── */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[44vh]"
          style={{
            transform: `translate3d(0, ${waterShiftVh}vh, 0)`,
            opacity: waveOpacity,
            willChange: "transform, opacity",
          }}
        >
          {/* Crisp Geometric Entry Splash Arcs & Ripples */}
          {splashOpacity > 0.01 && (
            <svg
              viewBox="0 0 1200 180"
              className="absolute -top-[88px] left-0 w-full h-[140px]"
              style={{ opacity: splashOpacity }}
            >
              {/* Expanding elliptical surface rings at entry point */}
              <ellipse
                cx={860}
                cy={108}
                rx={28 + splashT * 110}
                ry={6 + splashT * 18}
                fill="none"
                stroke="#38bdf8"
                strokeWidth={1.5}
                strokeOpacity={0.75 * (1 - splashT * 0.5)}
              />
              <ellipse
                cx={860}
                cy={108}
                rx={12 + splashT * 68}
                ry={3 + splashT * 11}
                fill="none"
                stroke="#f0f2f5"
                strokeWidth={1.2}
                strokeOpacity={0.6 * (1 - splashT * 0.6)}
              />
              {/* Clean geometric splash arcs left & right */}
              <path
                d={`M 838 106 Q ${808 - splashT * 24} ${64 - splashT * 24} ${778 - splashT * 36} ${92 - splashT * 8}`}
                fill="none"
                stroke="#f0f2f5"
                strokeOpacity={0.65}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
              <path
                d={`M 882 106 Q ${912 + splashT * 26} ${60 - splashT * 26} ${946 + splashT * 36} ${90 - splashT * 6}`}
                fill="none"
                stroke="#38bdf8"
                strokeOpacity={0.75}
                strokeWidth={1.5}
                strokeLinecap="round"
              />
              <circle cx={792 - splashT * 24} cy={66 - splashT * 18} r={2.5} fill="#f0f2f5" fillOpacity={0.7} />
              <circle cx={930 + splashT * 28} cy={62 - splashT * 20} r={2.5} fill="#38bdf8" fillOpacity={0.8} />
              <circle cx={858} cy={52 - splashT * 24} r={2} fill="#f0f2f5" fillOpacity={0.55} />
            </svg>
          )}

          {/* 3 Layered Dark Ocean Waves */}
          <svg
            viewBox="0 0 1440 320"
            preserveAspectRatio="none"
            className="h-full w-[112%] -ml-[6%]"
          >
            {/* Back crest */}
            <path
              className="anim-wave-b"
              d="M0,74 C240,28 460,112 720,68 C980,24 1200,104 1440,58 L1440,320 L0,320 Z"
              fill="#0d131c"
              stroke="#38bdf8"
              strokeOpacity="0.22"
              strokeWidth="1.25"
            />
            {/* Mid wave */}
            <path
              className="anim-wave-a"
              d="M0,108 C280,148 520,58 780,102 C1040,146 1240,66 1440,104 L1440,320 L0,320 Z"
              fill="#101722"
              stroke="#f0f2f5"
              strokeOpacity="0.12"
              strokeWidth="1"
            />
            {/* Front deep water body */}
            <path
              d="M0,144 C320,110 620,178 960,136 C1180,108 1320,142 1440,132 L1440,320 L0,320 Z"
              fill="#0c1017"
            />
          </svg>
          {/* Seamless deep ocean fill extending past viewport bottom during submersion */}
          <div className="h-[85vh] w-full bg-[#0c1017] -mt-1" />
        </div>

        {/* Rising Underwater Sonar Bubbles (0.42 -> 0.85, zero blur) */}
        {progress > 0.4 && progress < 0.88 && (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="pointer-events-none absolute inset-0 z-10 h-full w-full"
          >
            {BUBBLES.map((b, i) => {
              const localT = clamp((progress - b.delay) / 0.36, 0, 1);
              if (localT <= 0 || localT >= 1) return null;
              const y = b.startY - localT * b.speed;
              const op = Math.sin(localT * Math.PI) * 0.45;
              return (
                <circle
                  key={i}
                  cx={b.cx}
                  cy={y}
                  r={b.r * 0.18}
                  fill="none"
                  stroke="#38bdf8"
                  strokeWidth={0.18}
                  strokeOpacity={op}
                />
              );
            })}
          </svg>
        )}

        {/* ── PHASE 4: UNDERWATER 5-MODULE COMMAND DECK (0.64 -> 1.0) ── */}
        <div
          className="absolute inset-0 z-30 flex items-center justify-center px-6 lg:px-8"
          style={{
            opacity: deckT,
            transform: `translate3d(0, ${deckY}px, 0)`,
            pointerEvents: deckT > 0.35 ? "auto" : "none",
            willChange: "transform, opacity",
          }}
        >
          <div className="w-full max-w-[1280px] space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="font-mono text-xs text-[#38bdf8] tabular-nums">
                  Depth {depthMeters}m · Workspace ready
                </div>
                <h2 className="mt-1 text-[26px] sm:text-[32px] font-normal leading-tight tracking-[-0.02em] text-[#f0f2f5]">
                  Choose a module to inspect
                </h2>
              </div>
              <span className="font-mono text-xs text-[#737a87] tabular-nums">
                5 modules · live RDFLib + Gemini 3.5 Flash-Lite
              </span>
            </div>

            {/* Top Row: The 3 AI Grounding Modes */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              {/* 1. LLM Only */}
              <button
                type="button"
                onClick={() => onNavigate("llm-only")}
                className="surface-card btn-press group rounded-2xl p-5 text-left transition-colors duration-150 hover:border-[#f0f2f5]/[0.18] hover:bg-[#1a1e27] space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs text-[#a1a7b3]">
                    <Cpu size={15} strokeWidth={1.5} className="text-[#f43f5e]" />
                    <span>Condition A</span>
                  </span>
                  <TelemetryRing
                    percent={evalSummary ? (evalSummary.correct_a / evalSummary.total_cqs) * 100 : 10}
                    color="#f43f5e"
                    label={evalSummary ? `${evalSummary.correct_a}/${evalSummary.total_cqs}` : "1/10"}
                    size={42}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-[#f0f2f5]">LLM only</span>
                    <ArrowRight
                      size={15}
                      strokeWidth={1.5}
                      className="text-[#737a87] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#f0f2f5]"
                    />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#737a87]">
                    Run the raw LLM with zero graph access to expose unsupported claims
                  </p>
                </div>
              </button>

              {/* 2. LLM + KG */}
              <button
                type="button"
                onClick={() => onNavigate("llm-kg")}
                className="surface-card btn-press group rounded-2xl p-5 text-left transition-colors duration-150 hover:border-[#f0f2f5]/[0.18] hover:bg-[#1a1e27] space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs text-[#a1a7b3]">
                    <ShieldCheck size={15} strokeWidth={1.5} className="text-[#34d399]" />
                    <span>Condition B</span>
                  </span>
                  <TelemetryRing
                    percent={evalSummary ? (evalSummary.correct_b / evalSummary.total_cqs) * 100 : 100}
                    color="#34d399"
                    label={evalSummary ? `${evalSummary.correct_b}/${evalSummary.total_cqs}` : "10/10"}
                    size={42}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-[#f0f2f5]">LLM + KG</span>
                    <ArrowRight
                      size={15}
                      strokeWidth={1.5}
                      className="text-[#737a87] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#f0f2f5]"
                    />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#737a87]">
                    Retrieve facts, hop paths, and OWL rules first — or refuse out-of-KG traps
                  </p>
                </div>
              </button>

              {/* 3. Compare Both */}
              <button
                type="button"
                onClick={() => onNavigate("compare")}
                className="surface-card btn-press group rounded-2xl p-5 text-left transition-colors duration-150 hover:border-[#f0f2f5]/[0.18] hover:bg-[#1a1e27] space-y-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-xs text-[#a1a7b3]">
                    <GitCompare size={15} strokeWidth={1.5} className="text-[#38bdf8]" />
                    <span>Benchmark</span>
                  </span>
                  {/* Mini dual bar visual */}
                  <div className="flex items-end gap-1.5 h-8">
                    <span className="w-3 rounded-sm bg-[#525866]" style={{ height: "20%" }} />
                    <span className="w-3 rounded-sm bg-[#38bdf8]" style={{ height: "100%" }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium text-[#f0f2f5]">Compare both</span>
                    <ArrowRight
                      size={15}
                      strokeWidth={1.5}
                      className="text-[#737a87] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#f0f2f5]"
                    />
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#737a87]">
                    Live side-by-side arena, 10-CQ dot matrix, and 4 explainability traces
                  </p>
                </div>
              </button>
            </div>

            {/* Bottom Row: Asymmetric 7 / 5 Split for Graph & Hybrid AI */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              {/* 4. Knowledge Graph & Hops (Featured 7 cols) */}
              <button
                type="button"
                onClick={() => onNavigate("graph")}
                className="surface-card btn-press group rounded-2xl p-5 text-left transition-colors duration-150 hover:border-[#f0f2f5]/[0.18] hover:bg-[#1a1e27] lg:col-span-7 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-xs text-[#a1a7b3]">
                    <Network size={15} strokeWidth={1.5} className="text-[#f59e0b]" />
                    <span>Interactive hop visualizer &amp; symbolic rules A–E</span>
                  </span>
                  <ArrowRight
                    size={15}
                    strokeWidth={1.5}
                    className="text-[#737a87] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#f0f2f5]"
                  />
                </div>

                {/* Mini 5-hop preview strip */}
                <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#f0f2f5]/[0.07] bg-[#090b0f] px-3 py-2.5 font-mono text-[11px]">
                  {[
                    { name: "LibraryHelpBot", col: "#38bdf8" },
                    { name: "LibraryTool", col: "#2dd4bf" },
                    { name: "ReadLibraryLoans", col: "#f59e0b" },
                    { name: "LibraryLoansDB", col: "#818cf8" },
                    { name: "StudentPII", col: "#f43f5e" },
                  ].map((n, idx) => (
                    <span key={n.name} className="inline-flex items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-[#f0f2f5]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: n.col }} />
                        {n.name}
                      </span>
                      {idx < 4 && <span className="text-[#737a87]">→</span>}
                    </span>
                  ))}
                </div>

                <div>
                  <div className="text-base font-medium text-[#f0f2f5]">Knowledge graph &amp; audit</div>
                  <p className="mt-1 text-xs text-[#737a87]">
                    Node-by-node hop spawning, radial BFS wave depth scrubber, Access check, What-if simulator, and 13 SPARQL queries
                  </p>
                </div>
              </button>

              {/* 5. Hybrid AI (5 cols) */}
              <button
                type="button"
                onClick={() => onNavigate("hybrid")}
                className="surface-card btn-press group rounded-2xl p-5 text-left transition-colors duration-150 hover:border-[#f0f2f5]/[0.18] hover:bg-[#1a1e27] lg:col-span-5 flex flex-col justify-between space-y-4"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-2 text-xs text-[#a1a7b3]">
                    <GitBranch size={15} strokeWidth={1.5} className="text-[#818cf8]" />
                    <span>Option D · Embeddings</span>
                  </span>
                  <ArrowRight
                    size={15}
                    strokeWidth={1.5}
                    className="text-[#737a87] transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-[#f0f2f5]"
                  />
                </div>

                {/* Mini MRR uplift bar preview */}
                <div className="space-y-1.5 rounded-xl border border-[#f0f2f5]/[0.07] bg-[#090b0f] px-3 py-2.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-[#737a87]">
                    <span>DistMult MRR uplift</span>
                    <span className="text-[#38bdf8] tabular-nums">
                      {distMultGlobal.toFixed(3)} → {distMultOwl.toFixed(3)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1e222b]">
                    <div className="h-full rounded-full bg-[#38bdf8]" style={{ width: `${Math.round(distMultOwl * 100)}%` }} />
                  </div>
                </div>

                <div>
                  <div className="text-base font-medium text-[#f0f2f5]">Hybrid AI predictions</div>
                  <p className="mt-1 text-xs text-[#737a87]">
                    TransE &amp; DistMult link prediction gated by symbolic OWL &amp; policy audits
                  </p>
                </div>
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT-EDGE LIVE SONAR DEPTH RULER ── */}
        <div
          aria-hidden="true"
          className="pointer-events-none fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col items-end gap-2 xl:flex"
        >
          <span className="font-mono text-[11px] text-[#38bdf8] tabular-nums">{depthMeters}m</span>
          <div className="relative h-36 w-px bg-[#f0f2f5]/[0.14]">
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <span
                key={t}
                className="absolute right-0 h-px w-2 bg-[#f0f2f5]/[0.25]"
                style={{ top: `${t * 100}%` }}
              />
            ))}
            <span
              className="absolute -right-[3px] h-[7px] w-[7px] rounded-full bg-[#38bdf8]"
              style={{ top: `calc(${progress * 100}% - 3.5px)` }}
            />
          </div>
          <span className="font-mono text-[10px] text-[#737a87]">
            {progress < 0.35 ? "surface" : progress < 0.68 ? "diving" : "abyss"}
          </span>
        </div>

        {/* Bottom Scroll Cue (visible only at top) */}
        <button
          type="button"
          onClick={scrollToLaunchpad}
          className="absolute bottom-6 left-1/2 z-30 -translate-x-1/2 inline-flex flex-col items-center gap-1 font-mono text-[11px] text-[#a1a7b3] transition-opacity duration-200 hover:text-[#f0f2f5]"
          style={{
            opacity: Math.max(0, 1 - progress * 5),
            pointerEvents: progress < 0.18 ? "auto" : "none",
          }}
        >
          <span>Scroll to dive</span>
          <ArrowDown size={14} strokeWidth={1.5} className="anim-scroll-bob text-[#38bdf8]" />
        </button>
      </div>
    </div>
  );
}
