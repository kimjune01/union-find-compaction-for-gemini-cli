# Design Decisions: Union-Find Context Compaction

This document records all design decisions made during Step 6 (sharpening conflicts and complexity), ordered from least to most uncertain.

## Guiding Principles

1. **Match previous implementation** where applicable (backward compatibility, consistency)
2. **Spike validates mechanics, iterate on quality** (TF-IDF → dense if needed)
3. **Statistical rigor** (McNemar's test for recall comparison, p < 0.05)
4. **Document limitations** (known edge cases for future work)
5. **Invite criticism** (reviewers can flag quality issues, we iterate)

---

## Decided (Least Uncertain → Most Uncertain)

### 1. Hot Zone Size
**Decision:** 30 messages (configurable)

**Rationale:**
- Matches current 30% preservation threshold
- At typical compression trigger (~100 messages), 30% ≈ 30 messages
- Configurable via `config.getHotZoneSize()` (matches `getCompressionThreshold()`)
- Exposed as tuning parameter in PR

**Alternative considered:** Dynamic 30% of total messages (rejected: unbounded growth)

---

### 2. Model Routing
**Decision:** Reuse existing `chat-compression-3-pro` aliases exactly

**Rationale:**
- No new model configs needed
- Proven cost model
- Simpler implementation
- Uses same `modelStringToModelConfigAlias()` mapping

**Alternative considered:** Create separate `cluster-compression-*` aliases (rejected: unnecessary complexity)

---

### 3. Timestamp Format
**Decision:** Match gemini-cli's existing message timestamp format

**Rationale:**
- Consistency with current system
- Check `Content` type for timestamp field/format
- If no timestamps exist, rely on insertion order

**Alternative considered:** Force ISO-8601 (rejected: inconsistent with existing)

---

### 4. TF-IDF Vocabulary Strategy
**Decision:** Spike with simplest approach (incremental vocabulary), iterate based on recall

**Rationale:**
- Implementation detail, not architectural decision
- Spike validates mechanics, not final quality
- If recall < statsig threshold → swap to dense embeddings
- **Iteration loop:** spike → validate → update → re-validate

**Alternative considered:** Pre-built vocabulary (rejected: premature optimization)

---

### 5. Recall Threshold for Success
**Decision:** Statistically significant equal-or-better vs flat (McNemar's test, p < 0.05)

**Rationale:**
- Rigorous comparison (not eyeballed)
- Union-find must be **≥ flat with statistical significance**
- If TF-IDF fails statsig → swap to dense embeddings → re-test
- Matches reference experiment methodology

**Alternative considered:** Absolute threshold like ">75%" (rejected: ignores baseline)

---

### 6. Testing Dataset
**Decision:** Real conversation dataset preferred over synthetic planted facts

**Rationale:**
- More credible validation for reviewers
- Look for public coding conversation datasets (Stack Overflow, GitHub issues, etc.)
- Synthetic fixtures acceptable for initial smoke testing

**Alternative considered:** Purely synthetic (rejected: less credible)

---

### 7. Max Cold Clusters
**Decision:** Fixed at 10 (validated in reference experiments)

**Rationale:**
- Proven in 5+ experimental trials
- Balance between granularity and retrieval noise
- Not configurable (tuning parameter if needed later)

**Alternative considered:** Dynamic based on conversation length (rejected: adds complexity)

---

### 8. Merge Threshold
**Decision:** 0.15 for TF-IDF (configurable tuning parameter)

**Rationale:**
- Reference tuned from 0.3 → 0.15 (reduced singletons from 66 to 10)
- Configurable via `config.getMergeThreshold()`
- Different embeddings need different thresholds (e.g., 0.5 for dense)
- Exposed as tuning parameter in PR

**Alternative considered:** Adaptive threshold (rejected: premature optimization)

---

### 9. Retrieval Strategy
**Decision:** Always top-k clusters (k=3, min_sim=0.05)

**Rationale:**
- Simple, consistent, token-efficient
- Accept retrieval can miss (measure in tests)
- If recall suffers, iterate (adjust k or min_sim)

**Alternative considered:** Dump all clusters when under budget (rejected: wastes tokens)

---

### 10. Cache Eviction for Large Conversations
**Decision:** Evict old source messages, keep summaries (cap at 1000 messages)

**Strategy:**
- When `total_messages > 1000`, evict oldest `_nodes` entries
- Keep `_summaries`, `_children`, `_centroids` (cluster metadata)
- Recent messages (within cap) remain expandable
- Old clusters: searchable/retrievable, NOT expandable
- Graceful degradation (one-way compression for very old history)

**Rationale:**
- Bounds memory usage predictably
- Maintains searchability of old history
- Aligns with "hot expandable, cold compressed" model
- User doesn't need to manually clear context

**Alternative considered:**
- No eviction (rejected: unbounded memory)
- Evict entire clusters (rejected: loses old knowledge)
- Hard cap forcing manual clear (rejected: poor UX)

---

### 11. Message Edits (Edge Case)
**Decision:** Not supported in spike (document as known limitation)

**Rationale:**
- Rare edge case (editing old messages uncommon)
- Adds significant implementation complexity
- Validate core mechanics first
- Address in iteration if users encounter it

**Alternative considered:** Re-embed and re-cluster edited messages (deferred to future)

---

### 12. Concurrent Appends (Edge Case)
**Decision:** Out of scope for spike (document for future implementation)

**Rationale:**
- Concurrency is "bag of worms" to avoid in spike
- Spike assumes sequential message processing
- TypeScript single-threaded helps, but not guaranteed
- Document as known limitation: rapid tool outputs might need queuing/batching

**Alternative considered:** Lock-free concurrent appends (deferred to production)

---

### 13. Cluster Summary Quality Assurance
**Decision:** Trust single-pass summarization for spike, invite reviewer criticism

**Rationale:**
- Clusters are small (~20-40 messages), single-pass should suffice
- No verification step (keeps cost down, comparable to flat's 2-call model)
- Recall tests measure quality empirically
- **Invite reviewers:** If summaries are bad, please flag it
- Iterate with improvements (add verification, tune prompts, etc.)

**Alternative considered:**
- Add verification for all clusters (rejected: doubles cost, defeats cost parity)
- Spot-check with LLM judge (deferred: adds complexity)

---

### 14. Cross-Session Persistence
**Decision:** Match previous implementation (clusters persist with conversation)

**Rationale:**
- If flat persists `<state_snapshot>` in conversation history, union-find persists forest
- Forest state (clusters, summaries, metadata) saves with conversation
- Load forest on conversation restore
- Enables cross-session memory (key value prop)
- Use existing conversation storage mechanism

**Alternative considered:** Ephemeral clusters (rejected: loses key benefit)

---

### 15. Migration of Existing Conversations
**Decision:** Existing conversations stay on flat (safe, no migration in spike)

**Rationale:**
- Simple, safe, no migration risk
- New conversations use union-find (feature flag)
- Backward compatibility guaranteed
- Can implement snapshot → cluster parsing in iteration if needed

**Alternative considered:**
- Parse `<state_snapshot>` into initial clusters (deferred: risky, could lose info)
- Hybrid approach (deferred: adds complexity)

---

## Decision Summary Table

| # | Decision | Value | Configurable? | Status |
|---|----------|-------|---------------|--------|
| 1 | Hot zone size | 30 messages | Yes | Final |
| 2 | Model routing | `chat-compression-3-pro` | No (reuse existing) | Final |
| 3 | Timestamps | Match gemini-cli format | N/A | Final |
| 4 | TF-IDF vocab | Incremental | N/A | Spike (iterate) |
| 5 | Recall threshold | Statsig ≥ flat (p<0.05) | N/A | Final |
| 6 | Test dataset | Real conversations preferred | N/A | Final |
| 7 | Max cold clusters | 10 | No | Final |
| 8 | Merge threshold | 0.15 | Yes | Final |
| 9 | Retrieval | top-k (k=3) | No | Final |
| 10 | Cache eviction | @1000 messages | No | Final |
| 11 | Message edits | Not supported | N/A | Limitation |
| 12 | Concurrency | Not handled | N/A | Limitation |
| 13 | Summary quality | Trust single-pass | N/A | Spike (invite criticism) |
| 14 | Persistence | Match prev impl | N/A | Final |
| 15 | Migration | Existing stay flat | N/A | Final |

---

## Known Limitations (Documented for Future Work)

1. **Message edits:** Editing old clustered messages not supported
2. **Concurrency:** Rapid concurrent appends may need queuing/batching
3. **Summary verification:** No verification step (trust single-pass)
4. **TF-IDF limitations:** May need upgrade to dense embeddings if recall suffers
5. **Retrieval misses:** top-k can miss cross-topic queries

---

## Iteration Triggers

These conditions trigger refinement of the spike:

| Condition | Action |
|-----------|--------|
| Recall < statsig vs flat | Swap TF-IDF → dense embeddings |
| Cluster fragmentation >50% | Adjust merge threshold |
| Summary quality complaints | Add verification or tune prompts |
| Retrieval misses >20% | Increase k or adjust min_sim |
| Memory usage excessive | Adjust eviction threshold |

---

## Reviewer Invitation

**These decisions are initial hypotheses.** If you see issues:

- ✅ **Quality concerns?** Flag bad summaries, we'll iterate
- ✅ **Cost concerns?** We'll measure actual tokens in spike
- ✅ **Edge cases?** We documented limitations, can address in future
- ✅ **Better approach?** Propose alternative, we're open to refinement

**The goal:** Validate core mechanics in spike, iterate to production quality.
