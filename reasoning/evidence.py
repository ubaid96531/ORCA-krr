"""Evidence builder (design Component 7, Data Models §7; Requirement 14).

``build_evidence`` collects the facts behind a result and labels each one:

* a triple in the asserted graph is an explicit fact labelled with the
  ``orca:provenanceLabel`` of its subject (``Official_Fact`` or
  ``Synthetic_Fact``), or ``Unlabelled`` when the subject has none (Req 14.6);
* a triple produced by a derivation becomes an ``InferredFact`` with its rule
  id and source triples, and every source triple is added to the bundle as
  well, recursively (Req 14.5).

Inputs are rdflib triples; the bundle holds compact id triples (literals as
their lexical string). Every list is deduplicated and sorted, so identical
input gives an identical bundle (Req 14.7).
"""
from __future__ import annotations

import weakref
from collections.abc import Iterable

from rdflib import Literal

from reasoning.models import (
    AccessPath,
    EvidenceBundle,
    IdTriple,
    InferredFact,
    KGSnapshot,
    LabelledFact,
    Provenance,
)
from reasoning.namespaces import ORCA, compact
from reasoning.rules import Derivation, Triple

_EXPLICIT_LABELS = ("Official_Fact", "Synthetic_Fact")

_INDEX_CACHE: "weakref.WeakKeyDictionary[KGSnapshot, dict[Triple, tuple[Derivation, ...]]]" = (
    weakref.WeakKeyDictionary()
)


def derivation_index(kg: KGSnapshot) -> dict[Triple, tuple[Derivation, ...]]:
    """Map each inferred triple to all its derivations; built once per snapshot."""
    index = _INDEX_CACHE.get(kg)
    if index is None:
        grouped: dict[Triple, list[Derivation]] = {}
        for d in kg.derivations:
            grouped.setdefault(tuple(d.triple), []).append(d)
        index = {t: tuple(ds) for t, ds in grouped.items()}
        _INDEX_CACHE[kg] = index
    return index


def compact_term(term: object) -> str:
    """Compact id for a URI; the lexical string for a literal."""
    return str(term) if isinstance(term, Literal) else compact(term)


def compact_triple(t: Iterable[object]) -> IdTriple:
    s, p, o = t
    return (compact_term(s), compact_term(p), compact_term(o))


def _subject_label(kg: KGSnapshot, subject: object) -> Provenance:
    for value in kg.asserted.objects(subject, ORCA.provenanceLabel):
        text = str(value)
        if text in _EXPLICIT_LABELS:
            return text  # type: ignore[return-value]
    return "Unlabelled"


def provenance_of(kg: KGSnapshot, t: Triple) -> Provenance:
    """Provenance label of one rdflib triple.

    Asserted -> the subject's label (or ``Unlabelled``); inferred ->
    ``Inferred_Fact``; in neither graph -> ``Unlabelled``.
    """
    t = tuple(t)
    if t in kg.asserted:
        return _subject_label(kg, t[0])
    if t in kg.inferred or t in derivation_index(kg):
        return "Inferred_Fact"
    return "Unlabelled"


def _fact_sort_key(f: LabelledFact) -> tuple:
    return (f.triple, f.provenance)


def _inferred_sort_key(f: InferredFact) -> tuple:
    return (f.triple, f.rule_id, f.derived_from)


def build_evidence(
    kg: KGSnapshot,
    used: Iterable[Triple],
    derivations: Iterable[Derivation],
    paths: Iterable[AccessPath],
) -> EvidenceBundle:
    """Build a sorted, deduplicated Evidence_Bundle for a result."""
    index = derivation_index(kg)
    explicit: set[LabelledFact] = set()
    inferred: set[InferredFact] = set()
    visited_triples: set[Triple] = set()
    visited_derivations: set[tuple] = set()

    def add_derivation(d: Derivation) -> None:
        key = (tuple(d.triple), d.rule_id, tuple(tuple(s) for s in d.sources))
        if key in visited_derivations:
            return
        visited_derivations.add(key)
        inferred.add(
            InferredFact(
                triple=compact_triple(d.triple),
                rule_id=d.rule_id,
                derived_from=tuple(sorted({compact_triple(s) for s in d.sources})),
            )
        )
        for source in d.sources:
            add_triple(source)

    def add_triple(t: Triple) -> None:
        t = tuple(t)
        if t in visited_triples:
            return
        visited_triples.add(t)
        if t in kg.asserted:
            explicit.add(LabelledFact(compact_triple(t), _subject_label(kg, t[0])))
            return
        ds = index.get(t)
        if ds:
            for d in ds:
                add_derivation(d)
            return
        # In neither graph and not derived: still listed, marked unlabelled.
        explicit.add(LabelledFact(compact_triple(t), "Unlabelled"))

    for d in derivations:
        add_derivation(d)
    for t in used:
        add_triple(t)

    unique_paths = {p.path_id: p for p in paths}
    return EvidenceBundle(
        explicit_facts=tuple(sorted(explicit, key=_fact_sort_key)),
        inferred_facts=tuple(sorted(inferred, key=_inferred_sort_key)),
        applied_rules=tuple(sorted({f.rule_id for f in inferred})),
        access_paths=tuple(
            sorted(unique_paths.values(), key=lambda p: (tuple(f.triple for f in p.triples), p.path_id))
        ),
    )
