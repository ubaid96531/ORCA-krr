import { useEffect, useState } from "react";
import { api } from "./api";
import { DEMO_PRESETS } from "./components/Common";
import { Layout } from "./components/Layout";
import { ComparePage } from "./pages/ComparePage";
import { GraphAuditPage } from "./pages/GraphAuditPage";
import { HomePage } from "./pages/HomePage";
import { HybridAiPage } from "./pages/HybridAiPage";
import { LlmKgPage } from "./pages/LlmKgPage";
import { LlmOnlyPage } from "./pages/LlmOnlyPage";
import type { KGStats, PageId } from "./types";

const VALID_PAGES = new Set<PageId>(["home", "llm-only", "llm-kg", "compare", "graph", "hybrid"]);

function parseHash(): { page: PageId; demo: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [pagePart, queryPart] = raw.split("?", 2);
  const aliasMap: Record<string, PageId> = {
    assistant: "llm-kg",
    evaluation: "compare",
    explorer: "graph",
    dashboard: "home",
  };
  const resolved = aliasMap[pagePart] ?? pagePart;
  const page = VALID_PAGES.has(resolved as PageId) ? (resolved as PageId) : "home";
  let demo: string | null = null;
  if (queryPart) {
    const params = new URLSearchParams(queryPart);
    demo = params.get("demo");
  }
  return { page, demo };
}

export default function App() {
  const initial = parseHash();
  const [page, setPage] = useState<PageId>(initial.page);
  const [question, setQuestion] = useState<string>(
    initial.demo === "insufficient" ? DEMO_PRESETS[4].q : DEMO_PRESETS[0].q
  );
  const [graphPathId, setGraphPathId] = useState<string | null>(null);
  const [stats, setStats] = useState<KGStats | null>(null);

  useEffect(() => {
    api.getStats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => {
      const parsed = parseHash();
      setPage(parsed.page);
      if (parsed.demo === "insufficient") {
        setQuestion(DEMO_PRESETS[4].q);
      }
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const navigate = (next: PageId) => {
    window.location.hash = `#${next}`;
    setPage(next);
    window.scrollTo({ top: 0 });
  };

  const animatePathInGraph = (pathId: string) => {
    setGraphPathId(pathId);
    navigate("graph");
  };

  return (
    <Layout activePage={page} onSelect={navigate} stats={stats}>
      {page === "home" && <HomePage stats={stats} onNavigate={navigate} />}
      {page === "llm-only" && (
        <LlmOnlyPage question={question} onQuestionChange={setQuestion} onNavigate={navigate} />
      )}
      {page === "llm-kg" && (
        <LlmKgPage
          question={question}
          onQuestionChange={setQuestion}
          onNavigate={navigate}
          onAnimatePath={animatePathInGraph}
        />
      )}
      {page === "compare" && (
        <ComparePage
          question={question}
          onQuestionChange={setQuestion}
          onAnimatePath={animatePathInGraph}
        />
      )}
      {page === "graph" && <GraphAuditPage initialPathId={graphPathId} />}
      {page === "hybrid" && <HybridAiPage />}
    </Layout>
  );
}
