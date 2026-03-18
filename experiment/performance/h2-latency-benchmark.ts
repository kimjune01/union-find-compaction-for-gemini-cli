/**
 * H2 Latency Benchmark: Union-find per-append latency measurement
 *
 * Measures wall-clock time for each ContextWindow.append() call on a
 * 200-message conversation. Uses a mock summarizer with near-zero latency
 * to isolate local computation overhead (TF-IDF embedding, cosine similarity,
 * forest operations).
 *
 * Also tracks:
 * - Which appends trigger graduation (hot → cold)
 * - Which graduations trigger LLM merge calls
 * - p50, p95, p99, max latencies
 *
 * Preregistered pass criterion: p95 < 100ms
 */

import {
  ContextWindow,
  type Summarizer,
  type Embedder,
} from '/Users/junekim/Documents/gemini-cli/packages/core/src/services/contextWindow.js';
import { TFIDFEmbedder } from '/Users/junekim/Documents/gemini-cli/packages/core/src/services/embeddingService.js';

// -- Mock summarizer that tracks call count --
class MockSummarizer implements Summarizer {
  callCount = 0;
  totalInputChars = 0;

  async summarize(messages: string[]): Promise<string> {
    this.callCount++;
    const joined = messages.join(' ');
    this.totalInputChars += joined.length;
    // Simulate minimal processing — extract first 200 chars as "summary"
    return joined.slice(0, 200);
  }
}

// -- Generate realistic coding conversation messages --
function generateConversation(numMessages: number): string[] {
  const templates = [
    // User messages
    'I\'m getting an error when running `npm install` in the project root. The error says "ERESOLVE unable to resolve dependency tree" and mentions a conflict between react@18.2.0 and react@17.0.2.',
    'Can you help me debug this TypeScript error? I have a generic function `function merge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T` but the compiler says "Type Partial<T> is not assignable to type T".',
    'The API endpoint at `/api/v2/users/:id/preferences` is returning a 500 error. I checked the server logs and see "TypeError: Cannot read properties of undefined (reading \'theme\')" at line 42 of userPreferences.controller.ts.',
    'I need to optimize this database query: `SELECT u.*, COUNT(o.id) as order_count FROM users u LEFT JOIN orders o ON u.id = o.user_id WHERE u.created_at > \'2024-01-01\' GROUP BY u.id ORDER BY order_count DESC LIMIT 50`. It\'s taking 3.2 seconds on a table with 2M rows.',
    'How do I set up a GitHub Actions workflow that runs tests on PR, deploys to staging on merge to develop, and deploys to production on merge to main? I need it to work with our monorepo structure using nx.',
    'The WebSocket connection keeps dropping after exactly 60 seconds. I\'m using `ws` library v8.16.0 with Node.js 20.11.0. The nginx proxy has `proxy_read_timeout 3600s` configured.',
    'I\'m trying to implement rate limiting using Redis. My current approach uses a sliding window counter with `MULTI/EXEC` but I\'m seeing race conditions under high load. About 5% of requests exceed the limit.',
    'The Docker build is failing at the `RUN npm ci` step with "error An unexpected error occurred: ENOMEM not enough memory". The build machine has 8GB RAM. The node_modules folder is about 1.2GB.',
    'Can you review this migration script? It needs to add a `metadata` JSONB column to the `events` table and backfill it from the existing `extra_data` TEXT column, parsing the JSON string.',
    'I\'m implementing OAuth2 PKCE flow for our SPA. The auth server returns the token but the CORS preflight for the token endpoint fails with "No Access-Control-Allow-Origin header".',
    // Model responses
    'Looking at the error, the dependency conflict is between two versions of React. You can resolve this by adding an `overrides` field in your package.json: `"overrides": { "react": "18.2.0" }`. Alternatively, use `npm install --legacy-peer-deps`.',
    'The issue with your generic function is that `Partial<T>` makes all properties optional, so it\'s a wider type than `T`. You need to use Object.assign or a spread: `return { ...a, ...b } as T`. The type assertion is safe here because you\'re only overwriting existing keys.',
    'The 500 error is a null reference. The user preferences object doesn\'t have a `theme` property when the user hasn\'t set preferences yet. Add a null check: `const theme = user.preferences?.theme ?? \'default\'`. Also add a migration to set default preferences for existing users.',
    'For the query optimization: 1) Add a composite index: `CREATE INDEX idx_users_created_orders ON users(created_at) INCLUDE (id)`. 2) Use a CTE to pre-filter: `WITH recent_users AS (SELECT id FROM users WHERE created_at > ...)`. 3) Consider materializing the order count as a denormalized column if this query runs frequently.',
    'Here\'s a complete GitHub Actions workflow for your monorepo setup using nx affected. The workflow uses matrix strategy for parallel test execution and has three jobs: test (on PR), deploy-staging (on develop merge), and deploy-prod (on main merge with manual approval gate).',
    'The 60-second timeout is likely from a load balancer or proxy between your client and nginx. Common culprits: AWS ALB (default 60s idle timeout), CloudFlare (100s), or your application server. Add WebSocket ping/pong: `setInterval(() => ws.ping(), 30000)` to keep the connection alive.',
    'For Redis rate limiting with sliding windows, use a Lua script to make the check-and-increment atomic: `local current = redis.call("ZRANGEBYSCORE", KEYS[1], window_start, "+inf")`. This eliminates the race condition because Redis executes Lua scripts atomically.',
    'The ENOMEM error during npm ci usually means the build is running out of memory during native module compilation. Solutions: 1) Set `NODE_OPTIONS="--max-old-space-size=4096"`. 2) Use multi-stage Docker build to separate install from build. 3) Add `.dockerignore` to exclude node_modules.',
    'The migration looks good but needs a few changes: 1) Add a batch size for backfill (1000 rows at a time to avoid locking). 2) Use `ALTER TABLE events ADD COLUMN metadata JSONB DEFAULT \'{}\'::jsonb` to avoid null checks. 3) Add an index on the JSONB column for common query patterns.',
    'For PKCE with CORS, the issue is that the token endpoint needs to include CORS headers. If you control the auth server, add `Access-Control-Allow-Origin: https://your-spa.com` and `Access-Control-Allow-Methods: POST` headers. If using a third-party provider, proxy the token request through your backend.',
  ];

  const messages: string[] = [];
  for (let i = 0; i < numMessages; i++) {
    const template = templates[i % templates.length];
    // Add message index to make each message unique (affects TF-IDF)
    messages.push(`[Message ${i + 1}] ${template}`);
  }
  return messages;
}

// -- Percentile calculation --
function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// -- Main benchmark --
async function runBenchmark() {
  const NUM_MESSAGES = 200;
  const HOT_SIZE = 30;
  const MAX_COLD_CLUSTERS = 10;
  const MERGE_THRESHOLD = 0.15;

  console.log('=== H2 Latency Benchmark ===');
  console.log(`Messages: ${NUM_MESSAGES}`);
  console.log(`Hot zone size: ${HOT_SIZE}`);
  console.log(`Max cold clusters: ${MAX_COLD_CLUSTERS}`);
  console.log(`Merge threshold: ${MERGE_THRESHOLD}`);
  console.log(`Machine: Apple M4 Pro, 48GB RAM`);
  console.log(`Node.js: v22.21.1`);
  console.log(`Date: ${new Date().toISOString()}`);
  console.log('');

  const embedder = new TFIDFEmbedder();
  const summarizer = new MockSummarizer();
  const contextWindow = new ContextWindow(embedder, summarizer, {
    hotSize: HOT_SIZE,
    maxColdClusters: MAX_COLD_CLUSTERS,
    mergeThreshold: MERGE_THRESHOLD,
  });

  const messages = generateConversation(NUM_MESSAGES);

  interface LatencyRecord {
    msgIndex: number;
    latencyMs: number;
    hotCount: number;
    coldClusterCount: number;
    totalMessages: number;
    triggeredGraduation: boolean;
    summarizerCallsBefore: number;
    summarizerCallsAfter: number;
    triggeredMerge: boolean;
  }

  const records: LatencyRecord[] = [];

  for (let i = 0; i < messages.length; i++) {
    const callsBefore = summarizer.callCount;
    const hotBefore = contextWindow.hotCount;

    const start = performance.now();
    await contextWindow.append(messages[i]);
    const end = performance.now();

    const latencyMs = end - start;
    const callsAfter = summarizer.callCount;
    const triggeredGraduation = hotBefore >= HOT_SIZE;
    const triggeredMerge = callsAfter > callsBefore;

    records.push({
      msgIndex: i,
      latencyMs,
      hotCount: contextWindow.hotCount,
      coldClusterCount: contextWindow.coldClusterCount,
      totalMessages: contextWindow.totalMessages,
      triggeredGraduation,
      summarizerCallsBefore: callsBefore,
      summarizerCallsAfter: callsAfter,
      triggeredMerge,
    });
  }

  // -- Analysis --
  const latencies = records.map((r) => r.latencyMs);
  const sorted = [...latencies].sort((a, b) => a - b);

  const hotOnlyLatencies = records
    .filter((r) => !r.triggeredGraduation)
    .map((r) => r.latencyMs);
  const gradNoMergeLatencies = records
    .filter((r) => r.triggeredGraduation && !r.triggeredMerge)
    .map((r) => r.latencyMs);
  const gradWithMergeLatencies = records
    .filter((r) => r.triggeredMerge)
    .map((r) => r.latencyMs);

  console.log('--- Overall Latency Distribution ---');
  console.log(`  Count: ${sorted.length}`);
  console.log(`  Min:   ${sorted[0].toFixed(3)} ms`);
  console.log(`  p50:   ${percentile(sorted, 50).toFixed(3)} ms`);
  console.log(`  p90:   ${percentile(sorted, 90).toFixed(3)} ms`);
  console.log(`  p95:   ${percentile(sorted, 95).toFixed(3)} ms`);
  console.log(`  p99:   ${percentile(sorted, 99).toFixed(3)} ms`);
  console.log(`  Max:   ${sorted[sorted.length - 1].toFixed(3)} ms`);
  console.log(`  Mean:  ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(3)} ms`);
  console.log('');

  if (hotOnlyLatencies.length > 0) {
    const hotSorted = [...hotOnlyLatencies].sort((a, b) => a - b);
    console.log(`--- Hot-Only Appends (no graduation) ---`);
    console.log(`  Count: ${hotOnlyLatencies.length} (${((hotOnlyLatencies.length / NUM_MESSAGES) * 100).toFixed(1)}%)`);
    console.log(`  p50: ${percentile(hotSorted, 50).toFixed(3)} ms`);
    console.log(`  p95: ${percentile(hotSorted, 95).toFixed(3)} ms`);
    console.log(`  Max: ${hotSorted[hotSorted.length - 1].toFixed(3)} ms`);
    console.log('');
  }

  if (gradNoMergeLatencies.length > 0) {
    const gnmSorted = [...gradNoMergeLatencies].sort((a, b) => a - b);
    console.log(`--- Graduation Without Merge ---`);
    console.log(`  Count: ${gradNoMergeLatencies.length} (${((gradNoMergeLatencies.length / NUM_MESSAGES) * 100).toFixed(1)}%)`);
    console.log(`  p50: ${percentile(gnmSorted, 50).toFixed(3)} ms`);
    console.log(`  p95: ${percentile(gnmSorted, 95).toFixed(3)} ms`);
    console.log(`  Max: ${gnmSorted[gnmSorted.length - 1].toFixed(3)} ms`);
    console.log('');
  }

  if (gradWithMergeLatencies.length > 0) {
    const gwmSorted = [...gradWithMergeLatencies].sort((a, b) => a - b);
    console.log(`--- Graduation With Merge (includes mock summarizer call) ---`);
    console.log(`  Count: ${gradWithMergeLatencies.length} (${((gradWithMergeLatencies.length / NUM_MESSAGES) * 100).toFixed(1)}%)`);
    console.log(`  p50: ${percentile(gwmSorted, 50).toFixed(3)} ms`);
    console.log(`  p95: ${percentile(gwmSorted, 95).toFixed(3)} ms`);
    console.log(`  Max: ${gwmSorted[gwmSorted.length - 1].toFixed(3)} ms`);
    console.log('');
  }

  console.log('--- Merge Frequency ---');
  const totalMerges = records.filter((r) => r.triggeredMerge).length;
  const totalGraduations = records.filter((r) => r.triggeredGraduation).length;
  console.log(`  Total summarizer calls: ${summarizer.callCount}`);
  console.log(`  Appends triggering graduation: ${totalGraduations}/${NUM_MESSAGES} (${((totalGraduations / NUM_MESSAGES) * 100).toFixed(1)}%)`);
  console.log(`  Graduations triggering merge: ${totalMerges}/${totalGraduations} (${totalGraduations > 0 ? ((totalMerges / totalGraduations) * 100).toFixed(1) : 'N/A'}%)`);
  console.log(`  Total summarizer input chars: ${summarizer.totalInputChars}`);
  console.log('');

  console.log('--- Final State ---');
  console.log(`  Hot zone messages: ${contextWindow.hotCount}`);
  console.log(`  Cold clusters: ${contextWindow.coldClusterCount}`);
  console.log(`  Total messages tracked: ${contextWindow.totalMessages}`);
  console.log('');

  // -- H2 Verdict --
  const p95 = percentile(sorted, 95);
  console.log('=== H2 VERDICT ===');
  console.log(`p95 latency: ${p95.toFixed(3)} ms`);
  console.log(`Criterion: p95 < 100ms`);
  if (p95 < 100) {
    console.log(`Result: PASS ✅ (with mock summarizer — local computation is fast)`);
  } else {
    console.log(`Result: FAIL ❌`);
  }
  console.log('');

  // -- Critical finding: LLM call frequency --
  const mergePercent = (totalMerges / NUM_MESSAGES) * 100;
  console.log('=== CRITICAL FINDING: LLM Call Frequency ===');
  console.log(`${mergePercent.toFixed(1)}% of appends trigger LLM summarizer calls.`);
  if (mergePercent > 5) {
    console.log(`WARNING: With a real LLM (typical latency 500ms-5s),`);
    console.log(`p95 would be dominated by LLM response time, NOT local computation.`);
    console.log(`The p95 < 100ms criterion requires either:`);
    console.log(`  1. Async/background summarization (architectural change)`);
    console.log(`  2. An extremely fast summarizer (<100ms response time)`);
    console.log(`  3. Reducing merge frequency (increase hot zone or cluster limit)`);
  }
  console.log('');

  // -- Write CSV --
  const csvHeader = 'msg_index,latency_ms,hot_count,cold_cluster_count,total_messages,triggered_graduation,triggered_merge';
  const csvRows = records.map(
    (r) =>
      `${r.msgIndex},${r.latencyMs.toFixed(4)},${r.hotCount},${r.coldClusterCount},${r.totalMessages},${r.triggeredGraduation},${r.triggeredMerge}`,
  );
  const csv = [csvHeader, ...csvRows].join('\n');

  // Write to stdout for capture
  console.log('--- CSV Data (union-find-latencies.csv) ---');
  console.log(csv);

  return { records, p95, summarizer };
}

runBenchmark().catch(console.error);
