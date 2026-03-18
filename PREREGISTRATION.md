# Preregistration: Union-Find Context Compaction for Gemini-CLI

**Date:** 2026-03-17
**Status:** Preregistered (before implementation attempt)
**Purpose:** Establish hypotheses, success criteria, and decision rules to prevent p-hacking and HARKing

---

## Primary Research Question

**Does union-find context compaction improve gemini-cli compared to flat summarization?**

Specifically, we test three confirmatory hypotheses:
1. **Quality (H1)**: Recall improvement ≥5pp
2. **UX (H2)**: Non-blocking append latency <100ms
3. **Cost (H3)**: Total cost ≤2x flat

These are the **primary claims** requiring rigorous preregistration and protection against p-hacking.

**Secondary observation (exploratory, not confirmatory):**
- Development methodology: Document whether prose-driven development succeeds or requires iteration

---

## Implementation Conditions (Frozen)

Before stating hypotheses, freeze the exact implementation approach:

- **Model**: Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`)
- **Temperature**: Default (1.0)
- **Input**: `transformation-design.md` specification only
- **Tools**: Standard code tools (Read, Write, Edit)
- **Test feedback**: Allowed (can run tests, see failures, iterate on code)
- **Spec refinement**: Exploratory (document iterations, but not confirmatory claim)

---

## Primary Hypotheses (Confirmatory)

### H1: Recall Improvement (Quality) - PRIMARY CONFIRMATORY

**Hypothesis:** Union-find compaction improves recall by ≥5pp compared to flat summarization.

**Measurement approach:**
1. Create test dataset: 10 conversations with planted facts (technical details: ports, paths, commands, thresholds)
2. Compress with both strategies (flat vs union-find)
3. Query for facts, measure retrieval accuracy
4. Compare: union-find recall - flat recall

**Success criteria:**
- ✅ Recall improvement ≥ 5pp (statistically significant, McNemar's test p<0.05)
- ✅ No catastrophic failures (recall < flat - 5pp)

**Failure modes:**
- ❌ No significant difference (within ±2pp)
- ❌ Union-find worse than flat (regression)

**Decision rule if H1 fails:**
- If no difference: Document as "comparable quality, but better UX"
- If regression: Follow **Fixed Tuning Policy** (max 2 changes, see below)
- **After 2 tuning attempts:** Acknowledge quality trade-off

---

### H2: Non-Blocking UX (Performance) - PRIMARY CONFIRMATORY

**Hypothesis:** Union-find append latency < 100ms per message (non-blocking UX).

**Measurement approach:**
1. Measure append latency over 200-message conversation
2. Track: hot append (no graduation), cold append (graduation + merge)
3. 95th percentile latency < 100ms

**Success criteria:**
- ✅ p95 latency < 100ms
- ✅ No user-perceptible blocking (no spinner needed)

**Failure modes:**
- ❌ Latency > 100ms (merge computation too slow)
- ❌ Latency > 1000ms (requires spinner)

**Decision rule if H2 fails:**
- If 100ms < latency < 500ms: Still better than flat (20-30s), document trade-off
- If latency > 500ms: Follow **Fixed Tuning Policy** (max 2 changes, see below)
- **After 2 tuning attempts:** Acknowledge UX regression

---

### H3: Cost Comparable (Economics) - PRIMARY CONFIRMATORY

**Hypothesis:** Union-find total cost within 2x of flat summarization over 200 messages.

**Measurement approach:**
1. Track LLM API costs (input tokens + output tokens)
2. Flat: 2 calls (generate + verify) at ~190 messages each
3. Union-find: ~10 cluster summaries at ~20-40 messages each
4. Compare total token costs

**Success criteria:**
- ✅ Union-find cost ≤ 2x flat cost
- ✅ Preferably comparable (within 1.2x)

**Failure modes:**
- ❌ Union-find > 2x flat (too expensive)

**Decision rule if H3 fails:**
- If 2x < cost < 3x: Document trade-off (quality/UX vs cost)
- If cost > 3x: Follow **Fixed Tuning Policy** (max 2 changes, see below)
- **After 2 tuning attempts:** Acknowledge cost trade-off

---

## Fixed Tuning Policy (Protection Against P-Hacking)

**Purpose:** Limit post-hoc flexibility for H1-H3 (confirmatory hypotheses).

**Rules:**
1. **Initial measurement uses parameters from transformation-design.md** (frozen baseline)
2. **Maximum 2 parameter changes per hypothesis** if initial fails
3. **Changes follow priority order** (specified below)
4. **Each change requires full re-measurement** with documented results
5. **After 2 changes, accept outcome** - no further tuning

**Allowed parameter changes (priority order):**

**For H1 (Quality/Recall):**
1. Change 1: Upgrade TF-IDF to dense embeddings (e.g., OpenAI text-embedding-3-small)
2. Change 2: Adjust merge threshold (0.15 → {0.10, 0.20})
3. STOP - accept result

**For H2 (Performance/UX):**
1. Change 1: Add embedding cache (avoid recomputation)
2. Change 2: Async merge (non-blocking append)
3. STOP - accept result

**For H3 (Cost):**
1. Change 1: Increase cluster limit (10 → 15, reduce merge frequency)
2. Change 2: Tune summary brevity prompt
3. STOP - accept result

**Claim downgrade based on tuning:**
- 0 changes needed: "Hypothesis confirmed"
- 1-2 changes needed: "Hypothesis supported after tuning (exploratory)"
- Still failing after 2 changes: "Hypothesis not supported"

---

## Secondary Observation (Exploratory, Not Confirmatory)

### H4: Development Methodology

**Observation:** Document the prose-driven development process.

**What we'll record:**
- Did implementation work on first attempt from transformation-design.md?
- If not, how many iterations were needed?
- What spec ambiguities were discovered?
- What LLM limitations were encountered?

**This is NOT a confirmatory hypothesis:**
- No pass/fail criteria
- No p-hacking risk (just documentation)
- Interesting process note, not a rigorous claim
- Will inform future prose-driven attempts

**Why exploratory:**
The methodology is just how we built it. The important question is whether union-find improves gemini-cli (H1-H3), not whether prose-driven development is perfect.

---

## Decision Tree

### Scenario 1: All Primary Hypotheses Pass (H1 ✅, H2 ✅, H3 ✅)

**Outcome:** Union-find is strictly better than flat summarization

**Action:**
1. Document results in RESULTS.md
2. Open PR to gemini-cli with evidence
3. Write blog post: "Union-find context compaction: Better recall, UX, and comparable cost"
4. Note development methodology (H4) as interesting process observation

**Claims we can make:**
- ✅ Quality improved (recall ≥5pp better)
- ✅ UX improved (non-blocking append <100ms)
- ✅ Cost comparable (≤2x flat)
- ✅ Union-find is superior for Gemini 3 Pro users

---

### Scenario 2: H1 Fails (Quality Regression), Others Pass

**Outcome:** Recall not better than flat, but UX and cost are good

**Action:**
1. Follow Fixed Tuning Policy (max 2 changes)
2. Re-measure after each change
3. If still failing: Accept result

**Claims we can make:**
- ❌ Quality NOT better than baseline (recall comparable or worse)
- ✅ UX improved (non-blocking)
- ✅ Cost comparable
- ⚠️ Trade-off: "Better UX at comparable quality and cost"

**Honest reporting:**
- "Recall improvement not statistically significant"
- "Union-find provides UX benefits without quality regression"

---

### Scenario 3: H2 Fails (Performance Regression), Others Pass

**Outcome:** Recall better, cost good, but UX slow

**Action:**
1. Follow Fixed Tuning Policy (max 2 changes)
2. Profile and optimize
3. If still failing: Accept result

**Claims we can make:**
- ✅ Quality improved (recall ≥5pp better)
- ❌ UX NOT better (append latency >100ms)
- ✅ Cost comparable
- ⚠️ Trade-off: "Better quality at comparable cost, but slower append"

**Honest reporting:**
- "Append latency higher than expected (Xms p95)"
- "Still better than flat's 20-30s blocking if <500ms"

---

### Scenario 4: H3 Fails (Cost Explosion), Others Pass

**Outcome:** Recall better, UX good, but cost high

**Action:**
1. Follow Fixed Tuning Policy (max 2 changes)
2. Measure token costs accurately
3. If still failing: Accept result

**Claims we can make:**
- ✅ Quality improved (recall ≥5pp better)
- ✅ UX improved (non-blocking)
- ❌ Cost NOT comparable (>2x flat)
- ⚠️ Trade-off: "Premium feature for quality-focused users"

**Honest reporting:**
- "Cost Xx higher than flat"
- "Suitable for Gemini 3 Pro users who prioritize quality/UX"

---

### Scenario 5: Multiple Primary Hypotheses Fail

**Outcome:** Union-find does not improve gemini-cli

**Action:**
1. Follow Fixed Tuning Policy for each failing hypothesis
2. Document all results honestly
3. Accept that union-find may not be better

**Claims we can make:**
- ⚠️ Union-find does not provide clear improvement
- ⚠️ Trade-offs documented transparently
- ✅ Methodology was rigorous (even if result negative)

**Honest reporting:**
- "Multiple hypotheses not supported"
- "Trade-offs: [list all]"
- "Recommend staying with flat summarization"

---

## Stopping Rules

### When to Stop Tuning (Accept Result)

**Rule 1: Maximum Parameter Changes**
- **2 changes per hypothesis** (see Fixed Tuning Policy)
- After 2 changes, accept result and document trade-offs

**Rule 2: Fundamental Failure**
- If **H1 AND H2 both fail** after tuning, stop
- Document as: "Union-find does not improve quality or UX over baseline"
- Recommendation: Stay with flat summarization

**Rule 3: Prohibitive Cost**
- If H3 shows cost **>3x** after tuning, stop
- Document as: "Union-find too expensive for general use"
- Recommendation: Not suitable for cost-sensitive users

**Rule 4: Implementation Impossibility**
- If implementation reveals specification is infeasible (architectural conflict, incompatible with gemini-cli)
- Document as: "Design incompatible with existing system"
- Note: This invalidates experiment, not just hypothesis

---

## Data Collection Plan

### H1: Quality Measurement (Recall)

**Test dataset:**
- 10 conversations (100-300 messages each)
- 5 planted facts per conversation (technical details)
- Fact types: ports (8080), paths (/var/log/app.log), commands (git rebase -i), thresholds (timeout=30s), schemas (JSON structure)

**Measurement:**
1. Compress with flat: measure recall
2. Compress with union-find: measure recall
3. McNemar's test for significance (p<0.05)

**Storage:** `experiment/quality-test/`
- `conversations/` - Test conversations
- `facts.json` - Planted facts with ground truth
- `flat-recall.json` - Flat strategy results
- `union-find-recall.json` - Union-find results
- `analysis.md` - Statistical analysis

---

### H2: Performance Measurement (UX/Latency)

**Benchmark:**
- 200-message conversation (append one by one)
- Measure latency for each append (hot vs cold)
- Track p50, p95, p99 latencies

**Storage:** `experiment/performance/`
- `latencies.csv` - Per-message append latency
- `analysis.md` - Latency distribution analysis

---

### H3: Cost Measurement (Economics)

**Token tracking:**
- Flat: Track input/output tokens for generate + verify calls
- Union-find: Track input/output tokens for all cluster merges
- Calculate total cost using Gemini 3 Pro pricing

**Storage:** `experiment/cost/`
- `flat-tokens.json` - Flat strategy token counts
- `union-find-tokens.json` - Union-find token counts
- `cost-comparison.md` - Cost analysis

---

### H4: Development Methodology (Exploratory Observation)

**Data to collect:**
1. Prompt given to LLM (exact text with transformation-design.md)
2. Generated code (full implementation)
3. Test results (pass/fail for each test, iteration by iteration)
4. Compilation errors (if any)
5. Spec refinements required (what was ambiguous/missing?)
6. Number of iterations to working implementation

**Storage:** `experiment/methodology/`
- `iteration-N/` directories for each attempt
  - `prompt.md` - Exact prompt used
  - `generated-code.ts` - LLM output
  - `test-results.txt` - Test execution log
  - `fixes.md` - Any manual corrections or spec refinements
- `summary.md` - Overall methodology assessment

**Note:** This is observational only. No pass/fail criteria, just documentation for future prose-driven attempts.

---

## Preregistration Commitment

**I commit to:**

1. **Not cherry-pick results** - Report all outcomes (success and failure)
2. **Follow decision rules** - Use preregistered criteria, not post-hoc justification
3. **Acknowledge limitations** - If hypothesis fails, document honestly
4. **No HARKing** - Don't change hypotheses after seeing results
5. **Transparent iteration** - If specification requires refinement, document what changed and why

**Signature:**
June Kim (kimjune01)
Date: 2026-03-17

**Witness:**
Claude Sonnet 4.5 (noreply@anthropic.com)
Date: 2026-03-17

---

## Post-Experiment Reporting

After experiment completion, create `RESULTS.md` with:

1. **Hypothesis outcomes** (H1-H3: ✅ or ❌, with tuning if applicable)
2. **Data summary** (recall percentages, latency p95, total cost comparison)
3. **Decision tree outcome** (which scenario occurred)
4. **Parameter changes made** (if any tuning was required, document what changed)
5. **Lessons learned** (what worked, what didn't, trade-offs)
6. **Methodology observation** (H4: how many iterations, what spec refinements)
7. **Recommendation** (should gemini-cli adopt union-find? Under what conditions?)

**Commit both PREREGISTRATION.md and RESULTS.md to git** - timestamp verifiable.

---

## Notes

This preregistration establishes scientific rigor for an engineering experiment. The goal is credibility: readers can verify we didn't massage results or change criteria post-hoc.

**Why this matters:**
- **Primary claim**: Union-find improves gemini-cli (quality, UX, cost)
- **Scrutiny focus**: Code improvements, not development methodology
- **Risk**: Easy to be accused of cherry-picking or p-hacking if not rigorous
- **Protection**: Preregistration with fixed tuning policy prevents post-hoc rationalization

**What success looks like:**
- Not "everything worked perfectly"
- But "we followed the preregistered process honestly and documented all results"
- Negative results are valid results - no need to massage data

**What will be scrutinized:**
- H1-H3 (Quality, UX, Cost) - primary confirmatory claims
- Fixed tuning policy followed correctly
- Honest reporting of trade-offs

**What won't be scrutinized:**
- H4 (Development methodology) - just interesting process documentation
- Number of spec iterations needed - exploratory, not confirmatory

---

**End of preregistration. Do not modify H1-H3 criteria after implementation begins.**
