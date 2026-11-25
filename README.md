# ORCA — Iteration 1 (Phase 1)

**Ontology-based Resource Control and Authorization for AI Agents**  
AI3001 Knowledge Representation and Reasoning · Team `krr-34-orca`

ORCA models AI agents, tasks, tools, permissions, resources, and security policies as an OWL ontology and RDF knowledge graph to verify authorization, least-privilege compliance, and indirect access paths.

> This commit contains the core Iteration 1 knowledge-representation artifacts and the unified LLM client backend.

## Contents

```text
.
├── backend/
│   ├── requirements.txt        # Backend dependencies
│   └── llm_client.py           # Unified LLM client (API + local Qwen fallback)
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

## Unified LLM Client (`backend/llm_client.py`)

### Summary & Description
Adds ORCA's unified LLM client (`backend/llm_client.py`) supporting OpenAI-compatible HTTP endpoints (Gemini 3.5 Flash-Lite with retry on rate limits) and reproducible offline HuggingFace CPU inference.

- **Dual-Backend Support**: Seamlessly routes requests to cloud API models (Google Gemini 3.5 Flash-Lite via OpenAI-compatible endpoints) or offline CPU inference (`Qwen/Qwen2.5-0.5B-Instruct`).
- **Resilience & Safe Retries**: Automatic exponential backoff handling for transient HTTP 429 (rate-limit) and 503 errors.
- **Secure Configuration**: Loads settings via `.env` without hardcoding sensitive credentials into the codebase.
- **Testing Mocks**: Includes `FakeLLMClient` for predictable and fast automated testing.
