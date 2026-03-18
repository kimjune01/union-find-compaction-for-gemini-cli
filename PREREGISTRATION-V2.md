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
1. `Forest.union()` is synchronous — structural merge only (parent pointers, children, centroids), no LLM calls. Tracks `_newMembers` per cluster root.
2. `ContextWindow.append()` is synchronous — no LLM calls. Graduation triggers structural `union()` only.
3. `render()` is synchronous — returns cached summaries + hot zone messages. No LLM calls.
4. `resolveDirty()` is async fire-and-forget — batch-summarizes dirty clusters in background during main LLM call wait. One LLM call per dirty cluster, not one per merge.
5. **Overlap window** (`graduateAt`/`evictAt`): graduated messages stay in hot zone for ~2 turns. Background `resolveDirty()` runs during main LLM call (5-30s). By the time a message evicts from hot, its cluster summary is fresh. Zero blocking, zero staleness.

**Overlap window operational spec:**
- `append()` is synchronous: embeds (local TF-IDF), pushes to hot, graduates if hot exceeds `graduateAt`. Graduated messages stay in hot (overlap window). Evicts from hot when hot exceeds `evictAt`.
- `_graduate()` is synchronous: inserts into forest, finds nearest cluster, structural `union()` if similar enough, enforces hard cap. No LLM calls.
- `union()` is synchronous: merges parent pointers, children, centroids. Accumulates `_newMembers` (members added since last clean summary). No LLM calls.
- `render()` is synchronous: returns cold cluster summaries (cached) + hot zone messages (verbatim). Overlap window ensures graduated messages still appear verbatim from hot.
- `resolveDirty()` is async: for each cluster root with non-empty `_newMembers`, makes **one** `summarizer.summarize([clean_summary, ...new_raw_messages])` call. Clears `_newMembers`, updates cached summary. Called after `render()`, runs during main LLM call wait.
- For singletons (no prior summary), the raw message content is the "summary."
- Each raw message appears in exactly one summarization call → O(n) total cost.
- Multiple structural merges between `resolveDirty()` calls are batched.
- No concurrent append/resolveDirty: sequential single-threaded execution assumed (matches v1 and gemini-cli architecture).

**Why overlap, not blocking render:**
v1 analysis showed blocking render would add ~135s total wait across a 45-turn conversation (worse than flat's ~40s). The overlap window eliminates this: `render()` returns instantly using cached summaries, while `resolveDirty()` runs in background during the 5-30s main LLM call. By the time a message evicts from hot, its cluster summary is fresh.

**Why batch, not pairwise replay:**
v1 hit 80 merges for 120 messages (every graduation after msg 40 triggers a merge due to hard cap). Pairwise replay would still produce 80 LLM calls. Batch summarization produces ~10 calls (one per dirty cluster). The structural merges are free — only the final summary matters.

**Measurement protocol (frozen for H2/H3/H4):**
- For each conversation: append all messages, then call `render()` + `resolveDirty()` at end of conversation.
- This matches gemini-cli's usage pattern: messages accumulate, context is rendered for the next LLM call, `resolveDirty()` runs during model response.
- Cost (H3) counts all tokens from all LLM calls across the full conversation lifecycle (appends should be zero, `resolveDirty()` carries all cost).

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

### H2a: Append + Render Latency

Union-find v2 append and render latency p95 < 100ms.

**Method:** Same 12 conversations, same machine. Measure per-append wall-clock time and per-render wall-clock time. Both `append()` and `render()` are synchronous — no LLM calls. Append performs local computation (TF-IDF embedding + forest structural ops). Render returns cached summaries + hot zone messages.

**Benchmark target:** p95 < 100ms (both append and render)
**Note:** This metric validates that neither `append()` nor `render()` blocks on LLM calls. LLM work happens in `resolveDirty()` (background). See H2b.

### H2b: ResolveDirty Latency

Union-find v2 `resolveDirty()` latency reported (no pass/fail target).

**Method:** Measure wall-clock time of `resolveDirty()` call after each conversation's final render (batch-summarizes all dirty clusters). This is where all LLM work happens.

**Report:** p50, p90, p95, p99, max. Compare against v1's per-append latency to assess whether latency was genuinely eliminated or merely relocated.

**No pass/fail target** because `resolveDirty()` runs in background during the main LLM call wait (5-30s). Its absolute latency matters less than whether it completes before the overlap window evicts messages from hot. This is an honest observation, not a gamed metric.

### H3: Cost (Economics)

Union-find v2 total token cost ≤ 2x flat over same conversations.

**Method:** Same 12 conversations, actual token counts from API responses. Count ALL LLM calls across full conversation lifecycle: append-time (zero in v2) + render-time (zero in v2) + resolveDirty-time summarization calls.

**Benchmark target:** Union-find cost ≤ 2x flat
**Cost counting:** Total input + output tokens across all `summarizer.summarize()` calls, whenever they occur (all in `resolveDirty()` for v2).

### H4: Development Methodology (Exploratory)

Document the v2 development process. No pass/fail criteria.

Record: how v1 failures informed v2 design, number of iterations, whether spec warnings prevented repeat bugs.

---

## Tuning Policy

If a hypothesis misses its benchmark target on first measurement, **max 2 parameter changes** allowed. Architectural changes require a new preregistration.

| Hypothesis | Change 1 | Change 2 | Then |
|---|---|---|---|
| H1 (Recall) | Merge threshold (0.15 → {0.10, 0.20}) | Retrieval k (3 → {2, 5}) or min_sim | Accept result |
| H2a (Append+Render) | graduateAt/evictAt ({26,30} → {22,28}/{24,32}) | Max cluster count (10 → {8, 15}) | Accept result |
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
│   ├── union-find-v2-resolve-dirty-latencies.csv
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
