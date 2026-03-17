# Context Compaction Systems Comparison

This document compares two approaches to context compaction for chat systems: gemini-cli's current flat summarization and union-find structured compaction.

## Common Problem

Both systems address the same dual problem:

**Token exhaustion:** Accumulated chat history approaches model token limits, threatening conversation continuity.

**Context rot:** Old irrelevant history (abandoned approaches, debugging dead ends, superseded decisions) clutters the context window and degrades model performance. Even within token limits, the model must wade through noise to find signal.

Both systems use context compaction to solve these problems—but with fundamentally different architectures.

## Architectural Comparison

### Current System: Flat Summarization

**Structure:** Single `<state_snapshot>` containing all compressed history as prose.

**Zones:**
- Recent 30% of history: preserved verbatim
- Oldest 70%: compressed into one snapshot

**Process:**
1. Find split point (70/30 based on character count)
2. Truncate oversized tool outputs (reverse token budget, 50k limit)
3. Generate snapshot via LLM (cheap model)
4. Verify snapshot via second LLM call (self-evaluation)
5. Inject snapshot as user message + acknowledgment
6. Append preserved recent history

**Snapshot format:** Structured XML with sections (overall_goal, active_constraints, key_knowledge, artifact_trail, file_system_state, recent_actions, task_state)

**Cost:** Two LLM calls per compression (generate + verify)

**Timing:** Blocks user for 10-30 seconds during compression

---

### Union-Find: Structured Compaction

**Structure:** Forest of message clusters, each with its own summary.

**Zones:**
- **Hot zone:** Recent N messages, verbatim, never touched
- **Cold zone:** Older messages organized into clusters via union-find, each cluster has a summary

**Process:**
1. New message enters hot zone
2. If hot exceeds capacity, oldest graduates to cold (FIFO)
3. Graduated message becomes singleton or merges into nearest cluster (similarity threshold)
4. If cold exceeds cluster budget, closest pair merges
5. Each merge triggers one LLM summarization of that cluster
6. Context rendering: retrieve relevant cold clusters + all hot messages

**Cluster format:** Each cluster root stores:
- Summary (LLM-generated)
- Children list (source message IDs)
- Centroid (for similarity search)

**Cost:** One LLM call per merge (amortized, incremental)

**Timing:** Non-blocking, compression happens per message graduation

## Data Structure Comparison

| Aspect | Flat Summarization | Union-Find |
|--------|-------------------|------------|
| **History organization** | Two-part: snapshot + recent | Three-part: cold clusters + hot messages |
| **Compression granularity** | All-at-once (70% → 1 snapshot) | Incremental (message-by-message) |
| **Summary storage** | Single text block | Multiple cluster summaries |
| **Original messages** | Discarded after compression | Retained, linked to cluster roots |
| **Provenance** | None | Parent pointers trace to sources |
| **Retrieval** | Dump entire snapshot | Query-based (embed → nearest k clusters) |

## Behavioral Differences

### Triggering

**Flat:**
- Triggers at 50% of token limit
- Manual override via `/compress`
- Blocks conversation during execution

**Union-Find:**
- Triggers on every message append (graduation check)
- Incremental, never blocks
- Compression budget enforced via cluster count cap

### What Gets Preserved

**Flat:**
- Recent 30% in full fidelity
- Everything else compressed into snapshot sections
- Two-phase refinement attempts to preserve technical details

**Union-Find:**
- Hot window (configurable size, e.g., 20 messages) in full fidelity
- Cold clusters preserve per-topic summaries
- Original messages retained and expandable

### Failure Modes

**Flat:**
- Lossy compression drops details under pressure
- No way to recover dropped facts
- Compression artifacts accumulate over rounds
- Blocking UX interrupts flow

**Union-Find:**
- Retrieval misses (query doesn't match right cluster)
- Intra-cluster compression still lossy
- Cluster fragmentation if threshold too strict
- Filler pollution if threshold too loose

### Cost Model

**Flat:**
- 2 LLM calls per compression event (generate + verify)
- Compression events are infrequent (trigger at 50% of limit)
- Uses cheaper models (Flash Lite) for summarization
- Typical: compress every ~100 messages

**Union-Find:**
- 1 LLM call per cluster merge (no verification step)
- Merges happen incrementally on graduation
- Multiple small summarization tasks vs one large task
- Typical: 1 merge per 20 graduations (with 10-cluster cap)

**Cost comparison for 200-message conversation:**

**Flat:** ~2-3 compression events × 2 calls (generate + verify)
- Generate: 190 messages input
- Verify: 190 messages + generated summary input
- **Total: ~380 message-equivalents** per compression event

**Union-Find:** ~10 merges × 1 call (no verification)
- Each merge: 20-40 messages input
- **Total: ~200-400 message-equivalents** amortized over graduations

**Conclusion: Comparable total cost**, not 2x expensive:
- Union-find removes expensive verification step
- Smaller context per call (20-40 vs 190 messages)
- Amortized over time (non-blocking, incremental)
- Same or lower total token consumption

## User-Facing Differences

### UX During Compression

**Flat:**
- Spinner blocks conversation for 10-30s
- User cannot continue until compression completes
- Interrupts flow during iterative work

**Union-Find:**
- No visible compression step
- Graduation and merge happen asynchronously per message
- User never waits

### When Detail Is Lost

**Flat:**
- User asks for specific detail (port number, file path)
- Model: "I don't see that in our conversation history"
- User must re-paste information

**Union-Find:**
- User asks for specific detail
- If not in hot or retrieved clusters, same failure
- But: can expand cluster if identified
- Better recall for details within retrieved clusters

### Searching History

**Flat:**
- Snapshot is opaque prose
- Cannot grep or search structurally
- Must read entire snapshot or re-ask model

**Union-Find:**
- Clusters are indexed by centroid
- Can query: "find cluster about authentication"
- Can expand: retrieve original messages from cluster

### Cross-Session Memory

**Flat:**
- Each session starts with snapshot from last compression
- Successive compressions integrate previous snapshot
- Signal degrades over many rounds

**Union-Find:**
- Forest can persist across sessions
- Clusters from previous sessions remain queryable
- Schemas can form from repeatedly co-merged clusters

## Theoretical Properties

### Reversibility

**Flat:** Irreversible. Original messages gone after compression.

**Union-Find:** Reversible (within cold zone). `expand(cluster)` retrieves sources.

### Provenance

**Flat:** None. Cannot trace snapshot facts to source messages.

**Union-Find:** Yes. Parent pointers link summaries to source messages via `find()`.

### Searchability

**Flat:** No. Snapshot is unstructured prose.

**Union-Find:** Yes. Clusters indexed by centroid, query via embedding similarity.

### Consolidation

**Flat:** No learning across sessions. Each compression is independent.

**Union-Find:** Potential for schema formation from repeated co-activation patterns (Phase 2, not yet implemented).

## Performance Characteristics

### Time Complexity (per operation)

**Flat:**
- Find split point: O(n) where n = history length
- Summarization: O(n) input tokens to LLM (bounded by model limit)
- Compression event: O(n)

**Union-Find:**
- Find cluster root: O(α(n)) ≈ O(1) amortized with path compression
- Graduate message: O(m) where m = cluster count (find nearest)
- Merge clusters: O(1) union + O(k) summarization where k = cluster size

### Space Complexity

**Flat:**
- One snapshot (fixed size, ~500 tokens)
- Recent 30% of history (proportional to history size)
- Total: O(n) where n = recent messages

**Union-Find:**
- Hot: O(h) where h = hot_size (fixed)
- Cold: O(c × s) where c = cluster_count, s = avg summary size
- Originals: O(m) where m = graduated messages (retained)
- Total: O(m) but highly compressible (summaries + originals)

## What Each System Optimizes For

### Flat Summarization Optimizes For:

✅ **Simplicity** - One summary, predictable structure
✅ **Robustness** - Two-phase refinement catches omissions
✅ **Token efficiency** - Recent bias keeps current context in full fidelity
✅ **Cost predictability** - Fixed 2 LLM calls per compression
✅ **Integration ease** - Minimal changes to existing chat loop

### Union-Find Compaction Optimizes For:

✅ **Detail preservation** - Per-cluster summaries retain more facts
✅ **Non-blocking UX** - Incremental compression, never stalls user
✅ **Expandability** - Can retrieve original messages when needed
✅ **Provenance** - Trace facts back to source messages
✅ **Searchability** - Query clusters by semantic similarity
✅ **Cross-session memory** - Clusters persist, enable consolidation

## Key Trade-Offs

| Dimension | Flat | Union-Find |
|-----------|------|------------|
| **Complexity** | Low | High (forest, embeddings, retrieval) |
| **UX interruption** | High (10-30s block) | None (incremental) |
| **Detail recall** | Lower (single summary) | Higher (per-cluster) |
| **Cost (LLM calls)** | Lower (2 per event) | Higher (1 per merge) |
| **Provenance** | None | Full |
| **Expandability** | None | Yes |
| **Implementation effort** | Done ✅ | Requires refactoring |

## When Each System Wins

### Flat Summarization Wins When:

- Conversations are short (<200 messages)
- Compression is infrequent (under token limit)
- Single summary sufficient for context
- Blocking UX tolerable
- Implementation simplicity valued
- Cost minimization critical

### Union-Find Wins When:

- Conversations are long (200+ messages)
- High compression pressure
- Detail preservation critical (coding, ops, medical)
- Multi-topic conversations benefit from clustering
- Non-blocking UX required
- Provenance and expandability needed
- Cross-session learning desired

## Open Questions for Integration

1. **How to handle tool output truncation in union-find?**
   - Does reverse token budget apply before graduation?
   - Or does each cluster manage its own tool output budget?

2. **What replaces the two-phase generate+verify?**
   - Does each merge do verification?
   - Or trust smaller summaries to be accurate?

3. **How to migrate existing conversations?**
   - Conversations with `<state_snapshot>` in history
   - Parse snapshot into initial clusters?
   - Or keep snapshot and only union-find new messages?

4. **What embeddings to use?**
   - TF-IDF (cheap, deterministic) or dense (better, costs API calls)?
   - Embedding model version stability across sessions?

5. **How to tune thresholds?**
   - Hot size, max cold clusters, merge threshold
   - Per-user? Per-conversation type?

6. **Model routing for cluster summarization?**
   - Same cheap model as flat compression?
   - Or separate config for incremental summarization?

## Next Step: Transformation Design

This comparison establishes:
- ✅ What the current system does (flat summarization)
- ✅ What union-find does (structured compaction)
- ✅ How they differ architecturally and behaviorally
- ⚠️ Open integration questions

**Step 5** will design the transformation: how to refactor gemini-cli from flat to union-find while preserving backward compatibility and addressing the open questions.
