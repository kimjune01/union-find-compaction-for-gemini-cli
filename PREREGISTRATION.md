# Preregistration: Prose-Driven Implementation Experiment

**Date:** 2026-03-17
**Status:** Preregistered (before implementation attempt)
**Purpose:** Establish hypotheses, success criteria, and decision rules to prevent p-hacking and HARKing

---

## Primary Research Question

**Can a rigorous prose specification one-shot a complex refactoring implementation?**

Specifically: Can Gemini 3 Pro (or equivalent LLM) implement the union-find context compaction transformation from `transformation-design.md` alone, producing code that passes tests and meets quality criteria **without iterative debugging**?

---

## Hypotheses

### H1: One-Shot Implementation (Primary)

**Hypothesis:** Given `transformation-design.md`, an LLM can generate a correct TypeScript implementation that passes all tests on the first attempt.

**Success criteria:**
- ✅ All unit tests pass (find, union, merge, expand, retrieval)
- ✅ All integration tests pass (backward compat, hooks, tool truncation)
- ✅ No runtime errors in test execution
- ✅ No manual debugging required

**Failure modes:**
- ❌ Tests fail due to logic errors
- ❌ Tests fail due to missing edge cases
- ❌ Implementation misinterprets specification
- ❌ TypeScript compilation errors

**Decision rule if H1 fails:**
1. Document the failure mode (what went wrong?)
2. Classify: Was it prose ambiguity, missing detail, or LLM limitation?
3. If prose ambiguity: Refine spec, mark as iteration 1, retry
4. If LLM limitation: Document as methodology limitation
5. **Maximum 3 iterations** - if still failing, hypothesis rejected

---

### H2: Recall Improvement (Quality)

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

**Decision rule if H2 fails:**
- If no difference: Document as "comparable quality, but better UX"
- If regression: Investigate cause:
  - TF-IDF insufficient? → Try dense embeddings
  - Merge threshold too aggressive? → Tune threshold
  - Summary quality poor? → Add verification pass
- **If still failing after tuning:** Acknowledge quality trade-off

---

### H3: Non-Blocking UX (Performance)

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

**Decision rule if H3 fails:**
- If 100ms < latency < 500ms: Still better than flat (20-30s), document trade-off
- If latency > 500ms: Investigate:
  - Embedding computation bottleneck? → Cache or async
  - Merge algorithm too slow? → Optimize or reduce cluster count
- **If latency > 1s after optimization:** Acknowledge UX regression

---

### H4: Cost Comparable (Economics)

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

**Decision rule if H4 fails:**
- If 2x < cost < 3x: Document trade-off (quality/UX vs cost)
- If cost > 3x: Investigate:
  - Too many merge events? → Increase cluster limit
  - Summaries too verbose? → Tune prompts
- **If cost > 3x after tuning:** Acknowledge cost trade-off

---

## Decision Tree

### Scenario 1: All Hypotheses Pass (H1 ✅, H2 ✅, H3 ✅, H4 ✅)

**Outcome:** Prose-driven development validated for this case

**Action:**
1. Document results in RESULTS.md
2. Open PR to gemini-cli with evidence
3. Write blog post: "Prose-driven refactoring: A case study"
4. Acknowledge methodology worked for this specific case

**Claims we can make:**
- ✅ One-shot implementation succeeded
- ✅ Quality improved (recall +5pp)
- ✅ UX improved (non-blocking)
- ✅ Cost comparable

---

### Scenario 2: H1 Fails, Others Pass (Implementation Issues)

**Outcome:** Prose incomplete or LLM limitation

**Action:**
1. Document failure mode (what the LLM got wrong)
2. Refine specification based on failure
3. Retry (up to 3 iterations)
4. If still failing: Document as methodology limitation

**Claims we can make:**
- ❌ NOT "one-shot" (required iteration)
- ✅ Specification eventually converged (if succeeded after iteration)
- ✅ Prose-driven iterative development worked

**Honest reporting:**
- "Required N iterations to converge"
- "Common failure modes: [list]"
- "Prose ambiguities discovered: [list]"

---

### Scenario 3: H1 Passes, H2 Fails (Quality Regression)

**Outcome:** Implementation correct but quality poor

**Action:**
1. Investigate root cause (TF-IDF, threshold, summary quality)
2. Tune parameters or upgrade embeddings
3. Re-measure quality

**Claims we can make:**
- ✅ One-shot implementation succeeded
- ❌ Quality NOT better than baseline
- ⚠️ Document as "comparable quality, better UX" (if H3 passes)

**Honest reporting:**
- "Recall improvement not significant"
- "Trade-off: Better UX, comparable quality"

---

### Scenario 4: H1 Passes, H3 Fails (Performance Regression)

**Outcome:** Implementation correct but too slow

**Action:**
1. Profile bottlenecks (embedding, merge, retrieval)
2. Optimize hot paths
3. Re-measure latency

**Claims we can make:**
- ✅ One-shot implementation succeeded
- ❌ UX NOT better (still blocking or slow)
- ⚠️ Document as "better quality, comparable UX" (if H2 passes)

**Honest reporting:**
- "Append latency higher than expected"
- "Trade-off: Better quality, slower append"

---

### Scenario 5: H1 Passes, H4 Fails (Cost Explosion)

**Outcome:** Implementation correct but too expensive

**Action:**
1. Measure actual token costs (input + output)
2. Investigate why (too many merges? verbose summaries?)
3. Tune to reduce cost

**Claims we can make:**
- ✅ One-shot implementation succeeded
- ❌ Cost NOT comparable (>2x baseline)
- ⚠️ Document as premium feature for Pro users

**Honest reporting:**
- "Cost 2-3x higher than flat"
- "Trade-off: Better UX/quality, higher cost"
- "Suitable for users who prioritize quality"

---

### Scenario 6: Multiple Failures

**Outcome:** Implementation issues AND quality/performance/cost problems

**Action:**
1. Address H1 first (implementation correctness)
2. Then address H2/H3/H4 (quality/performance/cost)
3. Be transparent about all trade-offs

**Claims we can make:**
- ⚠️ Required iteration to converge
- ⚠️ Trade-offs documented honestly
- ✅ Methodology provided learning (even if hypothesis rejected)

**Honest reporting:**
- "Hypothesis partially validated"
- "Trade-offs: [list all]"
- "Lessons learned: [list]"

---

## Stopping Rules

### When to Stop Iterating (Give Up)

**Rule 1: Maximum Iterations**
- If H1 fails after **3 implementation iterations**, stop
- Document as: "Prose-driven one-shot failed, iterative approach required N+ iterations"

**Rule 2: Fundamental Trade-Off**
- If H2 AND H3 both fail after tuning, stop
- Document as: "Union-find does not improve quality or UX over baseline"

**Rule 3: Prohibitive Cost**
- If H4 shows cost >3x after optimization, stop
- Document as: "Union-find too expensive for general use"

**Rule 4: Implementation Impossibility**
- If implementation reveals specification is infeasible (architectural conflict, incompatible with gemini-cli), stop
- Document as: "Design incompatible with existing system"

---

## Data Collection Plan

### Implementation Attempt (H1)

**Data to collect:**
1. Prompt given to LLM (exact text)
2. Generated code (full implementation)
3. Test results (pass/fail for each test)
4. Compilation errors (if any)
5. Runtime errors (if any)
6. Manual fixes required (if any)

**Storage:** `experiment/iteration-N/` directory with:
- `prompt.md` - Exact prompt used
- `generated-code.ts` - LLM output
- `test-results.txt` - Test execution log
- `fixes.md` - Any manual corrections (with rationale)

---

### Quality Measurement (H2)

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

### Performance Measurement (H3)

**Benchmark:**
- 200-message conversation (append one by one)
- Measure latency for each append (hot vs cold)
- Track p50, p95, p99 latencies

**Storage:** `experiment/performance/`
- `latencies.csv` - Per-message append latency
- `analysis.md` - Latency distribution analysis

---

### Cost Measurement (H4)

**Token tracking:**
- Flat: Track input/output tokens for generate + verify calls
- Union-find: Track input/output tokens for all cluster merges
- Calculate total cost using Gemini 3 Pro pricing

**Storage:** `experiment/cost/`
- `flat-tokens.json` - Flat strategy token counts
- `union-find-tokens.json` - Union-find token counts
- `cost-comparison.md` - Cost analysis

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

1. **Hypothesis outcomes** (H1-H4: ✅ or ❌)
2. **Data summary** (recall, latency, cost measurements)
3. **Decision tree outcome** (which scenario occurred)
4. **Lessons learned** (what worked, what didn't)
5. **Methodology assessment** (did prose-driven development work?)
6. **Limitations and caveats** (honest about trade-offs)

**Commit both PREREGISTRATION.md and RESULTS.md to git** - timestamp verifiable.

---

## Notes

This preregistration establishes scientific rigor for an engineering experiment. The goal is credibility: readers can verify we didn't massage results or change criteria post-hoc.

**Why this matters:**
- Bold claim: "prose can one-shot complex refactoring"
- Easy to be accused of cherry-picking or HARKing
- Preregistration demonstrates intellectual honesty

**What success looks like:**
- Not "everything worked perfectly"
- But "we followed the process honestly and documented what we learned"

---

**End of preregistration. Do not modify after implementation begins.**
