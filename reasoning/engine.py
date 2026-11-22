"""Reasoning_Engine (design Component 6; Requirements 10 and 11).

Every public function takes a ``KGSnapshot`` plus identifiers and returns a
frozen result object from ``reasoning/models.py``. Nothing here changes the
snapshot (Req 10.9): the graphs are only read.

Facts are computed directly from the *asserted* graph, so the results never
depend on a stale ``inferred_facts.ttl``:

* Available permissions = direct ``hasPermission`` ∪ ``hasRole/hasPermission``
  ∪ ``usesTool/hasPermission`` (ORCA Rules A and B).
* Required permissions of an agent = union of ``requiresPermission`` over its
  ``assignedTask`` tasks.
* Excessive permissions = available − required (ORCA Rule D).
* Violated policies = asserted ``violatesPolicy`` ∪ ORCA Rule E.

The Derivation objects used as evidence are built here, from the same
asserted triples, so the evidence always matches the decision.

Identifiers may be compact ids (``agent:AdvisingAgent``), bare local names
(``AdvisingAgent``) or full URIs. An id resolves only to an individual typed
with the expected class or one of its subclasses (``rdf:type/rdfs:subClassOf*``);
anything else raises ``UnknownIdentifierError`` naming every bad id (Req 10.8, 11.6).

Every list in a result is sorted by compact id; access paths are sorted by
their tuple of triple ids, so equal input gives equal output (Req 10.7, 11.8).
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from rdflib import Graph, URIRef
from rdflib.namespace import RDF, RDFS

from reasoning.evidence import build_evidence, compact_triple
from reasoning.models import (
    AccessPath,
    AgentExcessSummary,
    AuthorizationDecision,
    EvidenceBundle,
    ExcessiveFinding,
    ExcessiveResult,
    IndirectAccessResult,
    KGSnapshot,
    LabelledFact,
    LeastPrivilegeResult,
    PermissionNotHeldError,
    Provenance,
    Recommendation,
    UnknownIdentifierError,
    WhatIfResult,
)
from reasoning.namespaces import ORCA, compact
from reasoning.rules import Derivation, Triple

_EXPLICIT_LABELS = ("Official_Fact", "Synthetic_Fact")


# --------------------------------------------------------------------------- ids


def local_name(uri: object) -> str:
    """Local name of a URI: the part after the prefix of its compact id."""
    text = compact(uri)
    if text != str(uri):
        return text.split(":", 1)[1]
    for sep in ("#", "/"):
        if sep in text:
            text = text.rsplit(sep, 1)[1] or text
    return text


def _cid(uri: object) -> str:
    return compact(uri)


def _sorted_uris(uris: Iterable[URIRef]) -> list[URIRef]:
    return sorted(set(uris), key=lambda u: (_cid(u), str(u)))


def _subclasses(g: Graph, cls: URIRef) -> set[URIRef]:
    """``cls`` and every class below it through ``rdfs:subClassOf*``."""
    seen = {cls}
    todo = [cls]
    while todo:
        current = todo.pop()
        for sub in g.subjects(RDFS.subClassOf, current):
            if isinstance(sub, URIRef) and sub not in seen:
                seen.add(sub)
                todo.append(sub)
    return seen


def individuals_of(g: Graph, cls: URIRef) -> list[URIRef]:
    """Individuals typed ``cls`` or a subclass of it, sorted by compact id."""
    found: set[URIRef] = set()
    for c in _subclasses(g, cls):
        for s in g.subjects(RDF.type, c):
            if isinstance(s, URIRef):
                found.add(s)
    return _sorted_uris(found)


def _resolve(g: Graph, ident: object, cls: URIRef) -> URIRef | None:
    text = str(ident).strip() if ident is not None else ""
    if not text:
        return None
    for uri in individuals_of(g, cls):
        if text == str(uri) or text == _cid(uri):
            return uri
    if ":" not in text:  # bare local name
        for uri in individuals_of(g, cls):
            if text == local_name(uri):
                return uri
    return None


def resolve_ids(kg: KGSnapshot, agent_id: str, task_id: str | None = None) -> tuple[URIRef, URIRef | None]:
    """Resolve an agent id (and optionally a task id); raise naming every bad id."""
    g = kg.asserted
    agent = _resolve(g, agent_id, ORCA.AIAgent)
    task = _resolve(g, task_id, ORCA.Task) if task_id is not None else None
    bad = []
    if agent is None:
        bad.append(str(agent_id))
    if task_id is not None and task is None:
        bad.append(str(task_id))
    if bad:
        raise UnknownIdentifierError(bad)
    return agent, task  # type: ignore[return-value]


def resolve_agent(kg: KGSnapshot, agent_id: str) -> URIRef:
    return resolve_ids(kg, agent_id)[0]


# ----------------------------------------------------------------- grant routes


@dataclass(frozen=True)
class _Route:
    """One way an agent holds a permission."""

    permission: URIRef
    route: str            # "tool" | "role" | "direct"
    via: URIRef | None    # the tool or role, None for direct
    triples: tuple[Triple, ...]
    derivation: Derivation

    @property
    def source(self) -> str:
        return "direct" if self.via is None else f"{self.route}:{local_name(self.via)}"


def _agent_type_triple(g: Graph, agent: URIRef) -> Triple:
    if (agent, RDF.type, ORCA.AIAgent) in g:
        return (agent, RDF.type, ORCA.AIAgent)
    classes = _subclasses(g, ORCA.AIAgent)
    for c in sorted(g.objects(agent, RDF.type), key=str):
        if c in classes:
            return (agent, RDF.type, c)
    return (agent, RDF.type, ORCA.AIAgent)


def _routes(g: Graph, agent: URIRef) -> list[_Route]:
    out: list[_Route] = []
    for tool in g.objects(agent, ORCA.usesTool):
        for p in g.objects(tool, ORCA.hasPermission):
            ts = ((agent, ORCA.usesTool, tool), (tool, ORCA.hasPermission, p))
            out.append(_Route(p, "tool", tool, ts, Derivation((agent, ORCA.hasAvailablePermission, p), "ORCA-A", ts)))
    for role in g.objects(agent, ORCA.hasRole):
        for p in g.objects(role, ORCA.hasPermission):
            ts = ((agent, ORCA.hasRole, role), (role, ORCA.hasPermission, p))
            out.append(_Route(p, "role", role, ts, Derivation((agent, ORCA.hasAvailablePermission, p), "ORCA-B", ts)))
    type_triple = _agent_type_triple(g, agent)
    for p in g.objects(agent, ORCA.hasPermission):
        ts = ((agent, ORCA.hasPermission, p),)
        out.append(_Route(p, "direct", None, ts,
                          Derivation((agent, ORCA.hasAvailablePermission, p), "ORCA-B", (type_triple, ts[0]))))
    unique = {(r.permission, r.route, r.via): r for r in out}
    return sorted(unique.values(), key=lambda r: (_cid(r.permission), r.route, _cid(r.via) if r.via else ""))


def available_permissions(g: Graph, agent: URIRef) -> dict[URIRef, list[str]]:
    """Available permission -> sorted sources (``direct``, ``role:<id>``, ``tool:<id>``)."""
    result: dict[URIRef, set[str]] = {}
    for r in _routes(g, agent):
        result.setdefault(r.permission, set()).add(r.source)
    return {p: sorted(result[p]) for p in _sorted_uris(result)}


def assigned_tasks(g: Graph, agent: URIRef) -> list[URIRef]:
    return _sorted_uris(t for t in g.objects(agent, ORCA.assignedTask) if isinstance(t, URIRef))


def task_required_permissions(g: Graph, task: URIRef) -> set[URIRef]:
    return set(g.objects(task, ORCA.requiresPermission))


def required_permissions(g: Graph, agent: URIRef) -> set[URIRef]:
    """Union of the required permissions of every task assigned to the agent."""
    out: set[URIRef] = set()
    for task in assigned_tasks(g, agent):
        out |= task_required_permissions(g, task)
    return out


def _resources_of(g: Graph, perms: Iterable[URIRef]) -> set[URIRef]:
    return {r for p in perms for r in g.objects(p, ORCA.accessesResource)}


def _categories_of(g: Graph, resources: Iterable[URIRef]) -> set[URIRef]:
    return {c for r in resources for c in g.objects(r, ORCA.containsSensitiveData)}


def reachable_categories(g: Graph, agent: URIRef) -> set[URIRef]:
    """Categories reachable through any available permission (ORCA Rule C)."""
    return _categories_of(g, _resources_of(g, available_permissions(g, agent)))


# -------------------------------------------------------------------- policies


def _rule_e(g: Graph, agent: URIRef, policy: URIRef, available: Iterable[URIRef]) -> list[Derivation]:
    """ORCA-E derivations of ``agent violatesPolicy policy``."""
    governed_tasks = [k for k in assigned_tasks(g, agent) if (k, ORCA.governedByPolicy, policy) in g]
    out = []
    for p in _sorted_uris(available):
        if (policy, ORCA.prohibitsPermission, p) not in g:
            continue
        for k in governed_tasks:
            out.append(Derivation(
                (agent, ORCA.violatesPolicy, policy),
                "ORCA-E",
                (
                    (agent, ORCA.hasAvailablePermission, p),
                    (policy, ORCA.prohibitsPermission, p),
                    (agent, ORCA.assignedTask, k),
                    (k, ORCA.governedByPolicy, policy),
                ),
            ))
    return out


def violated_policies(g: Graph, agent: URIRef, task: URIRef) -> list[URIRef]:
    """Policies governing ``task`` that the agent violates (asserted ``violatesPolicy`` ∪ Rule E)."""
    available = list(available_permissions(g, agent))
    out = []
    for pol in _sorted_uris(g.objects(task, ORCA.governedByPolicy)):
        if (agent, ORCA.violatesPolicy, pol) in g or _rule_e(g, agent, pol, available):
            out.append(pol)
    return out


# ------------------------------------------------------------------ access paths


def _label(g: Graph, t: Triple) -> Provenance:
    for value in g.objects(t[0], ORCA.provenanceLabel):
        if str(value) in _EXPLICIT_LABELS:
            return str(value)  # type: ignore[return-value]
    return "Unlabelled"


def _path_sort_key(p: AccessPath) -> tuple:
    return (tuple(f.triple for f in p.triples), p.path_id)


def _route_path(g: Graph, agent: URIRef, r: _Route) -> AccessPath:
    parts = ["path", local_name(agent), r.route]
    if r.via is not None:
        parts.append(local_name(r.via))
    parts.append(local_name(r.permission))
    return AccessPath(
        path_id="~".join(parts),
        agent=_cid(agent),
        target=_cid(r.permission),
        route=r.route,  # type: ignore[arg-type]
        triples=tuple(LabelledFact(compact_triple(t), _label(g, t)) for t in r.triples),
    )


def access_paths_to_permission(g: Graph, agent: URIRef, perm: URIRef) -> list[AccessPath]:
    """Every direct, role and tool path from the agent to ``perm`` (Req 10.6)."""
    paths = [_route_path(g, agent, r) for r in _routes(g, agent) if r.permission == perm]
    return sorted(paths, key=_path_sort_key)


# ---------------------------------------------------------------------- evidence


def _evidence(
    kg: KGSnapshot,
    local_derivations: Iterable[Derivation],
    used: Iterable[Triple],
    derivations: Iterable[Derivation],
    paths: Iterable[AccessPath],
) -> EvidenceBundle:
    """Build evidence against the locally derived facts, not the stored inferred file.

    A throw-away snapshot sharing the same graphs is used, so ``kg`` itself is
    never changed and stale stored derivations cannot leak into the bundle.
    """
    local = KGSnapshot(kg.asserted, kg.inferred, tuple(local_derivations), kg.version)
    return build_evidence(local, [t for t in used if t in kg.asserted], derivations, paths)


# ------------------------------------------------------------------- operations


def evaluate_authorization(kg: KGSnapshot, agent_id: str, task_id: str) -> AuthorizationDecision:
    """Authorization_Decision for an agent–task pair (Req 10.1–10.9)."""
    agent, task = resolve_ids(kg, agent_id, task_id)
    assert task is not None
    g = kg.asserted
    routes = _routes(g, agent)
    available = {r.permission for r in routes}
    required = _sorted_uris(task_required_permissions(g, task))
    missing = [p for p in required if p not in available]
    held_required = [p for p in required if p in available]

    violated: list[URIRef] = []
    e_derivations: list[Derivation] = []
    used: list[Triple] = [(agent, ORCA.assignedTask, task)]
    used += [(task, ORCA.requiresPermission, p) for p in required]
    for pol in _sorted_uris(g.objects(task, ORCA.governedByPolicy)):
        e = _rule_e(g, agent, pol, available)
        asserted = (agent, ORCA.violatesPolicy, pol) in g
        if asserted or e:
            violated.append(pol)
            e_derivations += e
            used.append((task, ORCA.governedByPolicy, pol))
            if asserted:
                used.append((agent, ORCA.violatesPolicy, pol))

    paths = sorted(
        (_route_path(g, agent, r) for r in routes if r.permission in set(held_required)),
        key=_path_sort_key,
    )
    ab = [r.derivation for r in routes if r.permission in set(held_required)]
    for r in routes:
        if r.permission in set(held_required):
            used += list(r.triples)
    evidence = _evidence(kg, [r.derivation for r in routes] + e_derivations, used, ab + e_derivations, paths)

    return AuthorizationDecision(
        result_id=f"authorization~{local_name(agent)}~{local_name(task)}",
        agent_id=_cid(agent),
        task_id=_cid(task),
        verdict="AUTHORIZED" if not missing and not violated else "NOT_AUTHORIZED",
        missing_permissions=tuple(_cid(p) for p in missing),
        violated_policies=tuple(_cid(p) for p in violated),
        access_paths=tuple(paths),
        evidence=evidence,
    )


def excessive_permissions(kg: KGSnapshot, agent_id: str) -> ExcessiveResult:
    """Excessive_Permissions of one agent with their extra exposure (Req 11.1–11.4, 11.6–11.8)."""
    agent = resolve_agent(kg, agent_id)
    g = kg.asserted
    routes = _routes(g, agent)
    sources = available_permissions(g, agent)
    tasks = assigned_tasks(g, agent)
    required = required_permissions(g, agent)
    excess = [p for p in sources if p not in required]

    required_resources = _resources_of(g, required)
    required_categories = _categories_of(g, required_resources)

    findings = []
    used: list[Triple] = [(agent, ORCA.assignedTask, k) for k in tasks]
    used += [(k, ORCA.requiresPermission, p) for k in tasks for p in _sorted_uris(task_required_permissions(g, k))]
    for p in excess:
        resources = _resources_of(g, [p])
        extra_resources = resources - required_resources
        extra_categories = _categories_of(g, resources) - required_categories
        for r in _sorted_uris(resources):
            used.append((p, ORCA.accessesResource, r))
            for c in _sorted_uris(g.objects(r, ORCA.containsSensitiveData)):
                if c in extra_categories:
                    used.append((r, ORCA.containsSensitiveData, c))
        findings.append(ExcessiveFinding(
            permission_id=_cid(p),
            sources=tuple(sources[p]),
            extra_resources=tuple(_cid(r) for r in _sorted_uris(extra_resources)),
            extra_categories=tuple(_cid(c) for c in _sorted_uris(extra_categories)),
        ))

    excess_set = set(excess)
    d_derivations = [
        Derivation((agent, ORCA.hasExcessivePermission, p), "ORCA-D", ((agent, ORCA.hasAvailablePermission, p),))
        for p in excess
    ]
    paths = sorted((_route_path(g, agent, r) for r in routes if r.permission in excess_set), key=_path_sort_key)
    for r in routes:
        if r.permission in excess_set:
            used += list(r.triples)
    evidence = _evidence(kg, [r.derivation for r in routes] + d_derivations, used, d_derivations, paths)

    return ExcessiveResult(
        result_id=f"excessive~{local_name(agent)}",
        agent_id=_cid(agent),
        no_assigned_task=not tasks,
        findings=tuple(findings),
        evidence=evidence,
    )


def excessive_permissions_all(kg: KGSnapshot) -> list[AgentExcessSummary]:
    """One summary per agent, sorted by id, including agents with no excess (Req 11.5, CQ3)."""
    g = kg.asserted
    out = []
    for agent in individuals_of(g, ORCA.AIAgent):
        available = available_permissions(g, agent)
        required = required_permissions(g, agent)
        categories = _categories_of(g, _resources_of(g, available))
        out.append(AgentExcessSummary(
            agent_id=_cid(agent),
            excessive_count=sum(1 for p in available if p not in required),
            reachable_category_count=len(categories),
        ))
    return sorted(out, key=lambda s: s.agent_id)


# --------------------------------------------------- indirect sensitive access


# The three fixed route templates (Req 12.3). Each is a single SELECT with the
# agent bound through initBindings, so the search always terminates, even when
# the data contains cycles (Req 12.5).
_TOOL_TEMPLATE = """
    SELECT ?via ?p ?r ?c WHERE {
        ?a orca:usesTool ?via .
        ?via orca:hasPermission ?p .
        ?p orca:accessesResource ?r .
        ?r orca:containsSensitiveData ?c .
    }
"""
_ROLE_TEMPLATE = """
    SELECT ?via ?p ?r ?c WHERE {
        ?a orca:hasRole ?via .
        ?via orca:hasPermission ?p .
        ?p orca:accessesResource ?r .
        ?r orca:containsSensitiveData ?c .
    }
"""
_DIRECT_TEMPLATE = """
    SELECT ?p ?r ?c WHERE {
        ?a orca:hasPermission ?p .
        ?p orca:accessesResource ?r .
        ?r orca:containsSensitiveData ?c .
    }
"""
_TEMPLATES = (
    ("tool", ORCA.usesTool, _TOOL_TEMPLATE),
    ("role", ORCA.hasRole, _ROLE_TEMPLATE),
    ("direct", None, _DIRECT_TEMPLATE),
)


@dataclass(frozen=True)
class _SensitiveRow:
    route: str
    via: URIRef | None
    permission: URIRef
    resource: URIRef
    category: URIRef
    triples: tuple[Triple, ...]


def _sensitive_rows(g: Graph, agent: URIRef) -> list[_SensitiveRow]:
    """Rows of the three templates, without node-repeating paths or duplicates."""
    rows: dict[tuple[Triple, ...], _SensitiveRow] = {}
    for route, link, template in _TEMPLATES:
        for row in g.query(template, initNs={"orca": ORCA}, initBindings={"a": agent}):
            via = row.via if link is not None else None  # type: ignore[union-attr]
            p, r, c = row.p, row.r, row.c  # type: ignore[union-attr]
            if not all(isinstance(x, URIRef) for x in (p, r, c)) or (via is not None and not isinstance(via, URIRef)):
                continue
            nodes = [agent] + ([via] if via is not None else []) + [p, r, c]
            if len(set(nodes)) != len(nodes):  # a path visiting a node twice is dropped
                continue
            head: tuple[Triple, ...] = (
                ((agent, link, via), (via, ORCA.hasPermission, p)) if via is not None
                else ((agent, ORCA.hasPermission, p),)
            )
            triples = head + ((p, ORCA.accessesResource, r), (r, ORCA.containsSensitiveData, c))
            rows.setdefault(triples, _SensitiveRow(route, via, p, r, c, triples))
    return list(rows.values())


def sensitive_paths(g: Graph, agent: URIRef) -> list[AccessPath]:
    """Every tool, role and direct path from the agent to a sensitive category (Req 12.1–12.6).

    A category is "excessive exposure" when every path to it passes through an
    Excessive_Permission; then every path to it is marked and names the
    excessive permissions on that path.
    """
    rows = _sensitive_rows(g, agent)
    excess = set(available_permissions(g, agent)) - required_permissions(g, agent)

    by_category: dict[URIRef, list[_SensitiveRow]] = {}
    for row in rows:
        by_category.setdefault(row.category, []).append(row)
    exposed = {c for c, rs in by_category.items() if all(r.permission in excess for r in rs)}

    paths = []
    for row in rows:
        parts = ["path", local_name(agent), row.route]
        if row.via is not None:
            parts.append(local_name(row.via))
        parts += [local_name(row.permission), local_name(row.resource), local_name(row.category)]
        marked = row.category in exposed
        # each template has one permission node; when marked it is excessive
        on_path = sorted(_cid(p) for p in (row.permission,) if p in excess) if marked else []
        paths.append(AccessPath(
            path_id="~".join(parts),
            agent=_cid(agent),
            target=_cid(row.category),
            route=row.route,  # type: ignore[arg-type]
            triples=tuple(LabelledFact(compact_triple(t), _label(g, t)) for t in row.triples),
            excessive_exposure=marked,
            excessive_permissions=tuple(on_path),
        ))
    return sorted(paths, key=_path_sort_key)


def indirect_access(kg: KGSnapshot, agent_id: str) -> IndirectAccessResult:
    """Sensitive categories the agent reaches, with every access path (Req 12, CQ1)."""
    agent = resolve_agent(kg, agent_id)
    g = kg.asserted
    rows = _sensitive_rows(g, agent)
    paths = sensitive_paths(g, agent)
    routes = _routes(g, agent)
    route_by_key = {(r.permission, r.route, r.via): r for r in routes}

    used: list[Triple] = [t for row in rows for t in row.triples]
    ab: list[Derivation] = []
    c_derivations: list[Derivation] = []
    for row in rows:
        r = route_by_key.get((row.permission, row.route, row.via))
        if r is not None:
            ab.append(r.derivation)
        c_derivations.append(Derivation(
            (agent, ORCA.canReachSensitiveData, row.category),
            "ORCA-C",
            (
                (agent, ORCA.hasAvailablePermission, row.permission),
                (row.permission, ORCA.accessesResource, row.resource),
                (row.resource, ORCA.containsSensitiveData, row.category),
            ),
        ))
    evidence = _evidence(kg, [r.derivation for r in routes] + c_derivations, used, ab + c_derivations, paths)

    categories = _sorted_uris(row.category for row in rows)
    return IndirectAccessResult(
        result_id=f"indirect~{local_name(agent)}",
        agent_id=_cid(agent),
        categories=tuple(_cid(c) for c in categories),
        paths=tuple(paths),
        evidence=evidence,
    )


# ------------------------------------------------- least privilege and what-if
#
# What-if removal never edits ``kg``: it copies the asserted graph, deletes the
# permission from every route through which the agent holds it (direct, each
# used tool, each role) and recomputes Rules A–E on the copy with the same
# functions used above. Removing from a shared tool or role also affects other
# agents *in the copy*; the stored graph is untouched (Req 13.3).


def _copy_graph(g: Graph) -> Graph:
    new = Graph()
    for prefix, ns in g.namespaces():
        new.bind(prefix, ns, override=True, replace=True)
    for t in g:
        new.add(t)
    return new


def _removal_triples(g: Graph, agent: URIRef, perms: Iterable[URIRef]) -> list[Triple]:
    """Asserted triples granting any of ``perms`` to the agent, over all routes."""
    wanted = set(perms)
    out = {t for r in _routes(g, agent) if r.permission in wanted for t in r.triples[-1:]}
    return sorted(out, key=lambda t: compact_triple(t))


def _without(g: Graph, triples: Iterable[Triple]) -> Graph:
    new = _copy_graph(g)
    for t in triples:
        new.remove(t)
    return new


def _authorized_tasks(kg: KGSnapshot, agent: URIRef) -> set[URIRef]:
    return {
        k for k in assigned_tasks(kg.asserted, agent)
        if evaluate_authorization(kg, str(agent), str(k)).verdict == "AUTHORIZED"
    }


def _resolve_permission(kg: KGSnapshot, agent_id: str, permission_id: str) -> tuple[URIRef, URIRef]:
    g = kg.asserted
    agent = _resolve(g, agent_id, ORCA.AIAgent)
    perm = _resolve(g, permission_id, ORCA.Permission)
    bad = []
    if agent is None:
        bad.append(str(agent_id))
    if perm is None:
        bad.append(str(permission_id))
    if bad:
        raise UnknownIdentifierError(bad)
    assert agent is not None and perm is not None
    if perm not in available_permissions(g, agent):
        raise PermissionNotHeldError(_cid(agent), _cid(perm))
    return agent, perm


def _what_if(kg: KGSnapshot, agent: URIRef, perm: URIRef) -> WhatIfResult:
    g = kg.asserted
    removed = _removal_triples(g, agent, [perm])
    after_g = _without(g, removed)
    after_kg = KGSnapshot(after_g, Graph(), (), kg.version)

    before = reachable_categories(g, agent)
    after = reachable_categories(after_g, agent)
    lost_tasks = _authorized_tasks(kg, agent) - _authorized_tasks(after_kg, agent)

    # Evidence: the removed triples, plus every path that disappears.
    after_ids = {p.path_id for p in sensitive_paths(after_g, agent)}
    gone = [p for p in sensitive_paths(g, agent) if p.path_id not in after_ids]
    gone += access_paths_to_permission(g, agent, perm)
    routes = _routes(g, agent)
    used: list[Triple] = list(removed)
    used += [t for p_route in routes if p_route.permission == perm for t in p_route.triples]
    evidence = _evidence(kg, [r.derivation for r in routes], used, [], sorted(gone, key=_path_sort_key))

    return WhatIfResult(
        result_id=f"whatif~{local_name(agent)}~{local_name(perm)}",
        agent_id=_cid(agent),
        permission_id=_cid(perm),
        categories_before=tuple(_cid(c) for c in _sorted_uris(before)),
        categories_after=tuple(_cid(c) for c in _sorted_uris(after)),
        tasks_losing_authorization=tuple(_cid(k) for k in _sorted_uris(lost_tasks)),
        evidence=evidence,
    )


def what_if_remove(kg: KGSnapshot, agent_id: str, permission_id: str) -> WhatIfResult:
    """Effect of removing one permission from every route of the agent (Req 13.3, 13.4, 13.7, 13.8)."""
    agent, perm = _resolve_permission(kg, agent_id, permission_id)
    return _what_if(kg, agent, perm)


def least_privilege(kg: KGSnapshot, agent_id: str) -> LeastPrivilegeResult:
    """Minimum_Permission_Set and one removal recommendation per excessive permission (Req 13.1, 13.2)."""
    agent = resolve_agent(kg, agent_id)
    g = kg.asserted
    routes = _routes(g, agent)
    sources = available_permissions(g, agent)
    required = required_permissions(g, agent)
    excess = [p for p in sources if p not in required]

    recommendations = []
    for p in excess:
        w = _what_if(kg, agent, p)
        lost = sorted(set(w.categories_before) - set(w.categories_after))
        recommendations.append(Recommendation(
            permission_id=_cid(p),
            sources=tuple(sources[p]),
            categories_lost=tuple(lost),
        ))

    excess_set = set(excess)
    d_derivations = [
        Derivation((agent, ORCA.hasExcessivePermission, p), "ORCA-D", ((agent, ORCA.hasAvailablePermission, p),))
        for p in excess
    ]
    tasks = assigned_tasks(g, agent)
    used: list[Triple] = [(agent, ORCA.assignedTask, k) for k in tasks]
    used += [(k, ORCA.requiresPermission, p) for k in tasks for p in _sorted_uris(task_required_permissions(g, k))]
    for r in routes:
        if r.permission in excess_set:
            used += list(r.triples)
    paths = sorted((_route_path(g, agent, r) for r in routes if r.permission in excess_set), key=_path_sort_key)
    evidence = _evidence(kg, [r.derivation for r in routes] + d_derivations, used, d_derivations, paths)

    return LeastPrivilegeResult(
        result_id=f"least~{local_name(agent)}",
        agent_id=_cid(agent),
        minimum_permission_set=tuple(_cid(p) for p in _sorted_uris(required)),
        recommendations=tuple(recommendations),
        evidence=evidence,
    )


def apply_recommendations(kg: KGSnapshot, agent_id: str) -> KGSnapshot:
    """New snapshot with every recommended permission removed from all of the agent's routes.

    Used to check Req 13.5/13.6. Shared tools and roles lose the permission for
    other agents too; required permissions of this agent are never removed
    because, by definition, they are not excessive.
    """
    agent = resolve_agent(kg, agent_id)
    g = kg.asserted
    excess = set(available_permissions(g, agent)) - required_permissions(g, agent)
    new = _without(g, _removal_triples(g, agent, excess))
    return KGSnapshot(new, Graph(), (), kg.version)
