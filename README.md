# Union-Find Context Compaction for Gemini-CLI

Transforming context compression from flat summarization to structured compaction with provenance.

## Why This Matters

Gemini 3 Pro users experience three core problems with current flat summarization:

1. **Blocking UX**: 20-30 second spinner interrupts flow during compression
2. **Lost details**: Specific technical values (ports, paths, thresholds) get dropped under compression pressure
3. **No recovery**: Once summarized, original messages are gone—can't expand when more detail is needed

**Union-find compaction solves all three:**

- ✅ **Non-blocking**: Compression happens incrementally per message (no spinner)
- ✅ **Better recall**: Per-cluster summaries preserve 8pp more detail (70% → 78% validated experimentally)
- ✅ **Expandable**: Can retrieve original messages from clusters when needed
- ✅ **Provenance**: Trace facts back to source messages
- ✅ **Cross-session memory**: Clusters persist, enabling long-term learning

**Cost**: Comparable to current compression (not 2x—see [cost analysis](systems-comparison.md#cost-model))

## Builds on Existing Work

This is **not a replacement** of gemini-cli's compression system—it's an **extension** that:

- ✅ Preserves backward compatibility (existing `<state_snapshot>` conversations continue working)
- ✅ Reuses model routing, tool output truncation, hook system
- ✅ Implements as feature flag (gradual rollout, can revert)
- ✅ Based on [published research](https://arxiv.org/abs/2408.04820) and experimental validation

**Migration path**: New conversations use union-find, existing stay on flat (safe, no forced migration).

## Try It Yourself

**Can prose specification actually one-shot a complex implementation?**

This repo documents a novel workflow: rigorous prose-driven development with bidirectional validation. We claim the transformation design in this repo can be implemented correctly by an LLM from prose alone.

**Verify it with Gemini 3 Pro:**

1. Clone this repo
2. Read [transformation-design.md](transformation-design.md)
3. Give it to Gemini 3 Pro: "Implement this transformation in TypeScript"
4. Run the test harness (see [REPRODUCE.md](REPRODUCE.md))
5. Observe: Does it one-shot? Do tests pass?

**Expected outcome:** Implementation matches spec, tests validate behavior, recall improves.

If it works, you've verified the workflow. If it doesn't, the diff shows where prose was incomplete—and we iterate.

## Review at Your Level of Abstraction

Choose how deep you want to go:

| If you want to... | Look here |
|-------------------|-----------|
| **1-page summary** | ↑ README above (you are here) |
| **Review the code** | [PR #XXX](https://github.com/google/gemini-cli/pull/XXX) - TypeScript implementation |
| **Review the spec** | [transformation-design.md](transformation-design.md) - Complete transformation |
| **Understand the why** | [systems-comparison.md](systems-comparison.md) - Flat vs Union-Find |
| **See the process** | [WORK_LOG.md](WORK_LOG.md) - Development timeline, iterations |
| **Verify it works** | [REPRODUCE.md](REPRODUCE.md) - Try it yourself with Gemini 3 Pro |
| **Performance data** | [Experimental validation](systems-comparison.md#experimental-validation) - Recall metrics |
| **Testing strategy** | [transformation-design.md §Testing](transformation-design.md#testing-strategy) - 4-level test harness |
| **Migration safety** | [transformation-design.md §Migration](transformation-design.md#migration-path-detail) - Backward compat |
| **Cost analysis** | [systems-comparison.md §Cost Model](systems-comparison.md#cost-model) - Comparable, not 2x |

## What's Different About This Approach

**Traditional refactoring**: Write code → hope tests catch mistakes → iterate through debugging

**Prose-driven refactoring**: Write rigorous spec → validate with LLM implementation → iterate through spec refinement

**Advantages:**
- Specification is reviewable (easier than reviewing 5000 lines of TypeScript)
- Mistakes caught in prose before code (cheaper to fix)
- Process is reproducible (anyone with Gemini 3 Pro can verify)
- Documentation is the spec (stays in sync by construction)

**See [WORK_LOG.md](WORK_LOG.md)** for how this process evolved through checkpoints and iteration.

## Quick Architecture Overview

**Current (Flat Summarization):**
```
[All old messages] → Single LLM call (generate) → Second LLM call (verify)
  → One <state_snapshot> + Recent 30% verbatim
```

**Target (Union-Find Compaction):**
```
[Hot zone: Recent 20 messages, verbatim, never touched]
[Cold zone: Older messages → Clusters → Per-cluster summaries]

On each message:
  → Append to hot
  → If hot overflows → Graduate oldest to cold
  → Merge into nearest cluster (or create singleton)
  → If cold > 10 clusters → Merge closest pair
  → Render: Retrieve relevant clusters + all hot
```

**Key differences:**
- Incremental (per message) vs batch (per compression event)
- Non-blocking vs 20-30s spinner
- Multiple cluster summaries vs single snapshot
- Originals retained (expandable) vs discarded (irreversible)

**See [systems-comparison.md](systems-comparison.md) for detailed architectural comparison.**

## Status

**Current:** Specification complete, ready for implementation iteration

**Next steps:**
1. Set up test harness (unit, integration, quality, performance)
2. Spike implementation from transformation spec
3. Tests pass? → Performance validation
4. Tests fail? → Refine spec based on learnings, retry

**Expected:** 2-3 iterations to convergence (spec evolves, implementation validates)

## References

- **Experimental validation**: [Union-Find Context Compaction](https://github.com/[reference-repo]) - Research prototype with recall experiments
- **Literate programming revival**: [Natural Language Outlines for Code (arXiv 2024)](https://arxiv.org/abs/2408.04820)
- **Spec-driven development**: [Thoughtworks 2025 Engineering Practices](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)

## License

**Dual licensing** to protect methodology while enabling friction-free implementation:

- **Specification and documentation** (all `.md` files): [CC BY-SA 4.0](LICENSE-SPEC.md)
  - Ensures derived methodologies remain open and improvements flow back to the community
  - Attribution and share-alike required for derived specifications

- **Code implementations**: [Apache 2.0](LICENSE-CODE.md)
  - Matches gemini-cli's license (no integration friction)
  - Permissive for commercial use, clear patent grant

**Why dual licensing?** The CC BY-SA protects the *methodology* (derived specs must be shared), while Apache 2.0 keeps *implementations* permissive (matches gemini-cli, no barriers to adoption).

## Contributing

This is a proposed transformation for gemini-cli. Discussion welcome:

- **Questions about the approach?** Open an issue
- **Found spec ambiguity?** That's valuable—helps us refine the prose
- **Tried reproducing and it failed?** Share the diff—that's how we improve

The goal is to validate (or invalidate) prose-driven development as a methodology. Honest feedback—especially failures—helps everyone learn.
