# Preregistration v2: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-17
**Author:** June Kim (kimjune01)
**Witness:** Claude Opus 4.6 (noreply@anthropic.com)
**Status:** Preregistered (before v2 implementation attempt)
**Predecessor:** `PREREGISTRATION.md` (v1 — all three hypotheses failed, stopping rule triggered)

---

## Why a New Preregistration

The v1 preregistration's stopping rule was triggered: H1 AND H2 both failed, AND cost exceeded 3x (26.6x). The v1 Fixed Tuning Policy explicitly classified the two required fixes as **architectural changes** (not parameter tuning):

1. **Incremental summary merging** — `union()` merges two existing summaries instead of re-reading all member raw texts (changes summarization algorithm)
2. **Non-blocking append** — summarization deferred to `render()` time instead of blocking `append()` (sync to async — explicitly named as architectural in v1 prereg)

Per v1 prereg: "Architectural changes require reclassification as exploratory." Rather than reclassify under v1, we create a fresh preregistration for v2 with the same hypotheses and criteria.

---

## Research Question

**Does union-find context compaction with incremental merging and deferred summarization improve gemini-cli compared to flat summarization?**

Three confirmatory hypotheses (H1-H3) test the code improvements.
One exploratory observation (H4) documents the development process.

---

## Experimental Setup

**Implementation:** Claude Opus 4.6 builds v2 from `transformation-design.md` warnings
**Evaluation model:** Gemini 3.1 Flash Lite (budget constraint)
**Evaluation data:** Same 12 GitHub issue conversations from v1 experiment
**Evaluation freeze:** H1-H3 run on a **tagged git commit** only

**v2 architectural changes (vs v1):**
1. `Forest.union()` merges two root summaries (O(1) per merge), not all member raw texts (O(members) per merge)
2. `ContextWindow.append()` is synchronous — LLM summarization deferred to `render()` time via dirty-flag mechanism

**Limitations:**
- Same as v1: Flash Lite, proxy data, benchmark scope
- v2 is the second attempt at this architecture — not independent of v1 learnings
- Reusing same 12 conversations risks overfitting to known data (mitigated: no parameter changes based on v1 recall results)

---

## Confirmatory Hypotheses

### H1: Recall (Quality)

Union-find v2 improves recall by ≥5pp on the same 12 coding conversations.

**Method:** Identical to v1 — same conversations, same questions, same blinded LLM-as-judge, same binary scoring.

**Test:** McNemar's on paired binary outcomes (p<0.05)
**Pass:** Union-find recall ≥ flat recall + 5pp, statistically significant
**Fail:** No significant difference (±2pp) or regression

### H2: Latency (UX)

Union-find v2 append latency p95 < 100ms (non-blocking).

**Method:** Same 12 conversations, same machine. Measure per-append latency. Since summarization is deferred to `render()`, append should only do local computation (TF-IDF embedding + forest ops).

**Pass:** Append p95 < 100ms
**Fail:** p95 > 100ms

**Note:** `render()` latency is NOT part of H2. Render may trigger deferred LLM calls and is expected to take longer. H2 measures only whether `append()` blocks the caller.

### H3: Cost (Economics)

Union-find v2 total token cost ≤ 2x flat over same conversations.

**Method:** Same 12 conversations, actual token counts from API responses. Incremental merging should produce ~10 LLM calls per conversation (two summaries as input, not all members).

**Pass:** Union-find cost ≤ 2x flat
**Fail:** Union-find cost > 2x flat

---

## Fixed Tuning Policy

Same as v1. If a hypothesis fails on first measurement, **max 2 parameter changes** allowed. Architectural changes require yet another preregistration.

| Hypothesis | Change 1 | Change 2 | Then |
|---|---|---|---|
| H1 (Recall) | Merge threshold (0.15 → {0.10, 0.20}) | Retrieval k (3 → {2, 5}) or min_sim | Accept result |
| H2 (Latency) | Hot zone size (30 → {20, 40}) | Max cluster count (10 → {8, 15}) | Accept result |
| H3 (Cost) | Cluster limit (10 → 15) | Summary max tokens | Accept result |

**Claim strength:**
- 0 changes: "Confirmed"
- 1-2 changes: "Supported after tuning"
- Architectural change: Requires PREREGISTRATION-V3
- Still failing: "Not supported"

---

## Exploratory Observation

### H4: Development Methodology

Document the v2 development process. No pass/fail criteria.

Record: how v1 failures informed v2 design, number of iterations, whether spec warnings prevented repeat bugs.

---

## Decision Rules

| Outcome | Claim | Action |
|---|---|---|
| H1 ✅ H2 ✅ H3 ✅ | v2 improves all metrics (scoped to benchmark) | Open PR with evidence |
| H1 ❌ H2 ✅ H3 ✅ | Better UX, comparable quality/cost | Document UX-focused value |
| H1 ✅ H2 ❌ H3 ✅ | Better quality, slower append | Document quality-focused value |
| H1 ✅ H2 ✅ H3 ❌ | Better quality/UX, higher cost | Document as premium feature |
| Multiple ❌ | No clear improvement after two architectural attempts | Recommend staying with flat |

**Stop if:** H1 AND H2 both fail after tuning, OR cost >3x after tuning.

---

## Data Storage

```
experiment/v2/
├── quality-test/         # H1 — reuse v1 conversations and questions
│   ├── flat-results.json   # (reuse v1 flat baseline)
│   ├── union-find-v2-results.json
│   └── analysis.md
├── performance/          # H2
│   ├── union-find-v2-latencies.csv
│   ├── environment.md
│   └── analysis.md
├── cost/                 # H3
│   ├── union-find-v2-tokens.json
│   └── cost-comparison.md
└── methodology/          # H4
    └── summary.md
```

---

## Commitment

1. **Report all outcomes** — success and failure
2. **Follow preregistered criteria** — no post-hoc changes to H1-H3
3. **Acknowledge limitations** — Flash Lite, proxy data, reused conversations, informed by v1
4. **No HARKing** — hypotheses frozen before v2 implementation
5. **Transparent lineage** — link to v1 preregistration and results

After experiment: append to `RESULTS.md` with v2 hypothesis outcomes.

---

**Do not modify H1-H3 criteria after v2 implementation begins.**
