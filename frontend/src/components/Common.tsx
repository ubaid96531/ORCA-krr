import { AlertCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

export const DEMO_PRESETS = [
  {
    id: "policy",
    label: "Policy violation",
    q: "Which AI agents violate a security policy that governs one of their assigned tasks, and which official control does that policy implement?",
  },
  {
    id: "advising",
    label: "AdvisingAgent reach",
    q: "Which sensitive data categories can AdvisingAgent reach through indirect tool-permission-resource relationships?",
  },
  {
    id: "grading",
    label: "GradingAssistant",
    q: "What tools and permissions does GradingAssistant have, and what sensitive data can it reach?",
  },
  {
    id: "missing",
    label: "Missing tools",
    q: "Which AI agents lack required permissions, and what missing tools are predicted?",
  },
  {
    id: "trap",
    label: "PayrollDatabase trap",
    q: "Which AI agent has permission to read PayrollDatabase and what is its supervisor?",
  },
];

const ENTITY_DOT_COLORS: Record<string, string> = {
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

export function shortName(id: string): string {
  const idx = id.indexOf(":");
  return idx >= 0 ? id.slice(idx + 1) : id;
}

export function FormattedProse({ text }: { text: string }) {
  // Cleanly render **bold**, *emphasis*, and `code` tokens from raw LLM output without ugly raw asterisks
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`)/g;
  const parts: Array<{ kind: "text" | "bold" | "code"; value: string }> = [];
  let last = 0;
  for (const match of text.matchAll(tokenRegex)) {
    const start = match.index ?? 0;
    if (start > last) {
      parts.push({ kind: "text", value: text.slice(last, start) });
    }
    const raw = match[0];
    if (raw.startsWith("**")) {
      parts.push({ kind: "bold", value: raw.slice(2, -2) });
    } else if (raw.startsWith("*")) {
      parts.push({ kind: "code", value: raw.slice(1, -1) });
    } else {
      parts.push({ kind: "code", value: raw.slice(1, -1) });
    }
    last = start + raw.length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }

  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === "bold") {
          return (
            <strong key={i} className="font-medium text-[#f0f2f5]">
              {p.value}
            </strong>
          );
        }
        if (p.kind === "code") {
          return (
            <code
              key={i}
              className="mx-0.5 inline-flex items-center rounded-md border border-[#f0f2f5]/[0.1] bg-[#1e222b] px-1.5 py-0.5 font-mono text-[12px] text-[#f0f2f5]"
            >
              {p.value}
            </code>
          );
        }
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
}

export function EntityChipText({ text }: { text: string }) {
  const cleaned = text.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  const regex = /\b(agent|task|tool|role|perm|resource|category|policy|control|user):([A-Za-z0-9_-]+)\b/g;
  const parts: Array<string | { prefix: string; name: string }> = [];
  let last = 0;
  for (const match of cleaned.matchAll(regex)) {
    const start = match.index ?? 0;
    if (start > last) parts.push(cleaned.slice(last, start));
    parts.push({ prefix: match[1], name: match[2] });
    last = start + match[0].length;
  }
  if (last < cleaned.length) parts.push(cleaned.slice(last));

  return (
    <>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          <FormattedProse key={i} text={p} />
        ) : (
          <code
            key={i}
            className="mx-0.5 inline-flex items-center gap-1.5 rounded-md border border-[#f0f2f5]/[0.1] bg-[#1e222b] px-1.5 py-0.5 font-mono text-[12px] font-normal text-[#f0f2f5]"
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: ENTITY_DOT_COLORS[p.prefix] ?? "#737a87" }}
            />
            {p.name}
          </code>
        )
      )}
    </>
  );
}

export function AnimatedNumber({
  value,
  decimals = 0,
  suffix = "",
  duration = 560,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return (
    <span className="tabular-nums">
      {decimals > 0 ? display.toFixed(decimals) : Math.round(display)}
      {suffix}
    </span>
  );
}

export function ErrorBanner({ error, onDismiss }: { error: string | null; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className="anim-rise surface-card flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm text-[#f0f2f5]"
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle size={16} strokeWidth={1.5} className="mt-0.5 shrink-0 text-[#f43f5e]" />
        <span>{error}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="rounded-md p-1 text-[#737a87] transition-colors duration-150 hover:bg-[#1e222b] hover:text-[#f0f2f5]"
        >
          <X size={15} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-[#f0f2f5]/[0.07] bg-[#0f1115] p-5 text-center text-sm text-[#737a87]">
      {message}
    </div>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="surface-card rounded-xl p-5 space-y-3">
      <div className="flex items-center justify-between text-xs text-[#a1a7b3]">
        <span>{label}</span>
        <span className="font-mono text-[#737a87]">running</span>
      </div>
      <div className="h-[3px] w-full overflow-hidden rounded-full bg-[#1e222b]">
        <div className="anim-scan h-full w-1/3 rounded-full bg-[#38bdf8]" />
      </div>
    </div>
  );
}
