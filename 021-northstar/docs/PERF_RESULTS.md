# Performance results (generated data, not a sales guarantee)

Date: 2026-10-02T05:55:00.600Z · scale 1 · DB size 997.8 MB

Rows: goals 10000, decisions 50000, people 5000, contacts 100000, knowledge 500000, reviews ≤10000, actions 20000

| Measurement | ms |
|---|---|
| generate (665523 search docs) | 155242.3 |
| fulltext search 'ProofFlow 販売' (trigram) | 945.3 |
| fulltext search '価格' (2 chars → LIKE fallback) | 453.2 |
| fulltext search knowledge-only 'MCP 設計' | 463.2 |
| today view | 32.9 |
| weekly review summary | 524.8 |
| quarterly review summary | 3988.1 |
| AI retrieval: structured facts | 4.7 |
| AI retrieval: full (facts + fts + semantic over indexed subset) | 2299.7 |
| embeddings sync (local-lite, 20000 docs, differential) | 782.2 |
| semantic search over 20000 vectors (cosine in JS) | 35.3 |
| HTTP GET /api/today via app.request | 2.4 |

Environment: Node v22.22.0, node:sqlite (FTS5 trigram), single process, in this CI container (4 vCPU).