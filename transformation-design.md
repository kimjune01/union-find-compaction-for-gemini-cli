# Transformation Design: Flat Summarization → Union-Find Compaction

This document specifies the complete transformation from gemini-cli's current flat summarization to union-find structured compaction, targeting Gemini 3 Pro users.

## Design Principles

**Strict improvement:** Union-find must be better on all dimensions that matter to Gemini 3 Pro users:
- ✅ Non-blocking UX (no 30s spinner)
- ✅ Better detail preservation (per-cluster summaries)
- ✅ Expandability (retrieve originals when needed)
- ✅ Provenance (trace facts to sources)
- ✅ Cross-session memory (clusters persist)

**Backward compatible:** Existing conversations with `<state_snapshot>` continue working.

**Iterative deployment:** Test harness validates both implementations, allowing comparison and rollback.

## Architecture Overview

### Current: Flat Summarization

```
ChatCompressionService
  ├─ compress(chat, force, model, ...)
  ├─ findCompressSplitPoint(contents, fraction)
  ├─ truncateHistoryToBudget(history, config)
  └─ Two LLM calls: generate + verify snapshot
```

**Flow:**
1. Check threshold (50% of token limit)
2. Truncate tool outputs (reverse token budget)
3. Find split point (70/30)
4. Generate snapshot (all old → one summary)
5. Verify snapshot (second LLM call)
6. Inject snapshot + recent history

### Target: Union-Find Compaction (v2)

```
ContextWindow
  ├─ append(content, timestamp)        ← synchronous, no LLM calls
  │     ├─ embed (local TF-IDF)
  │     ├─ push to hot zone
  │     └─ if hot exceeds graduateAt:
  │           ├─ _graduate() oldest into forest (structural merge)
  │           └─ graduated message stays in hot (overlap window)
  │     └─ if hot exceeds evictAt:
  │           └─ remove oldest from hot (summary is fresh by now)
  ├─ render(query?)                    ← synchronous, uses cached summaries
  │     ├─ retrieve relevant clusters by query (cached summaries)
  │     └─ return cold summaries + hot messages
  ├─ resolveDirty()                    ← async, fire-and-forget
  │     └─ batch-summarize dirty clusters (LLM calls)
  │        called after render(), runs during main LLM call wait
  └─ Forest
      ├─ insert(msg_id, content, embedding, timestamp)
      ├─ find(msg_id) → root with path compression
      ├─ union(id_a, id_b) → structural merge only (synchronous)
      │     ├─ parent pointers, children, centroids
      │     └─ tracks new members since last clean summary
      ├─ nearest(query_embedding, k) → top-k clusters
      └─ expand(root_id) → source messages
```

**Flow:**
1. Every message appends to ContextWindow (synchronous, <1ms)
2. If hot exceeds `graduateAt`, oldest graduates to cold (structural merge, <1ms)
3. Graduated message **stays in hot zone** (overlap window)
4. If hot exceeds `evictAt`, oldest evicted from hot (summary is fresh by now)
5. **No LLM calls during steps 1-4.** Merges are structural only.
6. Render (synchronous, <1ms): retrieve clusters using cached summaries + hot messages
7. After render: fire-and-forget `resolveDirty()` — runs during main LLM call wait

**Overlap window eliminates staleness:**
Messages exist in both hot zone and cold tree for a few turns. During that
overlap, background `resolveDirty()` runs during the main LLM call (5-30s).
By the time a message evicts from hot, its cluster summary is fresh.

```
hot zone: [msg1 ... msg26, msg27, msg28, msg29, msg30]
                           ↑ graduateAt     ↑ evictAt
                           (enter tree)      (leave hot)

msg27-msg30: overlap window — in BOTH hot and tree
  - render() shows them verbatim from hot (no stale summary)
  - background resolveDirty() summarizes their clusters
  - by the time msg27 evicts from hot, its cluster summary is fresh
```

**Batch summarization (background):**
`resolveDirty()` makes **one** LLM call per dirty cluster:
`summarize([last_clean_summary, ...new_raw_messages_since_last_summary])`
Each raw message appears in exactly one summarization call → O(n) total cost.

**Result: summarization moved off the blocking path.**
- append(): <1ms (structural)
- render(): <1ms (cached summaries, overlap covers freshness)
- resolveDirty(): runs in background during main LLM wait (5-30s)

**Caveats:**
- If resolveDirty() hasn't completed before a message evicts from hot, its cluster
  summary may be stale (showing raw root content instead of a proper summary).
  The overlap window (4 messages ≈ 2 turns) is sized to make this unlikely.
- Messages in the overlap window appear in both cold and hot render output.
  The hot copy is authoritative; the cold copy may be a stale summary.

## What Changes

### 1. New Classes (Port from Reference)

**File:** `packages/core/src/services/contextWindow.ts`

```typescript
interface Embedder {
  embed(text: string): number[];  // synchronous — TF-IDF is local computation
  embedQuery?(text: string): number[];  // optional — embed without mutating state
  // embedQuery() prevents corpus contamination: render(query) must not
  // change vocabulary/IDF, or searching would alter future embeddings.
  // Falls back to embed() if not provided.
}

interface Summarizer {
  summarize(messages: string[]): Promise<string>;
}

class Message {
  id: number;
  content: string;
  embedding: number[];
  timestamp: string | null;
  _parent: number | null;  // union-find parent
  _rank: number;           // union-find rank
}

class Forest {
  private _nodes: Map<number, Message>;
  private _summaries: Map<number, string>;        // root_id → last clean summary
  private _children: Map<number, number[]>;       // root_id → member ids
  private _centroids: Map<number, number[]>;      // root_id → centroid
  private _dirtyInputs: Map<number, string[]>;    // root_id → raw messages for next summarization
  // _dirtyInputs stores the actual text to pass to the summarizer, not member IDs.
  // On union: collects representations of both clusters (summaries or raw content).
  // On resolveDirty: passes these strings to the summarizer, then clears.
  private _embedder: Embedder;
  private _summarizer: Summarizer;

  insert(msg_id: number, content: string, embedding?: number[], timestamp?: string): number;
  find(msg_id: number): number;  // with path compression
  union(id_a: number, id_b: number): number;  // SYNCHRONOUS — structural merge only
  // union() merges parent pointers, children, centroids.
  // It does NOT call the summarizer. No LLM calls. No async.
  // Collects dirty inputs: for each side, uses its existing summary if clean,
  // its dirty inputs if already dirty, or raw content if singleton.
  // Creates a new array: [...inputsA, ...inputsB]. This array identity matters
  // for the concurrency guard in resolveDirty() (see below).
  async resolveDirty(): Promise<void>;  // batch-summarize all dirty clusters
  // For each dirty root:
  //   1. Skip if root was consumed by a concurrent union() since snapshot
  //   2. Summarize the dirty inputs
  //   3. Only write summary if _dirtyInputs.get(root) === inputs (identity check)
  //      If union() replaced the array during the await, skip — the combined
  //      dirty entry will be resolved in a future resolveDirty() call.
  // This reference-equality guard prevents stale summaries from overwriting
  // combined inputs created by in-flight merges.
  compact(root_id: number): string;  // return summary or raw content if singleton/dirty
  expand(root_id: number): string[];  // return source messages
  nearest(query_embedding: number[], k?: number, min_sim?: number): number[];
  nearestRoot(query_embedding: number[]): [number, number] | null;  // [root_id, similarity]
  getCentroid(root_id: number): number[] | undefined;

  // Queries
  roots(): number[];
  members(root_id: number): number[];
  summary(root_id: number): string | undefined;
  isDirty(root_id: number): boolean;  // has unsummarized content
  dirtyRoots(): number[];             // all roots with unsummarized content
  size(): number;
  clusterCount(): number;
}

interface ContextWindowOptions {
  graduateAt?: number;       // default 26 — start graduating at this hot count
  evictAt?: number;          // default 30 — evict from hot at this count
  maxColdClusters?: number;  // default 10
  mergeThreshold?: number;   // default 0.15
}

class ContextWindow {
  private _forest: Forest;
  private _hot: Message[];
  private _graduateAt: number;
  private _evictAt: number;
  private _maxColdClusters: number;
  private _mergeThreshold: number;
  private _nextId: number;
  private _graduatedIndex: number;     // tracks which hot messages already graduated

  constructor(
    embedder: Embedder,
    summarizer: Summarizer,
    options?: ContextWindowOptions
  );
  // Constructor validates: evictAt must be >= graduateAt (else _graduatedIndex corrupts)
  // overlap window = evictAt - graduateAt = 4 messages ≈ 2 turns
  // gives background resolveDirty() time to finish during main LLM call

  append(content: string, timestamp?: string): number;  // SYNCHRONOUS — no LLM calls
  private _graduate(msg: Message): void;                 // SYNCHRONOUS — structural merge only
  render(query?: string | null, k?: number, minSim?: number): string[];
  // render() is SYNCHRONOUS — uses cached summaries from forest.
  // If query is provided, uses embedQuery() (not embed()) to avoid mutating
  // the TF-IDF corpus. Falls back to embed() if embedQuery not available.
  // Overlap window ensures graduated messages appear verbatim from hot.
  // NOTE: messages in the overlap window may appear in both cold (via cluster
  // summary) and hot (verbatim). This is by design — the hot copy is authoritative.
  // After render(), caller fires resolveDirty() as background work.
  async resolveDirty(): Promise<void>;  // fire-and-forget after render()
  // Runs during main LLM call wait. Resolves dirty clusters via batch LLM calls.
  expand(root_id: number): string[];

  // Getters
  get hotCount(): number;
  get coldClusterCount(): number;
  get totalMessages(): number;  // NOTE: double-counts overlap window messages
  get forest(): Forest;
}
```

### 2. Modified: ChatCompressionService

**File:** `packages/core/src/services/chatCompressionService.ts`

**Changes:**
- Add `ContextWindow` instance per conversation (stored in GeminiChat)
- Replace `compress()` logic with `ContextWindow.append()` + `render()`
- Keep `truncateHistoryToBudget()` but apply before graduation
- Remove two-phase generate+verify (union-find summarizes incrementally)

**New method:**
```typescript
async compactWithUnionFind(
  chat: GeminiChat,
  promptId: string,
  model: string,
  config: Config,
  abortSignal?: AbortSignal,
): Promise<{ newHistory: Content[] | null; info: ChatCompressionInfo }>
```

**Flow:**
1. Get or create `ContextWindow` for this conversation
2. For each message in chat history not yet in window:
   - Truncate tool outputs if needed
   - `window.append(message.content, message.timestamp)` — synchronous, <1ms
3. Render context: `window.render(query=lastUserMessage)` — synchronous, <1ms (cached summaries)
4. Fire-and-forget: `window.resolveDirty()` — runs during main LLM call wait
5. Return rendered clusters + hot messages as new history

### 3. New: Embedding Strategy

**File:** `packages/core/src/services/embeddingService.ts`

Two options, choose one:

**Option A: TF-IDF (cheap, deterministic, local)**
```typescript
class TFIDFEmbedder implements Embedder {
  private _vocab: Map<string, number>;
  private _docCount: number;
  private _termDocFreq: Map<string, number>;

  embed(text: string): number[] {  // synchronous — mutates vocab/IDF state
    // Tokenize, update vocabulary, update document frequency,
    // compute TF-IDF, L2-normalize, return vector
  }

  embedQuery(text: string): number[] {  // synchronous — does NOT mutate state
    // Same TF-IDF computation against current vocab, but skips
    // vocabulary and IDF updates. Unknown terms get zero weight.
    // Used by render(query) to prevent corpus contamination.
  }
}
```

**Pros:** No API calls, deterministic, fast
**Cons:** Lexically shallow, poor semantic matching

**Known issues with incremental TF-IDF:**
- Vocabulary grows unboundedly (one dimension per unique term). Bounded in
  practice by conversation length.
- Old embeddings/centroids become stale as IDF shifts over time. Stored vectors
  are never recomputed. Retrieval quality degrades over very long conversations.
- `cosineSimilarity()` handles mismatched vector dimensions (older vectors are
  shorter) by treating missing dimensions as zero.

**Option B: Dense embeddings (better semantic matching, costs API)**
```typescript
class GeminiEmbedder implements Embedder {
  async embed(text: string): Promise<number[]> {
    // Call text-embedding-004 or similar
    // Return dense vector (768 dimensions)
  }
}
```

**Pros:** Better semantic clustering, better retrieval
**Cons:** API calls add latency and cost

**Decision:** Start with **Option A (TF-IDF)** for initial spike:
- Cheaper to iterate during testing
- Deterministic (reproducible test results)
- Can upgrade to Option B in refinement if recall suffers

### 4. New: Cluster Summarization

**File:** `packages/core/src/services/clusterSummarizer.ts`

```typescript
class ClusterSummarizer implements Summarizer {
  constructor(
    private llmClient: LlmClient,
    private modelConfigKey: string  // e.g., 'chat-compression-3-pro'
  ) {}

  async summarize(messages: string[]): Promise<string> {
    // Called from Forest.resolveDirty() at render() time.
    // Input: [last_clean_summary (if any), ...new_raw_messages]
    // Each raw message appears in exactly one call → O(n) total cost.
    const response = await this.llmClient.generateContent({
      modelConfigKey: { model: this.modelConfigKey },
      contents: [{
        role: 'user',
        parts: [{
          text: this.buildClusterPrompt(messages)
        }]
      }],
      promptId: 'cluster-summarize',
      role: LlmRole.UTILITY_COMPRESSOR,
      abortSignal: new AbortController().signal,
    });
    return getResponseText(response)?.trim() ?? messages.join('\n---\n');
  }

  // Prompt (actual implementation):
  // "Summarize the following conversation messages into a concise,
  //  information-dense paragraph. Preserve all specific technical details,
  //  file paths, tool results, variable names, and user constraints.
  //  Messages: [1] ... [2] ..."
  // Simpler than originally specified. No explicit token limit or
  // summary-integration instruction. Works because clusters are small.
}
```

**v1 bug context (resolved in v2):** v1's `union()` called the summarizer on every
merge, re-reading all member raw texts each time. This produced O(n²) cost (26.6×
expected). v2 fixes this: `union()` is synchronous (no LLM calls), and `render()`
batch-summarizes dirty clusters — one LLM call per cluster, not one per merge.

**Key difference from flat:** No two-phase verification. Each cluster is small enough (~20-40 messages) that a single summarization call is sufficient.

## What Stays

### 1. Tool Output Truncation

**Keep:** `truncateHistoryToBudget()` logic

**Where it applies:** Before message graduation to cold zone

**Flow:**
```
Message arrives → Check if contains tool output →
  If total tool output tokens > budget → Truncate oldest →
  Append to ContextWindow
```

Tool output budget remains 50,000 tokens, applied before embedding and graduation.

### 2. Model Routing

**Keep:** `modelStringToModelConfigAlias()` mapping

**Usage:** Cluster summarization uses same model as current compression:
- Main model: `gemini-3-pro`
- Cluster summarization: `chat-compression-3-pro`

### 3. Hook System

**Keep:** PreCompress hook firing

**Trigger:** Fire on every graduation that triggers a merge (not on every append)

**Flow:**
```typescript
if (merge_happened) {
  await config.getHookSystem()?.firePreCompressEvent(PreCompressTrigger.Auto);
}
```

### 4. Compression Threshold Configuration

**Keep:** `getCompressionThreshold()` config option

**Interpretation:** Instead of "compress at 50% of token limit," becomes "hot zone size"

**Mapping:**
```
threshold = 0.5, model token limit = 200k
→ hot zone = 0.5 * 200k / (avg tokens per message) ≈ 20-30 messages
```

## Answers to Open Questions

### Q1: Tool Output Handling in Union-Find

**Answer:** Apply `truncateHistoryToBudget()` before graduation.

**Flow:**
1. Message with tool output arrives
2. Before `ContextWindow.append()`, check cumulative tool output budget
3. If exceeded, truncate this message's tool output
4. Then append truncated message to window
5. Graduation and clustering work on truncated content

**Result:** Tool outputs don't bloat clusters, budget remains enforced.

### Q2: Two-Phase Verification Replacement

**Answer:** Remove two-phase verification for cluster summarization.

**Rationale:**
- Clusters are small (~20-40 messages vs 190)
- Smaller summarization tasks are more reliable
- Two-phase would double cost (already 2x vs flat)
- Initial spike uses single-phase, measure quality
- If recall suffers, add verification in refinement

**Quality safeguard:** Test harness will measure recall. If single-phase drops too many facts, we iterate.

### Q3: Migration Strategy

**Answer:** Parallel implementation with feature flag.

**Phase 1: Dual implementation**
```typescript
enum CompressionStrategy {
  FLAT = 'flat',
  UNION_FIND = 'union-find'
}

// In config
compressionStrategy: CompressionStrategy = FLAT;  // default

// In ChatCompressionService
async compress(...) {
  if (config.getCompressionStrategy() === CompressionStrategy.UNION_FIND) {
    return this.compactWithUnionFind(...);
  } else {
    return this.compressWithFlat(...);  // current implementation
  }
}
```

**Phase 2: Migration of existing conversations**

**Option A (safe):** Conversations with `<state_snapshot>` stay on flat
- New conversations start with union-find
- Existing conversations continue with flat
- No migration needed

**Option B (gradual):** Parse existing snapshot into initial clusters
- Extract key_knowledge, artifact_trail sections from snapshot
- Create one cluster per section
- Continue with union-find from there
- Risk: parsing might lose information

**Decision:** Start with **Option A** for spike. Existing conversations stay flat, new ones use union-find. Measure if users notice difference. If union-find proves better, implement Option B for migration.

### Q4: Embedding Choice

**Answer:** TF-IDF for initial spike, dense embeddings for refinement if needed.

**Initial:** TF-IDF
- Local, deterministic, no API calls
- Fast iteration during testing
- Vocabulary built from conversation corpus

**Refinement:** If retrieval quality suffers, upgrade to `text-embedding-004`
- Better semantic matching
- Higher API cost but acceptable for Pro users
- Version pinning for stability

### Q5: Threshold Tuning

**Answer:** Start with reference implementation defaults, tune based on Pro user conversations.

**Initial thresholds (see [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md)):**
```typescript
hot_size = 30              // Recent messages kept verbatim (configurable, matches 30% preservation)
max_cold_clusters = 10     // Cluster budget cap (validated in experiments)
merge_threshold = 0.15     // TF-IDF cosine similarity floor (configurable tuning parameter)
retrieve_k = 3             // Top-k clusters for rendering
retrieve_min_sim = 0.05    // Minimum similarity to include
```

**Configurable parameters:**
- `hot_size`: via `config.getHotZoneSize()` (default 30)
- `merge_threshold`: via `config.getMergeThreshold()` (default 0.15 for TF-IDF, 0.5+ for dense)

**Tuning strategy:**
- Measure cluster count distribution across Pro conversations
- If avg cluster count < 10: raise merge_threshold (more selective merging)
- If avg cluster count > 15: lower merge_threshold (more aggressive merging)
- Adjust hot_size based on token budget and avg message length

### Q6: Model Routing for Cluster Summarization

**Answer:** Use same compression model as flat (`chat-compression-3-pro` for Pro users).

**Routing:**
```typescript
const summarizer = new ClusterSummarizer(
  config.getBaseLlmClient(),
  modelStringToModelConfigAlias(model)  // Reuse existing logic
);
```

**Cost model for Pro users (v2 batch summarization):**
- Flat: 2 calls per compression event × large context (190 messages)
- Union-find v2: 1 call per dirty cluster at render time × medium context (summary + ~9 new messages)
- With 10 clusters: ~10 LLM calls per render, each ~1000 tokens input
- Total: ~10,000-15,000 tokens per conversation (comparable to flat's ~12,000)

**v1 cost comparison:** v1 hit 26.6× flat cost because `union()` called the
summarizer on every merge (80 calls per conversation), re-reading all members
each time (O(n²)). v2 decouples merging from summarization: structural merges
are free, summarization is batched at render time (O(n)).

## Migration Path Detail

### Step 1: Feature Flag Introduction

**File:** `packages/core/src/config/config.ts`

Add configuration option:
```typescript
interface CompressionConfig {
  strategy: 'flat' | 'union-find';
  threshold?: number;
  // Union-find specific
  hotSize?: number;
  maxColdClusters?: number;
  mergeThreshold?: number;
}
```

**Default:** `strategy: 'flat'` (backward compatible)

### Step 2: Conversation-Level State

**File:** `packages/core/src/core/geminiChat.ts`

Add optional ContextWindow:
```typescript
class GeminiChat {
  private contextWindow?: ContextWindow;

  getOrCreateContextWindow(config: Config): ContextWindow {
    if (!this.contextWindow) {
      const embedder = new TFIDFEmbedder(/* vocabulary from history */);
      const summarizer = new ClusterSummarizer(
        config.getBaseLlmClient(),
        modelStringToModelConfigAlias(this.model)
      );
      this.contextWindow = new ContextWindow(
        embedder,
        summarizer,
        config.getCompressionConfig().hotSize ?? 20,
        config.getCompressionConfig().maxColdClusters ?? 10,
        config.getCompressionConfig().mergeThreshold ?? 0.15
      );
    }
    return this.contextWindow;
  }
}
```

### Step 3: Dual-Path Compression

**File:** `packages/core/src/services/chatCompressionService.ts`

```typescript
async compress(...) {
  const strategy = config.getCompressionConfig().strategy;

  if (strategy === 'union-find') {
    return this.compactWithUnionFind(chat, promptId, model, config, abortSignal);
  } else {
    // Existing flat compression logic
    return this.compressWithFlat(chat, promptId, force, model, config, hasFailedCompressionAttempt, abortSignal);
  }
}

private async compactWithUnionFind(...): Promise<{...}> {
  const window = chat.getOrCreateContextWindow(config);
  const curatedHistory = chat.getHistory(true);

  // Populate window with messages not yet added
  for (const content of curatedHistory) {
    if (!window.contains(content.id)) {
      // Truncate tool outputs first
      const truncated = await this.maybeTruncateToolOutputs(content, config);
      window.append(
        JSON.stringify(truncated),
        content.timestamp ?? new Date().toISOString()
      );
    }
  }

  // Render context
  const lastUserMessage = curatedHistory
    .reverse()
    .find(c => c.role === 'user')
    ?.parts?.[0]?.text ?? '';

  const rendered = window.render(lastUserMessage, 3, 0.05);

  // Convert to Content format
  const newHistory: Content[] = rendered.map(text => ({
    role: 'user',
    parts: [{ text }]
  }));

  // Token counting
  const newTokenCount = await calculateRequestTokenCount(
    newHistory.flatMap(c => c.parts || []),
    config.getContentGenerator(),
    model
  );

  return {
    newHistory,
    info: {
      originalTokenCount: chat.getLastPromptTokenCount(),
      newTokenCount,
      compressionStatus: CompressionStatus.COMPRESSED
    }
  };
}
```

### Step 4: Gradual Rollout

**Phase 1:** Internal testing
- Set `compressionStrategy: 'union-find'` for internal conversations
- Run for 1 week, collect metrics
- Compare recall, UX, cost vs flat

**Phase 2:** Alpha users
- Opt-in for Gemini 3 Pro users who want to test
- Collect feedback on detail preservation and UX
- Iterate based on learnings

**Phase 3:** Default for new Pro conversations
- New conversations use union-find by default
- Existing conversations stay on flat (backward compat)
- Option to migrate via conversation settings

**Phase 4:** Full migration
- Implement snapshot → cluster parsing (Option B)
- Migrate all Pro conversations to union-find
- Deprecate flat compression

## Testing Strategy

### Test Harness Components

#### 1. Unit Tests (Correctness)

**File:** `packages/core/src/services/contextWindow.test.ts`

**Tests:**
```typescript
describe('Forest', () => {
  test('find() with path compression', () => {
    // Create chain: 1 → 2 → 3 → 4
    // find(1) should compress paths
    // Verify all nodes point directly to root after find
  });

  test('union() by rank', () => {
    // Union two trees
    // Verify smaller rank attached under larger
    // Verify rank increment on equal ranks
  });

  test('nearest() retrieves top-k by similarity', () => {
    // Insert 10 clusters
    // Query should return closest k by cosine similarity
  });

  test('expand() returns source messages', () => {
    // Create cluster with 5 messages
    // Merge into another cluster
    // expand(root) should return all 5 originals
  });
});

describe('ContextWindow', () => {
  test('graduation triggers when hot exceeds capacity', () => {
    // Append hot_size + 1 messages
    // Verify oldest graduated to cold
  });

  test('merge happens when cold exceeds cluster budget', () => {
    // Graduate max_cold_clusters + 1 messages
    // Verify closest pair merged
  });

  test('render with query retrieves relevant clusters', () => {
    // Populate with multi-topic conversation
    // Query about topic A
    // Verify clusters about topic A retrieved, not topic B
  });
});
```

#### 2. Integration Tests (Behavior)

**File:** `packages/core/src/services/chatCompressionService.test.ts`

**Tests:**
```typescript
describe('Union-Find Compression', () => {
  test('preserves backward compat: existing flat conversations continue working', () => {
    // Load conversation with <state_snapshot>
    // Compress with strategy='flat'
    // Verify no errors, snapshot updated
  });

  test('new conversations use union-find when configured', () => {
    // Set strategy='union-find'
    // Create new conversation
    // Append messages
    // Verify ContextWindow created, clusters formed
  });

  test('tool output truncation applies before graduation', () => {
    // Append message with huge tool output (>50k tokens)
    // Verify truncated before adding to window
    // Verify cluster summary uses truncated version
  });

  test('hooks fire on merge, not on every append', () => {
    // Listen for PreCompress hook
    // Append messages that don't trigger merge
    // Verify hook not fired
    // Append message that triggers merge
    // Verify hook fired
  });
});
```

#### 3. Quality Tests (Recall)

**File:** `integration-tests/compression-recall.test.ts`

**Approach:** Replicate reference experiment

**Setup:**
```typescript
// Generate conversation with planted facts
const conversation = generateConversationWithPlantedFacts({
  length: 200,
  topics: 8,
  factsPerTopic: 5
});

// Compress with flat
const flatCompressed = await compressWithFlat(conversation);

// Compress with union-find
const ufCompressed = await compressWithUnionFind(conversation);

// Ask questions about planted facts
const questions = generateQuestions(plantedFacts);

// Score answers
const flatRecall = await scoreRecall(flatCompressed, questions, plantedFacts);
const ufRecall = await scoreRecall(ufCompressed, questions, plantedFacts);

// Compare
expect(ufRecall).toBeGreaterThan(flatRecall);
```

**Metrics:**
- Recall % per compression strategy
- Statistical significance (McNemar's test on discordant pairs)
- Per-topic breakdown (does union-find win on all topics or specific ones?)

#### 4. Performance Tests (Cost & UX)

**File:** `integration-tests/compression-performance.test.ts`

**Metrics:**
```typescript
interface PerformanceMetrics {
  // UX
  appendP95Ms: number;           // union-find: <1ms (synchronous, no LLM)
  renderP95Ms: number;           // union-find: <1ms (cached summaries)
  blockingTimeMs: number;        // flat only: 10000-30000ms compression event

  // Cost
  llmCallCount: number;          // Flat: 2 per event, UF v2: ~67 (background)
  totalInputTokens: number;      // Sum across all LLM calls
  totalOutputTokens: number;

  // Quality
  finalTokenCount: number;       // Context size after compression
  clusterCount?: number;         // Union-find only
  avgClusterSize?: number;       // Union-find only
}
```

**Tests:**
```typescript
test('append is synchronous and never calls summarizer', () => {
  const summarizer = { summarize: vi.fn() };
  const cw = new ContextWindow(embedder, summarizer, {
    graduateAt: 2, evictAt: 4
  });

  cw.append('msg1');
  cw.append('msg2');
  cw.append('msg3');  // triggers graduation + structural merge

  expect(summarizer.summarize).not.toHaveBeenCalled();
});

test('render is synchronous and uses cached summaries', () => {
  // Append enough to graduate and merge
  for (let i = 0; i < 10; i++) cw.append(`msg${i}`);

  const start = Date.now();
  const rendered = cw.render('query');  // synchronous — no await
  const latency = Date.now() - start;

  expect(latency).toBeLessThan(10);  // <10ms (no LLM calls)
  expect(rendered.length).toBeGreaterThan(0);
});

test('resolveDirty batch-summarizes dirty clusters', async () => {
  for (let i = 0; i < 50; i++) cw.append(`msg${i}`);

  expect(summarizer.summarize).not.toHaveBeenCalled();

  await cw.resolveDirty();

  // ~10 calls (one per dirty cluster), not 80 (one per merge)
  expect(summarizer.summarize.mock.calls.length).toBeLessThanOrEqual(15);
});

test('overlap window: graduated messages still in hot', () => {
  const cw = new ContextWindow(embedder, summarizer, {
    graduateAt: 3, evictAt: 5
  });
  for (let i = 0; i < 4; i++) cw.append(`msg${i}`);

  // msg0 graduated but still in hot (overlap window)
  expect(cw.hotCount).toBe(4);
  expect(cw.coldClusterCount).toBe(1);

  const rendered = cw.render();
  // msg0 appears from hot zone (verbatim), not from stale cold summary
  expect(rendered).toContain('msg0');
});
```

### Review-Driven Hardening

After implementation, a code review (GPT-5.4) identified 10 issues. 5 were fixed:

1. **Embedding dimension mismatch → NaN** (HIGH): `cosineSimilarity()` and centroid merging now handle mismatched vector lengths (TF-IDF vocabulary grows, making newer vectors longer than older ones).
2. **`resolveDirty()` race condition** (HIGH): Replaced `_dirtyInputs.clear()` with per-entry deletion and reference-equality guard. If `union()` modifies a cluster during async summarization, the stale result is discarded.
3. **Render query corpus contamination** (HIGH): Added `embedQuery()` to `Embedder` interface. `render(query)` uses it to avoid mutating TF-IDF state.
4. **In-flight merge during summarization** (HIGH): If a root is merged while its summary is in flight, the summary is safely skipped via `_dirtyInputs.get(root) === inputs` identity check.
5. **Config validation** (MEDIUM): Constructor rejects `evictAt < graduateAt`.

5 documented as known limitations (see above).

Full details in [WORK_LOG.md](WORK_LOG.md).

### Success Criteria for Spike

**Spike passes if:**
1. ✅ **Correctness tests pass** - 62 tests green across 4 test files
2. ✅ **Behavior tests pass** - Integration tests green, backward compat verified
3. ✅ **Recall improvement** - Union-find **≥ flat with statistical significance** (McNemar's test, p < 0.05)
4. ✅ **Non-blocking UX** - Append latency < 100ms
5. ✅ **Cost acceptable** - Total tokens comparable to flat (not 2x - see cost model)

**Spike fails if:**
- ❌ Correctness tests fail → Learning: implementation bug, fix in prose
- ❌ Recall worse than flat → Learning: TF-IDF insufficient, try dense embeddings
- ❌ Cost > 3x flat → Learning: too many merges, adjust thresholds
- ❌ Latency > 1s per append → Learning: embedding too slow, optimize or simplify

## Design Decisions & Known Limitations

**All design decisions documented in:** [DESIGN_DECISIONS.md](DESIGN_DECISIONS.md)

**Key decisions for spike:**
- Hot zone = 30 messages (configurable, matches 30% preservation)
- TF-IDF embeddings (swap to dense if recall < statsig threshold)
- No verification for cluster summaries (trust single-pass)
- Real conversation dataset preferred for testing
- Statsig recall threshold: ≥ flat with p < 0.05

**Known limitations (deferred to future):**
- Message edits not supported
- Cache eviction at 1000 messages not yet implemented (design doc specifies it, code omits it — `_nodes` map grows unboundedly)
- Unbounded TF-IDF vocabulary — `_vocab` and `_termDocFreq` grow without bound
- IDF drift — old embeddings/centroids stale as corpus evolves, never recomputed
- `totalMessages` double-counts messages in the overlap window
- `AbortSignal` not propagated — `ClusterSummarizer` creates a detached controller per call; user cancellation doesn't stop background summarization
- Overlap window renders messages in both cold (cluster summary) and hot (verbatim) — no deduplication

### Inherited bugs from shared utilities

The union-find path calls `truncateHistoryToBudget()` before graduation. A code review
of the existing flat compression path found four bugs in shared code. Two are inherited:

**Inherited:**
1. **Tool-response field loss** (HIGH): `truncateHistoryToBudget` extracts only
   `response.output` or `response.content` into a string, estimates tokens from that
   alone, then rewrites the response to `{ output: truncatedMessage }`. Other fields
   on the response object are silently discarded. Token budget can be exceeded because
   extra fields aren't counted. Users report compression barely reducing size
   ([#15225](https://github.com/google-gemini/gemini-cli/issues/15225)).

2. **Unbounded temp-file growth** (MEDIUM): Each compression run writes a full copy of
   oversized tool outputs to `tool-outputs/` with a new truncation ID. No dedup or
   cleanup. Long sessions leak disk space.

**Not inherited:**
3. `findCompressSplitPoint` uses `JSON.stringify` length — union-find doesn't use this.
4. "Send original vs truncated" gate uses wrong model limit — union-find has no such gate.

**Plan:** These are upstream bugs. Fixing them benefits both paths. Proposed as separate
PRs rather than bundling with the union-find feature:

- **Fix 1 (token accounting + field loss):** `truncateHistoryToBudget` bypasses the
  existing `estimateFunctionResponseTokens()` in `tokenCalculation.ts:76` and estimates
  only extracted text. Fix: use `estimateTokenCountSync([part])` for full-part budgeting.
  For truncation, replace only `response.output` or `response.content` (the large payload
  field) instead of rewriting the entire response to `{ output: ... }`. This preserves
  structured sibling fields. Risk: more accurate counting will truncate earlier, shifting
  test expectations.

- **Fix 2 (temp file leak):** Compression writes to project-level `tool-outputs/` without
  a `sessionId`, but session cleanup only deletes `tool-outputs/session-<id>/`. "Add
  cleanup on session end" won't catch these files. Fix: write compression artifacts under
  a session-specific path (`tool-outputs/session-<id>/`), then existing session cleanup
  handles them. Content-hash dedup is overkill as first step — defer unless disk usage
  remains a problem after session-scoped writes.

**Approach:** Add root-cause comments to existing issues (#15225, #22942) rather than
opening new ones. Go straight to PRs if maintainers are receptive.

**See DESIGN_DECISIONS.md for complete rationale and iteration triggers.**

## Next: Implementation Iteration

This transformation design is the **initial specification** for Step 8.1 (spike implementation).

**Expected flow:**
1. Set up test harness (all tests above)
2. Run tests against current code (flat) → establishes baseline
3. Implement transformation (apply this prose)
4. Run tests against new code (union-find)
5. Tests pass? → Success, proceed to performance experiment
6. Tests fail? → Extract learnings, update this prose, retry

**This document will evolve** based on what we learn in implementation.
