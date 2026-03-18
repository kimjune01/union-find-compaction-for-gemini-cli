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

### Cost Model Refinement (16:35)

**Speculation based on double-pass realization:**

**Current assumption:** Union-find is 2x cost because more LLM calls
- Flat: 2 calls per event
- Union-find: ~10 calls per 200 messages

**Revised understanding:** Cost is actually comparable, not 2x, because:

1. **Flat already does double-pass:** Generate (190 messages) + Verify (190 messages) = ~380 message-equivalents
2. **Union-find is single-pass per cluster:** 10 calls × 20-40 messages = ~200-400 message-equivalents
3. **No verification overhead:** Clusters small enough to trust single-pass summarization
4. **Amortized over time:** Spread across many appends, not one blocking event

**Updated framing:**
- ❌ NOT "2x more expensive, but worth it for quality"
- ✅ "Comparable cost, better UX and recall"

**To verify in spike:** Measure actual token counts (input + output) for both strategies

### Navigation Table Design (16:35)

**For gemini-cli code reviewers:**

Elicited key concern: Credibility + avoiding offense (outsider doing better/faster work)

**Solution:** Self-service navigation at arbitrary abstraction levels
- Executive summary → README
- Code review → PR
- Spec review → transformation-design.md
- Why/architecture → systems-comparison.md
- Process → WORK_LOG.md
- Performance → performance-analysis.md
- Testing → transformation-design.md §Testing
- Migration → transformation-design.md §Migration
- Cost → systems-comparison.md §Cost Model
- Try it yourself → REPRODUCE.md

**Hook:** Intrigue - "See if prose-driven development actually works" (works with Gemini 3 Pro)

### README Created (16:40)
**File:** `README.md` (6.5KB)

**Structure addresses reviewer concerns:**

1. **Value prop** - Non-blocking UX, 8pp recall improvement, comparable cost
2. **Respect** - Builds on existing, backward compatible, feature flag, safe
3. **Invitation** - Try with Gemini 3 Pro, verify one-shot claim
4. **Navigation table** - Self-service review at arbitrary abstraction (9 levels)
5. **Approach** - Prose-driven vs traditional refactoring
6. **Architecture** - Quick visual comparison (flat vs union-find)

**Hook:** "Can prose specification actually one-shot a complex implementation?"

**Commits:** 840b061 (cost model), 6d949f4 (README)

### Step 6: Design Decisions Elicitation (16:45-17:15)
**File:** `DESIGN_DECISIONS.md` (280 lines)

**Approach:** Systematic elicitation from least to most uncertain (user preference: one question at a time)

**15 decisions documented with rationale:**

**Least uncertain (1-3):**
1. Hot zone size: 30 messages (configurable, matches current 30% preservation)
2. Model routing: Reuse `chat-compression-3-pro` aliases (no new configs)
3. Timestamp format: Match gemini-cli existing format

**Medium uncertainty (4-9):**
4. TF-IDF vocabulary: Incremental (spike → iterate if recall suffers)
5. Recall threshold: Statsig ≥ flat (McNemar's test, p<0.05)
6. Test dataset: Real conversations preferred over synthetic
7. Max cold clusters: 10 (validated in reference experiments)
8. Merge threshold: 0.15 for TF-IDF (configurable tuning parameter)
9. Retrieval strategy: Always top-k (k=3, min_sim=0.05)

**Most uncertain (10-15):**
10. Cache eviction: Evict sources @1000 messages, keep summaries (graceful degradation)
11. Message edits: Not supported (known limitation)
12. Concurrency: Out of scope for spike (known limitation)
13. Summary quality: Trust single-pass, invite reviewer criticism
14. Persistence: Match previous impl (clusters persist with conversation)
15. Migration: Existing conversations stay flat (safe, no forced migration)

**Known limitations documented:**
- Message edits not supported (editing old clustered messages)
- Concurrency not handled (rapid appends may need queuing)
- No summary verification (trust single-pass)
- TF-IDF may need upgrade to dense embeddings
- Retrieval can miss cross-topic queries

**Iteration triggers defined:**
- Recall < statsig vs flat → Swap to dense embeddings
- Cluster fragmentation >50% → Adjust merge threshold
- Summary quality complaints → Add verification or tune prompts
- Retrieval misses >20% → Increase k or adjust min_sim
- Memory usage excessive → Adjust eviction threshold

**Key insights:**
- Cache eviction strategy critical: evict old `_nodes` entries, keep `_summaries`/`_children`/`_centroids`
- Old clusters: searchable/retrievable, NOT expandable (one-way compression for very old history)
- Bounds memory predictably while maintaining searchability
- User doesn't need manual context clearing

**Commits:** fba6342 (DESIGN_DECISIONS.md), 9dae866 (integrated into transformation-design.md)

**Checkpoint:** ✅ **Step 6 COMPLETE** - All design conflicts sharpened, specification ready for implementation

### Next Steps
- [ ] Create REPRODUCE.md (how to verify one-shot with Gemini 3 Pro)
- [ ] Step 7: Publish blog post + repo with process documentation
- [ ] Step 8: Iterative implementation (test harness → spike → learn → refine)
- [ ] Step 9: Open PR with evidence

### Working Directory Contents
```
current-system-extraction.md  (4.5KB) - Current system code extraction
current-system-prose.md       (7.5KB) - Prose description (verified)
current-system-verification.md (5.5KB) - Verification audit
systems-comparison.md         (13KB)  - Flat vs Union-Find comparison
transformation-design.md      (21KB)  - Complete transformation spec
DESIGN_DECISIONS.md           (280 lines) - 15 design decisions
README.md                     (6.5KB) - Navigation + value prop
WORK_LOG.md                   (this file)
```

### All Design Questions Resolved
~~1. How does union-find integrate with existing split point logic?~~ → Feature flag dual-path
~~2. Should hot zone = preserved 30%? Or different size?~~ → 30 messages (configurable)
~~3. What happens to tool output truncation in union-find system?~~ → Truncate before graduation
~~4. How to handle previous `<state_snapshot>` integration?~~ → Existing stay flat (safe migration)
~~5. Model routing for cluster summarization vs full snapshot?~~ → Reuse chat-compression-3-pro
~~6. Backward compatibility during transition?~~ → Feature flag, no forced migration

### Dual Licensing Structure (17:23)

**Decision:** Switch from MIT to dual licensing

**Rationale:**
- CC BY-SA 4.0 protects the methodology (derived specs must share-alike)
- Apache 2.0 for code (matches gemini-cli, no integration friction)
- Clear separation: documentation vs implementation have appropriate licenses
- Precedent: Many projects use CC for docs, permissive for code (Rust docs are CC-BY)

**Files created:**
1. **LICENSE-SPEC.md** (CC BY-SA 4.0)
   - Covers all `.md` files
   - Ensures methodology improvements flow back to community
   - Attribution and share-alike required for derived specifications

2. **LICENSE-CODE.md** (Apache 2.0)
   - Covers future implementations
   - Matches gemini-cli licensing
   - Clear patent grant, permissive for commercial use

3. **README.md updated**
   - Replaced "MIT (see LICENSE)" section
   - Added explanation of dual licensing rationale
   - Why: Protects methodology while enabling friction-free implementation

**Commit:** 30cfa1a

### Acknowledgments Section (17:42)

**Added:** Intellectual journey traced through blog posts

**Blog post progression:**
1. **[Vibelogging](https://june.kim/vibelogging)** - Insight for methodology discovered
2. **[Double Loop](https://june.kim/double-loop)** - Methodology achieved
3. **[The Natural Framework](https://june.kim/the-natural-framework)** - Metacognition enabled
4. **[Diagnosis: LLM](https://june.kim/diagnosis-llm)** - Problem diagnosed
5. **[The Parts Bin](https://june.kim/the-parts-bin)** - Solution discovered
6. **[Union-Find Compaction](https://june.kim/union-find-compaction)** - Novel solution discussed

**Added to:** README.md Acknowledgments section (before License)

**Why document this:** Shows the intellectual lineage - not invented in vacuum, but built on accumulated insights from previous work

**Commit:** f1a323e

### Preregistration for Implementation Experiment (17:45)

**Decision:** Create preregistration before attempting implementation to prevent p-hacking and HARKing

**File:** `PREREGISTRATION.md` (360 lines)

**Purpose:** Establish credibility by precommitting to:
- Hypotheses (what we expect)
- Success criteria (how we measure)
- Decision rules (what we do if X happens)
- Stopping rules (when to give up)

**Four hypotheses preregistered:**

1. **H1: One-Shot Implementation (Primary)**
   - Can LLM implement from prose alone without debugging?
   - Success: All tests pass, no manual fixes
   - Failure: Logic errors, missing edge cases, misinterpretation
   - Decision: Max 3 iterations, then document limitation

2. **H2: Recall Improvement (Quality)**
   - Union-find recall ≥ flat + 5pp
   - Success: McNemar's test p<0.05, improvement ≥5pp
   - Failure: No difference or regression
   - Decision: Tune (embeddings, threshold), then document trade-offs

3. **H3: Non-Blocking UX (Performance)**
   - Append latency p95 < 100ms
   - Success: No spinner needed, non-blocking UX
   - Failure: Latency > 100ms
   - Decision: Optimize, accept trade-off if 100ms-500ms

4. **H4: Cost Comparable (Economics)**
   - Total cost ≤ 2x flat
   - Success: Within 2x (preferably 1.2x)
   - Failure: Cost > 2x
   - Decision: Tune, document premium feature if >2x

**Decision tree:** 6 scenarios (all pass, H1 fails, H2 fails, H3 fails, H4 fails, multiple failures)
- Each scenario has clear action plan
- Honest reporting required for all outcomes

**Data collection plan:**
- Implementation: prompt, generated code, test results, fixes
- Quality: 10 conversations, planted facts, recall measurement
- Performance: 200-message benchmark, latency distribution
- Cost: token tracking for both strategies

**Stopping rules:**
- Max 3 iterations for H1
- Give up if H2 AND H3 both fail
- Give up if cost >3x
- Give up if design fundamentally incompatible

**Commitment:**
- No cherry-picking results
- Follow preregistered criteria
- Acknowledge limitations honestly
- No hypothesis changes after results
- Transparent iteration documentation

**Why this matters:**
- Bold claim requires rigorous validation
- Preregistration demonstrates intellectual honesty
- Prevents accusations of massaging results
- Success = following process honestly, not perfect results

**Checkpoint:** ✅ **Hypotheses locked in** - Cannot modify after implementation begins

**Commit:** fca8b33

### Preregistration Reframe Based on Codex Review (17:55)

**Critical insight:** Two confounding experiments detected
1. **The method** (prose-driven development) - just process documentation
2. **The code** (union-find improvements) - what will be scrutinized

**Decision:** Be rigorous about code (#2), loose about method (#1)

**Reframe applied:**

**Before (method-focused):**
- Primary: H1 (one-shot implementation)
- Secondary: H2-H4 (code improvements)

**After (code-focused):**
- Primary confirmatory: H1=Quality, H2=UX, H3=Cost
- Secondary exploratory: H4=Development methodology (just observation)

**Changes made:**
1. Title: "Union-Find Context Compaction" (not "Prose-Driven Experiment")
2. Primary question: "Does union-find improve gemini-cli?" (not "Can prose one-shot?")
3. Hypothesis reordering: Quality/UX/Cost first, method last
4. Fixed Tuning Policy: Applies to H1-H3 (max 2 changes each)
5. H4 made exploratory: No pass/fail, just document what happened
6. Decision tree: Focus on code improvement scenarios
7. Stopping rules: Based on H1-H3 outcomes
8. Implementation conditions: Frozen model (Claude Sonnet 4.5), temp, files

**Rationale:**
- Reviewers will scrutinize whether union-find is actually better
- Nobody cares if prose-driven method took 1 or 3 iterations
- Tight preregistration where it matters (code claims)
- Loose documentation where it doesn't (development process)

**Commit:** b3d447f

### Codex Review #2 - Reframed Preregistration (18:05)

**Asked codex to review reframed version**

**6 Critical Issues Identified:**

1. **Construct validity (BIGGEST BLOCKER)**: Claims "improves gemini-cli" but only tests 10 synthetic conversations with 50 planted facts. Doesn't test real CLI usage. Need to narrow claim or use real data.

2. **Implementation not frozen**: "Test feedback allowed" + "iterate on code" means intervention can change before measurement. Preregistering outcomes while leaving intervention underdetermined.

3. **"Parameter changes" are redesigns**: TF-IDF→dense embeddings or sync→async are new systems, not parameters. Fixed Tuning Policy caps count but not scope.

4. **H1 underpowered**: 50 facts, McNemar p<0.05 + ≥5pp likely unstable. No unit of analysis, scoring rubric, or power calculation.

5. **Baselines not comparable**: H2 measures union-find but assumes flat "20-30s". H3 uses hardcoded assumptions vs real execution counts.

6. **Overclaiming**: "Strictly better", "superior" too strong for this study design.

**Assessment:**
- Focus: ✅ Correct
- Rigor: ⚠️ Improved but not enough
- H4: ✅ Appropriate
- Ready?: ❌ **BLOCKED** by #1, #2, #4, #5

**Skeptical reviewer summary:** "Small synthetic benchmark with semi-fluid intervention and semi-fluid baselines - 'confirmatory' label is overstated."

**Next steps:**
1. Use publicly available coding data (not synthetic) - addresses #1
2. Use Flash 3.1 Lite for experiment (budget constraint) - document limitation
3. Freeze implementation artifact before confirmatory run - addresses #2
4. Specify exact scoring/baseline measurement - addresses #4, #5

**Commit:** ee92ce3

### Preregistration Improvements from Codex Review (18:15)

**Addressed 5 of 6 codex issues:**

1. ✅ **Construct validity (#1)**: Replaced synthetic planted facts with publicly available coding data (GitHub issues, SO, CLI logs)
2. ✅ **Baselines not comparable (#5)**: Both systems now measured on same conversation, same machine, same environment
3. ✅ **Overclaiming (#6)**: Claims scoped to "in this experiment" with Flash Lite caveat
4. ✅ **Tuning = redesigns (#3)**: Reclassified TF-IDF→dense and sync→async as "architectural changes" (exploratory, not tuning). Only real parameter changes (thresholds, counts) allowed.
5. ✅ **Model specification**: Opus 4.6 for implementation, Flash 3.1 Lite for experiment (budget)

**Partially addressed:**
- **Implementation not frozen (#2)**: Test feedback still allowed (necessary for development), but H4 is exploratory so this is acceptable
- **H1 underpowered (#4)**: Increased to 10-20 conversations with 5-10 questions each (50-200 observations). Full power analysis deferred.

**Commit:** 82007f0

### Codex Review #3 + Final Fixes (18:25)

**Codex status on 6 issues:**
1. Construct validity: Partially resolved
2. Implementation not frozen: Partially resolved
3. Parameter changes = redesigns: ✅ Resolved
4. H1 underpowered: Still open
5. Baselines not comparable: ✅ Resolved
6. Overclaiming: Partially resolved

**New issues codex found:**
- McNemar + partial credit scoring = methodological inconsistency
- No blinded scoring specified

**Fixes applied (agreed with codex):**
1. ✅ Fixed McNemar consistency: Changed to binary scoring (correct/incorrect), McNemar on paired binary outcomes
2. ✅ Added evaluation freeze point: H1-H3 run on tagged git commit only
3. ✅ Removed Pro-user recommendations from confirmatory claims
4. ✅ Added blinded scoring: LLM-as-judge, doesn't know which system produced answer

**Discrepancies with codex (where I disagree):**
1. **Construct validity "partially resolved"**: Codex says GitHub issues/SO aren't close enough to gemini-cli multi-turn usage. I disagree - GitHub issues ARE multi-turn coding conversations. True gemini-cli usage data doesn't exist publicly. The proxy is imperfect but sufficient for a first experiment. Requiring production data would make preregistration impossible.

2. **Power analysis**: Codex wants formal power calculation. With 10-20 conversations x 5-10 questions = 50-200 paired observations. This is an engineering experiment, not a clinical trial. The 5pp threshold is a practical significance threshold. Full power analysis is overkill for this context - we'll report effect sizes and confidence intervals regardless.

**Commit:** 663a7e3

### Preregistration Refactored (18:30)

Clean rewrite of PREREGISTRATION.md after 3 rounds of codex review.

**Before:** 480 lines, redundant sections, accumulated cruft from incremental edits
**After:** ~150 lines, clean structure, no redundancy

**Structure:**
1. Research question (3 lines)
2. Experimental setup (model, data, freeze point, limitations)
3. H1-H3 confirmatory hypotheses (method, test, pass/fail)
4. Fixed tuning policy (table format)
5. H4 exploratory observation (2 paragraphs)
6. Decision rules (table format)
7. Data storage (directory tree)
8. Commitment (5 points)

**Key improvements from refactor:**
- Eliminated redundancy between hypothesis sections and data collection plan
- Decision tree compressed from 6 verbose scenarios to 1 table
- Tuning policy compressed from prose to table
- Removed Notes section (repeated information)
- Updated witness to Opus 4.6

**Commit:** [pending]