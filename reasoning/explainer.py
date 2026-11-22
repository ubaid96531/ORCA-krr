"""Template_Explainer (design Component 8; Requirements 17.4, 17.8).

``explain(result)`` turns any engine result into fixed English sentences.
There is no randomness: every list is sorted before it is written, so equal
results always give the same text.

The sentences use readable local names (``AdvisingAgent``). The text always
ends with an ``Evidence:`` part that lists, as compact ids, every AI agent,
permission, resource and sensitive data category that appears anywhere in
``result.evidence`` (explicit facts, inferred facts with their source
triples, and access paths). This is what Req 17.8 asks of the template
answer, and the assistant uses ``evidence_identifiers`` to check LLM text
against the same set.

Ids are recognised by their compact family prefix: ``agent:``, ``perm:``,
``resource:`` and ``category:``. Subclass instances share the family prefix
(a ``Database`` is ``resource:...``), see ``reasoning/namespaces.py``.
"""
from __future__ import annotations

from collections.abc import Iterable, Iterator

from reasoning.models import (
    NO_INTENT_NOTE,
    AnalysisResult,
    AuthorizationDecision,
    EvidenceBundle,
    ExcessiveResult,
    IdTriple,
    IndirectAccessResult,
    LeastPrivilegeResult,
    WhatIfResult,
)

#: Family prefixes whose ids must be named in every explanation, in output order.
EVIDENCE_FAMILIES: tuple[str, ...] = ("agent", "perm", "resource", "category")

_FAMILY_TITLES = {
    "agent": "AI agents",
    "perm": "permissions",
    "resource": "resources",
    "category": "sensitive data categories",
}


# ------------------------------------------------------------------- helpers


def _family(ident: str) -> str | None:
    if ":" not in ident or "://" in ident:
        return None
    prefix = ident.split(":", 1)[0]
    return prefix if prefix in EVIDENCE_FAMILIES else None


def _name(ident: str) -> str:
    """Readable local name of a compact id, source string or full URI."""
    if ident == "direct":
        return "a direct grant"
    if ":" in ident and "://" not in ident:
        return ident.split(":", 1)[1]
    for sep in ("#", "/"):
        if sep in ident:
            return ident.rsplit(sep, 1)[1] or ident
    return ident


def _join(items: Iterable[str]) -> str:
    """``A``, ``A and B``, ``A, B and C``; ``none`` for an empty list."""
    xs = list(items)
    if not xs:
        return "none"
    if len(xs) == 1:
        return xs[0]
    return ", ".join(xs[:-1]) + " and " + xs[-1]


def _names(ids: Iterable[str]) -> str:
    return _join(_name(i) for i in sorted(set(ids)))


def _plural(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else (plural or word + 's')}"


def _triple_terms(triples: Iterable[IdTriple]) -> Iterator[str]:
    for t in triples:
        yield from t


def _evidence_terms(bundle: EvidenceBundle) -> Iterator[str]:
    yield from _triple_terms(f.triple for f in bundle.explicit_facts)
    for f in bundle.inferred_facts:
        yield from f.triple
        yield from _triple_terms(f.derived_from)
    for p in bundle.access_paths:
        yield p.agent
        yield p.target
        yield from _triple_terms(f.triple for f in p.triples)
        yield from p.excessive_permissions


def evidence_identifiers(bundle: EvidenceBundle) -> tuple[str, ...]:
    """Every agent, permission, resource and category id in the bundle, sorted."""
    return tuple(sorted({t for t in _evidence_terms(bundle) if _family(t)}))


def _evidence_text(bundle: EvidenceBundle) -> str:
    ids = evidence_identifiers(bundle)
    parts = []
    for fam in EVIDENCE_FAMILIES:
        members = [i for i in ids if _family(i) == fam]
        parts.append(f"{_FAMILY_TITLES[fam]} {_join(members)}")
    rules = _join(sorted(set(bundle.applied_rules)))
    return (
        "Evidence: " + "; ".join(parts) + ". "
        f"Rules applied: {rules}. "
        f"Based on {_plural(len(bundle.explicit_facts), 'explicit fact')}, "
        f"{_plural(len(bundle.inferred_facts), 'inferred fact')} and "
        f"{_plural(len(bundle.access_paths), 'access path')}."
    )


def _via(path) -> str | None:
    """The tool or role a path goes through, or None for a direct grant."""
    if path.route == "direct" or not path.triples:
        return None
    return path.triples[0].triple[2]


# ----------------------------------------------------------------- templates


def _explain_authorization(r: AuthorizationDecision) -> list[str]:
    agent, task = _name(r.agent_id), _name(r.task_id)
    out = [f"{agent} is {r.verdict} for {task}."]
    held = sorted({p.target for p in r.access_paths})
    vias = sorted({v for p in r.access_paths if (v := _via(p))})
    direct = any(p.route == "direct" for p in r.access_paths)
    if held:
        through = [_name(v) for v in vias] + (["a direct grant"] if direct else [])
        verb = "is" if len(held) == 1 else "are"
        word = "permission" if len(held) == 1 else "permissions"
        out.append(f"Required {word} {_names(held)} {verb} available through {_join(through)}.")
    elif not r.missing_permissions:
        out.append(f"{task} requires no permissions.")
    if r.missing_permissions:
        out.append(f"Missing required permissions: {_names(r.missing_permissions)}.")
    if r.violated_policies:
        out.append(f"{agent} violates the policies {_names(r.violated_policies)} that govern {task}.")
    return out


def _explain_excessive(r: ExcessiveResult) -> list[str]:
    agent = _name(r.agent_id)
    out = []
    if r.no_assigned_task:
        out.append(f"{agent} has no assigned task, so every available permission is excessive.")
    findings = sorted(r.findings, key=lambda f: f.permission_id)
    if not findings:
        out.append(f"{agent} has no excessive permissions.")
    else:
        out.append(
            f"{agent} has {_plural(len(findings), 'excessive permission')}: {_names(f.permission_id for f in findings)}."
        )
        for f in findings:
            s = f"{_name(f.permission_id)} is {f.label}; it is granted through {_names(f.sources)}."
            if f.extra_resources:
                s += f" It adds access to resources {_names(f.extra_resources)}."
            if f.extra_categories:
                s += f" It adds exposure to sensitive data categories {_names(f.extra_categories)}."
            out.append(s)
    out.append(NO_INTENT_NOTE)
    return out


def _explain_indirect(r: IndirectAccessResult) -> list[str]:
    agent = _name(r.agent_id)
    if not r.categories:
        return [f"{agent} cannot reach any sensitive data category."]
    out = [
        f"{agent} can reach {_plural(len(set(r.categories)), 'sensitive data category', 'sensitive data categories')}: "
        f"{_names(r.categories)}."
    ]
    for p in sorted(r.paths, key=lambda p: p.path_id):
        via = _via(p)
        how = f"through {_name(via)}" if via else "through a direct grant"
        s = f"{_name(p.target)} is reached {how}."
        if p.excessive_exposure:
            s += f" This path uses excessive permissions {_names(p.excessive_permissions)}."
        out.append(s)
    return out


def _explain_least_privilege(r: LeastPrivilegeResult) -> list[str]:
    agent = _name(r.agent_id)
    out = [f"The minimum permission set for {agent} is {_names(r.minimum_permission_set)}."]
    recs = sorted(r.recommendations, key=lambda x: x.permission_id)
    if not recs:
        out.append(f"No permission needs to be removed from {agent}.")
    for rec in recs:
        s = f"Remove {_name(rec.permission_id)} (granted through {_names(rec.sources)})."
        if rec.categories_lost:
            s += f" This removes access to sensitive data categories {_names(rec.categories_lost)}."
        out.append(s)
    return out


def _explain_what_if(r: WhatIfResult) -> list[str]:
    agent, perm = _name(r.agent_id), _name(r.permission_id)
    lost = sorted(set(r.categories_before) - set(r.categories_after))
    out = [
        f"If {perm} is removed from {agent}, the reachable sensitive data categories change from "
        f"{_names(r.categories_before)} to {_names(r.categories_after)}."
    ]
    out.append(f"Categories no longer reachable: {_names(lost)}.")
    if r.tasks_losing_authorization:
        out.append(f"Tasks that lose authorization: {_names(r.tasks_losing_authorization)}.")
    else:
        out.append("No assigned task loses authorization.")
    return out


_TEMPLATES = (
    (AuthorizationDecision, _explain_authorization),
    (ExcessiveResult, _explain_excessive),
    (IndirectAccessResult, _explain_indirect),
    (LeastPrivilegeResult, _explain_least_privilege),
    (WhatIfResult, _explain_what_if),
)


def explain(result: AnalysisResult) -> str:
    """Fixed English explanation of ``result`` ending with its evidence identifiers."""
    for cls, template in _TEMPLATES:
        if isinstance(result, cls):
            return " ".join(template(result) + [_evidence_text(result.evidence)])
    raise TypeError(f"Cannot explain {type(result).__name__}")
