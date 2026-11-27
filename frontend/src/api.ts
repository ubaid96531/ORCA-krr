import type {
  AccessPath,
  AgentExcessSummary,
  AnalysisResponse,
  AssistantResponse,
  AuthorizationDecision,
  CompareResponse,
  EmbeddingMetricsResponse,
  EntitySummary,
  EvaluationPayload,
  ExcessiveResult,
  ExplainabilityPayload,
  GraphResponse,
  HybridCandidateGroup,
  KGStats,
  LeastPrivilegeResult,
  LLMOnlyResponse,
  PredictedLink,
  SimilarEntity,
  SparqlPreset,
  SparqlResponse,
  WhatIfResult,
} from "./types";

const API_BASE = (
  (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ||
  (typeof window !== "undefined" && window.location.protocol.startsWith("http")
    ? ""
    : "http://127.0.0.1:8000")
).replace(/\/$/, "");

async function request<T>(opName: string, path: string, init?: RequestInit, timeoutMs = 45000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const body = await resp.json();
        if (body?.detail) {
          detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
        }
      } catch {
        // ignore JSON parse failure on error body
      }
      throw new Error(`${opName} failed: ${detail}`);
    }
    return (await resp.json()) as T;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`${opName} failed: request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    if (err instanceof Error) throw err;
    throw new Error(`${opName} failed: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  getStats: () => request<KGStats>("Load KG stats", "/api/kg/stats"),
  getGraph: (includeInferred = false) =>
    request<GraphResponse>("Load KG graph", `/api/kg/graph?include_inferred=${includeInferred}`),
  listCollection: (collection: string) =>
    request<EntitySummary[]>(`List ${collection}`, `/api/${collection}`),
  getAccessPaths: () => request<AccessPath[]>("List access paths", "/api/access-paths"),

  evaluateAuthorization: (agentId: string, taskId: string) =>
    request<AnalysisResponse<AuthorizationDecision>>("Authorization check", "/api/analysis/authorization", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, task_id: taskId }),
    }),
  getExcessiveAll: () =>
    request<{ result: AgentExcessSummary[] }>("Load excessive summary", "/api/analysis/excessive"),
  getExcessiveAgent: (agentId: string) =>
    request<AnalysisResponse<ExcessiveResult>>(
      "Load agent excessive permissions",
      `/api/analysis/excessive/${encodeURIComponent(agentId)}`
    ),
  getLeastPrivilege: (agentId: string) =>
    request<AnalysisResponse<LeastPrivilegeResult>>(
      "Load least privilege",
      `/api/analysis/least-privilege/${encodeURIComponent(agentId)}`
    ),
  whatIfRemove: (agentId: string, permissionId: string) =>
    request<AnalysisResponse<WhatIfResult>>("What-if simulation", "/api/analysis/what-if-removal", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, permission_id: permissionId }),
    }),

  getSparqlPresets: () => request<SparqlPreset[]>("Load SPARQL presets", "/api/sparql/presets"),
  runSparql: (query: string) =>
    request<SparqlResponse>("Run SPARQL query", "/api/sparql", {
      method: "POST",
      body: JSON.stringify({ query }),
    }),

  getEmbeddingMetrics: () =>
    request<EmbeddingMetricsResponse>("Load KG embedding metrics", "/api/reasoning/embeddings/metrics"),
  getSimilarEntities: (entityId: string, modelName = "TransE", topK = 5, sameClassOnly = false) =>
    request<SimilarEntity[]>(
      "Find similar entities",
      `/api/reasoning/embeddings/similar/${encodeURIComponent(entityId)}?model_name=${modelName}&top_k=${topK}&same_class_only=${sameClassOnly}`
    ),
  predictHybridLinks: (payload: {
    head?: string | null;
    relation: string;
    tail?: string | null;
    top_k?: number;
    model_name?: "TransE" | "DistMult";
    enforce_owl_types?: boolean;
  }) =>
    request<PredictedLink[]>("Predict hybrid links", "/api/reasoning/hybrid/predict", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getHybridCandidates: (modelName = "TransE") =>
    request<HybridCandidateGroup[]>(
      "Load hybrid link candidates",
      `/api/reasoning/hybrid/candidates?model_name=${modelName}`
    ),

  askLlmOnly: (question: string) =>
    request<LLMOnlyResponse>(
      "Ask LLM-only (Condition A)",
      "/api/assistant/llm-only",
      { method: "POST", body: JSON.stringify({ question }) },
      120000
    ),
  askAssistant: (question: string) =>
    request<AssistantResponse>(
      "Ask KG-grounded assistant (Condition B)",
      "/api/assistant/ask",
      { method: "POST", body: JSON.stringify({ question }) },
      120000
    ),
  compareAssistant: (question: string) =>
    request<CompareResponse>(
      "Compare LLM-only vs KG-grounded",
      "/api/assistant/compare",
      { method: "POST", body: JSON.stringify({ question }) },
      120000
    ),
  getLlmVsKgEvaluation: () =>
    request<EvaluationPayload>("Load LLM vs KG evaluation", "/api/evaluation/llm-vs-kg"),
  getExplainability: () =>
    request<ExplainabilityPayload>("Load explainability traces", "/api/evaluation/explainability"),
};
