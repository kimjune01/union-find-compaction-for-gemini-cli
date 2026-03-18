# Preregistration: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-17
**Author:** June Kim (kimjune01)
**Witness:** Claude Opus 4.6 (noreply@anthropic.com)
**Status:** Preregistered (before implementation attempt)

---

## Research Question

**Does union-find context compaction improve gemini-cli compared to flat summarization?**

Three confirmatory hypotheses (H1-H3) test the code improvements.
One exploratory observation (H4) documents the development process.

---

## Experimental Setup

**Implementation:** Claude Opus 4.6 builds from `transformation-design.md`
**Evaluation model:** Gemini 3.1 Flash Lite (budget constraint)
**Evaluation data:** Publicly available coding conversations (GitHub issues, Stack Overflow)
**Evaluation freeze:** H1-H3 run on a **tagged git commit** only

**Limitations:**
- Tested on Flash Lite, not Gemini 3 Pro (Pro validation is future work)
- Public coding conversations as proxy for gemini-cli production usage
- Benchmark results, not production validation

---

## Confirmatory Hypotheses

### H1: Recall (Quality)

Union-find improves recall by ≥5pp on publicly available coding conversations.

**Method:**
- 10-20 real conversations (≥100 messages each) from GitHub issues and Stack Overflow
- For each: compress with flat, compress with union-find
- 5-10 factual questions per conversation (APIs, commands, configs, errors)
- Binary scoring: correct (1) or incorrect (0)
- Questions generated from uncompressed source BEFORE compression
- Blinded LLM-as-judge scores answers without knowing which system produced them

**Test:** McNemar's on paired binary outcomes (p<0.05)
**Pass:** Union-find recall ≥ flat recall + 5pp, statistically significant
**Fail:** No significant difference (±2pp) or regression

### H2: Latency (UX)

Union-find append latency p95 < 100ms (non-blocking).

**Method:**
- Same 200-message conversation, both systems, same machine
- Flat: measure blocking time per compression event
- Union-find: measure per-append latency (hot vs cold)
- Document machine specs, model endpoint, network conditions

**Pass:** Union-find p95 < 100ms
**Fail:** p95 > 100ms

### H3: Cost (Economics)

Union-find total token cost ≤ 2x flat over 200 messages.

**Method:**
- Same 200-message conversation, both systems
- Track actual input/output tokens from real API responses (not estimates)
- Calculate cost at Flash Lite pricing

**Pass:** Union-find cost ≤ 2x flat
**Fail:** Union-find cost > 2x flat

---

## Fixed Tuning Policy

If a hypothesis fails on first measurement, **max 2 parameter changes** allowed per hypothesis. Architectural changes (e.g., TF-IDF to dense embeddings, sync to async) are **not** tuning and require reclassification as exploratory.

| Hypothesis | Change 1 | Change 2 | Then |
|---|---|---|---|
| H1 (Recall) | Merge threshold (0.15 → {0.10, 0.20}) | Retrieval k (3 → {2, 5}) or min_sim | Accept result |
| H2 (Latency) | Hot zone size (30 → {20, 40}) | Max cluster count (10 → {8, 15}) | Accept result |
| H3 (Cost) | Cluster limit (10 → 15) | Summary max tokens | Accept result |

**Claim strength:**
- 0 changes: "Confirmed"
- 1-2 changes: "Supported after tuning"
- Architectural change: "Exploratory only"
- Still failing: "Not supported"

---

## Exploratory Observation

### H4: Development Methodology

Document the prose-driven development process. No pass/fail criteria.

Record: number of iterations, spec ambiguities discovered, LLM limitations encountered, time to working implementation.

This is interesting context, not a rigorous claim.

---

## Decision Rules

| Outcome | Claim | Action |
|---|---|---|
| H1 ✅ H2 ✅ H3 ✅ | Improvement on all metrics (scoped to benchmark) | Open PR with evidence |
| H1 ❌ H2 ✅ H3 ✅ | Better UX, comparable quality/cost | Document UX-focused value |
| H1 ✅ H2 ❌ H3 ✅ | Better quality, slower append | Document quality-focused value |
| H1 ✅ H2 ✅ H3 ❌ | Better quality/UX, higher cost | Document as premium feature |
| Multiple ❌ | No clear improvement | Recommend staying with flat |

**Stop if:** H1 AND H2 both fail after tuning, OR cost >3x after tuning, OR design is architecturally incompatible.

---

## Data Storage

```
experiment/
├── quality-test/
│   ├── conversations/     # Archived URLs + local copies
│   ├── questions.json     # Questions + ground truth (generated before compression)
│   ├── flat-results.json  # Answers + binary scores
│   ├── union-find-results.json
│   └── analysis.md        # McNemar's test results
├── performance/
│   ├── union-find-latencies.csv  # Per-append (hot/cold flag)
│   ├── flat-blocking-times.csv   # Per-compression-event
│   ├── environment.md            # Machine specs, conditions
│   └── analysis.md
├── cost/
│   ├── flat-tokens.json          # Actual API token counts
│   ├── union-find-tokens.json
│   └── cost-comparison.md
└── methodology/                  # H4 (exploratory)
    ├── iteration-N/
    │   ├── prompt.md
    │   ├── test-results.txt
    │   └── fixes.md
    └── summary.md
```

---

## Commitment

1. **Report all outcomes** - success and failure
2. **Follow preregistered criteria** - no post-hoc changes to H1-H3
3. **Acknowledge limitations** - Flash Lite, proxy data, benchmark scope
4. **No HARKing** - hypotheses frozen before implementation
5. **Transparent tuning** - every parameter change documented with full re-measurement

After experiment: create `RESULTS.md` with hypothesis outcomes, data, decision tree result, parameter changes, lessons learned, and recommendation.

---

**Do not modify H1-H3 criteria after implementation begins.**
