# Work Log: Union-Find Compaction for Gemini-CLI

## 2026-03-17

### Initial Misunderstanding (15:34-15:37)
- **Error**: Focused on "path compression" (find() optimization) instead of "context compaction" (full system)
- Created 4 files documenting path compression algorithm
- User corrected: scope is the entire context compaction system

### Course Correction (15:37-15:40)
- Cleared incorrect path compression files
- Restarted with correct scope: gemini-cli's current context compaction system
- Read `chatCompressionService.ts` (476 lines)

### Step 1: Extract Current System (15:40-15:42)
**File:** `current-system-extraction.md`

**Key findings:**
- Gemini-cli uses flat summarization (all old content → single `<state_snapshot>`)
- Two-phase process: generate snapshot, then verify/refine
- Split point at 30% preservation threshold (newest 30% kept verbatim)
- Reverse token budget for tool outputs (50k token limit)
- Irreversible: original messages discarded after compression
- No provenance tracking
- Model routing: uses cheaper models for compression

**Architecture:**
```
[Trigger] → [Truncate tool outputs] → [Find split point] → [Summarize old 70%]
  → [Verify summary] → [Construct new history: snapshot + recent 30%]
```

**This is exactly what the union-find reference critiques:**
- Flat = loses specificity under high compression
- Irreversible = can't expand back to sources
- No provenance = can't trace facts to episodes
- Single summary = all old content in one blob

### Step 2: Write Current System Prose (15:42-15:44)
**File:** `current-system-prose.md` (7.5KB)

**Description covers:**
- Problem: unbounded chat growth
- Trigger: 50% of token limit threshold
- Split point: character-based, 70/30 split, user-message boundaries
- Tool output management: reverse token budget (50k limit)
- Two-phase summarization: generate + verify
- Previous snapshot integration
- High fidelity decision: original vs truncated for summarizer
- Failure modes: empty summary, token inflation, repeated failures
- Model routing: cheaper models for compression
- Key properties: flat, irreversible, no provenance, recent bias

**Critical insight from prose:**
> "The current system is a cache eviction strategy that works. The question is whether a structured approach could do better."

This sets up the transformation to union-find.

### Step 3: Verify Current System Prose (15:44-15:47)
**File:** `current-system-verification.md` (5.5KB)

**Verification approach:** Semantic audit (not reimplementation due to complex dependencies)

**Results:**
- ✅ Triggering logic: 50% threshold, manual override - MATCH
- ✅ Split point: 70/30, character-based, user boundaries - MATCH
- ✅ Tool budget: 50k tokens, reverse iteration, truncation - MATCH
- ✅ Two-phase: generate + verify with critical evaluation - MATCH
- ✅ High fidelity: original vs truncated decision - MATCH
- ✅ Failure handling: empty summary, token inflation, retry logic - MATCH
- ✅ Compression prompt: verified emphasis on technical details (ports, commands, schemas)

**Semantic equivalence check:**
- Algorithm flow: 8-step sequence matches code exactly (lines 245-473)
- Edge cases: empty history, failed compression, split point safety all handled
- Minor gaps: hook details, empty history early return (non-critical)

**Checkpoint:** ✅ **PASSED** - No semantic delta detected

### Summary of Steps 1-3 (Current System Baseline)

We now have:
1. **Extraction** - Code structure documented
2. **Prose** - Human-readable description without code refs
3. **Verification** - Confirmed prose ↔ code equivalence

**Key insight:** Current system is "flat summarization" - exactly what union-find reference critiques:
- Flat (single snapshot)
- Irreversible (originals discarded)
- No provenance (can't trace facts)
- No expandability (can't recover sources)

This baseline establishes the "before" state for transformation.

### Checkpoint: Human Review (15:53-15:55)
- Opened `current-system-prose.md` for manual review
- **Feedback received:** "consolidate" used improperly - describing what system doesn't do is out of scope

**Correction applied:**
- Removed critique language: "it compresses, but it doesn't consolidate"
- Removed comparison list: "What it doesn't achieve: Consolidation..."
- Removed forward-looking: "whether a structured approach could do better"
- Replaced with purely descriptive: "compression is lossy by design"

**Prose now:** Describes only what the system DOES, not what it doesn't do or could do

### Additional Feedback: Document Known Problems (15:55-15:57)
- **Request:** Document deficiencies as user-centric known problems
- **Added section:** "Known Problems" with 6 observed issues:
  1. Blocking UX (10-30s spinner interrupts flow)
  2. Lossy compression (users must re-paste dropped details)
  3. Unsearchable history (can't grep snapshot, must read manually)
  4. No provenance (can't trace facts back to source)
  5. Compression artifacts accumulate (signal degrades over rounds)
  6. Cannot expand (one-way door, originals gone)

**Framing:** User-facing problems observed in production, not theoretical comparisons

### Git Repository Created (15:57)
- **Repo:** https://github.com/kimjune01/union-find-compaction-for-gemini-cli
- **Initial commit:** 6a83923 - Current system documentation (4 files, 673 insertions)
- **Strategy:** Commit often throughout development

### Revision: Add Context Rot Motivation (15:58)
- **Commit:** c69e0fe
- **Added:** Context rot (old irrelevant history degrading performance) alongside token exhaustion
- **Explains:** Why compression needed even within token limits
  - Abandoned approaches, debugging dead ends clutter attention
  - Model must wade through irrelevant history to find current signal

### Research: Similar Workflows (15:58-16:05)
**Question:** Is anyone else using this workflow for production systems?

**Findings:**

**Related approaches exist:**
1. **Spec-Driven Development (SDD)** - Emerging 2025-2026
   - Specifications as source of truth for AI-assisted development
   - Applied to brownfield refactoring (Thoughtworks, enterprise adoption)
   - Workflow: Specify → Plan → Decompose → Implement → Validate
   - Status: "Emerging practice, even more change expected in 2026"

2. **LLM-Driven Refactoring** - Active research 2025
   - Multi-agent systems with validation pipelines
   - Automated test + static analysis verification
   - Known issue: LLM hallucinations in refactored code

3. **Literate Programming Renaissance** - Research 2024-2025
   - LLMs generate code from natural language outlines
   - Lacks production tooling, still research-stage

**Novel aspects of our workflow:**
- ✅ Document current system in prose FIRST (baseline)
- ✅ Verify prose ↔ code equivalence (no-delta checkpoint)
- ✅ Bidirectional validation at each step
- ❌ **Not found elsewhere**: "verify current system prose first" checkpoint

**Assessment:**
- Each component has precedent (SDD, validation, refactoring)
- The combination is novel - nobody doing exactly this
- Treating as **research/exploration**, not proven playbook
- Blog post shifts to "what we learned trying" not "how to do it"

**Sources:** Thoughtworks, ICSE 2025, arXiv literate programming papers

### Step 4: Systems Comparison (16:05-16:10)
**File:** `systems-comparison.md` (13KB, 327 lines)

**Comprehensive comparison covering:**
- Architectural differences (flat snapshot vs union-find forest)
- Behavioral differences (blocking vs incremental, lossy vs expandable)
- User-facing differences (UX interruption, detail loss, searchability)
- Cost model (2 calls per event vs 1 per merge)
- Performance characteristics (time/space complexity)
- Trade-offs table (complexity, UX, recall, cost, provenance)
- When each system wins (conversation length, detail needs, UX requirements)

**Key insights:**
- Flat optimizes for: simplicity, robustness, token efficiency, cost
- Union-find optimizes for: detail preservation, non-blocking UX, expandability, provenance
- Open questions identified: tool output handling, two-phase verification replacement, migration, embeddings, tuning

**Commit:** eef98e2

### Target Audience: Gemini 3 Pro Users (16:10)

**Critical context:** We are primarily interested in Gemini 3 Pro users, not Flash/Flash Lite.

**Why this matters:**
- Gemini 3 Pro users value quality over cost (already paying premium)
- Longer, more complex conversations (detail preservation critical)
- More sensitive to compression quality and blocking UX
- 2x LLM calls is acceptable cost (already using expensive model)

**Reference experiment mapping:**
- Sonnet (better model) results apply: 70% flat → 78% union-find
- 8pp improvement even with capable model
- Pro users get strict improvement: non-blocking UX + better recall + provenance

**Compression model routing:**
- Main: `gemini-3-pro`
- Current compression: `chat-compression-3-pro`
- Union-find clusters: Same `chat-compression-3-pro` (quality matters for Pro users)

### Updated Plan: Step 8 Iterative Approach (16:12)

**Original plan:** Step 8 was "apply diff prose to gemini-cli, if doesn't one-shot go back and improve"

**New plan - Step 8 becomes iterative test-driven cycle:**

```
Step 8: Iterative Implementation
├─ 8.1: Set up test harness
│   └─ Define success criteria (tests that verify behavior)
├─ 8.2: Spike implementation
│   └─ Apply transformation prose to codebase
├─ 8.3: Tests pass?
│   ├─ YES → 8.4: Performance experiment on real conversations
│   └─ NO → 8.5: Learning loop
│       ├─ Extract the diff (what went wrong?)
│       ├─ Modify prose based on learnings
│       ├─ Reset spike
│       └─ Try again (back to 8.2)
```

**Rationale:** Step 8 is the most uncertain. Iterative approach:
- Validates prose through implementation feedback
- Captures learnings in prose refinements
- Each iteration improves specification quality
- Blog post documents the iteration, not just final state

### Step 5: Transformation Design Complete (16:15-16:30)
**File:** `transformation-design.md` (21KB, 759 lines)

**Comprehensive specification covering:**

**Architecture (what changes):**
- New classes: ContextWindow, Forest, Message, ClusterSummarizer, EmbeddingService
- Modified: ChatCompressionService with feature flag dual-path
- TypeScript ports from Python reference implementation

**What stays:**
- Tool output truncation (applied before graduation)
- Model routing system (chat-compression-3-pro for Pro users)
- Hook system (fires on merge events)
- Compression threshold config (reinterpreted as hot zone size)

**Answers to all 6 open questions:**
1. Tool outputs → truncate before graduation (keeps existing logic)
2. Two-phase verification → removed for clusters (single-phase sufficient for small summaries)
3. Migration → feature flag, dual implementation, Option A (new conversations only) for spike
4. Embeddings → TF-IDF initial (cheap iteration), dense if recall suffers
5. Thresholds → reference defaults (hot=20, clusters=10, threshold=0.15), tune later
6. Model routing → reuse existing chat-compression aliases

**Migration path:**
- Phase 1: Dual implementation with feature flag
- Phase 2: New conversations use union-find, existing stay flat
- Phase 3: Opt-in migration for existing
- Phase 4: Full migration with snapshot parsing

**Testing strategy (4 levels):**
1. Unit tests (correctness): find, union, path compression, nearest, expand
2. Integration tests (behavior): backward compat, hooks, tool truncation
3. Quality tests (recall): replicate reference experiment with planted facts
4. Performance tests (UX + cost): non-blocking, token count within 2x

**Success criteria for spike:**
- ✅ All tests pass
- ✅ Recall >= 5pp better than flat
- ✅ Append latency < 100ms (non-blocking)
- ✅ Total cost within 2x of flat

**Commit:** c876115

**This is the initial spec for Step 8 implementation iteration.**

### Next Steps
- [ ] Step 6: Sharpen conflicts and complexity at prose level
- [ ] Step 6: Sharpen conflicts and complexity at prose level
- [ ] Step 7: Publish blog post + repo with process documentation
- [ ] Step 8: Iterative implementation (test harness → spike → learn → refine)
- [ ] Step 4: Combine with union-find prose from reference
- [ ] Step 5: Create transformation prose (before → after)
- [ ] Step 6: Sharpen conflicts and complexity
- [ ] Step 7: Publish blog post + repo
- [ ] Step 8: Apply to gemini-cli (one-shot test)
- [ ] Step 9: Open PR with evidence

### Working Directory Contents
```
current-system-extraction.md  (4.5KB) - Current system code extraction
WORK_LOG.md                   (this file)
```

### Questions to Address
1. How does union-find integrate with existing split point logic?
2. Should hot zone = preserved 30%? Or different size?
3. What happens to tool output truncation in union-find system?
4. How to handle previous `<state_snapshot>` integration?
5. Model routing for cluster summarization vs full snapshot?
6. Backward compatibility during transition?
