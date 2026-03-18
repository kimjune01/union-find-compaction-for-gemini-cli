# Reproducing the One-Shot Implementation

This guide helps you verify the central claim: **rigorous prose specification can one-shot a complex implementation with an LLM.**

## Prerequisites

**Required:**
- Access to Gemini 3 Pro (or equivalent capable model)
- Local gemini-cli repository clone
- TypeScript development environment (Node.js 18+, pnpm)

**Time estimate:** 2-3 hours (mostly LLM generation + test runs)

## Quick Start

If you just want to see if it works:

```bash
# 1. Clone this repo
git clone https://github.com/kimjune01/union-find-compaction-for-gemini-cli.git
cd union-find-compaction-for-gemini-cli

# 2. Clone gemini-cli (if you don't have it)
git clone https://github.com/google/gemini-cli.git ../gemini-cli
cd ../gemini-cli
git checkout main  # or specific commit SHA if provided

# 3. Set up test harness (TBD - see Step 8.1)
# This will be added when test harness is implemented

# 4. Run baseline tests with current flat compression
pnpm test  # All should pass

# 5. Now apply the transformation (see below)
```

## Full Reproduction Steps

### Step 1: Read the Specification

**What to do:**
1. Read [transformation-design.md](transformation-design.md) completely
2. Note the architecture, interfaces, algorithms, and testing strategy
3. Optionally read [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md) for rationale

**What to look for:**
- Is the spec unambiguous? (Can you understand what to build?)
- Are there missing details? (Note them for later comparison)
- Does it seem complete enough for implementation?

### Step 2: Prepare Your LLM Session

**Recommended prompt for Gemini 3 Pro:**

```
I have a rigorous specification for transforming gemini-cli's context
compression system from flat summarization to union-find structured
compaction.

The specification is in transformation-design.md (attached).

Your task:
1. Implement this transformation in TypeScript
2. Follow the spec exactly as written
3. Preserve backward compatibility (feature flag dual-path)
4. Match the interfaces, algorithms, and behavior described
5. Ask clarifying questions if the spec is ambiguous

Repository structure:
- packages/core/src/services/chatCompressionService.ts (existing)
- New files: contextWindow.ts, forest.ts, message.ts, embeddings.ts, summarizer.ts

Start by creating the new classes, then integrate into chatCompressionService.ts
with a feature flag.
```

**Attach:**
- transformation-design.md
- DESIGN_DECISIONS.md (optional, for context)
- Relevant gemini-cli files (chatCompressionService.ts, etc.)

### Step 3: Let It Generate

**What to do:**
1. Let the LLM generate the implementation
2. **Don't guide or correct** (we're testing one-shot capability)
3. Save all generated files

**What to observe:**
- Does it ask clarifying questions? (Note: spec ambiguities)
- Does it generate plausible TypeScript?
- Does it follow the feature flag dual-path pattern?
- Does it implement the core algorithms (find, union, nearest, expand)?

### Step 4: Run the Test Harness

**Unit tests:**
```bash
# Test union-find mechanics
pnpm test forest.test.ts

# Expected: find(), union(), path compression work correctly
```

**Integration tests:**
```bash
# Test context window behavior
pnpm test contextWindow.test.ts

# Expected: hot/cold graduation, merge triggering, retrieval
```

**Quality tests (recall):**
```bash
# Test recall with planted facts
pnpm test recall.test.ts

# Expected: Union-find >= 5pp better than flat
```

**Performance tests:**
```bash
# Test non-blocking behavior and cost
pnpm test performance.test.ts

# Expected: Append < 100ms, total cost within 2x of flat
```

### Step 5: Record Results

**If tests pass:**
- ✅ One-shot claim validated
- Note: How many files generated? How many lines?
- Note: Did it match the spec exactly or deviate?
- Share: Post success story (GitHub issue, blog comment, etc.)

**If tests fail:**
- ❌ Note the failure mode:
  - Compilation error? (Spec missed type details)
  - Logic error? (Spec ambiguous about algorithm)
  - Integration error? (Spec unclear about interfaces)
  - Test failure? (Spec wrong about behavior)
- Extract the diff: What did LLM misunderstand?
- Share: This helps refine the prose (that's the point!)

## Measuring Success

### Baseline Metrics (What to Compare)

**Before transformation (flat):**
```bash
# Measure baseline recall
pnpm test recall.test.ts -- --baseline

# Measure baseline cost
pnpm test performance.test.ts -- --baseline

# Measure baseline UX (blocking time)
# Expected: 10-30s spinner during compression
```

**After transformation (union-find):**
```bash
# Measure union-find recall
pnpm test recall.test.ts -- --union-find

# Measure union-find cost
pnpm test performance.test.ts -- --union-find

# Measure UX (non-blocking)
# Expected: No spinner, < 100ms per append
```

### Statistical Validation

**Recall comparison (McNemar's test):**
```bash
# Compare flat vs union-find on same dataset
pnpm test recall.test.ts -- --compare

# Expected output:
# Flat recall: 70%
# Union-find recall: 78%
# McNemar p-value: < 0.05 (statistically significant)
```

**Cost comparison:**
```bash
# Measure total tokens (input + output) for 200-message conversation
pnpm test performance.test.ts -- --cost-analysis

# Expected:
# Flat: ~380 message-equivalents per compression event
# Union-find: ~200-400 message-equivalents amortized
# Conclusion: Comparable cost
```

## Advanced: Iterate the Spec

If tests fail, you can iterate the specification:

### Iteration Loop (Step 8.5 from plan)

1. **Extract the diff**: What went wrong? (Type errors, logic bugs, etc.)
2. **Identify root cause**: Was spec ambiguous? Missing detail? Wrong assumption?
3. **Update prose**: Clarify ambiguity, add missing detail, fix assumption
4. **Reset spike**: Discard generated code, start fresh
5. **Try again**: Re-run Step 3 with updated spec

**Document learnings:**
- Open GitHub issue describing the failure mode
- Suggest spec improvement (we'll integrate feedback)
- This validates the workflow: prose evolves through iteration

## Reporting Results

### Success Case

**What to share:**
- ✅ "One-shot worked! Tests passed."
- Generated file count and LOC
- Any deviations from spec (even if tests passed)
- Time taken (LLM generation + test runs)

**Where to share:**
- GitHub issue: "Reproduction: Success on [date]"
- Optional: Blog post, Twitter thread, etc.

### Failure Case

**What to share:**
- ❌ "One-shot failed at [step]"
- Failure mode (compilation, logic, integration, tests)
- Spec ambiguity or missing detail identified
- Suggested spec improvement

**Where to share:**
- GitHub issue: "Reproduction: Failed at [step]"
- Include error messages, diffs, analysis
- **This is valuable feedback** - helps everyone learn

## FAQ

### Q: What if I don't have Gemini 3 Pro?

**A:** Try with another capable model (GPT-4, Claude Opus 4.6, etc.). Document which model you used. Results may vary—that's interesting data!

### Q: What if the spec seems incomplete?

**A:** That's a finding! Note where it's incomplete, try anyway, see what happens. Report the gap.

### Q: Can I guide the LLM during generation?

**A:** For pure one-shot validation, no. But if you're iterating the spec (Step 8.5), yes—just document that it wasn't one-shot.

### Q: What if tests don't exist yet?

**A:** You're early! Check back after Step 8.1 (test harness setup). Or help build the test harness—see [CONTRIBUTING.md](CONTRIBUTING.md).

### Q: What if I find a bug in the spec?

**A:** Perfect! Open a GitHub issue. Specs improve through validation attempts.

### Q: Can I use this for my own refactoring?

**A:** Absolutely! This workflow is the experiment. Try it on your codebase, share what you learn.

## Expected Outcomes

### Optimistic Case (One-Shot Works)

- LLM generates ~5 new files (~1000 LOC total)
- All tests pass on first try
- Recall improves by 5-8pp
- Cost comparable to flat
- UX is non-blocking

**This validates:** Rigorous prose can one-shot complex refactoring

### Realistic Case (1-2 Iterations)

- First attempt: 70% correct, some type errors or logic bugs
- Spec refinement: Clarify 2-3 ambiguities
- Second attempt: Tests pass
- Total time: 3-4 hours

**This validates:** Prose-driven development works with iteration

### Pessimistic Case (Many Iterations)

- Multiple failures, spec has fundamental gaps
- Requires 5+ iterations to converge
- Total time: 1-2 days

**This teaches:** Where prose-driven development struggles (complex integration? Algorithm details? etc.)

**All outcomes are valuable.** We're validating a methodology, not selling a product.

## Next Steps After Reproduction

1. **Report results** (GitHub issue)
2. **If successful:** Consider contributing to gemini-cli PR
3. **If failed:** Help improve the spec
4. **Either way:** Share what you learned (blog, talk, etc.)

The goal is to validate or invalidate prose-driven refactoring. Honest feedback—especially failures—advances the field.

## References

- **Spec-Driven Development (SDD)**: [Thoughtworks 2025](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)
- **Literate Programming Revival**: [arXiv 2024](https://arxiv.org/abs/2408.04820)
- **Union-Find Reference Experiment**: [GitHub repo](https://github.com/[reference-repo]) - Original validation

## Support

**Questions?** Open a GitHub issue with the tag `[reproduction]`

**Stuck?** Check existing reproduction issues—someone may have hit the same problem

**Want to help?** Build test harness, improve spec, document edge cases
