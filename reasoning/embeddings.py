"""PyTorch Knowledge Graph Embedding models (TransE and DistMult) for ORCA.

Implements neural KG link prediction and entity similarity over the asserted
ORCA object-property graph while enforcing strict separation from confirmed
explicit/inferred facts (predictions carry ``provenance="Predicted_Link"`` and
``verified=False``).

References:
- Bordes et al. (2013), "Translating Embeddings for Modeling Multi-relational Data" (TransE)
- Yang et al. (2015), "Embedding Entities and Relations for Learning and Inference in Knowledge Bases" (DistMult)
"""
from __future__ import annotations

import math
import random
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal, Sequence

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from rdflib import Graph, URIRef
from rdflib.namespace import RDF, RDFS

from reasoning.models import KGSnapshot
from reasoning.namespaces import INFERENCE, INSTANCE_BASE, ORCA, compact

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_EMBEDDINGS_PATH = PROJECT_ROOT / "results" / "kg_embeddings.pt"

ModelName = Literal["TransE", "DistMult"]

_PROVENANCE_PREDS = frozenset({ORCA.provenanceLabel, ORCA.derivedBy, ORCA.derivedFrom})


# --------------------------------------------------------------------------- data extraction & OWL types


@dataclass(frozen=True)
class KGDataset:
    """Indexed relational triples and OWL class metadata extracted from ``kg.asserted``."""

    entities: tuple[str, ...]
    relations: tuple[str, ...]
    entity_to_id: dict[str, int]
    relation_to_id: dict[str, int]
    triples: tuple[tuple[int, int, int], ...]
    triple_strs: tuple[tuple[str, str, str], ...]
    entity_classes: dict[str, frozenset[str]]
    entity_primary_class: dict[str, str]
    relation_domains: dict[str, str]
    relation_ranges: dict[str, str]

    @property
    def num_entities(self) -> int:
        return len(self.entities)

    @property
    def num_relations(self) -> int:
        return len(self.relations)

    @property
    def known_triple_set(self) -> set[tuple[int, int, int]]:
        return set(self.triples)

    def domain_candidates(self, relation_id: str) -> list[int]:
        """Entity indices conforming to ``rdfs:domain`` of ``relation_id`` (or all entities)."""
        dom = self.relation_domains.get(relation_id)
        if not dom:
            return list(range(self.num_entities))
        cands = [i for i, e in enumerate(self.entities) if dom in self.entity_classes.get(e, ())]
        return cands or list(range(self.num_entities))

    def range_candidates(self, relation_id: str) -> list[int]:
        """Entity indices conforming to ``rdfs:range`` of ``relation_id`` (or all entities)."""
        rng = self.relation_ranges.get(relation_id)
        if not rng:
            return list(range(self.num_entities))
        cands = [i for i, e in enumerate(self.entities) if rng in self.entity_classes.get(e, ())]
        return cands or list(range(self.num_entities))


def _is_domain_instance(node: object) -> bool:
    if not isinstance(node, URIRef):
        return False
    text = str(node)
    return text.startswith(INSTANCE_BASE) and not text.startswith(str(INFERENCE))


def _superclasses(g: Graph, cls: URIRef) -> set[str]:
    seen = {cls}
    todo = [cls]
    while todo:
        cur = todo.pop()
        for sup in g.objects(cur, RDFS.subClassOf):
            if isinstance(sup, URIRef) and str(sup).startswith(str(ORCA)) and sup not in seen:
                seen.add(sup)
                todo.append(sup)
    return {compact(c) for c in seen}


def extract_kg_dataset(kg_or_graph: KGSnapshot | Graph) -> KGDataset:
    """Extract all asserted relational triples (excluding rdf:type, literals, annotations)."""
    g = kg_or_graph.asserted if isinstance(kg_or_graph, KGSnapshot) else kg_or_graph

    raw_triples: list[tuple[str, str, str]] = []
    entity_set: set[str] = set()
    relation_set: set[str] = set()

    # Include every ORCA instance declared in the graph so isolated instances can also be scored.
    for s, p, o in g:
        if _is_domain_instance(s):
            entity_set.add(compact(s))
        if (
            _is_domain_instance(s)
            and _is_domain_instance(o)
            and isinstance(p, URIRef)
            and str(p).startswith(str(ORCA))
            and p not in _PROVENANCE_PREDS
        ):
            h_cid, r_cid, t_cid = compact(s), compact(p), compact(o)
            raw_triples.append((h_cid, r_cid, t_cid))
            entity_set.add(h_cid)
            entity_set.add(t_cid)
            relation_set.add(r_cid)

    entities = tuple(sorted(entity_set))
    relations = tuple(sorted(relation_set))
    ent_to_id = {e: i for i, e in enumerate(entities)}
    rel_to_id = {r: i for i, r in enumerate(relations)}

    unique_triple_strs = tuple(sorted(set(raw_triples)))
    indexed_triples = tuple((ent_to_id[h], rel_to_id[r], ent_to_id[t]) for h, r, t in unique_triple_strs)

    # Map every entity to its asserted class and full ORCA superclass closure.
    entity_classes: dict[str, frozenset[str]] = {}
    entity_primary: dict[str, str] = {}
    for s in sorted({s for s in g.subjects(RDF.type, None) if _is_domain_instance(s)}, key=str):
        cid = compact(s)
        types = [t for t in g.objects(s, RDF.type) if isinstance(t, URIRef) and str(t).startswith(str(ORCA))]
        if not types:
            continue
        all_super: set[str] = set()
        for tp in types:
            all_super |= _superclasses(g, tp)
        entity_classes[cid] = frozenset(all_super)
        # Most specific class is the one that is not a strict superclass of another asserted type.
        primary = sorted(types, key=lambda c: len(_superclasses(g, c)), reverse=True)[0]
        entity_primary[cid] = compact(primary)

    for e in entities:
        entity_classes.setdefault(e, frozenset())
        entity_primary.setdefault(e, "orca:Thing")

    rel_domains: dict[str, str] = {}
    rel_ranges: dict[str, str] = {}
    for r in relations:
        r_uri = ORCA[r.split(":", 1)[1]]
        doms = [compact(d) for d in g.objects(r_uri, RDFS.domain) if isinstance(d, URIRef)]
        rngs = [compact(d) for d in g.objects(r_uri, RDFS.range) if isinstance(d, URIRef)]
        if doms:
            rel_domains[r] = sorted(doms)[0]
        if rngs:
            rel_ranges[r] = sorted(rngs)[0]

    return KGDataset(
        entities=entities,
        relations=relations,
        entity_to_id=ent_to_id,
        relation_to_id=rel_to_id,
        triples=indexed_triples,
        triple_strs=unique_triple_strs,
        entity_classes=entity_classes,
        entity_primary_class=entity_primary,
        relation_domains=rel_domains,
        relation_ranges=rel_ranges,
    )


def stratified_degree_preserving_split(
    triples: Sequence[tuple[int, int, int]],
    test_ratio: float = 0.2,
    min_remaining_degree: int = 2,
    seed: int = 42,
) -> tuple[list[tuple[int, int, int]], list[tuple[int, int, int]]]:
    """Split ``triples`` into ``(train, test)`` ensuring no cold-start entities or relations.

    A triple is moved to ``test`` only if its head, relation, and tail each retain
    at least ``min_remaining_degree`` occurrences in the remaining ``train`` split.
    """
    rng = random.Random(seed)
    ordered = sorted(set(triples))
    shuffled = list(ordered)
    rng.shuffle(shuffled)

    ent_deg: Counter[int] = Counter()
    rel_deg: Counter[int] = Counter()
    for h, r, t in ordered:
        ent_deg[h] += 1
        ent_deg[t] += 1
        rel_deg[r] += 1

    target = max(1, int(round(len(ordered) * test_ratio)))
    test_set: set[tuple[int, int, int]] = set()

    for triple in shuffled:
        if len(test_set) >= target:
            break
        h, r, t = triple
        dec_h = 2 if h == t else 1
        dec_t = 2 if h == t else 1
        if (
            ent_deg[h] - dec_h >= min_remaining_degree
            and ent_deg[t] - dec_t >= min_remaining_degree
            and rel_deg[r] - 1 >= min_remaining_degree
        ):
            ent_deg[h] -= 1
            ent_deg[t] -= 1
            rel_deg[r] -= 1
            test_set.add(triple)

    # If the strict degree>=2 constraint yielded fewer than half target, relax to 1 for remainder.
    if len(test_set) < max(1, target // 2) and min_remaining_degree > 1:
        for triple in shuffled:
            if len(test_set) >= target:
                break
            if triple in test_set:
                continue
            h, r, t = triple
            dec = 2 if h == t else 1
            if ent_deg[h] - dec >= 1 and ent_deg[t] - dec >= 1 and rel_deg[r] - 1 >= 1:
                ent_deg[h] -= 1
                ent_deg[t] -= 1
                rel_deg[r] -= 1
                test_set.add(triple)

    train = [tr for tr in ordered if tr not in test_set]
    test = [tr for tr in ordered if tr in test_set]
    return train, test


# --------------------------------------------------------------------------- PyTorch KG embedding models


class TransE(nn.Module):
    """Translational embedding model: ``score(h, r, t) = -||h + r - t||_p``."""

    def __init__(self, num_entities: int, num_relations: int, dim: int = 64, p_norm: int = 2) -> None:
        super().__init__()
        self.num_entities = num_entities
        self.num_relations = num_relations
        self.dim = dim
        self.p_norm = p_norm
        self.ent_emb = nn.Embedding(num_entities, dim)
        self.rel_emb = nn.Embedding(num_relations, dim)
        bound = 6.0 / math.sqrt(dim)
        nn.init.uniform_(self.ent_emb.weight, -bound, bound)
        nn.init.uniform_(self.rel_emb.weight, -bound, bound)
        with torch.no_grad():
            self.ent_emb.weight.copy_(F.normalize(self.ent_emb.weight, p=2, dim=-1))
            self.rel_emb.weight.copy_(F.normalize(self.rel_emb.weight, p=2, dim=-1))

    def score_triples(self, h: torch.Tensor, r: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        h_e = F.normalize(self.ent_emb(h), p=2, dim=-1)
        r_e = self.rel_emb(r)
        t_e = F.normalize(self.ent_emb(t), p=2, dim=-1)
        return -torch.linalg.vector_norm(h_e + r_e - t_e, ord=self.p_norm, dim=-1)

    @torch.no_grad()
    def normalized_entities(self) -> torch.Tensor:
        return F.normalize(self.ent_emb.weight, p=2, dim=-1)

    @torch.no_grad()
    def score_all_tails(self, h_idx: int, r_idx: int) -> torch.Tensor:
        ents = self.normalized_entities()
        h_e = ents[h_idx].unsqueeze(0)
        r_e = self.rel_emb.weight[r_idx].unsqueeze(0)
        return -torch.linalg.vector_norm(h_e + r_e - ents, ord=self.p_norm, dim=-1)

    @torch.no_grad()
    def score_all_heads(self, r_idx: int, t_idx: int) -> torch.Tensor:
        ents = self.normalized_entities()
        r_e = self.rel_emb.weight[r_idx].unsqueeze(0)
        t_e = ents[t_idx].unsqueeze(0)
        return -torch.linalg.vector_norm(ents + r_e - t_e, ord=self.p_norm, dim=-1)


class DistMult(nn.Module):
    """Bilinear diagonal semantic matching model: ``score(h, r, t) = <h, r, t>``."""

    def __init__(self, num_entities: int, num_relations: int, dim: int = 64) -> None:
        super().__init__()
        self.num_entities = num_entities
        self.num_relations = num_relations
        self.dim = dim
        self.ent_emb = nn.Embedding(num_entities, dim)
        self.rel_emb = nn.Embedding(num_relations, dim)
        nn.init.xavier_uniform_(self.ent_emb.weight)
        nn.init.xavier_uniform_(self.rel_emb.weight)

    def score_triples(self, h: torch.Tensor, r: torch.Tensor, t: torch.Tensor) -> torch.Tensor:
        h_e = self.ent_emb(h)
        r_e = self.rel_emb(r)
        t_e = self.ent_emb(t)
        return torch.sum(h_e * r_e * t_e, dim=-1)

    @torch.no_grad()
    def normalized_entities(self) -> torch.Tensor:
        return F.normalize(self.ent_emb.weight, p=2, dim=-1)

    @torch.no_grad()
    def score_all_tails(self, h_idx: int, r_idx: int) -> torch.Tensor:
        hr = self.ent_emb.weight[h_idx] * self.rel_emb.weight[r_idx]
        return torch.matmul(self.ent_emb.weight, hr)

    @torch.no_grad()
    def score_all_heads(self, r_idx: int, t_idx: int) -> torch.Tensor:
        rt = self.rel_emb.weight[r_idx] * self.ent_emb.weight[t_idx]
        return torch.matmul(self.ent_emb.weight, rt)


# --------------------------------------------------------------------------- training


def _sample_negatives(
    pos_triples: Sequence[tuple[int, int, int]],
    dataset: KGDataset,
    known: set[tuple[int, int, int]],
    neg_ratio: int,
    rng: random.Random,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    """Mix ontology-type-consistent hard negatives (50%) and uniform negatives (50%)."""
    all_ents = dataset.num_entities
    dom_pools = {r: dataset.domain_candidates(r) for r in dataset.relations}
    rng_pools = {r: dataset.range_candidates(r) for r in dataset.relations}

    neg_h: list[int] = []
    neg_r: list[int] = []
    neg_t: list[int] = []

    for h, r, t in pos_triples:
        r_name = dataset.relations[r]
        dom_cands = dom_pools[r_name]
        rng_cands = rng_pools[r_name]
        for k in range(neg_ratio):
            corrupt_tail = (k % 2 == 0)
            use_typed = (k % 4) < 2
            cand_h, cand_t = h, t
            for _ in range(15):
                if corrupt_tail:
                    pool = rng_cands if use_typed and len(rng_cands) > 1 else None
                    cand_t = rng.choice(pool) if pool is not None else rng.randrange(all_ents)
                    cand_h = h
                else:
                    pool = dom_cands if use_typed and len(dom_cands) > 1 else None
                    cand_h = rng.choice(pool) if pool is not None else rng.randrange(all_ents)
                    cand_t = t
                if (cand_h, r, cand_t) not in known:
                    break
            neg_h.append(cand_h)
            neg_r.append(r)
            neg_t.append(cand_t)

    return (
        torch.tensor(neg_h, dtype=torch.long),
        torch.tensor(neg_r, dtype=torch.long),
        torch.tensor(neg_t, dtype=torch.long),
    )


def train_transe(
    dataset: KGDataset,
    train_triples: Sequence[tuple[int, int, int]],
    *,
    dim: int = 64,
    margin: float = 1.0,
    lr: float = 0.01,
    epochs: int = 600,
    neg_ratio: int = 10,
    seed: int = 42,
) -> tuple[TransE, list[float]]:
    """Train TransE with margin ranking loss and L2 entity normalization."""
    torch.manual_seed(seed)
    rng = random.Random(seed)
    model = TransE(dataset.num_entities, dataset.num_relations, dim=dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    loss_fn = nn.MarginRankingLoss(margin=margin)

    known = dataset.known_triple_set
    pos_h = torch.tensor([h for h, _, _ in train_triples], dtype=torch.long)
    pos_r = torch.tensor([r for _, r, _ in train_triples], dtype=torch.long)
    pos_t = torch.tensor([t for _, _, t in train_triples], dtype=torch.long)

    pos_h_rep = pos_h.repeat_interleave(neg_ratio)
    pos_r_rep = pos_r.repeat_interleave(neg_ratio)
    pos_t_rep = pos_t.repeat_interleave(neg_ratio)
    ones = torch.ones(len(pos_h_rep), dtype=torch.float32)

    losses: list[float] = []
    model.train()
    for _ in range(epochs):
        neg_h, neg_r, neg_t = _sample_negatives(train_triples, dataset, known, neg_ratio, rng)
        optimizer.zero_grad()
        pos_scores = model.score_triples(pos_h_rep, pos_r_rep, pos_t_rep)
        neg_scores = model.score_triples(neg_h, neg_r, neg_t)
        loss = loss_fn(pos_scores, neg_scores, ones)
        loss.backward()
        optimizer.step()
        with torch.no_grad():
            model.ent_emb.weight.copy_(F.normalize(model.ent_emb.weight, p=2, dim=-1))
        losses.append(float(loss.item()))
    model.eval()
    return model, losses


def train_distmult(
    dataset: KGDataset,
    train_triples: Sequence[tuple[int, int, int]],
    *,
    dim: int = 64,
    lr: float = 0.01,
    l2_reg: float = 1e-4,
    epochs: int = 600,
    neg_ratio: int = 10,
    seed: int = 42,
) -> tuple[DistMult, list[float]]:
    """Train DistMult with binary cross-entropy loss and L2 regularization."""
    torch.manual_seed(seed)
    rng = random.Random(seed + 1)
    model = DistMult(dataset.num_entities, dataset.num_relations, dim=dim)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    bce = nn.BCEWithLogitsLoss()

    known = dataset.known_triple_set
    pos_h = torch.tensor([h for h, _, _ in train_triples], dtype=torch.long)
    pos_r = torch.tensor([r for _, r, _ in train_triples], dtype=torch.long)
    pos_t = torch.tensor([t for _, _, t in train_triples], dtype=torch.long)
    pos_y = torch.ones(len(train_triples), dtype=torch.float32)

    losses: list[float] = []
    model.train()
    for _ in range(epochs):
        neg_h, neg_r, neg_t = _sample_negatives(train_triples, dataset, known, neg_ratio, rng)
        neg_y = torch.zeros(len(neg_h), dtype=torch.float32)

        all_h = torch.cat([pos_h, neg_h])
        all_r = torch.cat([pos_r, neg_r])
        all_t = torch.cat([pos_t, neg_t])
        all_y = torch.cat([pos_y, neg_y])

        optimizer.zero_grad()
        logits = model.score_triples(all_h, all_r, all_t)
        reg = l2_reg * (model.ent_emb.weight.pow(2).mean() + model.rel_emb.weight.pow(2).mean())
        loss = bce(logits, all_y) + reg
        loss.backward()
        optimizer.step()
        losses.append(float(loss.item()))
    model.eval()
    return model, losses


# --------------------------------------------------------------------------- filtered evaluation


def _filtered_rank(
    scores: np.ndarray,
    true_idx: int,
    candidate_indices: Sequence[int],
    filter_out: set[int],
) -> int:
    """1-based filtered rank of ``true_idx`` among ``candidate_indices`` excluding ``filter_out``."""
    pool = [i for i in candidate_indices if i == true_idx or i not in filter_out]
    if true_idx not in pool:
        pool.append(true_idx)
    true_score = float(scores[true_idx])
    higher = sum(1 for i in pool if i != true_idx and float(scores[i]) > true_score)
    ties = sum(1 for i in pool if i != true_idx and float(scores[i]) == true_score)
    return 1 + higher + ties // 2


def evaluate_link_prediction(
    model: TransE | DistMult | None,
    dataset: KGDataset,
    test_triples: Sequence[tuple[int, int, int]],
    *,
    ontology_constrained: bool = False,
    seed: int = 42,
) -> dict[str, Any]:
    """Evaluate link prediction using the standard filtered ranking protocol.

    When ``model is None``, evaluates a deterministic random-scoring baseline
    using the identical candidate pools for fair comparison.
    """
    all_true = dataset.known_triple_set
    all_indices = list(range(dataset.num_entities))
    rng = np.random.default_rng(seed)

    ranks: list[int] = []
    per_triple: list[dict[str, Any]] = []

    for h, r, t in test_triples:
        r_name = dataset.relations[r]
        tail_pool = dataset.range_candidates(r_name) if ontology_constrained else all_indices
        head_pool = dataset.domain_candidates(r_name) if ontology_constrained else all_indices

        if model is None:
            tail_scores = rng.random(dataset.num_entities)
            head_scores = rng.random(dataset.num_entities)
        else:
            tail_scores = model.score_all_tails(h, r).cpu().numpy()
            head_scores = model.score_all_heads(r, t).cpu().numpy()

        known_tails = {t2 for h2, r2, t2 in all_true if h2 == h and r2 == r and t2 != t}
        known_heads = {h2 for h2, r2, t2 in all_true if r2 == r and t2 == t and h2 != h}

        t_rank = _filtered_rank(tail_scores, t, tail_pool, known_tails)
        h_rank = _filtered_rank(head_scores, h, head_pool, known_heads)
        ranks.extend([t_rank, h_rank])

        # Also record top-3 predicted tails in the pool for transparency.
        filtered_tail_cands = [i for i in tail_pool if i == t or i not in known_tails]
        top_t = sorted(filtered_tail_cands, key=lambda idx: float(tail_scores[idx]), reverse=True)[:3]
        per_triple.append({
            "triple": [dataset.entities[h], r_name, dataset.entities[t]],
            "tail_rank": t_rank,
            "head_rank": h_rank,
            "tail_pool_size": len(filtered_tail_cands),
            "top3_tail_predictions": [dataset.entities[i] for i in top_t],
        })

    n = len(ranks) or 1
    mrr = sum(1.0 / rk for rk in ranks) / n
    mr = sum(ranks) / n
    hits1 = sum(1 for rk in ranks if rk <= 1) / n
    hits3 = sum(1 for rk in ranks if rk <= 3) / n
    hits10 = sum(1 for rk in ranks if rk <= 10) / n

    return {
        "num_test_triples": len(test_triples),
        "num_evaluations": len(ranks),
        "ontology_constrained": ontology_constrained,
        "mrr": round(mrr, 4),
        "mean_rank": round(mr, 2),
        "hits_at_1": round(hits1, 4),
        "hits_at_3": round(hits3, 4),
        "hits_at_10": round(hits10, 4),
        "sample_predictions": per_triple[:8],
    }


# --------------------------------------------------------------------------- bundle, persistence & queries


@dataclass
class EmbeddingBundle:
    """Trained evaluation models, full-KG production models, and benchmark metrics."""

    dataset: KGDataset
    train_size: int
    test_size: int
    transe_full: TransE
    distmult_full: DistMult
    metrics: dict[str, Any]

    def get_model(self, model_name: ModelName = "TransE") -> TransE | DistMult:
        if model_name == "DistMult":
            return self.distmult_full
        return self.transe_full


def build_and_evaluate_embeddings(
    kg_or_graph: KGSnapshot | Graph,
    *,
    dim: int = 64,
    epochs: int = 600,
    seed: int = 42,
    save_path: Path | None = DEFAULT_EMBEDDINGS_PATH,
) -> EmbeddingBundle:
    """Run held-out evaluation and fit full-KG TransE + DistMult models."""
    dataset = extract_kg_dataset(kg_or_graph)
    train_triples, test_triples = stratified_degree_preserving_split(
        dataset.triples, test_ratio=0.2, min_remaining_degree=2, seed=seed
    )

    transe_eval, transe_losses = train_transe(dataset, train_triples, dim=dim, epochs=epochs, seed=seed)
    distmult_eval, distmult_losses = train_distmult(dataset, train_triples, dim=dim, epochs=epochs, seed=seed)

    metrics = {
        "dataset": {
            "num_entities": dataset.num_entities,
            "num_relations": dataset.num_relations,
            "total_relational_triples": len(dataset.triples),
            "train_triples": len(train_triples),
            "test_triples": len(test_triples),
            "embedding_dim": dim,
            "epochs": epochs,
            "seed": seed,
        },
        "global_filtered": {
            "Random": evaluate_link_prediction(None, dataset, test_triples, ontology_constrained=False, seed=seed),
            "TransE": evaluate_link_prediction(transe_eval, dataset, test_triples, ontology_constrained=False),
            "DistMult": evaluate_link_prediction(distmult_eval, dataset, test_triples, ontology_constrained=False),
        },
        "ontology_constrained_filtered": {
            "Random": evaluate_link_prediction(None, dataset, test_triples, ontology_constrained=True, seed=seed),
            "TransE": evaluate_link_prediction(transe_eval, dataset, test_triples, ontology_constrained=True),
            "DistMult": evaluate_link_prediction(distmult_eval, dataset, test_triples, ontology_constrained=True),
        },
        "training_loss": {
            "TransE_start": round(transe_losses[0], 4),
            "TransE_end": round(transe_losses[-1], 4),
            "DistMult_start": round(distmult_losses[0], 4),
            "DistMult_end": round(distmult_losses[-1], 4),
        },
    }

    # Train full-KG models on all asserted relational triples for similarity & novel prediction.
    transe_full, _ = train_transe(dataset, dataset.triples, dim=dim, epochs=epochs, seed=seed)
    distmult_full, _ = train_distmult(dataset, dataset.triples, dim=dim, epochs=epochs, seed=seed)

    bundle = EmbeddingBundle(
        dataset=dataset,
        train_size=len(train_triples),
        test_size=len(test_triples),
        transe_full=transe_full,
        distmult_full=distmult_full,
        metrics=metrics,
    )
    if save_path is not None:
        save_bundle(bundle, save_path)
    return bundle


def save_bundle(bundle: EmbeddingBundle, path: Path = DEFAULT_EMBEDDINGS_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "dataset": {
            "entities": list(bundle.dataset.entities),
            "relations": list(bundle.dataset.relations),
            "triples": list(bundle.dataset.triples),
            "triple_strs": list(bundle.dataset.triple_strs),
            "entity_classes": {k: sorted(v) for k, v in bundle.dataset.entity_classes.items()},
            "entity_primary_class": bundle.dataset.entity_primary_class,
            "relation_domains": bundle.dataset.relation_domains,
            "relation_ranges": bundle.dataset.relation_ranges,
        },
        "train_size": bundle.train_size,
        "test_size": bundle.test_size,
        "dim": bundle.transe_full.dim,
        "transe_state": bundle.transe_full.state_dict(),
        "distmult_state": bundle.distmult_full.state_dict(),
        "metrics": bundle.metrics,
    }
    torch.save(payload, str(path))


def load_or_train_bundle(
    kg_or_graph: KGSnapshot | Graph,
    path: Path = DEFAULT_EMBEDDINGS_PATH,
    *,
    force_retrain: bool = False,
) -> EmbeddingBundle:
    """Load cached embeddings if entity/triple counts match; otherwise train fresh."""
    current_ds = extract_kg_dataset(kg_or_graph)
    if not force_retrain and path.is_file():
        try:
            payload = torch.load(str(path), map_location="cpu", weights_only=False)
            ds_raw = payload["dataset"]
            if (
                tuple(ds_raw["entities"]) == current_ds.entities
                and tuple(ds_raw["relations"]) == current_ds.relations
                and tuple(tuple(t) for t in ds_raw["triples"]) == current_ds.triples
            ):
                dim = int(payload["dim"])
                transe = TransE(current_ds.num_entities, current_ds.num_relations, dim=dim)
                transe.load_state_dict(payload["transe_state"])
                transe.eval()
                distmult = DistMult(current_ds.num_entities, current_ds.num_relations, dim=dim)
                distmult.load_state_dict(payload["distmult_state"])
                distmult.eval()
                return EmbeddingBundle(
                    dataset=current_ds,
                    train_size=int(payload["train_size"]),
                    test_size=int(payload["test_size"]),
                    transe_full=transe,
                    distmult_full=distmult,
                    metrics=payload["metrics"],
                )
        except Exception:
            pass
    return build_and_evaluate_embeddings(kg_or_graph, save_path=path)


def _resolve_dataset_id(name: str, pool: tuple[str, ...]) -> str:
    text = (name or "").strip()
    if text in pool:
        return text
    for item in pool:
        if item.endswith(f":{text}") or item.lower() == text.lower() or item.split(":", 1)[-1].lower() == text.lower():
            return item
    raise KeyError(f"Unknown identifier in KG embedding space: {name!r}")


def most_similar_entities(
    bundle: EmbeddingBundle,
    entity_id: str,
    *,
    model_name: ModelName = "TransE",
    top_k: int = 5,
    same_class_only: bool = False,
) -> list[dict[str, Any]]:
    """Return top-k cosine-similar entities in the learned embedding space."""
    ds = bundle.dataset
    eid = _resolve_dataset_id(entity_id, ds.entities)
    idx = ds.entity_to_id[eid]
    model = bundle.get_model(model_name)
    embs = model.normalized_entities()
    sims = torch.matmul(embs, embs[idx]).cpu().numpy()

    target_cls = ds.entity_primary_class.get(eid, "")
    candidates = []
    for i, cand_id in enumerate(ds.entities):
        if i == idx:
            continue
        if same_class_only and ds.entity_primary_class.get(cand_id, "") != target_cls:
            continue
        candidates.append((float(sims[i]), cand_id))
    candidates.sort(key=lambda x: (-x[0], x[1]))

    return [
        {
            "entity_id": cand_id,
            "entity_class": ds.entity_primary_class.get(cand_id, "orca:Thing"),
            "cosine_similarity": round(score, 4),
            "model": model_name,
        }
        for score, cand_id in candidates[:top_k]
    ]


def _calibrated_confidences(raw_scores: np.ndarray, candidate_indices: Sequence[int]) -> dict[int, float]:
    if not candidate_indices:
        return {}
    vals = np.array([float(raw_scores[i]) for i in candidate_indices], dtype=np.float64)
    shifted = vals - np.max(vals)
    probs = np.exp(shifted)
    probs = probs / np.sum(probs)
    return {idx: float(p) for idx, p in zip(candidate_indices, probs)}


def predict_tail(
    bundle: EmbeddingBundle,
    head_id: str,
    relation_id: str,
    *,
    top_k: int = 5,
    model_name: ModelName = "TransE",
    filter_known: bool = True,
    enforce_owl_range: bool = True,
) -> list[dict[str, Any]]:
    """Predict missing tail entities ``(head_id, relation_id, ?)``."""
    ds = bundle.dataset
    h_cid = _resolve_dataset_id(head_id, ds.entities)
    r_cid = _resolve_dataset_id(relation_id, ds.relations)
    h_idx = ds.entity_to_id[h_cid]
    r_idx = ds.relation_to_id[r_cid]

    model = bundle.get_model(model_name)
    raw = model.score_all_tails(h_idx, r_idx).cpu().numpy()

    pool = ds.range_candidates(r_cid) if enforce_owl_range else list(range(ds.num_entities))
    known = ds.known_triple_set
    filtered = [t_idx for t_idx in pool if t_idx != h_idx and (not filter_known or (h_idx, r_idx, t_idx) not in known)]
    confs = _calibrated_confidences(raw, filtered)
    ranked = sorted(filtered, key=lambda idx: (-float(raw[idx]), ds.entities[idx]))[:top_k]

    return [
        {
            "head": h_cid,
            "relation": r_cid,
            "tail": ds.entities[t_idx],
            "raw_score": round(float(raw[t_idx]), 4),
            "confidence": round(confs.get(t_idx, 0.0), 4),
            "model": model_name,
            "provenance": "Predicted_Link",
            "verified": False,
            "already_known": (h_idx, r_idx, t_idx) in known,
        }
        for t_idx in ranked
    ]


def predict_head(
    bundle: EmbeddingBundle,
    relation_id: str,
    tail_id: str,
    *,
    top_k: int = 5,
    model_name: ModelName = "TransE",
    filter_known: bool = True,
    enforce_owl_domain: bool = True,
) -> list[dict[str, Any]]:
    """Predict missing head entities ``(?, relation_id, tail_id)``."""
    ds = bundle.dataset
    r_cid = _resolve_dataset_id(relation_id, ds.relations)
    t_cid = _resolve_dataset_id(tail_id, ds.entities)
    r_idx = ds.relation_to_id[r_cid]
    t_idx = ds.entity_to_id[t_cid]

    model = bundle.get_model(model_name)
    raw = model.score_all_heads(r_idx, t_idx).cpu().numpy()

    pool = ds.domain_candidates(r_cid) if enforce_owl_domain else list(range(ds.num_entities))
    known = ds.known_triple_set
    filtered = [h_idx for h_idx in pool if h_idx != t_idx and (not filter_known or (h_idx, r_idx, t_idx) not in known)]
    confs = _calibrated_confidences(raw, filtered)
    ranked = sorted(filtered, key=lambda idx: (-float(raw[idx]), ds.entities[idx]))[:top_k]

    return [
        {
            "head": ds.entities[h_idx],
            "relation": r_cid,
            "tail": t_cid,
            "raw_score": round(float(raw[h_idx]), 4),
            "confidence": round(confs.get(h_idx, 0.0), 4),
            "model": model_name,
            "provenance": "Predicted_Link",
            "verified": False,
            "already_known": (h_idx, r_idx, t_idx) in known,
        }
        for h_idx in ranked
    ]
