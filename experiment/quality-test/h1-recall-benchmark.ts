/**
 * H1 Recall Benchmark: Union-find vs flat compression information retention
 *
 * Without real LLM API access, measures STRUCTURAL information retention:
 * - Plants unique technical "facts" (file paths, error codes, port numbers, API names)
 *   at specific positions throughout conversations
 * - Compresses both ways using a budget-limited mock summarizer
 * - Counts how many planted facts survive in the compressed output
 * - Runs McNemar's test on paired binary outcomes
 *
 * The mock summarizer simulates LLM compression by keeping the most
 * "important" content up to a fixed character budget per summary.
 * This tests the STRUCTURAL advantage of clustered vs flat compression,
 * not LLM summarization quality.
 *
 * Preregistered pass criterion: union-find recall >= flat recall + 5pp (p<0.05)
 */

import {
  ContextWindow,
  Forest,
  type Summarizer,
} from '/Users/junekim/Documents/gemini-cli/packages/core/src/services/contextWindow.js';
import { TFIDFEmbedder } from '/Users/junekim/Documents/gemini-cli/packages/core/src/services/embeddingService.js';

// -- Types --
interface PlantedFact {
  id: string;
  fact: string;         // The unique searchable string
  messageIndex: number; // Where it was planted
  topic: string;        // Topic cluster it belongs to
}

interface Conversation {
  id: string;
  messages: string[];
  plantedFacts: PlantedFact[];
}

interface TrialResult {
  conversationId: string;
  factId: string;
  flatRetained: boolean;
  unionFindRetained: boolean;
}

// -- Budget-limited mock summarizer --
// Simulates LLM compression: keeps first N chars of concatenated input.
// This models the key constraint: fixed output budget regardless of input size.
class BudgetSummarizer implements Summarizer {
  private budget: number;
  callCount = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;

  constructor(budget: number = 500) {
    this.budget = budget;
  }

  async summarize(messages: string[]): Promise<string> {
    this.callCount++;
    const joined = messages.join('\n');
    this.totalInputTokens += Math.ceil(joined.length / 4); // rough token estimate
    const output = joined.slice(0, this.budget);
    this.totalOutputTokens += Math.ceil(output.length / 4);
    return output;
  }
}

// -- Flat compression simulator --
// Mimics the flat strategy: concatenate all old messages, summarize to a budget
class FlatCompressor {
  private budget: number;
  private preserveRatio: number;

  constructor(budget: number = 1500, preserveRatio: number = 0.3) {
    this.budget = budget;
    this.preserveRatio = preserveRatio;
  }

  compress(messages: string[]): string {
    const splitPoint = Math.floor(messages.length * (1 - this.preserveRatio));
    const toCompress = messages.slice(0, splitPoint);
    const toKeep = messages.slice(splitPoint);

    // Flat summary: truncate to budget (simulating LLM compression)
    const concatenated = toCompress.join('\n');
    const summary = concatenated.slice(0, this.budget);

    return [summary, '---PRESERVED---', ...toKeep].join('\n');
  }
}

// -- Generate conversations with planted facts --
function generateConversation(
  convId: string,
  numMessages: number,
  factsPerTopic: number,
): Conversation {
  // Define distinct topics with unique facts
  const topics = [
    {
      name: 'database',
      templateMessages: [
        'We need to optimize the PostgreSQL query on the users table.',
        'The slow query is: SELECT * FROM orders WHERE user_id IN (SELECT id FROM users WHERE status = $STATUS$)',
        'I ran EXPLAIN ANALYZE and the sequential scan takes 3.2 seconds.',
        'Adding an index on orders(user_id) reduced it to 45ms.',
        'The migration file is at db/migrations/$MIGRATION_FILE$.',
      ],
      facts: [
        { id: `${convId}-db-port`, template: 'PostgreSQL running on port $PORT$' },
        { id: `${convId}-db-table`, template: 'The table has $ROWS$ rows' },
        { id: `${convId}-db-index`, template: 'Index name: idx_$INDEX_NAME$' },
      ],
    },
    {
      name: 'api',
      templateMessages: [
        'The REST API endpoint for user preferences is broken.',
        'Error: 500 Internal Server Error at $ENDPOINT$',
        'The controller file is at src/controllers/$CONTROLLER_FILE$.ts',
        'Root cause: null reference on user.preferences.theme',
        'Fix deployed to staging, monitoring for 24h before production.',
      ],
      facts: [
        { id: `${convId}-api-endpoint`, template: 'Endpoint: /api/v$API_VER$/users/$USER_ID$/prefs' },
        { id: `${convId}-api-status`, template: 'HTTP status code: $STATUS_CODE$' },
        { id: `${convId}-api-file`, template: 'File: $API_FILE$.controller.ts' },
      ],
    },
    {
      name: 'docker',
      templateMessages: [
        'The Docker build is failing during npm install.',
        'Error: ENOMEM - not enough memory during native module compilation.',
        'Build machine has $MEMORY$GB RAM, node_modules is 1.2GB.',
        'Solution: multi-stage build with NODE_OPTIONS="--max-old-space-size=$MAX_MEM$".',
        'Dockerfile is at infra/docker/$DOCKERFILE$.',
      ],
      facts: [
        { id: `${convId}-docker-image`, template: 'Base image: node:$NODE_VER$-alpine' },
        { id: `${convId}-docker-port`, template: 'Container port: $CONTAINER_PORT$' },
        { id: `${convId}-docker-vol`, template: 'Volume mount: /data/$VOL_NAME$' },
      ],
    },
    {
      name: 'auth',
      templateMessages: [
        'Implementing OAuth2 PKCE flow for the SPA.',
        'The auth server returns tokens but CORS preflight fails.',
        'Token endpoint: $TOKEN_ENDPOINT$',
        'Redirect URI configured: $REDIRECT_URI$',
        'Solution: proxy token requests through our backend at /api/auth/token.',
      ],
      facts: [
        { id: `${convId}-auth-secret`, template: 'Client ID: $CLIENT_ID$' },
        { id: `${convId}-auth-scope`, template: 'OAuth scope: $OAUTH_SCOPE$' },
        { id: `${convId}-auth-exp`, template: 'Token expires in $TOKEN_EXP$ seconds' },
      ],
    },
    {
      name: 'websocket',
      templateMessages: [
        'WebSocket connection drops after exactly 60 seconds.',
        'Using ws library v$WS_VER$ with Node.js 20.11.0.',
        'Nginx proxy_read_timeout is set to 3600s.',
        'Added ping/pong with interval=$PING_INTERVAL$ms.',
        'The load balancer idle timeout was the culprit: $LB_TIMEOUT$s.',
      ],
      facts: [
        { id: `${convId}-ws-url`, template: 'WebSocket URL: wss://$WS_HOST$/v$WS_VER_NUM$/stream' },
        { id: `${convId}-ws-proto`, template: 'Subprotocol: $WS_PROTOCOL$' },
        { id: `${convId}-ws-maxconn`, template: 'Max connections: $MAX_CONN$' },
      ],
    },
  ];

  const messages: string[] = [];
  const plantedFacts: PlantedFact[] = [];

  // Random-ish unique values for facts
  let factCounter = 0;
  function uniqueVal(): string {
    return `UNQ${convId}X${factCounter++}Z`;
  }

  // Interleave topics to simulate a real conversation
  const msgsPerTopic = Math.ceil(numMessages / topics.length);
  for (let round = 0; round < msgsPerTopic; round++) {
    for (const topic of topics) {
      if (messages.length >= numMessages) break;

      // Add a template message
      const tmplIdx = round % topic.templateMessages.length;
      let msg = topic.templateMessages[tmplIdx];

      // Plant facts into some messages
      if (round < factsPerTopic && round < topic.facts.length) {
        const fact = topic.facts[round];
        const val = uniqueVal();
        const factStr = fact.template.replace(/\$[A-Z_]+\$/g, val);
        msg = `${msg}\nNote: ${factStr}`;
        plantedFacts.push({
          id: fact.id,
          fact: val, // The unique searchable string
          messageIndex: messages.length,
          topic: topic.name,
        });
      }

      messages.push(`[${topic.name}] ${msg}`);
    }
  }

  return { id: convId, messages, plantedFacts };
}

// -- McNemar's test --
function mcnemarsTest(results: TrialResult[]): {
  flatCorrect: number;
  unionCorrect: number;
  both: number;
  neitherBut: { flatOnly: number; unionOnly: number };
  chiSquared: number;
  pValue: number;
  significant: boolean;
} {
  let a = 0; // both correct
  let b = 0; // flat correct, union wrong
  let c = 0; // flat wrong, union correct
  let d = 0; // both wrong

  for (const r of results) {
    if (r.flatRetained && r.unionFindRetained) a++;
    else if (r.flatRetained && !r.unionFindRetained) b++;
    else if (!r.flatRetained && r.unionFindRetained) c++;
    else d++;
  }

  // McNemar's chi-squared (with continuity correction)
  const chiSquared = b + c > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / (b + c) : 0;

  // Approximate p-value from chi-squared with 1 df
  // Using survival function approximation
  const pValue = chiSquaredSurvival(chiSquared, 1);

  return {
    flatCorrect: a + b,
    unionCorrect: a + c,
    both: a,
    neitherBut: { flatOnly: b, unionOnly: c },
    chiSquared,
    pValue,
    significant: pValue < 0.05,
  };
}

// Chi-squared survival function (1 df) approximation
function chiSquaredSurvival(x: number, _df: number): number {
  if (x <= 0) return 1.0;
  // For 1 df: P(X > x) = 2 * (1 - Phi(sqrt(x)))
  // Using Abramowitz & Stegun approximation for normal CDF
  const z = Math.sqrt(x);
  const t = 1 / (1 + 0.2316419 * z);
  const d = 0.3989422804014327; // 1/sqrt(2*pi)
  const p =
    d *
    Math.exp((-z * z) / 2) *
    (t *
      (0.319381530 +
        t *
          (-0.356563782 +
            t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return 2 * p;
}

// -- Main experiment --
async function runExperiment() {
  console.log('=== H1 Recall Benchmark ===');
  console.log('Strategy: Structural information retention with budget-limited mock summarizer');
  console.log('Note: Without real LLM API access, this measures structural advantage only');
  console.log('');

  const NUM_CONVERSATIONS = 15;
  const MESSAGES_PER_CONV = 120;
  const FACTS_PER_TOPIC = 3;

  // Summary budget: models the key constraint that LLM output has fixed max length
  const FLAT_SUMMARY_BUDGET = 1500;  // chars for flat single summary
  const UNION_CLUSTER_BUDGET = 500;  // chars per cluster summary

  console.log(`Conversations: ${NUM_CONVERSATIONS}`);
  console.log(`Messages per conversation: ${MESSAGES_PER_CONV}`);
  console.log(`Facts per topic per conversation: ${FACTS_PER_TOPIC}`);
  console.log(`Flat summary budget: ${FLAT_SUMMARY_BUDGET} chars`);
  console.log(`Union cluster budget: ${UNION_CLUSTER_BUDGET} chars`);
  console.log('');

  const allResults: TrialResult[] = [];
  const perConvResults: Array<{
    convId: string;
    totalFacts: number;
    flatRecall: number;
    unionRecall: number;
  }> = [];

  for (let i = 0; i < NUM_CONVERSATIONS; i++) {
    const convId = `conv_${String(i + 1).padStart(2, '0')}`;
    const conv = generateConversation(convId, MESSAGES_PER_CONV, FACTS_PER_TOPIC);

    // -- Flat compression --
    const flatCompressor = new FlatCompressor(FLAT_SUMMARY_BUDGET, 0.3);
    const flatOutput = flatCompressor.compress(conv.messages);

    // -- Union-find compression --
    const embedder = new TFIDFEmbedder();
    const summarizer = new BudgetSummarizer(UNION_CLUSTER_BUDGET);
    const contextWindow = new ContextWindow(embedder, summarizer, {
      hotSize: 30,
      maxColdClusters: 10,
      mergeThreshold: 0.15,
    });

    for (const msg of conv.messages) {
      await contextWindow.append(msg);
    }

    const rendered = contextWindow.render(null);
    const unionOutput = rendered.join('\n');

    // -- Score fact retention --
    let flatCorrect = 0;
    let unionCorrect = 0;

    for (const fact of conv.plantedFacts) {
      const flatRetained = flatOutput.includes(fact.fact);
      const unionRetained = unionOutput.includes(fact.fact);

      if (flatRetained) flatCorrect++;
      if (unionRetained) unionCorrect++;

      allResults.push({
        conversationId: conv.id,
        factId: fact.id,
        flatRetained,
        unionFindRetained: unionRetained,
      });
    }

    const totalFacts = conv.plantedFacts.length;
    perConvResults.push({
      convId: conv.id,
      totalFacts,
      flatRecall: totalFacts > 0 ? flatCorrect / totalFacts : 0,
      unionRecall: totalFacts > 0 ? unionCorrect / totalFacts : 0,
    });

    console.log(
      `  ${conv.id}: flat=${flatCorrect}/${totalFacts} (${(((flatCorrect / totalFacts) * 100) || 0).toFixed(0)}%), ` +
      `union-find=${unionCorrect}/${totalFacts} (${(((unionCorrect / totalFacts) * 100) || 0).toFixed(0)}%)`
    );
  }

  // -- Aggregate results --
  console.log('');
  console.log('--- Per-Conversation Results ---');
  console.log('Conv ID      | Facts | Flat Recall | UF Recall | Diff');
  console.log('-------------|-------|-------------|-----------|------');
  for (const r of perConvResults) {
    const diff = r.unionRecall - r.flatRecall;
    console.log(
      `${r.convId.padEnd(12)} | ${String(r.totalFacts).padStart(5)} | ` +
      `${(r.flatRecall * 100).toFixed(1).padStart(10)}% | ` +
      `${(r.unionRecall * 100).toFixed(1).padStart(8)}% | ` +
      `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp`
    );
  }

  // -- Overall --
  const totalFacts = allResults.length;
  const flatTotal = allResults.filter((r) => r.flatRetained).length;
  const unionTotal = allResults.filter((r) => r.unionFindRetained).length;
  const flatRecall = flatTotal / totalFacts;
  const unionRecall = unionTotal / totalFacts;
  const diffPP = (unionRecall - flatRecall) * 100;

  console.log('');
  console.log('--- Aggregate Results ---');
  console.log(`Total fact probes: ${totalFacts}`);
  console.log(`Flat recall: ${flatTotal}/${totalFacts} (${(flatRecall * 100).toFixed(1)}%)`);
  console.log(`Union-find recall: ${unionTotal}/${totalFacts} (${(unionRecall * 100).toFixed(1)}%)`);
  console.log(`Difference: ${diffPP >= 0 ? '+' : ''}${diffPP.toFixed(1)}pp`);
  console.log('');

  // -- McNemar's test --
  const mcnemar = mcnemarsTest(allResults);
  console.log('--- McNemar\'s Test ---');
  console.log(`Both retained: ${mcnemar.both}`);
  console.log(`Flat only: ${mcnemar.neitherBut.flatOnly}`);
  console.log(`Union-find only: ${mcnemar.neitherBut.unionOnly}`);
  console.log(`Neither: ${totalFacts - mcnemar.both - mcnemar.neitherBut.flatOnly - mcnemar.neitherBut.unionOnly}`);
  console.log(`Chi-squared (with continuity correction): ${mcnemar.chiSquared.toFixed(4)}`);
  console.log(`p-value: ${mcnemar.pValue.toFixed(6)}`);
  console.log(`Significant (p < 0.05): ${mcnemar.significant ? 'YES' : 'NO'}`);
  console.log('');

  // -- H1 Verdict --
  console.log('=== H1 VERDICT ===');
  console.log(`Union-find recall: ${(unionRecall * 100).toFixed(1)}%`);
  console.log(`Flat recall: ${(flatRecall * 100).toFixed(1)}%`);
  console.log(`Difference: ${diffPP >= 0 ? '+' : ''}${diffPP.toFixed(1)}pp`);
  console.log(`Criterion: union-find >= flat + 5pp AND p < 0.05`);

  if (diffPP >= 5 && mcnemar.significant) {
    console.log(`Result: PASS ✅`);
  } else if (diffPP >= 5 && !mcnemar.significant) {
    console.log(`Result: FAIL ❌ (difference >= 5pp but not statistically significant)`);
  } else if (diffPP < 5 && diffPP > -2) {
    console.log(`Result: FAIL ❌ (no meaningful difference)`);
  } else {
    console.log(`Result: FAIL ❌`);
  }

  console.log('');
  console.log('=== LIMITATION ===');
  console.log('This measures STRUCTURAL information retention with a truncation-based mock summarizer.');
  console.log('Real LLM summarization may show different patterns (better extraction, semantic compression).');
  console.log('Results should be interpreted as: "Does the union-find structure provide more output space');
  console.log('for preserved facts?" not "Does the full system achieve better recall?"');

  // -- Write JSON results --
  console.log('');
  console.log('--- JSON Results ---');
  console.log(JSON.stringify({
    metadata: {
      date: new Date().toISOString(),
      conversations: NUM_CONVERSATIONS,
      messagesPerConv: MESSAGES_PER_CONV,
      factsPerTopic: FACTS_PER_TOPIC,
      flatBudget: FLAT_SUMMARY_BUDGET,
      unionClusterBudget: UNION_CLUSTER_BUDGET,
      summarizer: 'BudgetSummarizer (truncation)',
      limitation: 'No real LLM - structural measurement only',
    },
    aggregate: {
      totalFacts,
      flatRecall: flatRecall,
      unionFindRecall: unionRecall,
      diffPP,
      mcnemar: {
        chiSquared: mcnemar.chiSquared,
        pValue: mcnemar.pValue,
        significant: mcnemar.significant,
      },
    },
    perConversation: perConvResults,
    trialResults: allResults,
  }, null, 2));
}

runExperiment().catch(console.error);
