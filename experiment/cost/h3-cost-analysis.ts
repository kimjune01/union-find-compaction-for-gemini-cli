/**
 * H3 Cost Analysis: Token consumption comparison between flat and union-find
 *
 * Measures total tokens consumed (input + output) by each compression strategy
 * on identical 200-message conversations. Uses character-based token estimation
 * (chars/4) matching the rough estimation used elsewhere in the codebase.
 *
 * For flat compression:
 * - 2 LLM calls per compression event (summarize + verify)
 * - Input = all old messages (70% of history)
 * - Output = summary text
 *
 * For union-find:
 * - 1 LLM call per merge event
 * - Input = cluster member messages (small subset)
 * - Output = cluster summary
 *
 * Preregistered pass criterion: union-find total tokens <= 2x flat total tokens
 */

import {
  ContextWindow,
  type Summarizer,
} from '/Users/junekim/Documents/gemini-cli-experiment/packages/core/dist/src/services/contextWindow.js';
import { TFIDFEmbedder } from '/Users/junekim/Documents/gemini-cli-experiment/packages/core/dist/src/services/embeddingService.js';

// -- Token-tracking summarizer --
class TokenTrackingSummarizer implements Summarizer {
  callCount = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  callDetails: Array<{
    callNum: number;
    inputTokens: number;
    outputTokens: number;
    numMessages: number;
  }> = [];

  async summarize(messages: string[]): Promise<string> {
    this.callCount++;
    const joined = messages.join('\n');
    const inputTokens = Math.ceil(joined.length / 4);
    this.totalInputTokens += inputTokens;

    // Simulate LLM output: ~20% of input size (typical compression ratio)
    const outputLen = Math.ceil(joined.length * 0.2);
    const output = joined.slice(0, outputLen);
    const outputTokens = Math.ceil(output.length / 4);
    this.totalOutputTokens += outputTokens;

    this.callDetails.push({
      callNum: this.callCount,
      inputTokens,
      outputTokens,
      numMessages: messages.length,
    });

    return output;
  }
}

// -- Generate realistic conversation --
function generateMessages(n: number): string[] {
  const templates = [
    'I\'m getting an error when running `npm install` in the project root. The error says "ERESOLVE unable to resolve dependency tree" and mentions a conflict between react@18.2.0 and react@17.0.2.',
    'Can you help me debug this TypeScript error? I have a generic function `function merge<T extends Record<string, unknown>>(a: T, b: Partial<T>): T`.',
    'The API endpoint at `/api/v2/users/:id/preferences` is returning a 500 error.',
    'I need to optimize this database query that takes 3.2 seconds on a table with 2M rows.',
    'How do I set up a GitHub Actions workflow that runs tests on PR?',
    'The WebSocket connection keeps dropping after exactly 60 seconds.',
    'I\'m trying to implement rate limiting using Redis with sliding window counter.',
    'The Docker build is failing at the `RUN npm ci` step with ENOMEM error.',
    'Can you review this migration script for adding a JSONB column?',
    'Implementing OAuth2 PKCE flow for our SPA with CORS issues.',
    'Looking at the error, you can resolve the dependency conflict with overrides in package.json.',
    'The issue is that Partial<T> makes all properties optional. Use Object.assign or spread.',
    'The 500 error is a null reference. Add optional chaining: user.preferences?.theme.',
    'For query optimization: add a composite index and use a CTE to pre-filter.',
    'Here\'s a GitHub Actions workflow using matrix strategy for parallel test execution.',
    'The 60-second timeout is from the load balancer. Add WebSocket ping/pong.',
    'For Redis rate limiting, use a Lua script for atomic check-and-increment.',
    'The ENOMEM error: use multi-stage Docker build with increased NODE_OPTIONS.',
    'The migration needs batch size for backfill and a JSONB default.',
    'For PKCE CORS, proxy the token request through your backend.',
  ];

  const messages: string[] = [];
  for (let i = 0; i < n; i++) {
    messages.push(`[Turn ${i + 1}] ${templates[i % templates.length]}`);
  }
  return messages;
}

// -- Estimate flat compression cost --
function estimateFlatCost(messages: string[], preserveRatio: number = 0.3) {
  const splitPoint = Math.floor(messages.length * (1 - preserveRatio));
  const toCompress = messages.slice(0, splitPoint);
  const inputText = toCompress.map((m) => m).join('\n');
  const inputTokens = Math.ceil(inputText.length / 4);

  // Flat uses 2 calls: summarize + verify
  // Call 1 (summarize): input = all old messages + system prompt
  const systemPromptTokens = 500; // approximate
  const call1Input = inputTokens + systemPromptTokens;
  const call1Output = Math.ceil(inputTokens * 0.15); // ~15% compression ratio for summary

  // Call 2 (verify): input = old messages + summary + verification prompt
  const verifyPromptTokens = 100;
  const call2Input = inputTokens + call1Output + verifyPromptTokens;
  const call2Output = Math.ceil(call1Output * 1.1); // verified summary slightly longer

  return {
    numCalls: 2,
    call1: { input: call1Input, output: call1Output },
    call2: { input: call2Input, output: call2Output },
    totalInput: call1Input + call2Input,
    totalOutput: call1Output + call2Output,
    totalTokens: call1Input + call2Input + call1Output + call2Output,
    messagesCompressed: toCompress.length,
    messagesPreserved: messages.length - splitPoint,
  };
}

// -- Main --
async function runCostAnalysis() {
  console.log('=== H3 Cost Analysis ===');
  console.log('Token estimation: chars/4 (rough approximation)');
  console.log('');

  const NUM_MESSAGES = 200;
  const messages = generateMessages(NUM_MESSAGES);

  // -- Flat cost --
  const flatCost = estimateFlatCost(messages);

  console.log('--- Flat Compression ---');
  console.log(`Messages compressed: ${flatCost.messagesCompressed}`);
  console.log(`Messages preserved: ${flatCost.messagesPreserved}`);
  console.log(`LLM calls: ${flatCost.numCalls}`);
  console.log(`  Call 1 (summarize): ${flatCost.call1.input} input + ${flatCost.call1.output} output = ${flatCost.call1.input + flatCost.call1.output} tokens`);
  console.log(`  Call 2 (verify): ${flatCost.call2.input} input + ${flatCost.call2.output} output = ${flatCost.call2.input + flatCost.call2.output} tokens`);
  console.log(`Total tokens: ${flatCost.totalTokens}`);
  console.log('');

  // -- Union-find cost --
  const embedder = new TFIDFEmbedder();
  const summarizer = new TokenTrackingSummarizer();
  const contextWindow = new ContextWindow(embedder, summarizer, {
    hotSize: 30,
    maxColdClusters: 10,
    mergeThreshold: 0.15,
  });

  for (const msg of messages) {
    await contextWindow.append(msg);
  }

  console.log('--- Union-Find Compression ---');
  console.log(`Hot zone: ${contextWindow.hotCount} messages`);
  console.log(`Cold clusters: ${contextWindow.coldClusterCount}`);
  console.log(`LLM calls: ${summarizer.callCount}`);
  console.log(`Total input tokens: ${summarizer.totalInputTokens}`);
  console.log(`Total output tokens: ${summarizer.totalOutputTokens}`);
  console.log(`Total tokens: ${summarizer.totalInputTokens + summarizer.totalOutputTokens}`);
  console.log('');

  // -- Per-call breakdown --
  console.log('--- Union-Find Call Details (first 10 and last 5) ---');
  const details = summarizer.callDetails;
  const showCalls = [...details.slice(0, 10), ...details.slice(-5)];
  console.log('Call# | Msgs | Input Tok | Output Tok | Total');
  console.log('------|------|-----------|------------|------');
  for (const d of showCalls) {
    console.log(
      `${String(d.callNum).padStart(5)} | ${String(d.numMessages).padStart(4)} | ` +
      `${String(d.inputTokens).padStart(9)} | ${String(d.outputTokens).padStart(10)} | ` +
      `${d.inputTokens + d.outputTokens}`
    );
  }
  if (details.length > 15) {
    console.log(`... (${details.length - 15} calls omitted)`);
  }
  console.log('');

  // -- Comparison --
  const unionTotal = summarizer.totalInputTokens + summarizer.totalOutputTokens;
  const ratio = unionTotal / flatCost.totalTokens;

  console.log('--- Cost Comparison ---');
  console.log(`Flat total tokens:       ${flatCost.totalTokens}`);
  console.log(`Union-find total tokens: ${unionTotal}`);
  console.log(`Ratio (union-find/flat): ${ratio.toFixed(2)}x`);
  console.log('');

  // -- H3 Verdict --
  console.log('=== H3 VERDICT ===');
  console.log(`Ratio: ${ratio.toFixed(2)}x`);
  console.log(`Criterion: union-find <= 2x flat`);
  if (ratio <= 2.0) {
    console.log(`Result: PASS ✅`);
  } else {
    console.log(`Result: FAIL ❌`);
  }
  console.log('');

  // -- Context --
  console.log('=== NOTES ===');
  console.log('1. Token counts are ESTIMATED (chars/4), not from real API responses.');
  console.log('2. Flat compression happens once (blocking). Union-find spreads calls over time.');
  console.log('3. Flat does 2 calls (summarize + verify). Union-find does ~1 call per merge.');
  console.log('4. Union-find processes smaller inputs per call but more calls total.');
  console.log(`5. Union-find call count (${summarizer.callCount}) >> flat call count (2),`);
  console.log('   but many union-find calls process just 2-10 messages vs flat processing 140.');
  console.log('');

  // JSON output
  console.log('--- JSON Results ---');
  console.log(JSON.stringify({
    metadata: {
      date: new Date().toISOString(),
      numMessages: NUM_MESSAGES,
      tokenEstimation: 'chars/4',
      limitation: 'Estimated tokens, not real API counts',
    },
    flat: {
      calls: flatCost.numCalls,
      totalInputTokens: flatCost.totalInput,
      totalOutputTokens: flatCost.totalOutput,
      totalTokens: flatCost.totalTokens,
      messagesCompressed: flatCost.messagesCompressed,
    },
    unionFind: {
      calls: summarizer.callCount,
      totalInputTokens: summarizer.totalInputTokens,
      totalOutputTokens: summarizer.totalOutputTokens,
      totalTokens: unionTotal,
      hotMessages: contextWindow.hotCount,
      coldClusters: contextWindow.coldClusterCount,
    },
    comparison: {
      ratio,
      pass: ratio <= 2.0,
    },
  }, null, 2));
}

runCostAnalysis().catch(console.error);
