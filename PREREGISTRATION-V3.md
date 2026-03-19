# Preregistration v3: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-19
**Author:** June Kim (kimjune01)
**Witness:** Claude Opus 4.6 (noreply@anthropic.com)
**Status:** Preregistered (before v3 experiment run)
**Predecessor:** `PREREGISTRATION-V2.md` (v2 — implementation built but experiment not completed)
**Classification:** Exploratory benchmark validation on reused data

---

## Why a New Preregistration

The v2 preregistration specified "Claude Opus 4.6 builds v2 from `transformation-design.md` warnings." The actual implementation followed a different methodology: [blind, blind, merge](https://june.kim/blind-blind-merge).

Three blind implementations were built from the same spec and prototype, then cross-reviewed and synthesized:
1. **Codex (GPT-5.4)** — blind implementation, strong on architecture and config
2. **Claude Opus 4.6** — blind implementation, strong on defensive patterns and types
3. **Original pipeline (Claude Opus 4.6)** — human-guided, strong on error handling

The synthesis absorbed the best of all three. A fresh reviewer (blind to history) ranked the synthesis closest to production. This is a different implementation process than v2 preregistered, requiring a new preregistration.

**Implementation under test:**
- Repository: [`kimjune01/gemini-cli:feat/union-find-compaction-v2`](https://github.com/kimjune01/gemini-cli/tree/feat/union-find-compaction-v2)
- Commit: `04d6451d9f232ec4e5c27c21dbd1c22e64133600`
- Methodology: [blind, blind, merge](https://june.kim/blind-blind-merge)

**Evidence repos:**
- [Codex blind implementation](https://github.com/kimjune01/gemini-cli-codex)
- [Claude blind implementation](https://github.com/kimjune01/gemini-cli-claude)
- [Python prototype](https://github.com/kimjune01/union-find-compaction)
- [Spec + experiment harness](https://github.com/kimjune01/union-find-compaction-for-gemini-cli)

---

## What Changed from v2

**Implementation process:** Single-agent build → blind-blind-merge synthesis
**Architecture:** Unchanged from v2 prereg (synchronous append/render, async resolveDirty, overlap window)
**Hypotheses:** Unchanged from v2
**Evaluation:** Unchanged from v2 (same 12 conversations, same model, same protocol)
**Tuning policy:** Unchanged from v2

The only change is *how* the implementation was built, not *what* it does. The architecture, the API surface, and the evaluation protocol are identical to v2.

---

## Research Question

**Does union-find context compaction with incremental merging and deferred summarization improve gemini-cli compared to flat summarization?**

Same as v2. Four exploratory hypotheses (H1-H4).

---

## Experimental Setup

**Implementation:** Synthesis from blind-blind-merge (commit `04d6451d9`)
**Evaluation model:** `gemini-3.1-flash-lite-preview` (exact model ID, frozen)
**Evaluation data:** Same 12 GitHub issue conversations from v1/v2
**Evaluation freeze:** H1-H4 run on commit `04d6451d9` only
**Baseline:** Flat compression rerun contemporaneously in same environment

**v3 implementation characteristics (inherited from synthesis):**
1. `Forest.union()` is synchronous — structural merge only, no LLM calls. Tracks dirty inputs with reference-equality concurrency guard.
2. `ContextWindow.append()` is synchronous — no LLM calls. Graduation triggers structural `union()` only.
3. `render()` is synchronous — returns cached summaries + hot zone messages. Uses `embedQuery()` to avoid TF-IDF corpus contamination.
4. `resolveDirty()` is async fire-and-forget — batch-summarizes dirty clusters with per-cluster error catching. Failed clusters stay dirty for retry.
5. Overlap window (`graduateAt=26`/`evictAt=30`): graduated messages stay in hot zone for ~2 turns.
6. `ClusterSummarizer` skips LLM call for single messages, catches errors per-cluster.
7. Hot zone preserves original `Content` objects (roles, tool calls, tool responses).
8. Cold summaries wrapped in `<context_summaries>` with synthetic user+model envelope.
9. `ContextWindow` persisted on `GeminiChat` object across compression calls with incremental ingestion tracking.

**Measurement protocol:** Same as v2 (append all messages, render + resolveDirty at end).

**Limitations:** Same as v2, plus:
- Implementation built via novel methodology (blind-blind-merge) — results reflect both the algorithm and the build process
- Three rounds of cross-pollination may have introduced integration bugs not caught by unit tests

---

## Hypotheses

Unchanged from v2. All exploratory.

### H1: Recall (Quality)
Union-find v3 recall ≥ flat recall + 5pp (McNemar's, p<0.05)

### H2a: Append + Render Latency
p95 < 100ms (both append and render)

### H2b: ResolveDirty Latency
Reported, no pass/fail target

### H3: Cost (Economics)
Union-find cost ≤ 2x flat

### H4: Development Methodology (Exploratory)
Document the blind-blind-merge process. See [work log](https://june.kim/work-log).

---

## Tuning Policy

Unchanged from v2. Max 2 parameter changes per hypothesis. Architectural changes require PREREGISTRATION-V4.

| Hypothesis | Change 1 | Change 2 | Then |
|---|---|---|---|
| H1 (Recall) | Merge threshold (0.15 → {0.10, 0.20}) | Retrieval k (3 → {2, 5}) or min_sim | Accept result |
| H2a (Append+Render) | graduateAt/evictAt ({26,30} → {22,28}/{24,32}) | Max cluster count (10 → {8, 15}) | Accept result |
| H3 (Cost) | Cluster limit (10 → 15) | Summary max tokens | Accept result |

**Claim strength:**
- 0 changes: "Benchmark-supported on reused dataset"
- 1-2 changes: "Benchmark-supported after tuning"
- Architectural change: Requires PREREGISTRATION-V4
- Still failing: "Not supported"

---

## Decision Rules

Same as v2.

| Outcome | Observation | Action |
|---|---|---|
| H1 ✅ H2a ✅ H3 ✅ | v3 meets all benchmark targets | Open PR with evidence |
| H1 ❌ H2a ✅ H3 ✅ | Better append UX, comparable cost | Document; note H1 power limitation |
| H1 ✅ H2a ❌ H3 ✅ | Better quality, still blocking | Investigate implementation bug |
| H1 ✅ H2a ✅ H3 ❌ | Better quality/UX, higher cost | Document as premium feature |
| Multiple ❌ | No clear improvement after three attempts | Recommend staying with flat |

**Stop if:** H1 AND H2a both miss after tuning, OR cost >3x after tuning.

---

## Commitment

1. **Report all outcomes** — success and failure
2. **Follow preregistered criteria** — no post-hoc changes to hypotheses
3. **Acknowledge exploratory status** — benchmark validation, not confirmation
4. **No HARKing** — hypotheses frozen before experiment run
5. **Transparent lineage** — link to v1, v2 preregistrations and results
6. **Contemporaneous baselines** — rerun flat in same environment
7. **Honest render reporting** — H2b prevents hiding latency by deferring it
8. **Methodology transparency** — blind-blind-merge process documented in blog post and work log

After experiment: append to `RESULTS.md` with v3 hypothesis outcomes.

---

**Do not modify hypotheses after experiment run begins.**
