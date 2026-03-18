# Preregistration v2: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-17
**Author:** June Kim (kimjune01)
**Witness:** Claude Opus 4.6 (noreply@anthropic.com)
**Status:** Preregistered (before v2 implementation attempt)
**Predecessor:** `PREREGISTRATION.md` (v1 — all three hypotheses failed, stopping rule triggered)
**Classification:** Exploratory benchmark validation on reused data

---

## Why a New Preregistration

The v1 preregistration's stopping rule was triggered: H1 AND H2 both failed, AND cost exceeded 3x (26.6x). The v1 Fixed Tuning Policy explicitly classified the two required fixes as **architectural changes** (not parameter tuning):

1. **Incremental summary merging** — `union()` merges two existing summaries instead of re-reading all member raw texts (changes summarization algorithm)
2. **Non-blocking append** — summarization deferred to `render()` time instead of blocking `append()` (sync to async — explicitly named as architectural in v1 prereg)

Per v1 prereg: "Architectural changes require reclassification as exploratory." v2 is therefore an **exploratory redesign with benchmark validation**, not a confirmatory replication.

---

## Research Question

**Does union-find context compaction with incremental merging and deferred summarization improve gemini-cli compared to flat summarization?**

Four exploratory hypotheses (H1-H4) test the code improvements. Results are reported as benchmark observations, not confirmatory findings, because:
- The architecture was redesigned in direct response to v1 failures on the same data
- The same 12 conversations are reused (data contamination)
- H2 metric was redefined (append-only + render separately) after observing v1 failure mode

---

## Experimental Setup

**Implementation:** Claude Opus 4.6 builds v2 from `transformation-design.md` warnings
**Evaluation model:** `gemini-3.1-flash-lite-preview` (exact model ID, frozen)
**Evaluation data:** Same 12 GitHub issue conversations from v1 (v1 prereg specified 10-20 from GitHub/SO; v1 experiment resolved to these 12 GitHub issues)
**Evaluation freeze:** H1-H4 run on a **tagged git commit** only
**Baseline:** Flat compression rerun contemporaneously in same environment (not reusing v1 flat results)

**v2 architectural changes (vs v1):**
1. `Forest.union()` merges two root summaries (O(1) per merge), not all member raw texts (O(members) per merge)
2. `ContextWindow.append()` is synchronous (no LLM calls) — summarization deferred to `render()` time via dirty-flag mechanism

**Deferred summarization operational spec:**
- `union()` is synchronous: structural merge only (parent pointers, children, centroids). Marks merged cluster as `_dirty`.
- For singletons (no prior summary), the raw message content serves as the "summary."
- `render()` resolves all dirty clusters before returning: for each dirty root, calls `summarizer.summarize([summaryA, summaryB])` with the two pre-merge root summaries as input. Render blocks until all dirty summaries are resolved.
- Multiple appends between renders batch dirty clusters. One render call resolves all pending dirty clusters.
- No stale summaries in rendered output: `render()` always returns fully-resolved summaries.
- No concurrent append/render: sequential single-threaded execution assumed (matches v1 and gemini-cli architecture).

**Render protocol (frozen for H2/H3/H4 measurement):**
- `render()` is called once after all messages are appended (end-of-conversation render).
- This matches gemini-cli's usage pattern: messages accumulate, then context is rendered for the next LLM call.
- Cost (H3) counts all tokens from all LLM calls across the full conversation lifecycle (appends + render).

**Limitations:**
- **Exploratory, not confirmatory** — data-informed redesign on reused benchmark
- Same as v1: Flash Lite, proxy data, benchmark scope
- v2 is the second attempt at this architecture — not independent of v1 learnings
- Reusing same 12 conversations = data contamination for confirmatory purposes
- 96 question-answer pairs likely underpowered for 5pp effect size (v1 post-hoc: ~200 needed for 80% power)
- Questions nested within conversations create correlated outcomes; McNemar treats pairs as exchangeable (may overstate effective sample size)

---

## Hypotheses

All hypotheses are **exploratory**. Results are reported as benchmark observations.

### H1: Recall (Quality)

Union-find v2 recall on the 12 reused coding conversations.

**Method:** Same conversations, same questions, same blinded LLM-as-judge (`gemini-3.1-flash-lite-preview`), same binary scoring. Both flat and union-find v2 rerun contemporaneously.

**Test:** McNemar's on paired binary outcomes (p<0.05)
**Benchmark target:** Union-find recall ≥ flat recall + 5pp, statistically significant
**Observation if target missed:** Report effect size, p-value, and confidence interval regardless. A +7pp effect at p=0.17 (like v1) is still informative even if not significant.

**Sensitivity analysis:** Report conversation-level sign test (12 paired proportions) as secondary check on McNemar.

### H2a: Append Latency

Union-find v2 append latency p95 < 100ms.

**Method:** Same 12 conversations, same machine. Measure per-append wall-clock time. Since summarization is deferred to `render()`, append performs only local computation (TF-IDF embedding + forest structural ops).

**Benchmark target:** p95 < 100ms
**Note:** This metric validates that `append()` no longer blocks on LLM calls. It does NOT measure end-to-end UX. See H2b.

### H2b: Render Latency

Union-find v2 render latency p95 reported (no pass/fail target).

**Method:** Measure wall-clock time of `render()` call at end of each conversation (resolves all dirty clusters). This is where deferred LLM work happens.

**Report:** p50, p90, p95, p99, max. Compare against v1's per-append latency to assess whether latency was genuinely reduced or merely relocated.

**No pass/fail target** because render latency depends on number of dirty clusters accumulated, which varies by conversation. This is an honest observation, not a gamed metric.

### H3: Cost (Economics)

Union-find v2 total token cost ≤ 2x flat over same conversations.

**Method:** Same 12 conversations, actual token counts from API responses. Count ALL LLM calls across full conversation lifecycle: append-time (should be zero in v2) + render-time summarization calls.

**Benchmark target:** Union-find cost ≤ 2x flat
**Cost counting:** Total input + output tokens across all `summarizer.summarize()` calls, whenever they occur (append or render).

### H4: Development Methodology (Exploratory)

Document the v2 development process. No pass/fail criteria.

Record: how v1 failures informed v2 design, number of iterations, whether spec warnings prevented repeat bugs.

---

## Tuning Policy

If a hypothesis misses its benchmark target on first measurement, **max 2 parameter changes** allowed. Architectural changes require a new preregistration.

| Hypothesis | Change 1 | Change 2 | Then |
|---|---|---|---|
| H1 (Recall) | Merge threshold (0.15 → {0.10, 0.20}) | Retrieval k (3 → {2, 5}) or min_sim | Accept result |
| H2a (Append) | Hot zone size (30 → {20, 40}) | Max cluster count (10 → {8, 15}) | Accept result |
| H3 (Cost) | Cluster limit (10 → 15) | Summary max tokens | Accept result |

**Claim strength (downgraded for second attempt on reused data):**
- 0 changes: "Benchmark-supported on reused dataset"
- 1-2 changes: "Benchmark-supported after tuning"
- Architectural change: Requires PREREGISTRATION-V3
- Still failing: "Not supported"

**Note:** "Confirmed" is not available as a claim strength for v2. The data contamination from v1 precludes confirmatory status regardless of results.

---

## Decision Rules

| Outcome | Observation | Action |
|---|---|---|
| H1 ✅ H2a ✅ H3 ✅ | v2 meets all benchmark targets on reused data | Open PR with evidence, note exploratory status |
| H1 ❌ H2a ✅ H3 ✅ | Better append UX, comparable cost | Document; note H1 power limitation |
| H1 ✅ H2a ❌ H3 ✅ | Better quality, still blocking on append | Investigate — likely implementation bug |
| H1 ✅ H2a ✅ H3 ❌ | Better quality/UX, higher cost | Document as premium feature |
| Multiple ❌ | No clear improvement after two architectural attempts | Recommend staying with flat |

**Stop if:** H1 AND H2a both miss after tuning, OR cost >3x after tuning.

---

## Data Storage

```
experiment/v2/
├── quality-test/         # H1
│   ├── flat-v2-results.json      # Fresh flat rerun (contemporaneous)
│   ├── union-find-v2-results.json
│   └── analysis.md
├── performance/          # H2a + H2b
│   ├── union-find-v2-append-latencies.csv
│   ├── union-find-v2-render-latencies.csv
│   ├── environment.md
│   └── analysis.md
├── cost/                 # H3
│   ├── flat-v2-tokens.json       # Fresh flat rerun
│   ├── union-find-v2-tokens.json
│   └── cost-comparison.md
└── methodology/          # H4
    └── summary.md
```

---

## Commitment

1. **Report all outcomes** — success and failure
2. **Follow preregistered criteria** — no post-hoc changes to hypotheses
3. **Acknowledge exploratory status** — this is benchmark validation, not confirmation
4. **No HARKing** — hypotheses frozen before v2 implementation
5. **Transparent lineage** — link to v1 preregistration and results
6. **Contemporaneous baselines** — rerun flat in same environment, don't reuse v1 numbers
7. **Honest render reporting** — H2b prevents hiding latency by deferring it

After experiment: append to `RESULTS.md` with v2 hypothesis outcomes.

---

**Do not modify hypotheses after v2 implementation begins.**
