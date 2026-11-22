# ORCA — Iteration 1 (Phase 1)

**Ontology-based Resource Control and Authorization for AI Agents**  
AI3001 Knowledge Representation and Reasoning · Team `krr-34-orca`

ORCA models AI agents, tasks, tools, permissions, resources, and security policies as an OWL ontology and RDF knowledge graph to verify authorization, least-privilege compliance, and indirect access paths.

> This commit contains the core Iteration 1 knowledge-representation artifacts. Iteration 2 (backend API, hybrid reasoning, and frontend) will be added next.

## Contents

```text
.
├── Dataset/
│   ├── input/                  # entities.csv, relations.csv, official_controls.csv
│   └── sources/                # Source URLs and OWASP LLM06 reference notes
├── Ontology/
│   └── orca.ttl                # OWL ontology (27 classes, 18 object properties, 6 data properties)
├── RDF_Knowledge_Graph/
│   ├── official_facts.ttl      # Official control facts (NIST, OWASP, Entra)
│   ├── synthetic_facts.ttl     # Synthetic university scenario facts
│   └── inferred_facts.ttl      # 139 OWL-RL + rule-inferred facts
└── SPARQL_Queries/
    └── all_queries.rq          # 13 competency question SPARQL queries
```
...