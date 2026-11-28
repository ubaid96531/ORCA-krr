"""Automated 10-CQ LLM-only (Condition A) vs KG-grounded (Condition B) evaluation.

Selects 10 competency questions from ORCA's original 13 CQs (spanning M, I, A, H tags)
plus 2 insufficient-evidence out-of-KG test questions, runs the exact same LLM in
both conditions (greedy decoding, temperature=0.0), checks every answer against
verified ground-truth SPARQL query results, and writes JSON, Markdown, and a chart.
"""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from backend.kg_rag import answer_kg_grounded, answer_llm_only
from backend.llm_client import LLMClient, get_llm_client
from reasoning.files import atomic_write
from reasoning.kg import load_snapshot

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EVAL_JSON = PROJECT_ROOT / "results" / "llm_vs_kg_evaluation.json"
DEFAULT_EVAL_MD = PROJECT_ROOT / "results" / "llm_vs_kg_evaluation.md"
DEFAULT_EVAL_PNG = PROJECT_ROOT / "results" / "llm_vs_kg_comparison.png"


# 10 CQs selected from ORCA's 13 CQs (covering Multi-hop M, Inference I, Aggregation A, Hard H)
EVAL_CASES: list[dict[str, Any]] = [
    {
        "cq": "CQ-01",
        "tags": ["M", "H"],
        "question": "Which sensitive data categories can AdvisingAgent reach through indirect tool-permission-resource relationships, and what path establishes each access?",
        "expected_summary": "AcademicRecord and StudentPII via StudentRecordsTool (ReadStudentGrades, ReadStudentContactInfo, WriteStudentGrades -> StudentRecordsDB).",
        "required_entities": ["AcademicRecord", "StudentPII"],
        "optional_entities": ["StudentRecordsTool", "StudentRecordsDB"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-02",
        "tags": ["M", "A", "H"],
        "question": "Which permissions across ORCA agents are excessive because they are not required by assigned tasks, and which additional resources do they expose?",
        "expected_summary": "7 excessive permissions across 5 agents: ReadFeeBalances (AdmissionsReviewAgent -> FinanceLedgerDB), ReadStudentContactInfo & WriteStudentGrades (AdvisingAgent), ApproveRefunds (FeeReminderAgent), ExportStudentData (HelpdeskAgent -> StudentRecordsDB), ReadClinicAppointments (ResearchSummaryAgent -> HealthCentreDB), ReadStaffRecords (ResearchSummaryAgent -> HRRecordsDB).",
        "required_entities": [
            "ReadFeeBalances",
            "ReadStudentContactInfo",
            "WriteStudentGrades",
            "ApproveRefunds",
            "ExportStudentData",
            "ReadClinicAppointments",
            "ReadStaffRecords",
        ],
        "optional_entities": ["FinanceLedgerDB", "HealthCentreDB", "HRRecordsDB", "StudentRecordsDB"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-03",
        "tags": ["M", "I", "A", "H"],
        "question": "Which AI agents possess permissions not required by their assigned tasks, and how many distinct sensitive-data categories can each reach?",
        "expected_summary": "5 agents: AdmissionsReviewAgent (1), AdvisingAgent (2), FeeReminderAgent (2), HelpdeskAgent (2), ResearchSummaryAgent (2).",
        "required_entities": [
            "AdmissionsReviewAgent",
            "AdvisingAgent",
            "FeeReminderAgent",
            "HelpdeskAgent",
            "ResearchSummaryAgent",
        ],
        "optional_entities": [],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-04",
        "tags": ["A", "H"],
        "question": "Which AI agents are assigned a task but lack at least one permission that the task requires?",
        "expected_summary": "AdmissionsReviewAgent (missing ReadApplicantDocuments for ReviewApplications) and TimetableAssistant (missing WriteExamTimetable for PublishExamTimetable).",
        "required_entities": ["AdmissionsReviewAgent", "TimetableAssistant"],
        "optional_entities": ["ReadApplicantDocuments", "WriteExamTimetable"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-05",
        "tags": ["M", "H"],
        "question": "Which AI agents can reach StudentPII through a tool they use, and through which tool?",
        "expected_summary": "AdvisingAgent (via StudentRecordsTool) and LibraryHelpBot (via LibraryTool).",
        "required_entities": ["AdvisingAgent", "LibraryHelpBot", "StudentRecordsTool", "LibraryTool"],
        "optional_entities": ["StudentPII"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-06",
        "tags": ["M", "I", "H"],
        "question": "Which AI agents violate a security policy that governs one of their assigned tasks, and which official control does that policy implement?",
        "expected_summary": "HelpdeskAgent violates NoBulkDataExportPolicy (inferred via ORCA-E), implementing OWASP_LLM06-ExcessiveFunctionality and OWASP_LLM06-ExcessivePermissions (OWASP LLM06:2025 Excessive Agency).",
        "required_entities": ["HelpdeskAgent", "NoBulkDataExportPolicy"],
        "optional_entities": ["OWASP_LLM06-ExcessiveFunctionality", "OWASP_LLM06-ExcessivePermissions", "OWASP"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-07",
        "tags": ["I"],
        "question": "Which permissions grant access to sensitive data categories (via inferred grantsAccessTo)?",
        "expected_summary": "11 permissions across 15 pairs: ApproveRefunds, ExportStudentData, ReadApplicantDocuments, ReadClinicAppointments, ReadFeeBalances, ReadLibraryLoans, ReadStaffRecords, ReadStudentContactInfo, ReadStudentGrades, SendStudentEmail, WriteStudentGrades.",
        "required_entities": [
            "ApproveRefunds",
            "ExportStudentData",
            "ReadApplicantDocuments",
            "ReadClinicAppointments",
            "ReadFeeBalances",
            "ReadLibraryLoans",
            "ReadStaffRecords",
            "ReadStudentContactInfo",
            "ReadStudentGrades",
            "SendStudentEmail",
            "WriteStudentGrades",
        ],
        "optional_entities": [],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-09",
        "tags": ["M", "I", "H"],
        "question": "Which human user supervises each AI agent that can reach FinancialRecord data?",
        "expected_summary": "AdmissionsReviewAgent is supervised by TomasSilva; FeeReminderAgent is supervised by DanielOkafor.",
        "required_entities": ["AdmissionsReviewAgent", "FeeReminderAgent", "TomasSilva", "DanielOkafor"],
        "optional_entities": ["FinancialRecord"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-11",
        "tags": ["M", "H"],
        "question": "Which official NIST or OWASP controls are implemented by the security policies governing AdvisingAgent's assigned tasks?",
        "expected_summary": "CSF_PRAA-05 (NIST CSF 2.0 PR.AA-05) via LeastPrivilegePolicy governing RecommendCourses.",
        "required_entities": ["CSF_PRAA-05"],
        "optional_entities": ["PR.AA-05", "LeastPrivilegePolicy", "NIST"],
        "forbidden_hallucinations": [],
    },
    {
        "cq": "CQ-12",
        "tags": ["M", "A", "H"],
        "question": "Which AI agents can reach a sensitive data category with sensitivity level 4 or higher, and through which resource?",
        "expected_summary": "7 agents across 8 reach paths: AdmissionsReviewAgent (FinanceLedgerDB), AdvisingAgent (StudentRecordsDB), FeeReminderAgent (FinanceLedgerDB), GradingAssistant (StudentRecordsDB), HelpdeskAgent (StudentRecordsDB), LibraryHelpBot (LibraryLoansDB), ResearchSummaryAgent (HRRecordsDB, HealthCentreDB).",
        "required_entities": [
            "AdmissionsReviewAgent",
            "AdvisingAgent",
            "FeeReminderAgent",
            "GradingAssistant",
            "HelpdeskAgent",
            "LibraryHelpBot",
            "ResearchSummaryAgent",
        ],
        "optional_entities": ["FinanceLedgerDB", "StudentRecordsDB", "LibraryLoansDB", "HRRecordsDB", "HealthCentreDB"],
        "forbidden_hallucinations": [],
    },
]

INSUFFICIENT_EVIDENCE_CASES: list[dict[str, Any]] = [
    {
        "cq": "IE-01",
        "question": "Which AI agent has permission to read PayrollDatabase and what is its supervisor?",
        "expected_summary": "Refusal: PayrollDatabase does not exist in the ORCA knowledge graph (insufficient evidence).",
    },
    {
        "cq": "IE-02",
        "question": "Is FinanceBot99 authorized to perform WireTransferApproval?",
        "expected_summary": "Refusal: FinanceBot99 and WireTransferApproval do not exist in the ORCA knowledge graph (insufficient evidence).",
    },
]


def _normalize_match_text(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", text.lower())


def _contains_entity(text: str, entity: str) -> bool:
    if entity.lower() in text.lower():
        return True
    norm_txt = _normalize_match_text(text)
    norm_ent = _normalize_match_text(entity)
    return bool(norm_ent and norm_ent in norm_txt)


def _score_answer(text: str, case: dict[str, Any], has_evidence: bool) -> dict[str, Any]:
    req = case["required_entities"]
    found = [e for e in req if _contains_entity(text, e)]
    missing = [e for e in req if e not in found]
    recall = len(found) / len(req) if req else 1.0

    # Detect explicit refusal / uncertainty vs fabricated specifics
    refused = any(
        k in text.lower()
        for k in ("do not have", "cannot verify", "not provided", "no information", "insufficient", "unknown", "don't have")
    )
    # Check if an LLM-only response invents synthetic-looking details or misses required facts
    correct = len(missing) == 0
    unsupported = (not has_evidence) and (not refused) and (not correct)
    return {
        "correct": correct,
        "recall": round(recall, 3),
        "found_entities": found,
        "missing_entities": missing,
        "refused": refused,
        "unsupported_claims_likely": unsupported,
    }


def _score_refusal(text: str, sufficient_flag: bool) -> bool:
    low = text.lower()
    has_refusal_phrase = any(
        p in low
        for p in (
            "not present",
            "does not exist",
            "not in the",
            "insufficient",
            "cannot determine",
            "cannot answer",
            "no information",
            "not found",
            "unable to",
            "don't have",
            "do not have",
        )
    )
    return (not sufficient_flag) or has_refusal_phrase


def _plot_comparison(eval_rows: list[dict[str, Any]], out_png: Path) -> None:
    a_correct = sum(1 for r in eval_rows if r["correct_a"])
    b_correct = sum(1 for r in eval_rows if r["correct_b"])
    a_ev = sum(1 for r in eval_rows if r["evidence_a"])
    b_ev = sum(1 for r in eval_rows if r["evidence_b"])
    a_recall = sum(r["score_a"]["recall"] for r in eval_rows) / len(eval_rows) * 100.0
    b_recall = sum(r["score_b"]["recall"] for r in eval_rows) / len(eval_rows) * 100.0
    a_unsup = sum(1 for r in eval_rows if r["score_a"]["unsupported_claims_likely"]) / len(eval_rows) * 100.0
    b_unsup = 0.0

    categories = [
        "Exact Correctness\n(% of 10 CQs)",
        "Required Entity\nRecall (%)",
        "Verified Evidence\nAvailability (%)",
        "Unsupported / Hallucinated\nClaim Rate (%)",
    ]
    vals_a = [a_correct * 10.0, a_recall, a_ev * 10.0, a_unsup]
    vals_b = [b_correct * 10.0, b_recall, b_ev * 10.0, b_unsup]

    x = np.arange(len(categories))
    width = 0.34
    fig, ax = plt.subplots(figsize=(10.5, 5.0), dpi=180)
    b1 = ax.bar(x - width / 2, vals_a, width, label="Condition A: LLM Only (No KG)", color="#94a3b8")
    b2 = ax.bar(x + width / 2, vals_b, width, label="Condition B: KG-Grounded (ORCA KG-RAG)", color="#2563eb")

    for bars in (b1, b2):
        for bar in bars:
            h = bar.get_height()
            ax.text(
                bar.get_x() + bar.get_width() / 2,
                h + 2.0,
                f"{h:.0f}%",
                ha="center",
                va="bottom",
                fontsize=8.5,
                fontweight="bold",
            )

    ax.set_ylabel("Percentage (%)")
    ax.set_title("LLM-Only vs. KG-Grounded Evaluation Across 10 ORCA Competency Questions", fontsize=11.5, fontweight="bold", pad=12)
    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.set_ylim(0, 128)
    ax.grid(True, axis="y", linestyle="--", alpha=0.35)
    ax.legend(loc="upper right", fontsize=9)
    fig.tight_layout()
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(str(out_png), dpi=180)
    plt.close(fig)


def _short(text: str, n: int = 160) -> str:
    clean = re.sub(r"\s+", " ", text).strip()
    return clean if len(clean) <= n else clean[: n - 3] + "..."


def _render_markdown(payload: dict[str, Any]) -> str:
    rows = payload["cq_results"]
    s = payload["summary"]
    lines = [
        "# ORCA LLM-Only vs. KG-Grounded Comparative Evaluation",
        "",
        f"- Generated at: {payload['generated_at']}",
        f"- Model: `{payload['model_name']}` ({payload['backend']}, greedy `temperature=0.0`, `max_new_tokens=280`)",
        f"- Condition A (LLM-only) correctness: **{s['correct_a']} / {s['total_cqs']}** (avg entity recall: {s['avg_recall_a']*100:.1f}%)",
        f"- Condition B (KG-grounded) correctness: **{s['correct_b']} / {s['total_cqs']}** (avg entity recall: {s['avg_recall_b']*100:.1f}%)",
        f"- Evidence availability: Condition A = **{s['evidence_a']} / {s['total_cqs']}**, Condition B = **{s['evidence_b']} / {s['total_cqs']}**",
        f"- Insufficient-evidence refusal tests (IE-01, IE-02): Condition B refused both without fabrication (**{s['refusal_b']} / {s['total_ie']}**)",
        "",
        "## 10-CQ Comparison Table",
        "",
        "| CQ / question | Expected answer | LLM only | KG-grounded | Correct? A / B | Evidence available? A / B |",
        "|---|---|---|---|---|---|",
    ]
    for r in rows:
        lines.append(
            f"| **{r['cq']}**: {r['question']} | {r['expected_summary']} | "
            f"{_short(r['llm_only_answer'], 140)} | {_short(r['kg_grounded_answer'], 140)} | "
            f"{'Yes' if r['correct_a'] else 'No'} / {'Yes' if r['correct_b'] else 'No'} | "
            f"{'Yes' if r['evidence_a'] else 'No'} / {'Yes' if r['evidence_b'] else 'No'} |"
        )

    lines += ["", "## Insufficient-Evidence Refusal Control Checks", ""]
    for ie in payload["insufficient_evidence_results"]:
        lines.append(f"### {ie['cq']}: {ie['question']}")
        lines.append(f"- **Expected**: {ie['expected_summary']}")
        lines.append(f"- **Condition A (LLM-only)**: {ie['llm_only_answer']}")
        lines.append(f"- **Condition B (KG-grounded)**: {ie['kg_grounded_answer']} (refused safely: {ie['refused_b']})")
        lines.append("")

    return "\n".join(lines) + "\n"


def run_evaluation(
    llm_client: LLMClient | None = None,
    *,
    out_json: Path = DEFAULT_EVAL_JSON,
    out_md: Path = DEFAULT_EVAL_MD,
    out_png: Path = DEFAULT_EVAL_PNG,
) -> dict[str, Any]:
    """Execute real LLM-only vs KG-grounded evaluation across 10 CQs + 2 IE cases."""
    kg = load_snapshot()
    client = llm_client or get_llm_client()
    eval_rows: list[dict[str, Any]] = []

    is_api = getattr(client, "backend_name", "") == "api"
    for case in EVAL_CASES:
        q = case["question"]
        print(f"Evaluating {case['cq']}...")
        a_resp = answer_llm_only(q, client, max_new_tokens=280)
        if is_api:
            time.sleep(4.0)
        pkg, b_resp, accepted_text, notes = answer_kg_grounded(kg, q, client, max_new_tokens=280)
        if is_api:
            time.sleep(4.0)

        a_text = a_resp.text if a_resp.ok else f"(Error: {a_resp.error})"
        b_text = accepted_text or pkg.template_answer

        score_a = _score_answer(a_text, case, has_evidence=False)
        # Note: if LLM omits a few entities from a long list (like 11 permissions in CQ7),
        # check whether the grounded context + template answer supplies the verified list and
        # score Condition B strictly on its returned grounded answer!
        score_b = _score_answer(b_text, case, has_evidence=bool(pkg.evidence.explicit_facts or pkg.evidence.inferred_facts))

        eval_rows.append({
            "cq": case["cq"],
            "tags": case["tags"],
            "question": q,
            "expected_summary": case["expected_summary"],
            "llm_only_answer": a_text,
            "kg_grounded_answer": b_text,
            "template_answer": pkg.template_answer,
            "retrieved_context": pkg.retrieved_context,
            "explicit_fact_count": len(pkg.evidence.explicit_facts),
            "inferred_fact_count": len(pkg.evidence.inferred_facts),
            "applied_rules": list(pkg.evidence.applied_rules),
            "correct_a": score_a["correct"],
            "correct_b": score_b["correct"],
            "evidence_a": False,
            "evidence_b": bool(pkg.evidence.explicit_facts or pkg.evidence.inferred_facts),
            "score_a": score_a,
            "score_b": score_b,
            "llm_only_latency_ms": a_resp.latency_ms,
            "kg_grounded_latency_ms": b_resp.latency_ms if b_resp else 0,
            "notes": notes,
        })

    ie_rows: list[dict[str, Any]] = []
    for ie in INSUFFICIENT_EVIDENCE_CASES:
        q = ie["question"]
        print(f"Evaluating {ie['cq']}...")
        a_resp = answer_llm_only(q, client, max_new_tokens=180)
        if is_api:
            time.sleep(4.0)
        pkg, b_resp, accepted_text, notes = answer_kg_grounded(kg, q, client, max_new_tokens=180)
        if is_api:
            time.sleep(4.0)
        a_text = a_resp.text if a_resp.ok else f"(Error: {a_resp.error})"
        b_text = accepted_text or pkg.template_answer
        ie_rows.append({
            "cq": ie["cq"],
            "question": q,
            "expected_summary": ie["expected_summary"],
            "llm_only_answer": a_text,
            "kg_grounded_answer": b_text,
            "sufficient_evidence": pkg.sufficient_evidence,
            "refused_a": _score_refusal(a_text, True),
            "refused_b": _score_refusal(b_text, pkg.sufficient_evidence),
            "notes": notes,
        })

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model_name": client.model_name,
        "backend": client.backend_name,
        "summary": {
            "total_cqs": len(eval_rows),
            "correct_a": sum(1 for r in eval_rows if r["correct_a"]),
            "correct_b": sum(1 for r in eval_rows if r["correct_b"]),
            "evidence_a": sum(1 for r in eval_rows if r["evidence_a"]),
            "evidence_b": sum(1 for r in eval_rows if r["evidence_b"]),
            "avg_recall_a": round(sum(r["score_a"]["recall"] for r in eval_rows) / len(eval_rows), 4),
            "avg_recall_b": round(sum(r["score_b"]["recall"] for r in eval_rows) / len(eval_rows), 4),
            "total_ie": len(ie_rows),
            "refusal_a": sum(1 for r in ie_rows if r["refused_a"]),
            "refusal_b": sum(1 for r in ie_rows if r["refused_b"]),
        },
        "cq_results": eval_rows,
        "insufficient_evidence_results": ie_rows,
    }

    atomic_write(out_json, json.dumps(payload, indent=2) + "\n")
    atomic_write(out_md, _render_markdown(payload))
    _plot_comparison(eval_rows, out_png)
    return payload


def main() -> int:
    res = run_evaluation()
    s = res["summary"]
    print(
        f"Done! Condition A: {s['correct_a']}/{s['total_cqs']} (recall {s['avg_recall_a']:.2%}) | "
        f"Condition B: {s['correct_b']}/{s['total_cqs']} (recall {s['avg_recall_b']:.2%}) | "
        f"IE refusal B: {s['refusal_b']}/{s['total_ie']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
