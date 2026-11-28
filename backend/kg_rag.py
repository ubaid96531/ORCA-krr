"""Knowledge-Graph Retrieval-Augmented Generation (KG-RAG) for ORCA.

Pipeline:
1. Entity & concept linking + intent classification against the live ``KGSnapshot``
   (plus out-of-KG entity detection for insufficient-evidence refusal).
2. Live KG retrieval & symbolic reasoning (explicit facts, inferred facts +
   derivations, multi-hop access paths, structured rows, and optional audited
   embedding predictions kept outside ``EvidenceBundle``).
3. Grounded LLM generation with strict provenance formatting and post-generation
   consistency checks; also provides ``answer_llm_only`` using the same LLM for
   fair Condition A vs Condition B evaluation.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from rdflib import Graph, Literal, URIRef
from rdflib.namespace import RDF, RDFS

from backend.llm_client import LLMClient, LLMResponse
from reasoning.engine import (
    _categories_of,
    _resources_of,
    assigned_tasks,
    available_permissions,
    evaluate_authorization,
    excessive_permissions,
    excessive_permissions_all,
    indirect_access,
    individuals_of,
    least_privilege,
    local_name,
    required_permissions,
    what_if_remove,
)
from reasoning.evidence import build_evidence, compact_triple, derivation_index
from reasoning.explainer import evidence_identifiers, explain
from reasoning.models import (
    AnalysisResult,
    AuthorizationDecision,
    EvidenceBundle,
    LabelledFact,
    PermissionNotHeldError,
    UnknownIdentifierError,
)
from reasoning.namespaces import INSTANCE_BASE, ORCA, compact
from reasoning.rules import Derivation, Triple


# --------------------------------------------------------------------------- entity linking & unknown detection

_COMMON_STOPWORDS = frozenset({
    "What", "Which", "Who", "Where", "When", "Why", "How", "Can", "Does", "Is", "Are",
    "The", "This", "That", "Show", "Tell", "List", "Give", "Explain", "Check", "Verify",
    "If", "And", "Or", "For", "From", "With", "Into", "Through", "Via", "Only", "All",
    "Any", "Some", "University", "System", "Security", "Control", "Controls", "Policy",
    "Policies", "Agent", "Agents", "Task", "Tasks", "Tool", "Tools", "Role", "Roles",
    "Permission", "Permissions", "Resource", "Resources", "Sensitive", "Data", "Category",
    "Categories", "User", "Users", "Supervisor", "Supervisors", "Student", "Students",
    "Access", "Indirect", "Excessive", "Missing", "Required", "Available", "Least",
    "Privilege", "Predicted", "Prediction", "Predict", "NIST", "OWASP", "Entra",
    "Microsoft", "AI", "LLM", "KG", "ORCA", "SPARQL", "RDF", "OWL", "PII", "FAQ", "IT",
    "HR", "DB", "CSF", "RMF", "ID", "API", "M365", "JSON", "CSV", "Condition", "Answer",
    "Level", "High", "Sensitivity", "Using", "Assigned", "Governed", "Reach", "Reachable",
    "Hold", "Holds", "Grant", "Grants", "Violate", "Violates", "Remove", "Removed",
})

_DOMAIN_SUFFIX_RE = re.compile(
    r"\b([A-Z][A-Za-z0-9]*(?:Agent|Bot|Database|DB|Store|Mailbox|Tool|Role|Policy|Control|Permission|Task|Server|Portal|Ledger|Engine))\b"
)


@dataclass(frozen=True)
class EntityCatalogEntry:
    uri: URIRef
    compact_id: str
    local: str
    label: str
    primary_class: str
    aliases: tuple[str, ...]


def build_entity_catalog(g: Graph) -> list[EntityCatalogEntry]:
    """Index all domain individuals in ``g`` with compact IDs, local names, and labels."""
    entries: list[EntityCatalogEntry] = []
    seen: set[URIRef] = set()
    for s in sorted(set(g.subjects(RDF.type, None)), key=str):
        if not isinstance(s, URIRef) or not str(s).startswith(INSTANCE_BASE) or s in seen:
            continue
        seen.add(s)
        cid = compact(s)
        loc = local_name(s)
        lbl_vals = [str(v) for v in g.objects(s, RDFS.label)]
        label = lbl_vals[0] if lbl_vals else loc
        types = [compact(t) for t in g.objects(s, RDF.type) if isinstance(t, URIRef) and str(t).startswith(str(ORCA))]
        primary = sorted(types)[0] if types else "orca:Thing"

        aliases: set[str] = {cid.lower(), loc.lower(), label.lower()}
        spaced = re.sub(r"([a-z])([A-Z])", r"\1 \2", loc).lower()
        aliases.add(spaced)
        aliases.add(loc.replace("_", " ").replace("-", " ").lower())
        entries.append(
            EntityCatalogEntry(
                uri=s,
                compact_id=cid,
                local=loc,
                label=label,
                primary_class=primary,
                aliases=tuple(sorted((a for a in aliases if len(a) >= 3), key=len, reverse=True)),
            )
        )
    return entries


def extract_entities_and_unknowns(
    question: str, catalog: list[EntityCatalogEntry]
) -> tuple[list[EntityCatalogEntry], list[str]]:
    """Match known KG entities (longest match first) and detect unknown domain nouns."""
    q_low = " " + re.sub(r"\s+", " ", question.lower()) + " "
    matched: list[EntityCatalogEntry] = []
    matched_spans: list[tuple[int, int]] = []

    alias_pairs: list[tuple[str, EntityCatalogEntry]] = []
    for entry in catalog:
        for alias in entry.aliases:
            alias_pairs.append((alias, entry))
    alias_pairs.sort(key=lambda x: (-len(x[0]), x[1].compact_id))

    seen_uris: set[URIRef] = set()
    for alias, entry in alias_pairs:
        if entry.uri in seen_uris:
            continue
        pat = re.compile(r"(?<![a-z0-9_-])" + re.escape(alias) + r"(?![a-z0-9_-])")
        m = pat.search(q_low)
        if m:
            span = (m.start(), m.end())
            if any(not (span[1] <= s or span[0] >= e) for s, e in matched_spans):
                continue
            matched.append(entry)
            matched_spans.append(span)
            seen_uris.add(entry.uri)

    # Detect explicit unknown CamelCase/suffixed identifiers not in the KG.
    known_tokens = {e.local.lower() for e in catalog} | {e.label.lower() for e in catalog}
    for e in catalog:
        known_tokens.update(e.aliases)

    unknowns: list[str] = []
    for m in _DOMAIN_SUFFIX_RE.finditer(question):
        tok = m.group(1)
        if tok in _COMMON_STOPWORDS:
            continue
        if tok.lower() not in known_tokens and not any(tok.lower() in e.local.lower() for e in matched):
            if tok not in unknowns:
                unknowns.append(tok)

    # Also catch explicit "called X" / quoted terms / CamelCase words when no known entities match.
    for m in re.finditer(r"\b([A-Z][a-z]+[A-Z][A-Za-z0-9]*)\b", question):
        tok = m.group(1)
        if tok not in _COMMON_STOPWORDS and tok.lower() not in known_tokens and tok not in unknowns:
            if not any(tok.lower() in e.local.lower() for e in matched):
                unknowns.append(tok)

    return matched, unknowns


def _by_family(entries: list[EntityCatalogEntry], prefix: str) -> list[EntityCatalogEntry]:
    return [e for e in entries if e.compact_id.startswith(prefix + ":")]


# --------------------------------------------------------------------------- intent classification


def classify_intent(question: str, entities: list[EntityCatalogEntry], unknowns: list[str]) -> str:
    """Classify a natural-language question into an ORCA retrieval strategy."""
    q = question.lower()
    agents = _by_family(entities, "agent")
    tasks = _by_family(entities, "task")
    perms = _by_family(entities, "perm")

    # Explicit unknown domain entity that is not in the KG -> refuse instead of guessing.
    if unknowns and not entities:
        return "insufficient_evidence"
    if unknowns and any(k in q for k in ("payroll", "salary", "medical", "bitcoin", "weather", "hrportal", "financebot")):
        return "insufficient_evidence"

    # Pattern 1: What-if permission removal
    if perms and agents and any(w in q for w in ("remove", "revok", "drop", "what if", "what happens", "what changes")):
        return "what_if"

    # Pattern 2: Authorization check for specific agent + task
    if agents and tasks and any(w in q for w in ("authoriz", "allowed", "permitted", "can ", "able to perform")):
        return "authorization"

    # Pattern 3: Missing required permissions (CQ4)
    if any(w in q for w in ("lack", "missing permission", "missing a permission", "unmet", "not have")):
        return "missing_permissions"

    # Pattern 4: Least privilege / minimum permission set
    if agents and any(w in q for w in ("least privilege", "minimum permission", "recommend", "reduce privilege")):
        return "least_privilege"

    # Pattern 5: Agents with unneeded tools (CQ13)
    if any(w in q for w in ("unnecessary tool", "unneeded tool", "two or more tool", "tools whose permissions")):
        return "unneeded_tools"

    # Pattern 6: Roles with unneeded permissions (CQ10)
    if "role" in q and any(w in q for w in ("unneeded", "excessive", "not required", "unnecessary")):
        return "unneeded_roles"

    # Pattern 7: Excessive permissions (CQ2, CQ3, or single agent)
    if any(w in q for w in ("excessive", "unnecessary", "not required", "unneeded")):
        if agents and "which ai agent" not in q and "which agent" not in q:
            return "excessive_single"
        return "excessive_all"

    # Pattern 8: Policy violations & controls (CQ6)
    if any(w in q for w in ("violat", "break a policy", "breaks a policy")):
        return "policy_violation"

    # Pattern 9: Official NIST / OWASP / Entra controls for agent or overall (CQ11)
    if any(w in q for w in ("nist", "owasp", "entra", "official control", "security control")):
        return "controls_query"

    # Pattern 10: Supervisors (CQ9 or specific agent supervisor)
    if any(w in q for w in ("supervis", "human user", "oversight", "oversee")):
        return "supervisors"

    # Pattern 11: Sensitivity level >= N (CQ12)
    if "sensitivity level" in q or re.search(r"sensitivity.*(?:4|5|high)", q):
        return "high_sensitivity"

    # Pattern 12: Category agent counts (CQ8)
    if ("how many" in q or "count" in q) and ("category" in q or "categories" in q or "sensitive" in q):
        return "category_counts"

    # Pattern 13: Permissions granting access to categories (CQ7)
    if "which permission" in q and ("grant" in q or "sensitive data" in q):
        return "permission_grants"

    # Pattern 14: Hybrid KG embedding link prediction / similarity
    if any(w in q for w in ("predict", "embedding", "similar", "transe", "distmult", "link prediction", "missing link")):
        return "hybrid_predict"

    # Pattern 15: Indirect sensitive data access / reachability (CQ1, CQ5, or agent-target)
    if any(w in q for w in ("reach", "indirect", "sensitive data", "access", "path")):
        if agents and not ("which ai agent" in q or "which agent" in q):
            return "indirect_single"
        if _by_family(entities, "category") or _by_family(entities, "tool") or "sensitive" in q:
            return "indirect_query"

    # Pattern 16: Any question mentioning known KG entities or known ORCA classes -> general graph lookup
    if entities:
        if unknowns:
            # Known entity + unknown entity together (e.g., "Can AdvisingAgent access PayrollDatabase?")
            return "partial_unknown"
        return "general_entity_lookup"

    if any(w in q for w in ("agent", "bot", "bots", "task", "tool", "role", "permission", "resource", "database", "databases", "supervisor", "supervisors", "policy", "sensitive")):
        # Domain-class query without unknown entity (e.g., "List all AI agents in ORCA")
        if unknowns:
            return "insufficient_evidence"
        return "overview_lookup"

    return "insufficient_evidence"


# --------------------------------------------------------------------------- KG retrieval


@dataclass
class RetrievedKGPackage:
    intent: str
    sufficient_evidence: bool
    result_id: str | None
    template_answer: str
    evidence: EvidenceBundle
    retrieved_context: str
    structured_rows: list[dict[str, Any]]
    predicted_links: list[dict[str, Any]]
    engine_result: AnalysisResult | None = None
    unknown_mentions: tuple[str, ...] = ()


def _format_context(
    summary_header: str,
    structured_rows: list[dict[str, Any]],
    evidence: EvidenceBundle,
    predicted_links: list[dict[str, Any]],
    verified_summary: str = "",
) -> str:
    lines: list[str] = [f"Query Topic: {summary_header}"]
    if verified_summary:
        lines.append(f"Verified KG Answer Summary: {verified_summary}")

    if structured_rows:
        lines.append("")
        lines.append("=== STRUCTURED QUERY FINDINGS (Complete & Verified from ORCA KG) ===")
        for idx, row in enumerate(structured_rows[:25], 1):
            parts = [f"{k}={v}" for k, v in row.items() if v]
            lines.append(f"{idx}. " + " | ".join(parts))

    # Keep prompt concise for the LLM by omitting rdf:type / rdfs:label / owl:inverseOf boilerplate
    # while the full EvidenceBundle retains every triple for the UI & provenance audit.
    key_explicit = [
        lf for lf in evidence.explicit_facts
        if lf.triple[1] not in ("rdf:type", "rdfs:label", "rdfs:comment", "owl:inverseOf", "rdfs:subClassOf")
    ]
    if key_explicit:
        lines.append("")
        lines.append("=== KEY EXPLICIT FACTS (Official_Fact / Synthetic_Fact) ===")
        for lf in key_explicit[:15]:
            s, p, o = lf.triple
            lines.append(f"- [{lf.provenance}] {s} {p} {o}")

    key_inferred = [
        inf for inf in evidence.inferred_facts
        if inf.rule_id.startswith("ORCA-") or inf.rule_id == "owl:propertyChainAxiom"
    ]
    if key_inferred:
        lines.append("")
        lines.append("=== KEY INFERRED FACTS (OWL-RL / ORCA Rules A-E) ===")
        for inf in key_inferred[:10]:
            s, p, o = inf.triple
            lines.append(f"- [Inferred_Fact via {inf.rule_id}] {s} {p} {o}")

    if evidence.access_paths:
        lines.append("")
        lines.append("=== MULTI-HOP ACCESS PATHS ===")
        for ap in evidence.access_paths[:10]:
            chain = " -> ".join(
                [ap.triples[0].triple[0]] + [f"{f.triple[1]} -> {f.triple[2]}" for f in ap.triples]
            ) if ap.triples else f"{ap.agent} -> {ap.target}"
            flag = f" [EXCESSIVE EXPOSURE via {', '.join(ap.excessive_permissions)}]" if ap.excessive_exposure else ""
            lines.append(f"- [{ap.route} path]{flag} {chain}")

    if predicted_links:
        lines.append("")
        lines.append("=== PREDICTED LINKS (Unverified KG Embedding Predictions — NOT Confirmed Facts) ===")
        for pl in predicted_links[:8]:
            aud = pl.get("symbolic_audit", {})
            lines.append(
                f"- [Predicted_Link | Unverified | {pl['model']} conf={pl['confidence']:.3f}] "
                f"({pl['head']}, {pl['relation']}, {pl['tail']}) "
                f"| Audit: {aud.get('risk_level', 'N/A')} - {aud.get('summary', '')}"
            )

    return "\n".join(lines)


def _sparql_rows(g_full: Graph, query: str) -> list[dict[str, str]]:
    res = g_full.query(query, initNs={"orca": ORCA, "rdf": RDF, "rdfs": RDFS})
    vars_ = [str(v) for v in res.vars]
    rows: list[dict[str, str]] = []
    for r in res:
        item: dict[str, str] = {}
        for v in vars_:
            val = r[v]
            if val is None:
                item[v] = ""
            elif isinstance(val, Literal):
                item[v] = str(val)
            else:
                item[v] = compact(val)
        rows.append(item)
    return rows


def _full_graph(kg) -> Graph:
    g = Graph()
    for t in kg.asserted:
        g.add(t)
    for t in kg.inferred:
        g.add(t)
    return g


def _collect_triples_for_entities(kg, uris: list[URIRef]) -> tuple[list[Triple], list[Derivation]]:
    """Gather explicit asserted triples and inferred derivations touching ``uris``."""
    used: list[Triple] = []
    derivs: list[Derivation] = []
    idx = derivation_index(kg)
    uri_set = set(uris)
    for s, p, o in kg.asserted:
        if (s in uri_set or o in uri_set) and p != ORCA.provenanceLabel and p != RDFS.comment:
            used.append((s, p, o))
    for s, p, o in kg.inferred:
        if s in uri_set or o in uri_set:
            t = (s, p, o)
            used.append(t)
            derivs.extend(idx.get(t, ()))
    return used, derivs


def retrieve_kg_package(kg, question: str, *, include_hybrid: bool = True) -> RetrievedKGPackage:
    """Dynamically retrieve KG facts, reasoning outputs, and provenance for ``question``."""
    g = kg.asserted
    g_full = _full_graph(kg)
    catalog = build_entity_catalog(g)
    entities, unknowns = extract_entities_and_unknowns(question, catalog)
    intent = classify_intent(question, entities, unknowns)
    q_low = question.lower()

    agents = _by_family(entities, "agent")
    tasks = _by_family(entities, "task")
    perms = _by_family(entities, "perm")
    cats = _by_family(entities, "category")
    policies = _by_family(entities, "policy")

    # Handle out-of-KG / insufficient evidence cleanly
    if intent in ("insufficient_evidence", "partial_unknown"):
        missing_str = ", ".join(unknowns) if unknowns else "the requested concept or entity"
        known_note = (
            f" Recognized KG entities ({', '.join(e.compact_id for e in entities)}) exist, "
            f"but {missing_str} is NOT present in the ORCA knowledge graph."
            if entities
            else f" The queried entity/topic ({missing_str}) is NOT present in the ORCA knowledge graph."
        )
        # If there are known entities in a partial_unknown query, retrieve their known facts transparently,
        # while marking sufficient_evidence=False for the unknown target.
        used, derivs = _collect_triples_for_entities(kg, [e.uri for e in entities]) if entities else ([], [])
        ev = build_evidence(kg, used, derivs, [])
        ctx = (
            "INSUFFICIENT EVIDENCE IN ORCA KNOWLEDGE GRAPH.\n"
            f"Missing / unknown references not found in KG: {missing_str}.\n"
            + (_format_context(f"Partial context for {', '.join(e.compact_id for e in entities)}", [], ev, []) if entities else "")
        )
        template = (
            f"Insufficient evidence in the ORCA knowledge graph to answer this question fully.{known_note} "
            "No facts outside the graph will be fabricated."
        )
        return RetrievedKGPackage(
            intent=intent,
            sufficient_evidence=False,
            result_id=None,
            template_answer=template,
            evidence=ev,
            retrieved_context=ctx,
            structured_rows=[],
            predicted_links=[],
            unknown_mentions=tuple(unknowns),
        )

    # Engine-backed intents
    if intent == "authorization" and agents and tasks:
        res = evaluate_authorization(kg, agents[0].compact_id, tasks[0].compact_id)
        rows = [{
            "agent": res.agent_id,
            "task": res.task_id,
            "verdict": res.verdict,
            "missing_permissions": ", ".join(res.missing_permissions) or "none",
            "violated_policies": ", ".join(res.violated_policies) or "none",
        }]
        ctx = _format_context(f"Authorization evaluation for {res.agent_id} on {res.task_id}", rows, res.evidence, [])
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=res.result_id,
            template_answer=explain(res), evidence=res.evidence, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[], engine_result=res,
        )

    if intent == "what_if" and agents and perms:
        try:
            res = what_if_remove(kg, agents[0].compact_id, perms[0].compact_id)
            rows = [{
                "agent": res.agent_id,
                "removed_permission": res.permission_id,
                "categories_before": ", ".join(res.categories_before) or "none",
                "categories_after": ", ".join(res.categories_after) or "none",
                "tasks_losing_authorization": ", ".join(res.tasks_losing_authorization) or "none",
            }]
            ctx = _format_context(f"What-if removal of {res.permission_id} from {res.agent_id}", rows, res.evidence, [])
            return RetrievedKGPackage(
                intent=intent, sufficient_evidence=True, result_id=res.result_id,
                template_answer=explain(res), evidence=res.evidence, retrieved_context=ctx,
                structured_rows=rows, predicted_links=[], engine_result=res,
            )
        except PermissionNotHeldError as exc:
            used, derivs = _collect_triples_for_entities(kg, [agents[0].uri, perms[0].uri])
            ev = build_evidence(kg, used, derivs, [])
            msg = f"{agents[0].compact_id} does not currently hold {perms[0].compact_id} ({exc})."
            ctx = _format_context(msg, [], ev, [])
            return RetrievedKGPackage(
                intent=intent, sufficient_evidence=True, result_id=None,
                template_answer=msg, evidence=ev, retrieved_context=ctx,
                structured_rows=[], predicted_links=[],
            )

    if intent == "least_privilege" and agents:
        res = least_privilege(kg, agents[0].compact_id)
        rows = [{
            "agent": res.agent_id,
            "minimum_permission_set": ", ".join(res.minimum_permission_set) or "none",
            "remove_recommendations": ", ".join(r.permission_id for r in res.recommendations) or "none",
        }]
        ctx = _format_context(f"Least-privilege analysis for {res.agent_id}", rows, res.evidence, [])
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=res.result_id,
            template_answer=explain(res), evidence=res.evidence, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[], engine_result=res,
        )

    if intent == "excessive_single" and agents:
        res = excessive_permissions(kg, agents[0].compact_id)
        rows = [
            {
                "agent": res.agent_id,
                "excessive_permission": f.permission_id,
                "sources": ", ".join(f.sources),
                "extra_resources": ", ".join(f.extra_resources) or "none",
                "extra_categories": ", ".join(f.extra_categories) or "none",
            }
            for f in res.findings
        ] or [{"agent": res.agent_id, "excessive_permission": "none"}]
        ctx = _format_context(f"Excessive permissions for {res.agent_id}", rows, res.evidence, [])
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=res.result_id,
            template_answer=explain(res), evidence=res.evidence, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[], engine_result=res,
        )

    if intent == "indirect_single" and agents:
        res = indirect_access(kg, agents[0].compact_id)
        rows = [
            {
                "agent": res.agent_id,
                "category": p.target,
                "route": p.route,
                "excessive_exposure": str(p.excessive_exposure),
                "excessive_permissions": ", ".join(p.excessive_permissions) or "none",
            }
            for p in res.paths
        ] or [{"agent": res.agent_id, "reachable_categories": "none"}]
        ctx = _format_context(f"Indirect sensitive data access for {res.agent_id}", rows, res.evidence, [])
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=res.result_id,
            template_answer=explain(res), evidence=res.evidence, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[], engine_result=res,
        )

    # All-agent excessive & category counts (CQ2 / CQ3)
    if intent == "excessive_all":
        summaries = excessive_permissions_all(kg)
        rows: list[dict[str, Any]] = []
        used_all: list[Triple] = []
        derivs_all: list[Derivation] = []
        paths_all = []
        idx = derivation_index(kg)
        for s in summaries:
            er = excessive_permissions(kg, s.agent_id)
            if er.findings:
                for f in er.findings:
                    rows.append({
                        "agent": s.agent_id,
                        "excessive_permission": f.permission_id,
                        "sources": ", ".join(f.sources),
                        "extra_resources": ", ".join(f.extra_resources) or "none",
                        "agent_reachable_categories": s.reachable_category_count,
                    })
                a_uri = next(u for u in individuals_of(g, ORCA.AIAgent) if compact(u) == s.agent_id)
                u, d = _collect_triples_for_entities(kg, [a_uri])
                used_all.extend(u)
                derivs_all.extend(d)
                paths_all.extend(er.evidence.access_paths)
        ev = build_evidence(kg, used_all, derivs_all, paths_all)
        summary_txt = "; ".join(
            f"{r['agent']} has excessive {r['excessive_permission']} (extra_resources={r['extra_resources']}, reachable_categories={r['agent_reachable_categories']})"
            for r in rows
        )
        tmpl = f"Excessive permissions found across {len({r['agent'] for r in rows})} agents: {summary_txt}."
        ctx = _format_context("All-agent excessive permissions and reachable category counts (CQ2/CQ3)", rows, ev, [], tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Missing required permissions (CQ4)
    if intent == "missing_permissions":
        rows = []
        used: list[Triple] = []
        derivs: list[Derivation] = []
        for a_uri in individuals_of(g, ORCA.AIAgent):
            aid = compact(a_uri)
            for t_uri in assigned_tasks(g, a_uri):
                dec = evaluate_authorization(kg, aid, compact(t_uri))
                if dec.missing_permissions:
                    for mp in dec.missing_permissions:
                        rows.append({"agent": aid, "task": compact(t_uri), "missing_permission": mp, "verdict": dec.verdict})
                    u, d = _collect_triples_for_entities(kg, [a_uri, t_uri])
                    used.extend(u)
                    derivs.extend(d)
        ev = build_evidence(kg, used, derivs, [])
        predicted: list[dict[str, Any]] = []
        if include_hybrid:
            try:
                from reasoning.embeddings import load_or_train_bundle
                from reasoning.hybrid import predict_and_audit

                bundle = load_or_train_bundle(kg)
                for ag in sorted({r["agent"] for r in rows}):
                    predicted.extend(predict_and_audit(kg, bundle, head_id=ag, relation_id="orca:usesTool", top_k=2))
            except Exception:
                pass
        txt = "; ".join(f"{r['agent']} (task {r['task']}) lacks {r['missing_permission']}" for r in rows)
        tmpl = f"Agents lacking required permissions: {txt}."
        ctx = _format_context("Agents lacking required task permissions (CQ4)", rows, ev, predicted, tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=predicted,
        )

    # Policy violations & controls (CQ6)
    if intent == "policy_violation":
        rows = _sparql_rows(g_full, """
            SELECT DISTINCT ?agent ?task ?policy ?control ?source ?section WHERE {
                ?agent orca:assignedTask ?task .
                ?task orca:governedByPolicy ?policy .
                ?agent orca:violatesPolicy ?policy .
                OPTIONAL {
                    ?policy orca:implementsControl ?control .
                    OPTIONAL { ?control orca:sourceName ?source . }
                    OPTIONAL { ?control orca:sourceSection ?section . }
                }
            } ORDER BY ?agent ?policy ?control
        """)
        uris = []
        for a_uri in individuals_of(g, ORCA.AIAgent):
            if any(compact(a_uri) == r["agent"] for r in rows):
                uris.append(a_uri)
        for p_uri in individuals_of(g, ORCA.SecurityPolicy):
            if any(compact(p_uri) == r["policy"] for r in rows):
                uris.append(p_uri)
        used, derivs = _collect_triples_for_entities(kg, uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(
            f"{r['agent']} on {r['task']} violates {r['policy']} (implements {r['control']} / {r['source']} {r['section']})"
            for r in rows
        )
        tmpl = txt or "No policy violations detected."
        ctx = _format_context("Security policy violations and implemented official controls (CQ6)", rows, ev, [], tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Controls for an agent or policy (CQ11)
    if intent == "controls_query":
        target_agent = agents[0] if agents else None
        if target_agent:
            rows = _sparql_rows(g_full, f"""
                SELECT DISTINCT ?task ?policy ?control ?source ?section ?excerpt WHERE {{
                    <{target_agent.uri}> orca:assignedTask ?task .
                    ?task orca:governedByPolicy ?policy .
                    ?policy orca:implementsControl ?control .
                    OPTIONAL {{ ?control orca:sourceName ?source . }}
                    OPTIONAL {{ ?control orca:sourceSection ?section . }}
                    OPTIONAL {{ ?control orca:excerptText ?excerpt . }}
                }} ORDER BY ?control
            """)
            uris = [target_agent.uri] + [e.uri for e in policies]
        else:
            rows = _sparql_rows(g_full, """
                SELECT DISTINCT ?policy ?control ?source ?section WHERE {
                    ?policy orca:implementsControl ?control .
                    OPTIONAL { ?control orca:sourceName ?source . }
                    OPTIONAL { ?control orca:sourceSection ?section . }
                } ORDER BY ?policy ?control
            """)
            uris = [e.uri for e in policies] or individuals_of(g, ORCA.SecurityControl)
        used, derivs = _collect_triples_for_entities(kg, uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(f"{r.get('policy','')}: {r['control']} ({r.get('source','')} {r.get('section','')})" for r in rows)
        tmpl = txt or "No matching security controls found."
        ctx = _format_context("Official security controls linked to governing policies (CQ11)", rows, ev, [], tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Permission -> SensitiveDataCategory via inferred grantsAccessTo (CQ7)
    if intent == "permission_grants":
        rows = _sparql_rows(g_full, """
            SELECT DISTINCT ?permission ?category WHERE {
                ?permission orca:grantsAccessTo ?category .
            } ORDER BY ?permission ?category
        """)
        perm_uris = [p for p in individuals_of(g, ORCA.Permission) if any(compact(p) == r["permission"] for r in rows)]
        used, derivs = _collect_triples_for_entities(kg, perm_uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(f"{r['permission']} -> {r['category']}" for r in rows)
        tmpl = f"Permissions granting sensitive data access ({len(rows)} pairs): {txt}."
        ctx = _format_context("Inferred permission-to-sensitive-category access (owl:propertyChainAxiom, CQ7)", rows, ev, [], tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Category counts (CQ8)
    if intent == "category_counts":
        rows = _sparql_rows(g_full, """
            SELECT ?category (COUNT(DISTINCT ?agent) AS ?agent_count) WHERE {
                ?agent orca:canReachSensitiveData ?category .
            } GROUP BY ?category ORDER BY DESC(?agent_count) ?category
        """)
        cat_uris = individuals_of(g, ORCA.SensitiveDataCategory)
        used, derivs = _collect_triples_for_entities(kg, cat_uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(f"{r['category']}: {r['agent_count']} agents" for r in rows)
        ctx = _format_context("Reachable agent count per sensitive data category (ORCA-C, CQ8)", rows, ev, [], txt)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=txt, evidence=ev, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[],
        )

    # Supervisors of agents reaching FinancialRecord or specific category/agent (CQ9)
    if intent == "supervisors":
        if cats:
            cat_filter = f"FILTER (?category = <{cats[0].uri}>)"
        elif "financial" in q_low:
            cat_filter = "FILTER (STRENDS(STR(?category), 'FinancialRecord'))"
        else:
            cat_filter = ""
        if agents:
            rows = _sparql_rows(g_full, f"""
                SELECT DISTINCT ?agent ?supervisor WHERE {{
                    BIND(<{agents[0].uri}> AS ?agent)
                    ?agent orca:supervisedBy ?supervisor .
                }} ORDER BY ?agent
            """)
            uris = [agents[0].uri]
        else:
            rows = _sparql_rows(g_full, f"""
                SELECT DISTINCT ?agent ?supervisor ?category WHERE {{
                    ?agent orca:hasAvailablePermission ?perm .
                    ?perm orca:accessesResource ?res .
                    ?res orca:containsSensitiveData ?category .
                    ?agent orca:supervisedBy ?supervisor .
                    {cat_filter}
                }} ORDER BY ?agent ?supervisor
            """)
            uris = [a for a in individuals_of(g, ORCA.AIAgent) if any(compact(a) == r["agent"] for r in rows)]
        used, derivs = _collect_triples_for_entities(kg, uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(f"{r['agent']} supervised by {r['supervisor']}" for r in rows)
        tmpl = txt or "No matching supervisors found."
        ctx = _format_context("Human supervisors overseeing agents (CQ9)", rows, ev, [], tmpl)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=tmpl,
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Roles with unneeded permissions (CQ10)
    if intent == "unneeded_roles":
        rows = _sparql_rows(g_full, """
            SELECT ?role ?permission (COUNT(DISTINCT ?agent) AS ?affected_agents) WHERE {
                ?agent orca:hasRole ?role .
                ?role orca:hasPermission ?permission .
                ?agent orca:hasExcessivePermission ?permission .
            } GROUP BY ?role ?permission ORDER BY ?role ?permission
        """)
        role_uris = [r for r in individuals_of(g, ORCA.Role) if any(compact(r) == row["role"] for row in rows)]
        used, derivs = _collect_triples_for_entities(kg, role_uris)
        ev = build_evidence(kg, used, derivs, [])
        ctx = _format_context("Roles granting unneeded permissions (ORCA-D, CQ10)", rows, ev, [])
        txt = "; ".join(f"{r['role']} grants unneeded {r['permission']}" for r in rows)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=txt, evidence=ev, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[],
        )

    # Unneeded tools (CQ13)
    if intent == "unneeded_tools":
        rows = _sparql_rows(g_full, """
            SELECT ?agent (COUNT(DISTINCT ?tool) AS ?unneeded_tool_count) WHERE {
                ?agent orca:usesTool ?tool .
                ?tool orca:hasPermission ?some_perm .
                FILTER NOT EXISTS {
                    ?tool orca:hasPermission ?p .
                    FILTER NOT EXISTS { ?agent orca:hasExcessivePermission ?p . }
                }
            } GROUP BY ?agent HAVING (COUNT(DISTINCT ?tool) >= 2) ORDER BY ?agent
        """)
        ag_uris = [a for a in individuals_of(g, ORCA.AIAgent) if any(compact(a) == r["agent"] for r in rows)]
        used, derivs = _collect_triples_for_entities(kg, ag_uris)
        ev = build_evidence(kg, used, derivs, [])
        ctx = _format_context("Agents with >= 2 unnecessary tools (CQ13)", rows, ev, [])
        txt = "; ".join(f"{r['agent']} uses {r['unneeded_tool_count']} unnecessary tools" for r in rows)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=txt or "No agents with >=2 unnecessary tools found.",
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # High sensitivity reach (CQ12)
    if intent == "high_sensitivity":
        m_lvl = re.search(r"(?:level|>=|at least)\s*(\d)", q_low)
        min_lvl = int(m_lvl.group(1)) if m_lvl else 4
        rows = _sparql_rows(g_full, f"""
            SELECT DISTINCT ?agent ?resource ?category ?level WHERE {{
                ?agent orca:hasAvailablePermission ?perm .
                ?perm orca:accessesResource ?resource .
                ?resource orca:containsSensitiveData ?category .
                ?category orca:sensitivityLevel ?level .
                FILTER (?level >= {min_lvl})
            }} ORDER BY ?agent ?resource ?category
        """)
        ag_uris = [a for a in individuals_of(g, ORCA.AIAgent) if any(compact(a) == r["agent"] for r in rows)]
        used, derivs = _collect_triples_for_entities(kg, ag_uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(
            f"{r['agent']} -> {r['resource']} -> {r['category']} (level {r['level']})" for r in rows
        )
        ctx = _format_context(f"Agents reaching sensitivity level >= {min_lvl} (CQ12)", rows, ev, [], txt)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=txt, evidence=ev, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[],
        )

    # Indirect query across agents (e.g. CQ5 StudentPII via tool)
    if intent == "indirect_query":
        if cats:
            cat_filter = f"FILTER (?category = <{cats[0].uri}>)"
        elif "studentpii" in q_low or "student pii" in q_low:
            cat_filter = "FILTER (STRENDS(STR(?category), 'StudentPII'))"
        else:
            cat_filter = ""
        via_tool_only = "tool" in q_low and "role" not in q_low
        if via_tool_only:
            rows = _sparql_rows(g_full, f"""
                SELECT DISTINCT ?agent ?tool ?resource ?category WHERE {{
                    ?agent orca:usesTool ?tool .
                    ?tool orca:hasPermission ?permission .
                    ?permission orca:accessesResource ?resource .
                    ?resource orca:containsSensitiveData ?category .
                    {cat_filter}
                }} ORDER BY ?agent ?tool
            """)
        else:
            rows = _sparql_rows(g_full, f"""
                SELECT DISTINCT ?agent ?permission ?resource ?category WHERE {{
                    ?agent orca:hasAvailablePermission ?permission .
                    ?permission orca:accessesResource ?resource .
                    ?resource orca:containsSensitiveData ?category .
                    {cat_filter}
                }} ORDER BY ?agent ?category
            """)
        ag_uris = [a for a in individuals_of(g, ORCA.AIAgent) if any(compact(a) == r["agent"] for r in rows)]
        used, derivs = _collect_triples_for_entities(kg, ag_uris)
        ev = build_evidence(kg, used, derivs, [])
        txt = "; ".join(
            f"{r['agent']} reaches {r['category']} via {r.get('tool', r.get('permission', ''))}" for r in rows
        )
        ctx = _format_context("Multi-hop sensitive data reachability query (CQ5)", rows, ev, [], txt)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=txt, evidence=ev, retrieved_context=ctx,
            structured_rows=rows, predicted_links=[],
        )

    # Hybrid prediction / similarity query
    if intent == "hybrid_predict":
        from reasoning.embeddings import load_or_train_bundle, most_similar_entities
        from reasoning.hybrid import discover_hybrid_candidates, predict_and_audit

        bundle = load_or_train_bundle(kg)
        predicted: list[dict[str, Any]] = []
        rows = []
        if agents:
            aid = agents[0].compact_id
            peers = most_similar_entities(bundle, aid, model_name="TransE", top_k=4)
            for p in peers:
                rows.append({"anchor": aid, "similar_entity": p["entity_id"], "cosine_similarity": p["cosine_similarity"]})
            predicted = predict_and_audit(kg, bundle, head_id=aid, relation_id="orca:usesTool", top_k=3)
        else:
            probes = discover_hybrid_candidates(kg, bundle, top_k_per_query=2)
            for pr in probes[:3]:
                predicted.extend(pr["candidates"])
        used, derivs = _collect_triples_for_entities(kg, [e.uri for e in entities]) if entities else ([], [])
        ev = build_evidence(kg, used, derivs, [])
        ctx = _format_context("Hybrid KG embedding similarity & link prediction", rows, ev, predicted)
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer="Retrieved embedding similarity and symbolically audited link predictions (unverified).",
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=predicted,
        )

    # General entity lookup or overview lookup (handles arbitrary unseen questions about KG entities!)
    if entities:
        uris = [e.uri for e in entities]
        used, derivs = _collect_triples_for_entities(kg, uris)
        # Include 1-hop neighborhood of tools/roles/tasks/resources attached to the queried entity
        neighbor_uris = set(uris)
        for s, p, o in kg.asserted:
            if s in neighbor_uris and isinstance(o, URIRef) and str(o).startswith(INSTANCE_BASE):
                used.append((s, p, o))
            elif o in neighbor_uris and isinstance(s, URIRef) and str(s).startswith(INSTANCE_BASE):
                used.append((s, p, o))
        extra_paths = []
        rows = []
        for ag in agents:
            ind = indirect_access(kg, ag.compact_id)
            extra_paths.extend(ind.paths)
            exc = excessive_permissions(kg, ag.compact_id)
            rows.append({
                "entity": ag.compact_id,
                "assigned_tasks": ", ".join(compact(t) for t in assigned_tasks(g, ag.uri)) or "none",
                "available_permissions": ", ".join(compact(p) for p in available_permissions(g, ag.uri)) or "none",
                "excessive_permissions": ", ".join(f.permission_id for f in exc.findings) or "none",
                "reachable_categories": ", ".join(ind.categories) or "none",
            })
        for e in entities:
            if not e.compact_id.startswith("agent:"):
                rows.append({
                    "entity": e.compact_id,
                    "class": e.primary_class,
                    "label": e.label,
                })
        ev = build_evidence(kg, used, derivs, extra_paths)
        ctx = _format_context(f"Entity neighborhood lookup for {', '.join(e.compact_id for e in entities)}", rows, ev, [])
        return RetrievedKGPackage(
            intent=intent, sufficient_evidence=True, result_id=None,
            template_answer=f"Retrieved {len(ev.explicit_facts)} explicit facts and {len(ev.inferred_facts)} inferred facts for {', '.join(e.compact_id for e in entities)}.",
            evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
        )

    # Domain-class overview (e.g. "Which AI agents exist in ORCA?")
    rows = []
    for a_uri in individuals_of(g, ORCA.AIAgent):
        rows.append({
            "agent": compact(a_uri),
            "tasks": ", ".join(compact(t) for t in assigned_tasks(g, a_uri)) or "none",
        })
    used, derivs = _collect_triples_for_entities(kg, individuals_of(g, ORCA.AIAgent))
    ev = build_evidence(kg, used, derivs, [])
    ctx = _format_context("ORCA Knowledge Graph domain overview", rows, ev, [])
    return RetrievedKGPackage(
        intent=intent, sufficient_evidence=True, result_id=None,
        template_answer=f"ORCA models {len(rows)} AI agents: " + ", ".join(r["agent"] for r in rows) + ".",
        evidence=ev, retrieved_context=ctx, structured_rows=rows, predicted_links=[],
    )


# --------------------------------------------------------------------------- LLM synthesis & Condition A/B


_GROUNDED_SYSTEM_PROMPT = (
    "You are the ORCA Knowledge-Graph Security Assistant for a synthetic university AI-agent authorization system.\n"
    "RULES:\n"
    "1. Answer using ONLY the facts provided in the RETRIEVED KNOWLEDGE GRAPH CONTEXT.\n"
    "2. Include ALL matching items from STRUCTURED QUERY FINDINGS in your answer cleanly in 2-5 complete English sentences (do not truncate the list or output raw RDF triple syntax).\n"
    "3. If the context says INSUFFICIENT EVIDENCE, refuse clearly and state what is missing without inventing any agent, tool, database, or supervisor.\n"
    "4. Always cite exact entity identifiers (e.g., AdvisingAgent, TomasSilva, CSF_PRAA-05). ONLY mention 'unverified predictions' if a PREDICTED LINKS section is present in the context; never call verified explicit or inferred facts unverified predictions."
)

_LLM_ONLY_SYSTEM_PROMPT = (
    "You are an AI security assistant answering a question about an AI agent authorization system at a university "
    "(the ORCA university scenario with AI agents, tasks, tools, roles, permissions, resources, sensitive data categories, "
    "and NIST/OWASP security policies). Answer the user's question concisely in 2-4 sentences. "
    "If you do not know specific details, state clearly what you cannot verify."
)

_VERDICT_RE = re.compile(r"\b(NOT_AUTHORIZED|AUTHORIZED)\b")

_REFUSAL_MARKERS = (
    "insufficient",
    "not present",
    "does not exist",
    "not in the",
    "not found",
    "cannot verify",
    "cannot answer",
    "no information",
    "missing from",
    "absent from",
)


def check_grounding(text: str, pkg: RetrievedKGPackage, catalog: list[EntityCatalogEntry]) -> tuple[bool, list[str]]:
    """Verify generated text against retrieved evidence (verdict, refusal, and entity grounding)."""
    notes: list[str] = []
    if not text or not text.strip():
        return False, ["LLM produced empty text."]

    if not pkg.sufficient_evidence:
        low = text.lower()
        has_refusal = any(m in low for m in _REFUSAL_MARKERS)
        if not has_refusal:
            notes.append(
                "Rejected LLM text: failed to refuse despite insufficient graph evidence; returning deterministic KG refusal."
            )
            return False, notes
        # Reject if LLM invented a synthetic name for an unknown entity (e.g. PayrollDatabaseAI)
        for unk in pkg.unknown_mentions:
            invented = re.findall(rf"\b{re.escape(unk)}[A-Za-z0-9_]+\b", text)
            if invented:
                notes.append(
                    f"Rejected LLM text: hallucinated non-existent identifier(s) {', '.join(invented)}; returning deterministic KG refusal."
                )
                return False, notes

    if isinstance(pkg.engine_result, AuthorizationDecision):
        found = _VERDICT_RE.findall(text)
        if found and pkg.engine_result.verdict not in found:
            notes.append(f"Rejected LLM text: stated verdict {found} instead of {pkg.engine_result.verdict}.")
            return False, notes

    # Check if LLM invented a known KG entity completely absent from retrieved context/evidence
    allowed_ids = set(evidence_identifiers(pkg.evidence))
    for row in pkg.structured_rows:
        for v in row.values():
            allowed_ids.add(str(v))
    allowed_lower = {a.lower() for a in allowed_ids}
    allowed_lower |= {a.split(":", 1)[-1].lower() for a in allowed_ids}
    ctx_lower = pkg.retrieved_context.lower()

    extra_known = []
    for entry in catalog:
        if entry.local.lower() in text.lower():
            if entry.local.lower() not in allowed_lower and entry.local.lower() not in ctx_lower:
                extra_known.append(entry.compact_id)
    if extra_known and pkg.sufficient_evidence:
        notes.append(f"Note: LLM mentioned extra KG entities outside primary context: {', '.join(sorted(set(extra_known)))}.")
    return True, notes


def answer_kg_grounded(
    kg,
    question: str,
    llm_client: LLMClient | None,
    *,
    max_new_tokens: int = 220,
) -> tuple[RetrievedKGPackage, LLMResponse | None, str | None, list[str]]:
    """Run full KG-RAG: retrieve -> synthesize with LLM -> validate grounding."""
    pkg = retrieve_kg_package(kg, question)
    catalog = build_entity_catalog(kg.asserted)
    notes: list[str] = []

    if llm_client is None:
        return pkg, None, None, ["No LLM client supplied; returning deterministic KG template answer."]

    if not pkg.sufficient_evidence:
        user_prompt = (
            f"RETRIEVED KNOWLEDGE GRAPH CONTEXT:\n{pkg.retrieved_context}\n\n"
            f"USER QUESTION: {question}\n\n"
            "Instructions: The knowledge graph does NOT contain sufficient evidence to answer this question. "
            "Explicitly state that the requested information is not in the ORCA knowledge graph and do not guess."
        )
    else:
        user_prompt = (
            f"RETRIEVED KNOWLEDGE GRAPH CONTEXT:\n{pkg.retrieved_context}\n\n"
            f"USER QUESTION: {question}\n\n"
            "Provide a clear, accurate, grounded answer citing only entities and rules from the context above."
        )

    llm_resp = llm_client.generate(
        _GROUNDED_SYSTEM_PROMPT,
        user_prompt,
        max_new_tokens=max_new_tokens,
        temperature=0.0,
    )
    if not llm_resp.ok:
        notes.append(llm_resp.error or "LLM call failed; falling back to template answer.")
        return pkg, llm_resp, None, notes

    accepted, check_notes = check_grounding(llm_resp.text, pkg, catalog)
    notes.extend(check_notes)
    if not accepted:
        return pkg, llm_resp, None, notes
    return pkg, llm_resp, llm_resp.text, notes


def answer_llm_only(
    question: str,
    llm_client: LLMClient,
    *,
    max_new_tokens: int = 220,
) -> LLMResponse:
    """Condition A baseline: ask the exact same LLM with zero KG retrieval."""
    return llm_client.generate(
        _LLM_ONLY_SYSTEM_PROMPT,
        f"Question: {question}",
        max_new_tokens=max_new_tokens,
        temperature=0.0,
    )
