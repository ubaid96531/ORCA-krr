"""Generate 4 end-to-end Explainability & Provenance traces (Iteration 2 Section 5).

Clearly distinguishes:
1. Explicit knowledge (Official_Fact / Synthetic_Fact directly stored in KG)
2. Inferred knowledge (derived via OWL-RL axioms or ORCA rules A-E)
3. Predicted links (unverified KG embedding predictions, when applicable)
4. Generated text (the LLM's natural-language response)
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.kg_rag import answer_kg_grounded
from backend.llm_client import LLMClient, get_llm_client
from reasoning.embeddings import load_or_train_bundle
from reasoning.files import atomic_write
from reasoning.hybrid import predict_and_audit
from reasoning.kg import load_snapshot

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EXPL_JSON = PROJECT_ROOT / "results" / "explainability_examples.json"
DEFAULT_EXPL_MD = PROJECT_ROOT / "results" / "explainability_examples.md"

EXPLAINABILITY_SCENARIOS: list[dict[str, Any]] = [
    {
        "id": "Trace-1",
        "title": "Multi-Hop Indirect Sensitive Data Access (LibraryHelpBot -> StudentPII)",
        "question": "Which sensitive data categories can LibraryHelpBot reach indirectly, and what paths establish access?",
        "include_hybrid_prediction": False,
    },
    {
        "id": "Trace-2",
        "title": "Symbolic Rule Inference & Official Control Trace (HelpdeskAgent Policy Violation)",
        "question": "Which AI agents violate a security policy governing their assigned task, and which official control does that policy implement?",
        "include_hybrid_prediction": False,
    },
    {
        "id": "Trace-3",
        "title": "Hybrid Symbolic + Embedding Reasoning (TimetableAssistant Missing Permission & Predicted Link)",
        "question": "Which AI agents lack required permissions, and what missing tools or permissions are predicted?",
        "include_hybrid_prediction": True,
    },
    {
        "id": "Trace-4",
        "title": "Insufficient Evidence Refusal (Out-of-KG Query on PayrollDatabase)",
        "question": "Which AI agent has permission to read PayrollDatabase and who supervises it?",
        "include_hybrid_prediction": False,
    },
]


def _render_md(traces: list[dict[str, Any]], model_name: str, generated_at: str) -> str:
    lines = [
        "# ORCA Explainability and Provenance Examples",
        "",
        f"- Generated at: {generated_at}",
        f"- LLM model: `{model_name}`",
        "",
    ]
    for tr in traces:
        lines.append(f"## {tr['id']}: {tr['title']}")
        lines.append("")
        lines.append(f"- **User question:** {tr['question']}")
        lines.append(f"- **Detected intent:** `{tr['intent']}` | **Sufficient evidence:** `{tr['sufficient_evidence']}`")
        lines.append(f"- **Generated text (LLM response):** {tr['generated_text']}")
        lines.append(f"- **Deterministic KG template summary:** {tr['template_answer']}")
        lines.append("")
        lines.append("### 1. Explicit Knowledge (Directly Stored in KG)")
        if tr["explicit_facts"]:
            for f in tr["explicit_facts"][:12]:
                lines.append(f"- `[{f['provenance']}]` `{ ' '.join(f['triple']) }`")
        else:
            lines.append("- None (no matching facts in the ORCA KG).")
        lines.append("")
        lines.append("### 2. Inferred Knowledge (Schema Axioms / ORCA Rules A-E)")
        if tr["inferred_facts"]:
            for inf in tr["inferred_facts"][:10]:
                srcs = "; ".join(" ".join(s) for s in inf["derived_from"])
                lines.append(f"- `[Inferred_Fact via {inf['rule_id']}]` `{' '.join(inf['triple'])}` <- `({srcs})`")
        else:
            lines.append("- None triggered.")
        lines.append("")
        lines.append("### 3. Multi-Hop Access Paths")
        if tr["access_paths"]:
            for ap in tr["access_paths"][:6]:
                chain = " -> ".join([f"{t['triple'][0]} --{t['triple'][1]}--> {t['triple'][2]}" for t in ap["triples"]])
                lines.append(f"- `[{ap['route']}]` {chain} (excessive_exposure={ap['excessive_exposure']})")
        else:
            lines.append("- None.")
        if tr["predicted_links"]:
            lines.append("")
            lines.append("### 4. Predicted Links (Unverified KG Embedding Predictions — NOT Confirmed Facts)")
            for pl in tr["predicted_links"][:5]:
                aud = pl.get("symbolic_audit", {})
                lines.append(
                    f"- `[Predicted_Link | verified=False | {pl['model']} conf={pl['confidence']:.4f}]` "
                    f"`({pl['head']}, {pl['relation']}, {pl['tail']})` -> `{aud.get('risk_level','')}`: {aud.get('summary','')}"
                )
        lines.append("")
    return "\n".join(lines) + "\n"


def generate_traces(
    llm_client: LLMClient | None = None,
    *,
    out_json: Path = DEFAULT_EXPL_JSON,
    out_md: Path = DEFAULT_EXPL_MD,
) -> dict[str, Any]:
    kg = load_snapshot()
    client = llm_client or get_llm_client()
    bundle = load_or_train_bundle(kg)

    traces: list[dict[str, Any]] = []
    for sc in EXPLAINABILITY_SCENARIOS:
        pkg, llm_resp, accepted_text, notes = answer_kg_grounded(kg, sc["question"], client, max_new_tokens=220)
        preds = list(pkg.predicted_links)
        if sc["include_hybrid_prediction"] and not preds:
            preds = predict_and_audit(kg, bundle, head_id="agent:TimetableAssistant", relation_id="orca:usesTool", top_k=3)

        traces.append({
            "id": sc["id"],
            "title": sc["title"],
            "question": sc["question"],
            "intent": pkg.intent,
            "sufficient_evidence": pkg.sufficient_evidence,
            "template_answer": pkg.template_answer,
            "generated_text": accepted_text or pkg.template_answer,
            "retrieved_context": pkg.retrieved_context,
            "applied_rules": list(pkg.evidence.applied_rules),
            "explicit_facts": [
                {"triple": list(f.triple), "provenance": f.provenance} for f in pkg.evidence.explicit_facts
            ],
            "inferred_facts": [
                {
                    "triple": list(inf.triple),
                    "rule_id": inf.rule_id,
                    "derived_from": [list(t) for t in inf.derived_from],
                }
                for inf in pkg.evidence.inferred_facts
            ],
            "access_paths": [
                {
                    "path_id": ap.path_id,
                    "route": ap.route,
                    "target": ap.target,
                    "excessive_exposure": ap.excessive_exposure,
                    "triples": [{"triple": list(f.triple), "provenance": f.provenance} for f in ap.triples],
                }
                for ap in pkg.evidence.access_paths
            ],
            "predicted_links": preds,
            "notes": notes,
            "latency_ms": llm_resp.latency_ms if llm_resp else 0,
        })

    generated_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = {
        "generated_at": generated_at,
        "model_name": client.model_name,
        "traces": traces,
    }
    atomic_write(out_json, json.dumps(payload, indent=2) + "\n")
    atomic_write(out_md, _render_md(traces, client.model_name, generated_at))
    return payload


def main() -> int:
    res = generate_traces()
    print(f"Generated {len(res['traces'])} explainability traces using {res['model_name']}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
