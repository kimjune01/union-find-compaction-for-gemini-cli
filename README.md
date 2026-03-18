# Union-Find Context Compaction for Gemini CLI

Alternative to flat summarization that is **cheaper** (0.79x tokens), **non-blocking** (0.3ms p95), and **retains more detail** (+8.3pp recall trend).

**Status:** Implemented, tested (89/89 pass), experimentally validated. Behind feature flag on [`feat/union-find-compaction`](https://github.com/kimjune01/gemini-cli/tree/feat/union-find-compaction).

**Issue:** [google-gemini/gemini-cli#22877](https://github.com/google-gemini/gemini-cli/issues/22877)

## Results

Preregistered experiment on 12 real GitHub issue conversations (120 messages each), evaluated with Gemini 3.1 Flash Lite.

| Hypothesis | Result | Details |
|---|---|---|
| **H2a -- Latency** | **PASS** | append p95 = 0.33ms, render p50 = 0.006ms (criterion: <100ms) |
| **H3 -- Cost** | **PASS** | 0.79x flat's token cost -- 21% cheaper |
| **H1 -- Recall** | Trending + | +8.3pp (30.2% vs 21.9%), p=0.136. Won 8/12 conversations. |
| **H2b -- Background** | INFO | resolveDirty p50 = 4.0s, fits within main LLM call wait |

Raw data: [`experiment/v2/results-v2.json`](experiment/v2/results-v2.json) | Latency CSVs: [`experiment/v2/performance/`](experiment/v2/performance/)

**Before merging:** These results use Flash Lite as the eval judge. To be confident in a change this size, we recommend:
1. Rerun with **Gemini 3 Pro** as the summarizer (production model)
2. Increase to **24+ conversations** and **16 questions each** to reach statistical significance on H1 (our 96-question sample was underpowered at p=0.136)

The experiment harness is ready to rerun with different parameters: [`experiment/v2/run-v2-experiment.ts`](experiment/v2/run-v2-experiment.ts). Track progress on [google-gemini/gemini-cli#22877](https://github.com/google-gemini/gemini-cli/issues/22877).

## How It Works

```
Flat (current):
  [All old messages] --> LLM summarize --> LLM verify --> single snapshot + recent 30%
  Blocking: 20-30s spinner. Two LLM calls per compression event.

Union-find (proposed):
  append(msg)       <1ms   Synchronous. Embeds locally, graduates to forest, merges by similarity.
  render()          <0.1ms Synchronous. Returns cached cluster summaries + hot zone verbatim.
  resolveDirty()    ~4s    Async fire-and-forget. Batch-summarizes dirty clusters in background.
```

**Overlap window:** Messages exist in both hot zone and cold forest for ~2 turns. By the time they evict from hot, their cluster summary is already resolved. Zero blocking, zero staleness.

## Repository Map

| Document | What's in it |
|---|---|
| [`PREREGISTRATION-V2.md`](PREREGISTRATION-V2.md) | Hypotheses, criteria, decision rules (written before experiment) |
| [`experiment/v2/`](experiment/v2/) | Experiment harness, results JSON, latency CSVs |
| [`transformation-design.md`](transformation-design.md) | TypeScript specification for the transformation |
| [`systems-comparison.md`](systems-comparison.md) | Flat vs union-find architectural comparison |
| [`DESIGN_DECISIONS.md`](DESIGN_DECISIONS.md) | 15 design choices with rationale |
| [`WORK_LOG.md`](WORK_LOG.md) | Full development timeline: v1 failure, v2 redesign, experiment |

## Implementation

Two commits on [`feat/union-find-compaction`](https://github.com/kimjune01/gemini-cli/tree/feat/union-find-compaction):

**New files:**
- `contextWindow.ts` -- Forest (union-find with path compression) + ContextWindow (overlap window)
- `contextWindow.test.ts` -- 45 tests
- `embeddingService.ts` -- TF-IDF embedder (synchronous, no API calls)
- `clusterSummarizer.ts` -- LLM summarizer via existing BaseLlmClient

**Modified files:**
- `chatCompressionService.ts` -- dual-path routing (flat vs union-find)
- `flagNames.ts` -- `UNION_FIND_COMPACTION` experiment flag
- `config.ts` -- `getCompressionStrategy()` method

Feature-flagged, defaults to flat. Existing conversations unaffected.

## License

- Specification (`.md` files): [CC BY-SA 4.0](LICENSE-SPEC.md)
- Code: [Apache 2.0](LICENSE-CODE.md) (matches gemini-cli)
