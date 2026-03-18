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

### Target: Union-Find Compaction

```
ContextWindow
  ├─ append(content, timestamp)
  ├─ _graduate(message) → triggers merge if needed
  ├─ render(query?) → retrieved clusters + hot messages
  └─ Forest
      ├─ insert(msg_id, content, embedding, timestamp)
      ├─ find(msg_id) → root with path compression
      ├─ union(id_a, id_b) → merge + summarize
      ├─ nearest(query_embedding, k) → top-k clusters
      └─ expand(root_id) → source messages
```

**Flow:**
1. Every message appends to ContextWindow
2. If hot exceeds capacity, oldest graduates to cold
3. Graduated message merges into nearest cluster (or creates singleton)
4. If cold exceeds cluster budget, closest pair merges (one LLM call)
5. Render: retrieve relevant clusters + all hot messages

## What Changes

### 1. New Classes (Port from Reference)

**File:** `packages/core/src/services/contextWindow.ts`

```typescript
interface Embedder {
  embed(text: string): Promise<number[]>;
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
  private _summaries: Map<number, string>;    // root_id → summary
  private _children: Map<number, number[]>;   // root_id → member ids
  private _centroids: Map<number, number[]>;  // root_id → centroid
  private _embedder: Embedder;
  private _summarizer: Summarizer;

  insert(msg_id: number, content: string, embedding?: number[], timestamp?: string): number;
  find(msg_id: number): number;  // with path compression
  union(id_a: number, id_b: number): number;  // merge + summarize
  compact(root_id: number): string;  // return summary
  expand(root_id: number): string[];  // return source messages
  nearest(query_embedding: number[], k: number, min_sim: number): number[];

  // Queries
  roots(): number[];
  members(root_id: number): number[];
  summary(root_id: number): string | null;
  size(): number;
  cluster_count(): number;
}

class ContextWindow {
  private _forest: Forest;
  private _hot: Message[];  // Fixed-size array (circular buffer or array)
  private _hot_size: number;
  private _max_cold_clusters: number;
  private _merge_threshold: number;
  private _next_id: number;

  constructor(
    embedder: Embedder,
    summarizer: Summarizer,
    hot_size: number = 20,
    max_cold_clusters: number = 10,
    merge_threshold: number = 0.15
  );

  append(content: string, timestamp?: string): number;
  private _graduate(msg: Message): void;
  render(query?: string, k?: number, min_sim?: number): string[];
  expand(root_id: number): string[];

  // Getters
  hot_count(): number;
  cold_cluster_count(): number;
  total_messages(): number;
  forest(): Forest;
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
   - `window.append(message.content, message.timestamp)`
3. Render context: `window.render(query=lastUserMessage)`
4. Return rendered clusters + hot messages as new history

### 3. New: Embedding Strategy

**File:** `packages/core/src/services/embeddingService.ts`

Two options, choose one:

**Option A: TF-IDF (cheap, deterministic, local)**
```typescript
class TFIDFEmbedder implements Embedder {
  private vocabulary: Map<string, number>;
  private idf: Map<string, number>;

  async embed(text: string): Promise<number[]> {
    // Tokenize, compute TF, multiply by IDF, return sparse vector
  }
}
```

**Pros:** No API calls, deterministic, fast
**Cons:** Lexically shallow, poor semantic matching

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
    // Sort by timestamp if available
    // Generate summary via single LLM call
    // Prompt: "Summarize these N messages into one dense paragraph.
    //          Preserve technical details: ports, paths, commands, versions.
    //          This is a cluster from a larger conversation."
    const response = await this.llmClient.generateContent({
      modelConfigKey: { model: this.modelConfigKey },
      contents: [{
        role: 'user',
        parts: [{
          text: this.buildClusterPrompt(messages)
        }]
      }],
      systemInstruction: { text: 'You are a cluster summarizer...' },
      role: LlmRole.UTILITY_COMPRESSOR
    });
    return getResponseText(response) ?? '';
  }

  private buildClusterPrompt(messages: string[]): string {
    return `Summarize these ${messages.length} messages into one dense paragraph (max 150 tokens).
Preserve all specific technical details: version numbers, ports, file paths, commands, function names, thresholds.
Drop filler and acknowledgments.

Messages:
${messages.map((m, i) => `[${i+1}] ${m}`).join('\n\n')}`;
  }
}
```

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

**Cost model for Pro users:**
- Flat: 2 calls per compression event × large context (190 messages)
- Union-find: 1 call per merge × small context (20-40 messages)
- More calls, but each is cheaper input
- Total cost comparable, but amortized over time (non-blocking)

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
  blockingTimeMs: number;        // 0 for union-find, 10000-30000 for flat
  messagesPerSecond: number;     // Throughput during compression

  // Cost
  llmCallCount: number;          // Flat: 2 per event, UF: ~1 per merge
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
test('union-find is non-blocking', async () => {
  const start = Date.now();
  await ufCompression.append(message);
  const latency = Date.now() - start;

  expect(latency).toBeLessThan(100);  // <100ms per append
});

test('flat compression blocks user', async () => {
  const start = Date.now();
  await flatCompression.compress();
  const blockingTime = Date.now() - start;

  expect(blockingTime).toBeGreaterThan(10000);  // >10s blocking
});

test('cost comparison for 200-message conversation', async () => {
  const flatMetrics = await measureCompressionCost(flatStrategy, conversation);
  const ufMetrics = await measureCompressionCost(ufStrategy, conversation);

  // Union-find may have more calls but each is smaller
  console.log('Flat:', flatMetrics);
  console.log('Union-find:', ufMetrics);

  // Acceptable if total cost within 2x
  expect(ufMetrics.totalInputTokens).toBeLessThan(flatMetrics.totalInputTokens * 2);
});
```

### Success Criteria for Spike

**Spike passes if:**
1. ✅ **Correctness tests pass** - Unit tests green
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
- Concurrency not handled (assumes sequential processing)
- Cache eviction at 1000 messages (evict sources, keep summaries)

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
