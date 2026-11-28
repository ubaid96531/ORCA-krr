export type Provenance =
  | "Official_Fact"
  | "Synthetic_Fact"
  | "Inferred_Fact"
  | "Unlabelled"
  | "Predicted_Link";

export interface EntitySummary {
  id: string;
  label: string | null;
}

export interface EntityFact {
  predicate: string;
  object: string;
}

export interface EntityDetail {
  id: string;
  label: string | null;
  provenance: Provenance;
  facts: EntityFact[];
}

export interface LabelledFact {
  triple: [string, string, string];
  provenance: Provenance;
}

export interface InferredFact {
  triple: [string, string, string];
  rule_id: string;
  derived_from: [string, string, string][];
}

export interface AccessPath {
  path_id: string;
  agent: string;
  target: string;
  route: "tool" | "role" | "direct";
  triples: LabelledFact[];
  excessive_exposure: boolean;
  excessive_permissions: string[];
}

export interface EvidenceBundle {
  explicit_facts: LabelledFact[];
  inferred_facts: InferredFact[];
  applied_rules: string[];
  access_paths: AccessPath[];
}

export interface AnalysisResponse<T> {
  result: T;
  evidence: EvidenceBundle;
  explanation: string;
  ai_generated_text: string | null;
}

export interface AuthorizationDecision {
  result_id: string;
  agent_id: string;
  task_id: string;
  verdict: "AUTHORIZED" | "NOT_AUTHORIZED";
  missing_permissions: string[];
  violated_policies: string[];
  access_paths: AccessPath[];
  evidence: EvidenceBundle;
}

export interface ExcessiveFinding {
  permission_id: string;
  sources: string[];
  extra_resources: string[];
  extra_categories: string[];
  label: string;
  note: string;
}

export interface ExcessiveResult {
  result_id: string;
  agent_id: string;
  no_assigned_task: boolean;
  findings: ExcessiveFinding[];
  evidence: EvidenceBundle;
}

export interface AgentExcessSummary {
  agent_id: string;
  excessive_count: number;
  reachable_category_count: number;
}

export interface IndirectAccessResult {
  result_id: string;
  agent_id: string;
  categories: string[];
  paths: AccessPath[];
  evidence: EvidenceBundle;
}

export interface Recommendation {
  permission_id: string;
  sources: string[];
  categories_lost: string[];
}

export interface LeastPrivilegeResult {
  result_id: string;
  agent_id: string;
  minimum_permission_set: string[];
  recommendations: Recommendation[];
  evidence: EvidenceBundle;
}

export interface WhatIfResult {
  result_id: string;
  agent_id: string;
  permission_id: string;
  categories_before: string[];
  categories_after: string[];
  tasks_losing_authorization: string[];
  evidence: EvidenceBundle;
}

export interface KGStats {
  asserted_triples: number;
  tbox_triples: number;
  abox_triples: number;
  inferred_triples: number;
  class_counts: Record<string, number>;
  shortfalls: { name: string; value: number; minimum: number }[];
  store_type: "RDFLib" | "GraphDB";
}

export interface GraphNode {
  id: string;
  label: string | null;
  type: string | null;
  provenance: Provenance | null;
}

export interface GraphEdge {
  source: string;
  predicate: string;
  target: string;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SparqlPreset {
  id: string;
  filename: string;
  title: string;
  query: string;
}

export interface SparqlResponse {
  query_type: "SELECT" | "ASK" | "CONSTRUCT";
  vars: string[];
  rows: Record<string, string | null>[];
  boolean: boolean | null;
  triples: [string, string, string][];
}

export interface PredictedLink {
  head: string;
  relation: string;
  tail: string;
  raw_score: number;
  confidence: number;
  model: string;
  provenance: "Predicted_Link";
  verified: boolean;
  already_known: boolean;
  symbolic_audit: {
    owl_type_valid?: boolean;
    fixes_missing_permission?: boolean;
    introduces_policy_violation?: boolean;
    risk_level?: string;
    summary?: string;
    resolved_authorizations?: Array<{
      agent: string;
      task: string;
      verdict_before: string;
      verdict_after: string;
      resolved_permissions: string[];
    }>;
  };
}

export interface SimilarEntity {
  entity_id: string;
  entity_class: string;
  cosine_similarity: number;
  model: string;
}

export interface HybridCandidateGroup {
  query_title: string;
  head: string | null;
  relation: string;
  tail: string | null;
  model: string;
  candidates: PredictedLink[];
}

export interface EmbeddingEvalRow {
  num_test_triples: number;
  num_evaluations: number;
  ontology_constrained: boolean;
  mrr: number;
  mean_rank: number;
  hits_at_1: number;
  hits_at_3: number;
  hits_at_10: number;
}

export interface EmbeddingMetricsResponse {
  dataset: {
    num_entities: number;
    num_relations: number;
    total_relational_triples: number;
    train_triples: number;
    test_triples: number;
    embedding_dim: number;
    epochs: number;
    seed: number;
  };
  global_filtered: Record<"Random" | "TransE" | "DistMult", EmbeddingEvalRow>;
  ontology_constrained_filtered: Record<"Random" | "TransE" | "DistMult", EmbeddingEvalRow>;
}

export interface LLMOnlyResponse {
  question: string;
  llm_only_text: string;
  model_name: string | null;
  backend: string;
  latency_ms: number;
  ok: boolean;
  error: string | null;
}

export interface AssistantResponse {
  answer: string;
  question_type: string | null;
  result_id: string | null;
  evidence: EvidenceBundle | null;
  ai_generated_text: string | null;
  notes: string[];
  retrieved_context: string;
  predicted_links: PredictedLink[];
  sufficient_evidence: boolean;
  llm_mode: string;
  model_name: string | null;
}

export interface CompareResponse {
  question: string;
  llm_only_text: string;
  kg_grounded_text: string;
  template_answer: string;
  question_type: string | null;
  sufficient_evidence: boolean;
  retrieved_context: string;
  evidence: EvidenceBundle | null;
  predicted_links: PredictedLink[];
  notes: string[];
  model_name: string | null;
  llm_only_latency_ms: number;
  kg_grounded_latency_ms: number;
}

export interface EvaluationPayload {
  generated_at: string;
  model_name: string;
  backend: string;
  summary: {
    total_cqs: number;
    correct_a: number;
    correct_b: number;
    evidence_a: number;
    evidence_b: number;
    avg_recall_a: number;
    avg_recall_b: number;
    total_ie: number;
    refusal_a: number;
    refusal_b: number;
  };
  cq_results: Array<{
    cq: string;
    tags: string[];
    question: string;
    expected_summary: string;
    llm_only_answer: string;
    kg_grounded_answer: string;
    template_answer: string;
    retrieved_context: string;
    explicit_fact_count: number;
    inferred_fact_count: number;
    applied_rules: string[];
    correct_a: boolean;
    correct_b: boolean;
    evidence_a: boolean;
    evidence_b: boolean;
    llm_only_latency_ms: number;
    kg_grounded_latency_ms: number;
    score_a: { recall: number; missing_entities: string[]; unsupported_claims_likely: boolean };
    score_b: { recall: number; missing_entities: string[]; unsupported_claims_likely: boolean };
  }>;
  insufficient_evidence_results: Array<{
    cq: string;
    question: string;
    expected_summary: string;
    llm_only_answer: string;
    kg_grounded_answer: string;
    sufficient_evidence: boolean;
    refused_a: boolean;
    refused_b: boolean;
  }>;
}

export interface ExplainabilityTrace {
  id: string;
  title: string;
  question: string;
  intent: string;
  sufficient_evidence: boolean;
  template_answer: string;
  generated_text: string;
  retrieved_context: string;
  applied_rules: string[];
  explicit_facts: LabelledFact[];
  inferred_facts: InferredFact[];
  access_paths: Array<{
    path_id: string;
    agent?: string;
    route: "tool" | "role" | "direct";
    target: string;
    excessive_exposure: boolean;
    excessive_permissions?: string[];
    triples: LabelledFact[];
  }>;
  predicted_links: PredictedLink[];
  notes: string[];
  latency_ms?: number;
}

export interface ExplainabilityPayload {
  generated_at: string;
  model_name: string;
  traces: ExplainabilityTrace[];
}

export type PageId = "home" | "llm-only" | "llm-kg" | "compare" | "graph" | "hybrid";
