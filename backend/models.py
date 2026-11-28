"""Pydantic request and response models for the Backend_API.

Design: Component 10 (Backend_API) and Data Models §7.
Requirements: 14.8, 14.9, 15.4, 15.5.

Request models validate every body (Req 15.4). FastAPI turns a validation
failure into HTTP 422 naming each invalid field (Req 15.5). Identifiers in
requests are bare local names (for example ``AdvisingAgent``); the API
resolves them to KG individuals.

Response models mirror ``reasoning/models.py`` with the same field names.
Analysis responses are wrapped in an envelope with separate ``result``,
``evidence``, ``explanation`` (Template_Explainer text) and
``ai_generated_text`` fields. ``ai_generated_text`` is ``None`` unless the
LLM_Provider produced accepted text, and the evidence never holds AI text
(Req 14.8, 14.9).
"""

from __future__ import annotations

from typing import Annotated, Any, Generic, Literal, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from reasoning import models as rm

# --------------------------------------------------------------------------- constrained types

IDENTIFIER_PATTERN = r"^[A-Za-z0-9_-]{1,100}$"
MAX_LABEL_LENGTH = 200
MAX_QUESTION_LENGTH = 500
MAX_SPARQL_LENGTH = 10_000

Identifier = Annotated[str, StringConstraints(pattern=IDENTIFIER_PATTERN, min_length=1, max_length=100)]
Label = Annotated[str, StringConstraints(min_length=1, max_length=MAX_LABEL_LENGTH)]

IdTriple = tuple[str, str, str]
Provenance = Literal["Official_Fact", "Synthetic_Fact", "Inferred_Fact", "Unlabelled"]


def _not_blank(value: str, field_name: str) -> str:
    if not value.strip():
        raise ValueError(f"{field_name} must not be blank or whitespace only")
    return value


# --------------------------------------------------------------------------- request models


class _Request(BaseModel):
    """Base for request bodies: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")


class CreateAgentRequest(_Request):
    id: Identifier
    label: Label


class CreateTaskRequest(_Request):
    id: Identifier
    label: Label
    required_permissions: list[Identifier] = Field(default_factory=list)


class AssignPermissionRequest(_Request):
    permission_id: Identifier


class AssignToolRequest(_Request):
    tool_id: Identifier


class AssignTaskRequest(_Request):
    task_id: Identifier


class AuthorizationRequest(_Request):
    agent_id: Identifier
    task_id: Identifier


class WhatIfRequest(_Request):
    agent_id: Identifier
    permission_id: Identifier


class SparqlRequest(_Request):
    query: Annotated[str, StringConstraints(min_length=1, max_length=MAX_SPARQL_LENGTH)]

    @field_validator("query")
    @classmethod
    def _query_not_blank(cls, value: str) -> str:
        return _not_blank(value, "query")


class AskRequest(_Request):
    question: Annotated[str, StringConstraints(min_length=1, max_length=MAX_QUESTION_LENGTH)]

    @field_validator("question")
    @classmethod
    def _question_not_blank(cls, value: str) -> str:
        return _not_blank(value, "question")


# --------------------------------------------------------------------------- result mirrors


class _Response(BaseModel):
    model_config = ConfigDict(frozen=True)


class LabelledFactModel(_Response):
    triple: IdTriple
    provenance: Provenance


class InferredFactModel(_Response):
    triple: IdTriple
    rule_id: str
    derived_from: list[IdTriple] = Field(default_factory=list)


class AccessPathModel(_Response):
    path_id: str
    agent: str
    target: str
    route: Literal["tool", "role", "direct"]
    triples: list[LabelledFactModel]
    excessive_exposure: bool = False
    excessive_permissions: list[str] = Field(default_factory=list)


class EvidenceBundleModel(_Response):
    """Four fields, always present, empty lists when there are no entries (Req 14.2)."""

    explicit_facts: list[LabelledFactModel] = Field(default_factory=list)
    inferred_facts: list[InferredFactModel] = Field(default_factory=list)
    applied_rules: list[str] = Field(default_factory=list)
    access_paths: list[AccessPathModel] = Field(default_factory=list)


class AuthorizationDecisionModel(_Response):
    result_id: str
    agent_id: str
    task_id: str
    verdict: Literal["AUTHORIZED", "NOT_AUTHORIZED"]
    missing_permissions: list[str]
    violated_policies: list[str]
    access_paths: list[AccessPathModel]
    evidence: EvidenceBundleModel


class ExcessiveFindingModel(_Response):
    permission_id: str
    sources: list[str]
    extra_resources: list[str] = Field(default_factory=list)
    extra_categories: list[str] = Field(default_factory=list)
    label: str = rm.EXCESSIVE_LABEL
    note: str = rm.NO_INTENT_NOTE


class ExcessiveResultModel(_Response):
    result_id: str
    agent_id: str
    no_assigned_task: bool
    findings: list[ExcessiveFindingModel]
    evidence: EvidenceBundleModel


class AgentExcessSummaryModel(_Response):
    agent_id: str
    excessive_count: int
    reachable_category_count: int


class IndirectAccessResultModel(_Response):
    result_id: str
    agent_id: str
    categories: list[str]
    paths: list[AccessPathModel]
    evidence: EvidenceBundleModel


class RecommendationModel(_Response):
    permission_id: str
    sources: list[str]
    categories_lost: list[str]


class LeastPrivilegeResultModel(_Response):
    result_id: str
    agent_id: str
    minimum_permission_set: list[str]
    recommendations: list[RecommendationModel]
    evidence: EvidenceBundleModel


class WhatIfResultModel(_Response):
    result_id: str
    agent_id: str
    permission_id: str
    categories_before: list[str]
    categories_after: list[str]
    tasks_losing_authorization: list[str]
    evidence: EvidenceBundleModel


# Dataclass -> Pydantic mirror.
RESULT_MODELS: dict[type, type[BaseModel]] = {
    rm.LabelledFact: LabelledFactModel,
    rm.InferredFact: InferredFactModel,
    rm.AccessPath: AccessPathModel,
    rm.EvidenceBundle: EvidenceBundleModel,
    rm.AuthorizationDecision: AuthorizationDecisionModel,
    rm.ExcessiveFinding: ExcessiveFindingModel,
    rm.ExcessiveResult: ExcessiveResultModel,
    rm.AgentExcessSummary: AgentExcessSummaryModel,
    rm.IndirectAccessResult: IndirectAccessResultModel,
    rm.Recommendation: RecommendationModel,
    rm.LeastPrivilegeResult: LeastPrivilegeResultModel,
    rm.WhatIfResult: WhatIfResultModel,
}


def from_result(obj: Any) -> BaseModel:
    """Convert a ``reasoning.models`` result dataclass into its Pydantic mirror."""
    model_cls = RESULT_MODELS.get(type(obj))
    if model_cls is None:
        raise TypeError(f"No response model for {type(obj).__name__}")
    return model_cls.model_validate(rm.to_dict(obj))


# --------------------------------------------------------------------------- envelopes

T = TypeVar("T", bound=BaseModel)


class AnalysisResponse(BaseModel, Generic[T]):
    """``{"result", "evidence", "explanation", "ai_generated_text"}`` (Req 14.8, 14.9).

    ``evidence`` is built only from KG facts; LLM text goes only into
    ``ai_generated_text``, which stays ``None`` when no accepted LLM text exists.
    """

    result: T
    evidence: EvidenceBundleModel
    explanation: str = ""
    ai_generated_text: Optional[str] = None


def analysis_response(
    obj: Any, explanation: str = "", ai_generated_text: Optional[str] = None
) -> AnalysisResponse:
    """Wrap a result dataclass that carries an ``evidence`` field in the envelope."""
    result = from_result(obj)
    evidence = getattr(result, "evidence", None)
    if not isinstance(evidence, EvidenceBundleModel):
        raise TypeError(f"{type(obj).__name__} has no evidence bundle")
    return AnalysisResponse[type(result)](
        result=result,
        evidence=evidence,
        explanation=explanation,
        ai_generated_text=ai_generated_text,
    )


AuthorizationResponse = AnalysisResponse[AuthorizationDecisionModel]
ExcessiveResponse = AnalysisResponse[ExcessiveResultModel]
IndirectAccessResponse = AnalysisResponse[IndirectAccessResultModel]
LeastPrivilegeResponse = AnalysisResponse[LeastPrivilegeResultModel]
WhatIfResponse = AnalysisResponse[WhatIfResultModel]


class ExcessiveSummaryResponse(BaseModel):
    """All-agent excessive-permission summary (CQ3). Holds no evidence and no AI text."""

    result: list[AgentExcessSummaryModel]
    ai_generated_text: Optional[str] = None


class EvidenceResponse(BaseModel):
    result_id: str
    evidence: EvidenceBundleModel


# --------------------------------------------------------------------------- entity and KG views


class EntitySummary(BaseModel):
    id: str
    label: Optional[str] = None


class EntityFact(BaseModel):
    predicate: str
    object: str


class EntityDetail(BaseModel):
    id: str
    label: Optional[str] = None
    provenance: Provenance
    facts: list[EntityFact] = Field(default_factory=list)


class ShortfallModel(BaseModel):
    name: str
    value: int
    minimum: int


class KGStatsResponse(BaseModel):
    asserted_triples: int
    tbox_triples: int
    abox_triples: int
    inferred_triples: int
    class_counts: dict[str, int] = Field(default_factory=dict)
    shortfalls: list[ShortfallModel] = Field(default_factory=list)
    store_type: str


class GraphNode(BaseModel):
    id: str
    label: Optional[str] = None
    type: Optional[str] = None
    provenance: Optional[Provenance] = None


class GraphEdge(BaseModel):
    source: str
    predicate: str
    target: str


class GraphResponse(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


class DashboardSummary(BaseModel):
    agent_count: int
    tool_count: int
    permission_count: int
    resource_count: int
    authorized_count: int
    not_authorized_count: int
    excessive_permission_count: int
    reachable_category_count: int
    indirect_path_count: int


class SparqlResponse(BaseModel):
    query_type: Literal["SELECT", "ASK", "CONSTRUCT"]
    vars: list[str] = Field(default_factory=list)
    rows: list[dict[str, Optional[str]]] = Field(default_factory=list)
    boolean: Optional[bool] = None
    triples: list[IdTriple] = Field(default_factory=list)


class PredictedLinkModel(_Response):
    head: str
    relation: str
    tail: str
    raw_score: float
    confidence: float
    model: str
    provenance: Literal["Predicted_Link"] = "Predicted_Link"
    verified: bool = False
    already_known: bool = False
    symbolic_audit: dict[str, Any] = Field(default_factory=dict)


class PredictLinkRequest(_Request):
    head: Optional[Identifier] = None
    relation: Identifier
    tail: Optional[Identifier] = None
    top_k: int = Field(default=5, ge=1, le=20)
    model_name: Literal["TransE", "DistMult"] = "TransE"
    enforce_owl_types: bool = True


class SimilarEntityModel(_Response):
    entity_id: str
    entity_class: str
    cosine_similarity: float
    model: str


class AssistantResponse(BaseModel):
    answer: str
    question_type: Optional[str] = None
    result_id: Optional[str] = None
    evidence: Optional[EvidenceBundleModel] = None
    ai_generated_text: Optional[str] = None
    notes: list[str] = Field(default_factory=list)
    retrieved_context: str = ""
    predicted_links: list[PredictedLinkModel] = Field(default_factory=list)
    sufficient_evidence: bool = True
    llm_mode: str = "template"
    model_name: Optional[str] = None


class LLMOnlyResponse(BaseModel):
    question: str
    llm_only_text: str
    model_name: Optional[str] = None
    backend: str = "template"
    latency_ms: int = 0
    ok: bool = True
    error: Optional[str] = None


class CompareResponse(BaseModel):
    question: str
    llm_only_text: str
    kg_grounded_text: str
    template_answer: str
    question_type: Optional[str] = None
    sufficient_evidence: bool = True
    retrieved_context: str = ""
    evidence: Optional[EvidenceBundleModel] = None
    predicted_links: list[PredictedLinkModel] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    model_name: Optional[str] = None
    llm_only_latency_ms: int = 0
    kg_grounded_latency_ms: int = 0


class ErrorResponse(BaseModel):
    detail: str
