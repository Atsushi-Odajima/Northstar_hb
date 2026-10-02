# Performance results (generated data, not a sales guarantee)

Date: 2026-10-02T06:03:23.472Z · scale 1 · DB size 1063.9 MB

Rows: goals 10000, decisions 50000, people 5000, contacts 100000, knowledge 500000, reviews ≤10000, actions 20000

| Measurement | ms |
|---|---|
| generate (665523 search docs) | 173310.3 |
| fulltext search 'ProofFlow 販売' (trigram) | 1011 |
| fulltext search '価格' (2 chars → LIKE fallback) | 449.3 |
| fulltext search knowledge-only 'MCP 設計' | 505.6 |
| today view | 35.1 |
| weekly review summary | 247.3 |
| quarterly review summary | 684.6 |
| AI retrieval: structured facts | 215.5 |
| AI retrieval: full (facts + fts + semantic over indexed subset) | 2433.2 |
| embeddings sync (local-lite, 20000 docs, differential) | 761.9 |
| semantic search over 20000 vectors (cosine in JS) | 22.5 |
| HTTP GET /api/today via app.request | 2.2 |

Environment: Node v22.22.0, node:sqlite (FTS5 trigram), single process, in this CI container (4 vCPU).