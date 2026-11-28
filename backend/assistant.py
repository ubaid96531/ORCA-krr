"""Knowledge-grounded Assistant (wraps ``backend.kg_rag`` and ``backend.llm_client``).

Maintains strict separation between deterministic KG evidence/template answers
and LLM-generated text (Req 14.8, 14.9, 17.1-17.11).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from backend.kg_rag import (
    RetrievedKGPackage,
    answer_kg_grounded,
    answer_llm_only,
    build_entity_catalog,
    check_grounding,
    classify_intent,
    extract_entities_and_unknowns,
    retrieve_kg_package,
)
from backend.llm_client import LLMClient, get_llm_client
from backend.models import (
    MAX_QUESTION_LENGTH,
    AssistantResponse,
    CompareResponse,
    LLMOnlyResponse,
    PredictedLinkModel,
    from_result,
)
from reasoning.models import KGSnapshot


@dataclass(frozen=True)
class MappedQuestion:
    operation: str
    ids: tuple[str, ...]


@dataclass(frozen=True)
class Unsupported:
    message: str


def map_question(question: str, kg: KGSnapshot) -> MappedQuestion | Unsupported:
    """Inspect a question and map it to its ORCA operation or Unsupported."""
    catalog = build_entity_catalog(kg.asserted)
    entities, unknowns = extract_entities_and_unknowns(question, catalog)
    intent = classify_intent(question, entities, unknowns)
    if intent in ("insufficient_evidence", "partial_unknown"):
        return Unsupported(
            "Question could not be answered from the ORCA KG (supported types: authorization, "
            "excessive permissions, indirect sensitive access, least privilege / what-if, policy controls, or entity lookup)."
        )
    return MappedQuestion(operation=intent, ids=tuple(e.compact_id for e in entities))


def check_llm_text(text: str, pkg: RetrievedKGPackage, kg: KGSnapshot) -> bool:
    """Validate LLM text against retrieved KG evidence."""
    catalog = build_entity_catalog(kg.asserted)
    ok, _ = check_grounding(text, pkg, catalog)
    return ok


def ask(
    question: str,
    kg: KGSnapshot,
    llm_client: LLMClient | None = None,
    *,
    use_default_llm: bool = True,
) -> AssistantResponse:
    """Answer a natural-language question using KG retrieval + optional LLM synthesis."""
    cleaned = (question or "").strip()
    if not cleaned or len(cleaned) > MAX_QUESTION_LENGTH:
        raise ValueError(f"Question must be between 1 and {MAX_QUESTION_LENGTH} non-whitespace characters.")

    client = llm_client
    if client is None and use_default_llm:
        client = get_llm_client()

    pkg, llm_resp, accepted_text, notes = answer_kg_grounded(kg, cleaned, client)
    ev_model = from_result(pkg.evidence)
    pred_models = [PredictedLinkModel.model_validate(p) for p in pkg.predicted_links]
    llm_mode = llm_resp.backend if (llm_resp is not None and accepted_text is not None) else "template"
    model_name = llm_resp.model if llm_resp is not None else None

    return AssistantResponse(
        answer=pkg.template_answer,
        question_type=pkg.intent,
        result_id=pkg.result_id,
        evidence=ev_model,  # type: ignore[arg-type]
        ai_generated_text=accepted_text,
        notes=notes,
        retrieved_context=pkg.retrieved_context,
        predicted_links=pred_models,
        sufficient_evidence=pkg.sufficient_evidence,
        llm_mode=llm_mode,
        model_name=model_name,
    )


def ask_llm_only(
    question: str,
    llm_client: LLMClient | None = None,
) -> LLMOnlyResponse:
    """Run Condition A (ungrounded LLM-only) without any KG retrieval."""
    cleaned = (question or "").strip()
    if not cleaned or len(cleaned) > MAX_QUESTION_LENGTH:
        raise ValueError(f"Question must be between 1 and {MAX_QUESTION_LENGTH} non-whitespace characters.")

    client = llm_client or get_llm_client()
    only_resp = answer_llm_only(cleaned, client)
    return LLMOnlyResponse(
        question=cleaned,
        llm_only_text=only_resp.text if only_resp.ok else f"(LLM error: {only_resp.error})",
        model_name=only_resp.model,
        backend=only_resp.backend,
        latency_ms=only_resp.latency_ms,
        ok=only_resp.ok,
        error=only_resp.error,
    )


def compare_llm_vs_kg(
    question: str,
    kg: KGSnapshot,
    llm_client: LLMClient | None = None,
) -> CompareResponse:
    """Run Condition A (LLM-only) vs Condition B (KG-grounded) using the identical LLM."""
    cleaned = (question or "").strip()
    if not cleaned or len(cleaned) > MAX_QUESTION_LENGTH:
        raise ValueError(f"Question must be between 1 and {MAX_QUESTION_LENGTH} non-whitespace characters.")

    client = llm_client or get_llm_client()
    only_resp = answer_llm_only(cleaned, client)
    pkg, kg_resp, accepted_text, notes = answer_kg_grounded(kg, cleaned, client)

    ev_model = from_result(pkg.evidence)
    pred_models = [PredictedLinkModel.model_validate(p) for p in pkg.predicted_links]
    return CompareResponse(
        question=cleaned,
        llm_only_text=only_resp.text if only_resp.ok else f"(LLM error: {only_resp.error})",
        kg_grounded_text=accepted_text or pkg.template_answer,
        template_answer=pkg.template_answer,
        question_type=pkg.intent,
        sufficient_evidence=pkg.sufficient_evidence,
        retrieved_context=pkg.retrieved_context,
        evidence=ev_model,  # type: ignore[arg-type]
        predicted_links=pred_models,
        notes=notes,
        model_name=(kg_resp.model if kg_resp else only_resp.model),
        llm_only_latency_ms=only_resp.latency_ms,
        kg_grounded_latency_ms=kg_resp.latency_ms if kg_resp else 0,
    )
