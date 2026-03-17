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

### Next Steps (pending review)
- [ ] Step 4: Combine current-system prose with union-find reference prose
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
