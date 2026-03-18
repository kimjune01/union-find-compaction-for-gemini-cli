# H2 Benchmark Environment

**Date:** 2026-03-17T17:47 PST (2026-03-18T01:47 UTC)
**Machine:** Apple M4 Pro, 48 GB RAM
**OS:** macOS (Darwin 25.3.0)
**Node.js:** v22.21.1
**npm:** 10.9.4
**Branch:** feat/union-find-compaction (commit 79a4aedea)

## Benchmark Configuration

| Parameter | Value |
|---|---|
| Messages | 200 |
| Hot zone size | 30 |
| Max cold clusters | 10 |
| Merge threshold | 0.15 |
| Retrieve k | 3 |
| Retrieve min_sim | 0.05 |
| Summarizer | Mock (near-zero latency, truncates to 200 chars) |
| Embedder | TFIDFEmbedder (real, local computation) |

## Notes

- Mock summarizer used to isolate local computation overhead
- Real LLM summarizer calls would add 500ms-5s per merge
- Network conditions: N/A (no external API calls in benchmark)
- No other significant CPU load during benchmark
