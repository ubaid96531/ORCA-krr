"""Hybrid Symbolic Rule + KG Embedding Reasoning (Iteration 2 Option D).

Combines:
1. Neural KG embeddings (TransE and DistMult in ``reasoning.embeddings``) for
   entity similarity and missing-link prediction (``Predicted_Link``).
2. Symbolic OWL T-Box validation and ORCA rules A-E (``reasoning.engine``)
   to audit every predicted link in a sandboxed graph copy before acceptance.

Outputs are strictly separated: predicted links carry
``provenance="Predicted_Link"`` and ``verified=False`` and are never injected
into ``kg.asserted`` or ``results/inferred_facts.ttl``.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from rdflib import Graph, URIRef
from rdflib.namespace import RDF
from sklearn.decomposition import PCA

from reasoning.embeddings import (
    DEFAULT_EMBEDDINGS_PATH,
    EmbeddingBundle,
    ModelName,
    load_or_train_bundle,
    most_similar_entities,
    predict_head,
    predict_tail,
)
from reasoning.engine import (
    _copy_graph,
    evaluate_authorization,
    excessive_permissions,
    indirect_access,
    individuals_of,
    local_name,
)
from reasoning.files import atomic_write
from reasoning.kg import load_snapshot
from reasoning.models import KGSnapshot
from reasoning.namespaces import INSTANCE_BASE, ORCA, compact

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_RESULTS_JSON = PROJECT_ROOT / "results" / "hybrid_reasoning_results.json"
DEFAULT_REPORT_MD = PROJECT_ROOT / "results" / "hybrid_reasoning_report.md"
DEFAULT_EMB_PLOT = PROJECT_ROOT / "results" / "embedding_space.png"
DEFAULT_METRICS_PLOT = PROJECT_ROOT / "results" / "link_prediction_metrics.png"


def _resolve_uri(g: Graph, ident: str) -> URIRef | None:
    text = (ident or "").strip()
    if not text:
        return None
    if text.startswith("orca:"):
        return ORCA[text.split(":", 1)[1]]
    if text.startswith("http://") or text.startswith("https://"):
        return URIRef(text)
    for node in set(g.subjects()) | set(g.objects()):
        if isinstance(node, URIRef) and str(node).startswith(INSTANCE_BASE):
            if compact(node) == text or local_name(node) == text:
                return node
    return None


def _agent_state_summary(kg: KGSnapshot) -> dict[str, dict[str, Any]]:
    """Snapshot every agent's verdicts, excessive permissions, and reachable categories."""
    g = kg.asserted
    out: dict[str, dict[str, Any]] = {}
    for agent_uri in individuals_of(g, ORCA.AIAgent):
        aid = compact(agent_uri)
        tasks = sorted(
            {compact(t) for t in g.objects(agent_uri, ORCA.assignedTask) if isinstance(t, URIRef)}
        )
        verdicts: dict[str, dict[str, Any]] = {}
        for tid in tasks:
            dec = evaluate_authorization(kg, aid, tid)
            verdicts[tid] = {
                "verdict": dec.verdict,
                "missing": set(dec.missing_permissions),
                "violated": set(dec.violated_policies),
            }
        exc = {f.permission_id for f in excessive_permissions(kg, aid).findings}
        cats = set(indirect_access(kg, aid).categories)
        out[aid] = {"verdicts": verdicts, "excessive": exc, "categories": cats}
    return out


def audit_predicted_link(
    kg: KGSnapshot,
    bundle: EmbeddingBundle,
    head_id: str,
    relation_id: str,
    tail_id: str,
    *,
    raw_score: float,
    confidence: float,
    model_name: str,
    before_state: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Symbolically audit one predicted link in an isolated copy of ``kg.asserted``."""
    ds = bundle.dataset
    h_uri = _resolve_uri(kg.asserted, head_id)
    r_uri = _resolve_uri(kg.asserted, relation_id)
    t_uri = _resolve_uri(kg.asserted, tail_id)

    dom_cls = ds.relation_domains.get(relation_id)
    rng_cls = ds.relation_ranges.get(relation_id)
    dom_ok = (dom_cls is None) or (dom_cls in ds.entity_classes.get(head_id, ()))
    rng_ok = (rng_cls is None) or (rng_cls in ds.entity_classes.get(tail_id, ()))
    owl_valid = bool(dom_ok and rng_ok)

    if h_uri is None or r_uri is None or t_uri is None:
        return {
            "head": head_id,
            "relation": relation_id,
            "tail": tail_id,
            "raw_score": raw_score,
            "confidence": confidence,
            "model": model_name,
            "provenance": "Predicted_Link",
            "verified": False,
            "already_known": False,
            "symbolic_audit": {
                "owl_type_valid": owl_valid,
                "risk_level": "UNRESOLVED",
                "summary": "One or more terms could not be resolved in the KG.",
            },
        }

    already_known = (h_uri, r_uri, t_uri) in kg.asserted
    before = before_state if before_state is not None else _agent_state_summary(kg)

    sim_g = _copy_graph(kg.asserted)
    sim_g.add((h_uri, r_uri, t_uri))
    sim_kg = KGSnapshot(sim_g, Graph(), (), kg.version)
    after = _agent_state_summary(sim_kg)

    resolved_missing: list[dict[str, Any]] = []
    new_violations: list[dict[str, Any]] = []
    new_excessive: list[dict[str, Any]] = []
    new_categories: list[dict[str, Any]] = []

    for aid, b_state in before.items():
        a_state = after[aid]
        for tid, b_v in b_state["verdicts"].items():
            a_v = a_state["verdicts"][tid]
            fixed_perms = sorted(b_v["missing"] - a_v["missing"])
            if fixed_perms or (b_v["verdict"] == "NOT_AUTHORIZED" and a_v["verdict"] == "AUTHORIZED"):
                resolved_missing.append({
                    "agent": aid,
                    "task": tid,
                    "verdict_before": b_v["verdict"],
                    "verdict_after": a_v["verdict"],
                    "resolved_permissions": fixed_perms,
                })
            added_pol = sorted(a_v["violated"] - b_v["violated"])
            if added_pol:
                new_violations.append({"agent": aid, "task": tid, "policies": added_pol})

        added_exc = sorted(a_state["excessive"] - b_state["excessive"])
        if added_exc:
            new_excessive.append({"agent": aid, "permissions": added_exc})

        added_cats = sorted(a_state["categories"] - b_state["categories"])
        if added_cats:
            new_categories.append({"agent": aid, "categories": added_cats})

    # Also detect whether the predicted triple introduces or reinforces a policy violation
    # (e.g. granting a prohibited permission directly to HelpdeskAgent or its tool).
    prohibited_trigger = False
    if r_uri == ORCA.hasPermission and (None, ORCA.prohibitsPermission, t_uri) in sim_g:
        for pol in sim_g.subjects(ORCA.prohibitsPermission, t_uri):
            for task_uri in sim_g.subjects(ORCA.governedByPolicy, pol):
                if h_uri == ORCA.AIAgent or (h_uri, RDF.type, ORCA.AIAgent) in sim_g:
                    if (h_uri, ORCA.assignedTask, task_uri) in sim_g:
                        prohibited_trigger = True
                for ag in sim_g.subjects(ORCA.usesTool, h_uri):
                    if (ag, ORCA.assignedTask, task_uri) in sim_g:
                        prohibited_trigger = True
                for ag in sim_g.subjects(ORCA.hasRole, h_uri):
                    if (ag, ORCA.assignedTask, task_uri) in sim_g:
                        prohibited_trigger = True

    if not owl_valid:
        risk_level = "OWL_TYPE_VIOLATION"
        summary = f"Violates OWL domain/range constraints (expected {dom_cls} -> {rng_cls})."
    elif new_violations or prohibited_trigger:
        risk_level = "POLICY_VIOLATION"
        pols = ", ".join(sorted({p for item in new_violations for p in item["policies"]})) or "governing SecurityPolicy"
        summary = f"BLOCKED by Rule ORCA-E: introduces or duplicates prohibited permission triggering {pols}."
    elif resolved_missing and not new_excessive:
        risk_level = "SAFE_REMEDIATION"
        agents = ", ".join(x["agent"] for x in resolved_missing)
        perms = ", ".join(p for x in resolved_missing for p in x["resolved_permissions"])
        summary = f"Resolves missing permission(s) [{perms}] for {agents} with zero excessive permissions."
    elif resolved_missing and new_excessive:
        risk_level = "REMEDIATION_WITH_EXCESS"
        agents = ", ".join(x["agent"] for x in resolved_missing)
        perms = ", ".join(p for x in resolved_missing for p in x["resolved_permissions"])
        exc_perms = ", ".join(p for x in new_excessive for p in x["permissions"])
        summary = (
            f"Restores [{perms}] for {agents} (NOT_AUTHORIZED -> AUTHORIZED), "
            f"but also introduces excessive permission(s) [{exc_perms}] via ORCA-D."
        )
    elif new_excessive or new_categories:
        risk_level = "EXCESSIVE_EXPOSURE"
        exc_perms = ", ".join(p for x in new_excessive for p in x["permissions"]) or "none"
        summary = f"Introduces excessive permission(s) [{exc_perms}] (ORCA-D) or new sensitive data exposure (ORCA-C)."
    else:
        risk_level = "LOW_RISK"
        summary = "OWL-consistent predicted relation with no new excessive permissions or policy violations."

    return {
        "head": head_id,
        "relation": relation_id,
        "tail": tail_id,
        "raw_score": raw_score,
        "confidence": confidence,
        "model": model_name,
        "provenance": "Predicted_Link",
        "verified": False,
        "already_known": already_known,
        "symbolic_audit": {
            "owl_type_valid": owl_valid,
            "expected_domain": dom_cls,
            "expected_range": rng_cls,
            "fixes_missing_permission": bool(resolved_missing),
            "resolved_authorizations": resolved_missing,
            "introduces_policy_violation": bool(new_violations),
            "new_policy_violations": new_violations,
            "introduces_excessive_permissions": new_excessive,
            "new_sensitive_categories": new_categories,
            "risk_level": risk_level,
            "summary": summary,
        },
    }


def predict_and_audit(
    kg: KGSnapshot,
    bundle: EmbeddingBundle,
    *,
    head_id: str | None = None,
    relation_id: str,
    tail_id: str | None = None,
    top_k: int = 5,
    model_name: ModelName = "TransE",
    enforce_owl_types: bool = True,
    before_state: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Run neural tail/head prediction and enrich every prediction with a symbolic audit."""
    if head_id and not tail_id:
        preds = predict_tail(
            bundle,
            head_id,
            relation_id,
            top_k=top_k,
            model_name=model_name,
            filter_known=True,
            enforce_owl_range=enforce_owl_types,
        )
    elif tail_id and not head_id:
        preds = predict_head(
            bundle,
            relation_id,
            tail_id,
            top_k=top_k,
            model_name=model_name,
            filter_known=True,
            enforce_owl_domain=enforce_owl_types,
        )
    else:
        raise ValueError("Provide exactly one of head_id or tail_id to predict the missing endpoint.")

    shared_before = before_state if before_state is not None else _agent_state_summary(kg)
    return [
        audit_predicted_link(
            kg,
            bundle,
            p["head"],
            p["relation"],
            p["tail"],
            raw_score=p["raw_score"],
            confidence=p["confidence"],
            model_name=p["model"],
            before_state=shared_before,
        )
        for p in preds
    ]


def discover_hybrid_candidates(
    kg: KGSnapshot,
    bundle: EmbeddingBundle,
    *,
    top_k_per_query: int = 3,
    model_name: ModelName = "TransE",
) -> list[dict[str, Any]]:
    """Run domain-relevant completion probes demonstrating symbolic + embedding synergy."""
    probes: list[tuple[str, str | None, str, str | None]] = [
        (
            "Missing tool prediction for unauthorized agent TimetableAssistant",
            "agent:TimetableAssistant",
            "orca:usesTool",
            None,
        ),
        (
            "Missing direct permission prediction for unauthorized agent TimetableAssistant",
            "agent:TimetableAssistant",
            "orca:hasPermission",
            None,
        ),
        (
            "Missing tool prediction for unauthorized agent AdmissionsReviewAgent",
            "agent:AdmissionsReviewAgent",
            "orca:usesTool",
            None,
        ),
        (
            "Candidate agent/role/tool holder for ExportStudentData (policy-risk probe)",
            None,
            "orca:hasPermission",
            "perm:ExportStudentData",
        ),
        (
            "Candidate governing policy for PublishExamTimetable",
            "task:PublishExamTimetable",
            "orca:governedByPolicy",
            None,
        ),
        (
            "Candidate official security control for LeastPrivilegePolicy",
            "policy:LeastPrivilegePolicy",
            "orca:implementsControl",
            None,
        ),
    ]

    shared_before = _agent_state_summary(kg)
    out: list[dict[str, Any]] = []
    for title, head_id, rel_id, tail_id in probes:
        audited = predict_and_audit(
            kg,
            bundle,
            head_id=head_id,
            relation_id=rel_id,
            tail_id=tail_id,
            top_k=top_k_per_query,
            model_name=model_name,
            enforce_owl_types=True,
            before_state=shared_before,
        )
        out.append({
            "query_title": title,
            "head": head_id,
            "relation": rel_id,
            "tail": tail_id,
            "model": model_name,
            "candidates": audited,
        })
    return out


# --------------------------------------------------------------------------- visualizations


def _family_group(primary_class: str) -> str:
    local = primary_class.split(":", 1)[-1]
    if local == "AIAgent":
        return "AIAgent"
    if local == "Task":
        return "Task"
    if local == "Tool":
        return "Tool"
    if local == "Role":
        return "Role"
    if local == "HumanUser":
        return "HumanUser"
    if local == "SecurityPolicy":
        return "SecurityPolicy"
    if local == "SecurityControl":
        return "SecurityControl"
    if "Permission" in local:
        return "Permission"
    if local in {"Database", "FileStore", "Mailbox", "WebContent", "Resource"}:
        return "Resource"
    if "Category" in local:
        return "SensitiveDataCategory"
    return "Other"


def plot_embedding_space(bundle: EmbeddingBundle, output_path: Path = DEFAULT_EMB_PLOT) -> None:
    """Save a 2D PCA projection of the TransE entity embeddings colored by ontology family."""
    ds = bundle.dataset
    embs = bundle.transe_full.normalized_entities().cpu().numpy()
    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(embs)
    var = pca.explained_variance_ratio_ * 100.0

    palette = {
        "AIAgent": "#1d4ed8",
        "Task": "#0891b2",
        "Tool": "#0d9488",
        "Role": "#7c3aed",
        "Permission": "#d97706",
        "Resource": "#4f46e5",
        "SensitiveDataCategory": "#dc2626",
        "SecurityPolicy": "#be185d",
        "SecurityControl": "#475569",
        "HumanUser": "#16a34a",
        "Other": "#6b7280",
    }

    groups = [_family_group(ds.entity_primary_class.get(e, "")) for e in ds.entities]
    fig, ax = plt.subplots(figsize=(11, 7.5), dpi=180)
    for grp, color in palette.items():
        idxs = [i for i, g in enumerate(groups) if g == grp]
        if not idxs:
            continue
        ax.scatter(
            coords[idxs, 0],
            coords[idxs, 1],
            c=color,
            label=f"{grp} ({len(idxs)})",
            s=58,
            alpha=0.88,
            edgecolors="white",
            linewidths=0.6,
        )

    highlight_prefixes = ("agent:", "category:", "user:", "policy:")
    for i, eid in enumerate(ds.entities):
        if eid.startswith(highlight_prefixes) or eid in {
            "tool:ExamTimetableTool",
            "tool:StudentRecordsTool",
            "resource:StudentRecordsDB",
            "perm:ExportStudentData",
            "perm:WriteExamTimetable",
        }:
            ax.annotate(
                eid.split(":", 1)[-1],
                (coords[i, 0], coords[i, 1]),
                fontsize=7.2,
                xytext=(4, 3),
                textcoords="offset points",
                alpha=0.92,
            )

    ax.set_title(
        f"ORCA TransE Entity Embedding Space (2D PCA, {var[0]:.1f}% + {var[1]:.1f}% variance explained)",
        fontsize=12,
        fontweight="bold",
        pad=12,
    )
    ax.set_xlabel(f"PC 1 ({var[0]:.1f}% variance)")
    ax.set_ylabel(f"PC 2 ({var[1]:.1f}% variance)")
    ax.grid(True, linestyle="--", alpha=0.3)
    ax.legend(loc="best", fontsize=8, frameon=True, ncol=2)
    fig.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=180)
    plt.close(fig)


def plot_link_prediction_metrics(metrics: dict[str, Any], output_path: Path = DEFAULT_METRICS_PLOT) -> None:
    """Save grouped bar chart of Random vs TransE vs DistMult (Global & OWL-Filtered)."""
    metric_keys = [("mrr", "MRR"), ("hits_at_1", "Hits@1"), ("hits_at_3", "Hits@3"), ("hits_at_10", "Hits@10")]
    models = ["Random", "TransE", "DistMult"]
    colors = ["#94a3b8", "#2563eb", "#0d9488"]

    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8), dpi=180, sharey=True)
    panels = [
        ("global_filtered", "Global Filtered Ranking (All 109 Entities)"),
        ("ontology_constrained_filtered", "Ontology-Constrained Ranking (OWL Domain/Range)"),
    ]

    x = np.arange(len(metric_keys))
    width = 0.25

    for ax, (key, title) in zip(axes, panels):
        section = metrics[key]
        for j, (m_name, col) in enumerate(zip(models, colors)):
            vals = [section[m_name][mk] for mk, _ in metric_keys]
            bars = ax.bar(x + (j - 1) * width, vals, width, label=m_name, color=col, alpha=0.92)
            for bar, v in zip(bars, vals):
                ax.text(
                    bar.get_x() + bar.get_width() / 2,
                    v + 0.02,
                    f"{v:.2f}",
                    ha="center",
                    va="bottom",
                    fontsize=7.5,
                )
        ax.set_title(title, fontsize=10.5, fontweight="bold")
        ax.set_xticks(x)
        ax.set_xticklabels([lbl for _, lbl in metric_keys])
        ax.set_ylim(0, 1.15)
        ax.grid(True, axis="y", linestyle="--", alpha=0.35)
        ax.legend(loc="upper left", fontsize=8.5)

    axes[0].set_ylabel("Score (0.0 – 1.0)")
    fig.suptitle(
        f"ORCA Link Prediction Evaluation ({metrics['dataset']['train_triples']} Train / "
        f"{metrics['dataset']['test_triples']} Held-Out Test Triples)",
        fontsize=12,
        fontweight="bold",
        y=1.01,
    )
    fig.tight_layout()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(output_path), dpi=180, bbox_inches="tight")
    plt.close(fig)


# --------------------------------------------------------------------------- report & CLI


def _render_report(results: dict[str, Any]) -> str:
    m = results["metrics"]
    ds = m["dataset"]
    lines = [
        "# ORCA Hybrid Symbolic + KG Embedding Reasoning Report (Option D)",
        "",
        f"- Generated at: {results['generated_at']}",
        f"- Entities: {ds['num_entities']} | Relations: {ds['num_relations']} | Total asserted relational triples: {ds['total_relational_triples']}",
        f"- Split: {ds['train_triples']} train / {ds['test_triples']} held-out test triples (degree-preserving, seed={ds['seed']})",
        f"- Embedding dim: {ds['embedding_dim']} | Epochs: {ds['epochs']}",
        "",
        "## 1. Link Prediction Benchmark (Filtered Ranking)",
        "",
        "| Setting | Model | MRR | Mean Rank | Hits@1 | Hits@3 | Hits@10 |",
        "|---|---|---|---|---|---|---|",
    ]
    for setting_key, setting_lbl in [
        ("global_filtered", "Global Filtered"),
        ("ontology_constrained_filtered", "OWL-Constrained Filtered"),
    ]:
        for model_name in ("Random", "TransE", "DistMult"):
            row = m[setting_key][model_name]
            lines.append(
                f"| {setting_lbl} | {model_name} | {row['mrr']:.4f} | {row['mean_rank']:.2f} | "
                f"{row['hits_at_1']:.4f} | {row['hits_at_3']:.4f} | {row['hits_at_10']:.4f} |"
            )

    lines += ["", "## 2. Entity Similarity Examples (Cosine Similarity in TransE Space)", ""]
    for anchor, peers in results["similarity_examples"].items():
        peer_str = ", ".join(f"{p['entity_id']} ({p['cosine_similarity']:.3f})" for p in peers)
        lines.append(f"- `{anchor}` -> {peer_str}")

    lines += ["", "## 3. Hybrid Symbolic-Audited Link Predictions (`Predicted_Link`, Unverified)", ""]
    for probe in results["hybrid_candidates"]:
        lines.append(f"### {probe['query_title']}")
        lines.append("")
        lines.append("| Predicted Triple | Confidence | Risk Level | Symbolic Audit Summary |")
        lines.append("|---|---|---|---|")
        for c in probe["candidates"]:
            aud = c["symbolic_audit"]
            lines.append(
                f"| `({c['head']}, {c['relation']}, {c['tail']})` | {c['confidence']:.4f} | "
                f"`{aud['risk_level']}` | {aud['summary']} |"
            )
        lines.append("")

    return "\n".join(lines) + "\n"


def run_hybrid_pipeline(*, force_retrain: bool = True) -> dict[str, Any]:
    """Train/evaluate TransE & DistMult, run hybrid symbolic audits, save artifacts & plots."""
    kg = load_snapshot()
    bundle = load_or_train_bundle(kg, DEFAULT_EMBEDDINGS_PATH, force_retrain=force_retrain)

    similarity_anchors = [
        "agent:AdvisingAgent",
        "agent:TimetableAssistant",
        "agent:HelpdeskAgent",
        "resource:StudentRecordsDB",
        "perm:ExportStudentData",
    ]
    similarity_examples = {
        anchor: most_similar_entities(bundle, anchor, model_name="TransE", top_k=4, same_class_only=False)
        for anchor in similarity_anchors
    }

    hybrid_candidates_transe = discover_hybrid_candidates(kg, bundle, top_k_per_query=3, model_name="TransE")
    hybrid_candidates_distmult = discover_hybrid_candidates(kg, bundle, top_k_per_query=3, model_name="DistMult")

    plot_embedding_space(bundle, DEFAULT_EMB_PLOT)
    plot_link_prediction_metrics(bundle.metrics, DEFAULT_METRICS_PLOT)

    results = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "metrics": bundle.metrics,
        "similarity_examples": similarity_examples,
        "hybrid_candidates": hybrid_candidates_transe,
        "hybrid_candidates_distmult": hybrid_candidates_distmult,
    }
    atomic_write(DEFAULT_RESULTS_JSON, json.dumps(results, indent=2) + "\n")
    atomic_write(DEFAULT_REPORT_MD, _render_report(results))
    return results


def main() -> int:
    res = run_hybrid_pipeline(force_retrain=True)
    m = res["metrics"]
    for key in ("global_filtered", "ontology_constrained_filtered"):
        print(f"=== {key} ===")
        for model in ("Random", "TransE", "DistMult"):
            r = m[key][model]
            print(f"  {model:8s}: MRR={r['mrr']:.4f} MR={r['mean_rank']:.2f} H@1={r['hits_at_1']:.4f} H@3={r['hits_at_3']:.4f} H@10={r['hits_at_10']:.4f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
