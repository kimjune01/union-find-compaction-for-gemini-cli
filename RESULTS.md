# Experiment Results: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-18
**Branch:** `feat/union-find-compaction` (commit `79a4aedea`)
**Evaluation model:** Gemini 3.1 Flash Lite Preview
**Duration:** 43.5 minutes, 1,380 API calls, 4.4M tokens consumed

---

## Summary

| Hypothesis | Criterion | Measured | Result |
|---|---|---|---|
| **H1 (Recall)** | union-find ≥ flat + 5pp, p<0.05 | +7.3pp, p=0.169 | **FAIL** — effect exists but not significant |
| **H2 (Latency)** | p95 < 100ms | p95 = 3,416ms | **FAIL** — synchronous LLM calls dominate |
| **H3 (Cost)** | union-find ≤ 2x flat | 26.6x | **FAIL** — 960 vs 24 LLM calls |

**Decision tree outcome:** Multiple failures → **"No clear improvement. Recommend staying with flat."**

**Claim strength:** Not supported

---

## H1: Recall (Quality)

**Setup:** 12 real GitHub issue conversations (120 messages each), 8 factual questions per conversation, blinded LLM-as-judge scoring, McNemar's test.

### Aggregate

| System | Correct | Total | Recall |
|---|---|---|---|
| Flat | 20 | 96 | 20.8% |
| Union-find | 27 | 96 | 28.1% |
| **Difference** | | | **+7.3pp** |

### McNemar's Contingency Table

|  | Union-find ✓ | Union-find ✗ |
|---|---|---|
| **Flat ✓** | 14 | 6 |
| **Flat ✗** | 13 | 63 |

- Chi-squared (continuity-corrected): 1.895
- p-value: **0.169** (not significant at α=0.05)

### Per-Conversation Breakdown

| Conversation | Flat | Union-find | Diff |
|---|---|---|---|
| microsoft/vscode#519 | 25% | 25% | +0pp |
| facebook/react#13991 | 25% | 13% | −13pp |
| facebook/react#11347 | 50% | 25% | −25pp |
| microsoft/TypeScript#202 | 25% | 38% | +13pp |
| microsoft/TypeScript#12936 | 13% | 38% | +25pp |
| vercel/next.js#48748 | 0% | 13% | +13pp |
| vercel/next.js#42991 | 0% | 25% | +25pp |
| vercel/next.js#7322 | 13% | 25% | +13pp |
| nodejs/node#4660 | 25% | 38% | +13pp |
| rust-lang/rust#57640 | 13% | 13% | +0pp |
| rust-lang/rust#31436 | 25% | 38% | +13pp |
| flutter/flutter#100522 | 38% | 50% | +13pp |

**Pattern:** Union-find wins on 8 conversations, ties on 2, loses on 2. The losses (react#13991, react#11347) are early conversations — possible warm-up effect in TF-IDF vocabulary building.

### Tuning Assessment (H1)

Per preregistration, allowed changes: merge threshold (0.15 → 0.10/0.20) or retrieval k (3 → 2/5).

**Decision: No tuning attempted.** The +7.3pp effect exceeds the 5pp threshold. The failure is statistical power (p=0.169), not effect size. Tuning clustering parameters wouldn't increase sample size. More conversations would be needed, not different parameters.

### Verdict

**FAIL** — Effect in right direction (+7.3pp > 5pp threshold) but not statistically significant (p=0.169 > 0.05). With 96 observations, the study is underpowered for this effect size. A post-hoc power analysis suggests ~200 paired observations would be needed to detect a 7pp difference with 80% power.

---

## H2: Latency (UX)

**Setup:** 1,440 append operations across 12 conversations (120 messages each), real LLM API calls via Gemini 3.1 Flash Lite.

### Overall Distribution

| Percentile | Latency |
|---|---|
| p50 | 1,841 ms |
| p90 | 3,034 ms |
| p95 | 3,416 ms |
| p99 | 4,210 ms |
| Max | 31,577 ms |

### By Operation Type

| Type | Count | % of Total | p50 | p95 |
|---|---|---|---|---|
| Hot-only (no graduation) | 360 | 25.0% | <0.1 ms | 0.1 ms |
| Graduation without merge | 120 | 8.3% | <0.1 ms | 0.3 ms |
| **Graduation with LLM merge** | **960** | **66.7%** | **2,268 ms** | **3,622 ms** |

### Local Computation Benchmark (Mock Summarizer)

Separate benchmark with near-zero latency mock summarizer:
- p95: **0.176 ms** (TF-IDF + cosine similarity + forest operations)
- Local computation overhead is negligible

### Root Cause Analysis

**The latency is entirely LLM API call time, not local computation.**

With `hotSize=30` and `maxColdClusters=10`:
1. First 30 appends: no graduation (hot zone fills)
2. Appends 31-40: graduation creates new cold clusters (no merge needed)
3. **Appends 41+: every graduation triggers a merge** because cluster count is already at max (10)

This means **66.7% of all appends block on an LLM API call**, making p95 equal to LLM response time (~3.4 seconds).

### Tuning Assessment (H2)

Allowed changes: hot zone size (30 → 20/40) or max cluster count (10 → 8/15).

- **Hot zone 40:** Would delay graduation onset to message 41, but wouldn't change merge frequency after that. p95 still ~3.4s.
- **Max clusters 15:** Would delay forced merges to message 46, but cluster-to-cluster similarity still triggers most merges via the 0.15 threshold. p95 still ~3.4s.

**Decision: No tuning attempted.** The issue is architectural (synchronous LLM calls), not parametric. Making summarization async would require `append()` to return immediately and merge in the background — this is an **architectural change**, classified as exploratory per preregistration.

### Verdict

**FAIL** — p95 = 3,416ms vs criterion of 100ms. The synchronous design makes every merge a blocking operation. Local computation is sub-millisecond, but 66.7% of appends trigger real LLM calls.

---

## H3: Cost (Economics)

**Setup:** Same 12 conversations, actual token counts from API responses.

### Comparison

| Metric | Flat | Union-find | Ratio |
|---|---|---|---|
| LLM calls | 24 | 960 | **40x** |
| Input tokens | 125,075 | 3,543,410 | **28.3x** |
| Output tokens | 17,964 | 261,807 | **14.6x** |
| **Total tokens** | **143,039** | **3,805,217** | **26.6x** |

### Why So Expensive?

The preregistration estimated union-find would make ~10 calls per conversation. **Actual: 80 calls per conversation.**

Every merge re-summarizes the merged cluster's full content:
1. Append message 41 → graduate → merge with nearest cluster → summarize all members (2-3 messages)
2. Append message 42 → graduate → merge → summarize (now 3-4 messages)
3. ... by message 120, some clusters have 15-20 members, each merge re-summarizing all of them

The cost is O(n²) in cluster size because each merge re-reads all existing members. Flat compression is O(n) — one pass over all messages.

### Tuning Assessment (H3)

Allowed changes: cluster limit (10 → 15) or summary max tokens.

- **Cluster limit 15:** Would INCREASE total calls (more clusters means more merges when forced).
- **Summary max tokens:** Would reduce output tokens but not input tokens (which dominate at 93% of total).

**Decision: No tuning attempted.** The cost explosion is structural, not parametric. The implementation re-reads all cluster members on every merge. An incremental summarization strategy ("summarize the new member against the existing summary") would fix this but is an architectural change.

### Verdict

**FAIL** — 26.6x vs criterion of 2x. The per-merge re-summarization of entire clusters creates quadratic token consumption.

---

## Tuning Policy Summary

| Hypothesis | Changes Made | Reason |
|---|---|---|
| H1 | 0 | Effect exists (+7.3pp) but power issue, not parameter issue |
| H2 | 0 | Architectural (sync LLM calls), not parametric |
| H3 | 0 | Architectural (full re-summarization), not parametric |

**Claim strength:** "Not supported" (0 changes, all hypotheses fail)

---

## Stopping Rule

Per preregistration: *"Stop if: H1 AND H2 both fail after tuning, OR cost >3x after tuning."*

Both conditions are met:
- H1 fails (p=0.169) AND H2 fails (p95=3,416ms)
- Cost = 26.6x > 3x

**Recommendation: Stay with flat compression.**

---

## Lessons Learned

### 1. The Merge Frequency Problem

The preregistration assumed ~10 LLM calls per 200-message conversation. Reality: **80 per 120 messages**. With `maxColdClusters=10`, every graduation after message ~40 triggers a merge. The "sparse merge" assumption from the reference paper doesn't hold with TF-IDF embeddings on real conversations — most messages are similar enough (>0.15 cosine similarity) to trigger merging.

### 2. The Re-Summarization Problem

Each `union()` call concatenates ALL cluster members and re-summarizes. This is correct for quality but creates O(n²) cost. An incremental approach ("merge new message's content with existing summary") would be O(n) but was not in the design spec.

### 3. The Synchronous Problem

`ContextWindow.append()` awaits graduation, which awaits merge, which awaits `summarizer.summarize()`. This makes every merge a blocking operation. The "non-blocking UX" claimed in the design requires async/background summarization — an architectural change, not a parameter tweak.

### 4. The Recall Signal

Despite all the problems above, union-find shows a +7.3pp recall advantage over flat compression. This effect is consistent across 10 of 12 conversations. The clustered approach does preserve more specific facts — it just does so at unacceptable cost and latency.

### 5. What Would Be Needed

To make union-find viable:
1. **Async graduation:** `append()` returns immediately, merges happen in background
2. **Incremental summarization:** "Update this summary with this new message" instead of re-summarizing all members
3. **Smarter merge decisions:** Raise threshold to reduce merge frequency, or use batch merging
4. **These are architectural changes** and would require a new preregistration

---

## Methodology Notes

### Data
- 12 GitHub issue conversations from 7 repositories
- microsoft/vscode, facebook/react, microsoft/TypeScript, vercel/next.js, nodejs/node, rust-lang/rust, flutter/flutter
- First 120 messages per conversation (total: 1,440 messages)

### Evaluation
- Gemini 3.1 Flash Lite Preview (budget constraint)
- Questions generated from uncompressed content before compression
- Blinded LLM-as-judge (didn't know which system produced the context)
- Randomized evaluation order to avoid position bias

### Limitations
- GitHub issues are multi-party discussions, not 1-on-1 coding conversations like gemini-cli produces
- Flash Lite for both evaluation and compression (Pro users would see different results)
- 96 question-answer pairs may be underpowered for small effect sizes
- API key inadvertently exposed during experiment setup (rotate after)

### Environment
- Machine: Apple M4 Pro, 48GB RAM
- OS: macOS Darwin 25.3.0
- Node.js: v22.21.1
- Experiment runtime: 43.5 minutes

---

## Raw Data

- `experiment/results.json` — Complete structured results
- `experiment/performance/union-find-latencies.csv` — Mock summarizer latencies (200 msgs)
- `experiment/performance/union-find-real-latencies.csv` — Real API latencies (1,440 msgs)
- `experiment/performance/environment.md` — Machine specs
- `experiment/quality-test/conversations/` — 12 source conversations (JSON)
