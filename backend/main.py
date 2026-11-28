"""FastAPI Backend_API for ORCA (design Component 10; Requirements 14-17).

Serves:
- Collection read routes (agents, tasks, tools, permissions, resources, sensitive-data, policies, roles, controls, supervisors)
- In-memory KG mutation routes with automatic OWL-RL + ORCA A-E re-inference
- Deterministic reasoning engine endpoints (authorization, excessive, indirect access, least privilege, what-if, evidence)
- Read-only SPARQL endpoint with parser guard & timeout enforcement + 13 CQ presets
- Hybrid symbolic + PyTorch KG embedding endpoints (Option D)
- Knowledge-grounded LLM Q&A assistant & LLM-only vs KG-grounded comparison endpoints
- Static SPA serving when ``frontend/dist`` is built
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from rdflib import Literal, URIRef
from rdflib.namespace import RDF, RDFS
from rdflib.plugins.sparql.parser import parseQuery

from backend.assistant import ask, ask_llm_only, compare_llm_vs_kg
from backend.graph_store import (
    GraphStore,
    QueryError,
    QueryTimeout,
    Settings,
    open_store,
)
from backend.llm_client import LLMClient, get_llm_client
from backend.models import (
    AccessPathModel,
    AgentExcessSummaryModel,
    AskRequest,
    AssignPermissionRequest,
    AssignTaskRequest,
    AssignToolRequest,
    AssistantResponse,
    AuthorizationRequest,
    AuthorizationResponse,
    CompareResponse,
    CreateAgentRequest,
    CreateTaskRequest,
    DashboardSummary,
    EntityDetail,
    EntityFact,
    EntitySummary,
    EvidenceResponse,
    ExcessiveResponse,
    ExcessiveSummaryResponse,
    GraphEdge,
    GraphNode,
    GraphResponse,
    IndirectAccessResponse,
    KGStatsResponse,
    LeastPrivilegeResponse,
    LLMOnlyResponse,
    PredictedLinkModel,
    PredictLinkRequest,
    ShortfallModel,
    SimilarEntityModel,
    SparqlRequest,
    SparqlResponse,
    WhatIfRequest,
    WhatIfResponse,
    analysis_response,
    from_result,
)
from reasoning.embeddings import DEFAULT_EMBEDDINGS_PATH, EmbeddingBundle, load_or_train_bundle, most_similar_entities
from reasoning.engine import (
    _resolve,
    assigned_tasks,
    evaluate_authorization,
    excessive_permissions,
    excessive_permissions_all,
    indirect_access,
    individuals_of,
    least_privilege,
    local_name,
    what_if_remove,
)
from reasoning.explainer import explain
from reasoning.hybrid import discover_hybrid_candidates, predict_and_audit
from reasoning.infer import build_output_graph, infer
from reasoning.models import KGSnapshot, PermissionNotHeldError, UnknownIdentifierError
from reasoning.namespaces import INSTANCE_BASE, INSTANCE_NS, ONTOLOGY_IRI, ORCA, compact
from reasoning.stats import compute_stats_from_graphs

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
SPARQL_DIR = PROJECT_ROOT / "sparql"
RESULTS_DIR = PROJECT_ROOT / "results"

_COLLECTIONS: dict[str, tuple[URIRef, str]] = {
    "agents": (ORCA.AIAgent, "AIAgent"),
    "tasks": (ORCA.Task, "Task"),
    "tools": (ORCA.Tool, "Tool"),
    "permissions": (ORCA.Permission, "Permission"),
    "resources": (ORCA.Resource, "Resource"),
    "sensitive-data": (ORCA.SensitiveDataCategory, "SensitiveDataCategory"),
    "policies": (ORCA.SecurityPolicy, "SecurityPolicy"),
    "roles": (ORCA.Role, "Role"),
    "controls": (ORCA.SecurityControl, "SecurityControl"),
    "supervisors": (ORCA.HumanUser, "HumanUser"),
}

_UPDATE_RE = re.compile(r"\b(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|COPY|MOVE|ADD)\b", re.IGNORECASE)


class ConflictError(Exception):
    """Raised when attempting to create a duplicate individual or relation (HTTP 409)."""


def _label_of(g, uri: URIRef) -> str | None:
    vals = [str(v) for v in g.objects(uri, RDFS.label)]
    return vals[0] if vals else local_name(uri)


def _provenance_of(g, uri: URIRef) -> str:
    for v in g.objects(uri, ORCA.provenanceLabel):
        s = str(v)
        if s in ("Official_Fact", "Synthetic_Fact", "Inferred_Fact"):
            return s
    return "Unlabelled"


def _entity_detail(snap: KGSnapshot, uri: URIRef) -> EntityDetail:
    g = snap.asserted
    facts: list[EntityFact] = []
    for p, o in sorted(g.predicate_objects(uri), key=lambda po: (compact(po[0]), str(po[1]))):
        if p in (RDFS.label, ORCA.provenanceLabel):
            continue
        obj_str = str(o) if isinstance(o, Literal) else compact(o)
        facts.append(EntityFact(predicate=compact(p), object=obj_str))
    return EntityDetail(
        id=local_name(uri),
        label=_label_of(g, uri),
        provenance=_provenance_of(g, uri),  # type: ignore[arg-type]
        facts=facts,
    )


def _resolve_collection_item(snap: KGSnapshot, collection: str, item_id: str) -> URIRef:
    if collection not in _COLLECTIONS:
        raise UnknownIdentifierError(collection)
    cls_uri, _ = _COLLECTIONS[collection]
    found = _resolve(snap.asserted, item_id, cls_uri)
    if found is None:
        raise UnknownIdentifierError(item_id)
    return found


def _recompute_inferred(store: GraphStore) -> None:
    snap = store.snapshot()
    result = infer(snap.asserted)
    store.replace_inferred(build_output_graph(result))


def create_app(
    store: GraphStore | None = None,
    llm_client: LLMClient | None = None,
    *,
    sparql_timeout_s: float = 30.0,
) -> FastAPI:
    """Create the ORCA FastAPI application."""
    active_store = store if store is not None else open_store(Settings.from_env())

    app = FastAPI(
        title="ORCA Agent Authorization API",
        description="Ontology-based Resource Control, Hybrid Reasoning, and KG-Grounded Q&A for AI Agents.",
        version="2.0.0",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.store = active_store
    app.state.llm_client = llm_client
    app.state.embedding_bundle = None
    app.state.sparql_timeout_s = sparql_timeout_s
    app.state.stats_cache = None  # tuple[int, KGStatsResponse]
    app.state.dashboard_cache = None  # tuple[int, DashboardSummary]
    app.state.hybrid_candidates_cache = {}  # dict[tuple[int, str], list[dict[str, Any]]]

    def _get_llm() -> LLMClient:
        if app.state.llm_client is None:
            app.state.llm_client = get_llm_client()
        return app.state.llm_client

    def _get_embeddings(snap: KGSnapshot) -> EmbeddingBundle:
        bundle: EmbeddingBundle | None = app.state.embedding_bundle
        if bundle is None or bundle.dataset.num_entities != len(
            {s for s in snap.asserted.subjects(RDF.type, None) if isinstance(s, URIRef) and str(s).startswith(INSTANCE_BASE)}
        ):
            bundle = load_or_train_bundle(snap, DEFAULT_EMBEDDINGS_PATH)
            app.state.embedding_bundle = bundle
        return bundle

    # ------------------------------------------------------------------ error handlers

    @app.exception_handler(UnknownIdentifierError)
    async def _handle_unknown(_req, exc: UnknownIdentifierError):
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(PermissionNotHeldError)
    async def _handle_not_held(_req, exc: PermissionNotHeldError):
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def _handle_conflict(_req, exc: ConflictError):
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    # ------------------------------------------------------------------ KG stats, graph & dashboard

    @app.get("/api/kg/stats", response_model=KGStatsResponse)
    def get_kg_stats():
        snap = active_store.snapshot()
        cached = app.state.stats_cache
        if cached is not None and cached[0] == snap.version:
            return cached[1]
        from rdflib import Graph as RDFGraph

        tbox_g = RDFGraph()
        abox_g = RDFGraph()
        for t in snap.asserted:
            if isinstance(t[0], URIRef) and str(t[0]).startswith(INSTANCE_BASE):
                abox_g.add(t)
            else:
                tbox_g.add(t)
        report = compute_stats_from_graphs(tbox_g, abox_g, snap.inferred)
        res = KGStatsResponse(
            asserted_triples=report.asserted_triples,
            tbox_triples=report.tbox_triples,
            abox_triples=report.abox_triples,
            inferred_triples=report.inferred_triples,
            class_counts=dict(report.class_counts),
            shortfalls=[ShortfallModel(name=s.name, value=s.value, minimum=s.minimum) for s in report.shortfalls],
            store_type=active_store.store_type,
        )
        app.state.stats_cache = (snap.version, res)
        return res

    @app.get("/api/kg/graph", response_model=GraphResponse)
    def get_kg_graph(include_inferred: bool = Query(default=False)):
        snap = active_store.snapshot()
        g = snap.asserted
        nodes: list[GraphNode] = []
        node_ids: set[str] = set()

        for s in sorted(set(g.subjects(RDF.type, None)), key=str):
            if not isinstance(s, URIRef) or not str(s).startswith(INSTANCE_BASE):
                continue
            cid = compact(s)
            node_ids.add(cid)
            types = [compact(t) for t in g.objects(s, RDF.type) if isinstance(t, URIRef) and str(t).startswith(str(ORCA))]
            nodes.append(
                GraphNode(
                    id=cid,
                    label=_label_of(g, s),
                    type=sorted(types)[0] if types else None,
                    provenance=_provenance_of(g, s),  # type: ignore[arg-type]
                )
            )

        edges: list[GraphEdge] = []
        seen_edges: set[tuple[str, str, str]] = set()
        for src_graph in (g, snap.inferred) if include_inferred else (g,):
            for s, p, o in src_graph:
                if (
                    isinstance(s, URIRef)
                    and isinstance(o, URIRef)
                    and str(s).startswith(INSTANCE_BASE)
                    and str(o).startswith(INSTANCE_BASE)
                    and str(p).startswith(str(ORCA))
                ):
                    edge = (compact(s), compact(p), compact(o))
                    if edge[0] in node_ids and edge[2] in node_ids and edge not in seen_edges:
                        seen_edges.add(edge)
                        edges.append(GraphEdge(source=edge[0], predicate=edge[1], target=edge[2]))
        edges.sort(key=lambda e: (e.source, e.predicate, e.target))
        return GraphResponse(nodes=nodes, edges=edges)

    @app.get("/api/dashboard/summary", response_model=DashboardSummary)
    def get_dashboard_summary():
        snap = active_store.snapshot()
        cached = app.state.dashboard_cache
        if cached is not None and cached[0] == snap.version:
            return cached[1]
        g = snap.asserted
        agents = individuals_of(g, ORCA.AIAgent)
        auth_ok = 0
        auth_fail = 0
        reachable_cats: set[str] = set()
        path_count = 0
        for a in agents:
            aid = compact(a)
            for t in assigned_tasks(g, a):
                dec = evaluate_authorization(snap, aid, compact(t))
                if dec.verdict == "AUTHORIZED":
                    auth_ok += 1
                else:
                    auth_fail += 1
            ind = indirect_access(snap, aid)
            reachable_cats.update(ind.categories)
            path_count += len(ind.paths)

        exc_total = sum(s.excessive_count for s in excessive_permissions_all(snap))
        res = DashboardSummary(
            agent_count=len(agents),
            tool_count=len(individuals_of(g, ORCA.Tool)),
            permission_count=len(individuals_of(g, ORCA.Permission)),
            resource_count=len(individuals_of(g, ORCA.Resource)),
            authorized_count=auth_ok,
            not_authorized_count=auth_fail,
            excessive_permission_count=exc_total,
            reachable_category_count=len(reachable_cats),
            indirect_path_count=path_count,
        )
        app.state.dashboard_cache = (snap.version, res)
        return res

    # ------------------------------------------------------------------ access paths

    @app.get("/api/access-paths", response_model=list[AccessPathModel])
    def list_access_paths():
        snap = active_store.snapshot()
        all_paths = []
        for a in individuals_of(snap.asserted, ORCA.AIAgent):
            res = indirect_access(snap, compact(a))
            all_paths.extend(from_result(p) for p in res.paths)
        return all_paths

    @app.get("/api/access-paths/{path_id}", response_model=AccessPathModel)
    def get_access_path(path_id: str):
        for p in list_access_paths():
            if p.path_id == path_id:
                return p
        raise UnknownIdentifierError(path_id)

    # ------------------------------------------------------------------ mutations

    @app.post("/api/agents", response_model=EntitySummary, status_code=201)
    def create_agent(req: CreateAgentRequest):
        snap = active_store.snapshot()
        g = snap.asserted
        if _resolve(g, req.id, ORCA.AIAgent) is not None or any(
            local_name(u) == req.id for u in set(g.subjects(RDF.type, None)) if str(u).startswith(INSTANCE_BASE)
        ):
            raise ConflictError(f"Identifier already exists: {req.id}")
        uri = INSTANCE_NS["AIAgent"][req.id]
        active_store.add([
            (uri, RDF.type, ORCA.AIAgent),
            (uri, RDFS.label, Literal(req.label)),
            (uri, ORCA.provenanceLabel, Literal("Synthetic_Fact")),
        ])
        _recompute_inferred(active_store)
        return EntitySummary(id=req.id, label=req.label)

    @app.post("/api/tasks", response_model=EntitySummary, status_code=201)
    def create_task(req: CreateTaskRequest):
        snap = active_store.snapshot()
        g = snap.asserted
        if _resolve(g, req.id, ORCA.Task) is not None or any(
            local_name(u) == req.id for u in set(g.subjects(RDF.type, None)) if str(u).startswith(INSTANCE_BASE)
        ):
            raise ConflictError(f"Identifier already exists: {req.id}")
        perm_uris: list[URIRef] = []
        bad_perms: list[str] = []
        for pid in req.required_permissions:
            p_uri = _resolve(g, pid, ORCA.Permission)
            if p_uri is None:
                bad_perms.append(pid)
            else:
                perm_uris.append(p_uri)
        if bad_perms:
            raise UnknownIdentifierError(bad_perms)

        uri = INSTANCE_NS["Task"][req.id]
        triples: list[tuple[Any, Any, Any]] = [
            (uri, RDF.type, ORCA.Task),
            (uri, RDFS.label, Literal(req.label)),
            (uri, ORCA.provenanceLabel, Literal("Synthetic_Fact")),
        ]
        for p_uri in perm_uris:
            triples.append((uri, ORCA.requiresPermission, p_uri))
        active_store.add(triples)
        _recompute_inferred(active_store)
        return EntitySummary(id=req.id, label=req.label)

    @app.post("/api/agents/{agent_id}/permissions", response_model=EntityDetail)
    def assign_agent_permission(agent_id: str, req: AssignPermissionRequest):
        snap = active_store.snapshot()
        g = snap.asserted
        agent = _resolve(g, agent_id, ORCA.AIAgent)
        perm = _resolve(g, req.permission_id, ORCA.Permission)
        bad = [x for x, uri in ((agent_id, agent), (req.permission_id, perm)) if uri is None]
        if bad:
            raise UnknownIdentifierError(bad)
        assert agent is not None and perm is not None
        triple = (agent, ORCA.hasPermission, perm)
        if triple in g:
            raise ConflictError(f"Agent {agent_id} already directly holds {req.permission_id}")
        active_store.add([triple])
        _recompute_inferred(active_store)
        return _entity_detail(active_store.snapshot(), agent)

    @app.delete("/api/agents/{agent_id}/permissions/{permission_id}", response_model=EntityDetail)
    def remove_agent_permission(agent_id: str, permission_id: str):
        snap = active_store.snapshot()
        g = snap.asserted
        agent = _resolve(g, agent_id, ORCA.AIAgent)
        perm = _resolve(g, permission_id, ORCA.Permission)
        bad = [x for x, uri in ((agent_id, agent), (permission_id, perm)) if uri is None]
        if bad:
            raise UnknownIdentifierError(bad)
        assert agent is not None and perm is not None
        triple = (agent, ORCA.hasPermission, perm)
        if triple not in g:
            raise PermissionNotHeldError(compact(agent), compact(perm))
        active_store.remove([triple])
        _recompute_inferred(active_store)
        return _entity_detail(active_store.snapshot(), agent)

    @app.post("/api/agents/{agent_id}/tools", response_model=EntityDetail)
    def assign_agent_tool(agent_id: str, req: AssignToolRequest):
        snap = active_store.snapshot()
        g = snap.asserted
        agent = _resolve(g, agent_id, ORCA.AIAgent)
        tool = _resolve(g, req.tool_id, ORCA.Tool)
        bad = [x for x, uri in ((agent_id, agent), (req.tool_id, tool)) if uri is None]
        if bad:
            raise UnknownIdentifierError(bad)
        assert agent is not None and tool is not None
        triple = (agent, ORCA.usesTool, tool)
        if triple in g:
            raise ConflictError(f"Agent {agent_id} already uses tool {req.tool_id}")
        active_store.add([triple])
        _recompute_inferred(active_store)
        return _entity_detail(active_store.snapshot(), agent)

    @app.delete("/api/agents/{agent_id}/tools/{tool_id}", response_model=EntityDetail)
    def remove_agent_tool(agent_id: str, tool_id: str):
        snap = active_store.snapshot()
        g = snap.asserted
        agent = _resolve(g, agent_id, ORCA.AIAgent)
        tool = _resolve(g, tool_id, ORCA.Tool)
        bad = [x for x, uri in ((agent_id, agent), (tool_id, tool)) if uri is None]
        if bad:
            raise UnknownIdentifierError(bad)
        assert agent is not None and tool is not None
        triple = (agent, ORCA.usesTool, tool)
        if triple not in g:
            raise HTTPException(status_code=404, detail=f"Agent {agent_id} does not use tool {tool_id}")
        active_store.remove([triple])
        _recompute_inferred(active_store)
        return _entity_detail(active_store.snapshot(), agent)

    @app.post("/api/agents/{agent_id}/tasks", response_model=EntityDetail)
    def assign_agent_task(agent_id: str, req: AssignTaskRequest):
        snap = active_store.snapshot()
        g = snap.asserted
        agent = _resolve(g, agent_id, ORCA.AIAgent)
        task = _resolve(g, req.task_id, ORCA.Task)
        bad = [x for x, uri in ((agent_id, agent), (req.task_id, task)) if uri is None]
        if bad:
            raise UnknownIdentifierError(bad)
        assert agent is not None and task is not None
        triple = (agent, ORCA.assignedTask, task)
        if triple in g:
            raise ConflictError(f"Agent {agent_id} is already assigned task {req.task_id}")
        active_store.add([triple])
        _recompute_inferred(active_store)
        return _entity_detail(active_store.snapshot(), agent)

    # ------------------------------------------------------------------ analysis & evidence

    @app.post("/api/analysis/authorization", response_model=AuthorizationResponse)
    def analyze_authorization(req: AuthorizationRequest):
        snap = active_store.snapshot()
        dec = evaluate_authorization(snap, req.agent_id, req.task_id)
        return analysis_response(dec, explanation=explain(dec))

    @app.get("/api/analysis/excessive", response_model=ExcessiveSummaryResponse)
    def analyze_excessive_all():
        snap = active_store.snapshot()
        summaries = excessive_permissions_all(snap)
        return ExcessiveSummaryResponse(
            result=[AgentExcessSummaryModel.model_validate(from_result(s)) for s in summaries]
        )

    @app.get("/api/analysis/excessive/{agent_id}", response_model=ExcessiveResponse)
    def analyze_excessive_one(agent_id: str):
        snap = active_store.snapshot()
        res = excessive_permissions(snap, agent_id)
        return analysis_response(res, explanation=explain(res))

    @app.get("/api/analysis/indirect-access/{agent_id}", response_model=IndirectAccessResponse)
    def analyze_indirect_access(agent_id: str):
        snap = active_store.snapshot()
        res = indirect_access(snap, agent_id)
        return analysis_response(res, explanation=explain(res))

    @app.get("/api/analysis/least-privilege/{agent_id}", response_model=LeastPrivilegeResponse)
    def analyze_least_privilege(agent_id: str):
        snap = active_store.snapshot()
        res = least_privilege(snap, agent_id)
        return analysis_response(res, explanation=explain(res))

    @app.post("/api/analysis/what-if-removal", response_model=WhatIfResponse)
    def analyze_what_if(req: WhatIfRequest):
        snap = active_store.snapshot()
        res = what_if_remove(snap, req.agent_id, req.permission_id)
        return analysis_response(res, explanation=explain(res))

    @app.get("/api/evidence/{result_id}", response_model=EvidenceResponse)
    def get_evidence_by_result_id(result_id: str):
        snap = active_store.snapshot()
        parts = result_id.split("~")
        op = parts[0]
        if op == "authorization" and len(parts) == 3:
            res = evaluate_authorization(snap, parts[1], parts[2])
        elif op == "excessive" and len(parts) == 2:
            res = excessive_permissions(snap, parts[1])
        elif op == "indirect" and len(parts) == 2:
            res = indirect_access(snap, parts[1])
        elif op == "least" and len(parts) == 2:
            res = least_privilege(snap, parts[1])
        elif op == "whatif" and len(parts) == 3:
            res = what_if_remove(snap, parts[1], parts[2])
        else:
            raise UnknownIdentifierError(result_id)
        return EvidenceResponse(result_id=res.result_id, evidence=from_result(res.evidence))  # type: ignore[arg-type]

    # ------------------------------------------------------------------ read-only SPARQL

    @app.get("/api/sparql/presets")
    def get_sparql_presets():
        presets = []
        if SPARQL_DIR.is_dir():
            for p in sorted(SPARQL_DIR.glob("*.rq")):
                text = p.read_text(encoding="utf-8")
                first_comment = next(
                    (ln.lstrip("# ").strip() for ln in text.splitlines() if ln.strip().startswith("#")),
                    p.stem,
                )
                presets.append({"id": p.stem, "filename": p.name, "title": first_comment, "query": text})
        return presets

    @app.post("/api/sparql", response_model=SparqlResponse)
    def execute_sparql(req: SparqlRequest):
        if _UPDATE_RE.search(req.query):
            # Let parseQuery check syntax too, or reject updates outright.
            try:
                parsed = parseQuery(req.query)
                if parsed[1].name not in ("SelectQuery", "AskQuery", "ConstructQuery"):
                    raise HTTPException(status_code=400, detail="Only read-only SELECT, ASK, or CONSTRUCT queries are allowed.")
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(status_code=400, detail=f"SPARQL error or unsupported update statement: {exc}")

        try:
            parsed = parseQuery(req.query)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"SPARQL syntax error: {exc}")

        qname = parsed[1].name
        if qname not in ("SelectQuery", "AskQuery", "ConstructQuery"):
            raise HTTPException(status_code=400, detail=f"Unsupported SPARQL query form {qname}; only SELECT, ASK, CONSTRUCT are allowed.")

        timeout = float(app.state.sparql_timeout_s)
        with ThreadPoolExecutor(max_workers=1) as pool:
            fut = pool.submit(active_store.query, req.query, timeout)
            try:
                qr = fut.result(timeout=timeout)
            except (FuturesTimeout, QueryTimeout):
                raise HTTPException(status_code=504, detail="query timed out")
            except QueryError as exc:
                raise HTTPException(status_code=400, detail=str(exc))

        if qr.query_type == "ASK":
            return SparqlResponse(query_type="ASK", boolean=qr.boolean)
        if qr.query_type == "CONSTRUCT":
            triples = sorted(
                (compact(s), compact(p), str(o) if isinstance(o, Literal) else compact(o))
                for s, p, o in (qr.graph or ())
            )
            return SparqlResponse(query_type="CONSTRUCT", triples=triples)
        return SparqlResponse(query_type="SELECT", vars=list(qr.vars), rows=[dict(r) for r in qr.rows])

    # ------------------------------------------------------------------ Hybrid KG Embeddings (Option D)

    @app.get("/api/reasoning/embeddings/metrics")
    def get_embedding_metrics():
        snap = active_store.snapshot()
        bundle = _get_embeddings(snap)
        return bundle.metrics

    @app.get("/api/reasoning/embeddings/similar/{entity_id}", response_model=list[SimilarEntityModel])
    def get_similar_entities(
        entity_id: str,
        model_name: str = Query(default="TransE"),
        top_k: int = Query(default=5, ge=1, le=20),
        same_class_only: bool = Query(default=False),
    ):
        snap = active_store.snapshot()
        bundle = _get_embeddings(snap)
        m_name = "DistMult" if model_name.lower() == "distmult" else "TransE"
        try:
            peers = most_similar_entities(
                bundle, entity_id, model_name=m_name, top_k=top_k, same_class_only=same_class_only
            )
        except KeyError as exc:
            raise UnknownIdentifierError(entity_id) from exc
        return [SimilarEntityModel.model_validate(p) for p in peers]

    @app.post("/api/reasoning/hybrid/predict", response_model=list[PredictedLinkModel])
    def run_hybrid_predict(req: PredictLinkRequest):
        if bool(req.head) == bool(req.tail):
            raise HTTPException(status_code=400, detail="Provide exactly one of 'head' or 'tail' to predict the other endpoint.")
        snap = active_store.snapshot()
        bundle = _get_embeddings(snap)
        rel_id = req.relation if ":" in req.relation else f"orca:{req.relation}"
        try:
            preds = predict_and_audit(
                snap,
                bundle,
                head_id=req.head,
                relation_id=rel_id,
                tail_id=req.tail,
                top_k=req.top_k,
                model_name=req.model_name,
                enforce_owl_types=req.enforce_owl_types,
            )
        except KeyError as exc:
            raise UnknownIdentifierError(str(exc)) from exc
        return [PredictedLinkModel.model_validate(p) for p in preds]

    @app.get("/api/reasoning/hybrid/candidates")
    def get_hybrid_candidates(model_name: str = Query(default="TransE")):
        snap = active_store.snapshot()
        m_name = "DistMult" if model_name.lower() == "distmult" else "TransE"
        cache_key = (snap.version, m_name)
        cached = app.state.hybrid_candidates_cache.get(cache_key)
        if cached is not None:
            return cached
        bundle = _get_embeddings(snap)
        res = discover_hybrid_candidates(snap, bundle, top_k_per_query=3, model_name=m_name)
        app.state.hybrid_candidates_cache = {k: v for k, v in app.state.hybrid_candidates_cache.items() if k[0] == snap.version}
        app.state.hybrid_candidates_cache[cache_key] = res
        return res

    # ------------------------------------------------------------------ KG-Grounded Assistant & Evaluation

    @app.post("/api/assistant/ask", response_model=AssistantResponse)
    def post_assistant_ask(req: AskRequest):
        snap = active_store.snapshot()
        return ask(req.question, snap, llm_client=_get_llm())

    @app.post("/api/assistant/llm-only", response_model=LLMOnlyResponse)
    def post_assistant_llm_only(req: AskRequest):
        return ask_llm_only(req.question, llm_client=_get_llm())

    @app.post("/api/assistant/compare", response_model=CompareResponse)
    def post_assistant_compare(req: AskRequest):
        snap = active_store.snapshot()
        return compare_llm_vs_kg(req.question, snap, llm_client=_get_llm())

    @app.get("/api/evaluation/llm-vs-kg")
    def get_llm_vs_kg_evaluation():
        path = RESULTS_DIR / "llm_vs_kg_evaluation.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Evaluation results have not been generated yet.")
        return json.loads(path.read_text(encoding="utf-8"))

    @app.get("/api/evaluation/explainability")
    def get_explainability_examples():
        path = RESULTS_DIR / "explainability_examples.json"
        if not path.is_file():
            raise HTTPException(status_code=404, detail="Explainability traces have not been generated yet.")
        return json.loads(path.read_text(encoding="utf-8"))

    # ------------------------------------------------------------------ generic collection routes (registered AFTER specific routes!)

    @app.get("/api/{collection}", response_model=list[EntitySummary])
    def list_collection(collection: str):
        if collection not in _COLLECTIONS:
            raise UnknownIdentifierError(collection)
        snap = active_store.snapshot()
        cls_uri, _ = _COLLECTIONS[collection]
        uris = individuals_of(snap.asserted, cls_uri)
        return [EntitySummary(id=local_name(u), label=_label_of(snap.asserted, u)) for u in uris]

    @app.get("/api/{collection}/{item_id}", response_model=EntityDetail)
    def get_collection_item(collection: str, item_id: str):
        snap = active_store.snapshot()
        uri = _resolve_collection_item(snap, collection, item_id)
        return _entity_detail(snap, uri)

    # ------------------------------------------------------------------ Static SPA fallback (for built frontend)

    if FRONTEND_DIST.is_dir() and (FRONTEND_DIST / "index.html").is_file():
        assets_dir = FRONTEND_DIST / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

        @app.get("/", include_in_schema=False)
        def serve_spa_root():
            return FileResponse(str(FRONTEND_DIST / "index.html"))

    return app


app = create_app()
