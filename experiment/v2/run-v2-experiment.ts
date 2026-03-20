/**
 * v2 Preregistered Experiment: Union-Find vs Flat Context Compaction
 *
 * Runs all hypotheses (H1, H2a, H2b, H3) using real Gemini 3.1 Flash Lite
 * API calls on the same 12 GitHub issue conversations from v1.
 *
 * v2 changes from v1:
 * - append() is synchronous — no LLM calls
 * - render() is synchronous — uses cached summaries
 * - resolveDirty() is async — batch-summarizes dirty clusters
 * - Overlap window (graduateAt/evictAt) instead of hotSize
 * - Flat baseline rerun contemporaneously (not reusing v1 flat results)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ContextWindow,
  type Summarizer,
} from '/Users/junekim/Documents/gemini-cli-experiment/packages/core/dist/src/services/contextWindow.js';
import { TFIDFEmbedder } from '/Users/junekim/Documents/gemini-cli-experiment/packages/core/dist/src/services/embeddingService.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const API_KEY = process.env.GEMINI_API_KEY ?? '';
const MODEL = 'gemini-3.1-flash-lite-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const CONV_DIR =
  '/Users/junekim/Documents/union-find-compaction-for-gemini-cli/experiment/quality-test/conversations';
const OUT_DIR =
  '/Users/junekim/Documents/union-find-compaction-for-gemini-cli/experiment/v2';

const GRADUATE_AT = 26;
const EVICT_AT = 30;
const MAX_COLD_CLUSTERS = 10;
const MERGE_THRESHOLD = 0.15;
const MESSAGES_PER_CONV = 120;
const QUESTIONS_PER_CONV = 8;
const NUM_CONVERSATIONS = 12;

// ─── Gemini API Helper ────────────────────────────────────────────────────────
interface GeminiResponse {
  text: string;
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
}

let totalApiCalls = 0;
let totalApiTokens = 0;

async function callGemini(
  prompt: string,
  systemInstruction?: string,
  maxRetries: number = 3,
): Promise<GeminiResponse> {
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await fetch(
        `${API_BASE}/models/${MODEL}:generateContent?key=${API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (resp.status === 429 || resp.status >= 500) {
        const wait = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.log(`  [API] ${resp.status}, retrying in ${(wait / 1000).toFixed(1)}s...`);
        await sleep(wait);
        continue;
      }

      const data = (await resp.json()) as Record<string, unknown>;
      if ((data as { error?: { message: string } }).error) {
        throw new Error(
          `API error: ${(data as { error: { message: string } }).error.message}`,
        );
      }

      const candidates = data.candidates as Array<{
        content: { parts: Array<{ text: string }> };
      }>;
      const usage = data.usageMetadata as {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
      };

      totalApiCalls++;
      totalApiTokens += usage?.totalTokenCount ?? 0;

      return {
        text: candidates?.[0]?.content?.parts?.[0]?.text ?? '',
        promptTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      };
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await sleep(Math.pow(2, attempt) * 1000);
    }
  }
  throw new Error('Max retries exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Real LLM Summarizer (tracks tokens) ─────────────────────────────────────
class RealSummarizer implements Summarizer {
  callCount = 0;
  totalInputTokens = 0;
  totalOutputTokens = 0;
  callLatencies: number[] = [];

  async summarize(messages: string[]): Promise<string> {
    this.callCount++;
    const prompt = `Summarize these ${messages.length} items into one dense paragraph (max 150 tokens).\nThe first item may be a previous summary — integrate it with the new messages.\nPreserve all specific technical details: version numbers, ports, file paths, commands, function names, thresholds.\nDrop filler and acknowledgments.\n\nItems:\n${messages.map((m, i) => `[${i + 1}] ${m}`).join('\n\n')}`;

    const start = performance.now();
    const resp = await callGemini(prompt);
    const elapsed = performance.now() - start;
    this.callLatencies.push(elapsed);

    this.totalInputTokens += resp.promptTokens;
    this.totalOutputTokens += resp.outputTokens;
    return resp.text;
  }
}

// ─── Flat Compression with Real LLM ──────────────────────────────────────────
interface FlatResult {
  summary: string;
  preservedMessages: string[];
  inputTokens: number;
  outputTokens: number;
  callCount: number;
  totalLatencyMs: number;
}

async function flatCompress(messages: string[]): Promise<FlatResult> {
  const splitPoint = Math.floor(messages.length * 0.7);
  const toCompress = messages.slice(0, splitPoint);
  const toKeep = messages.slice(splitPoint);

  const compressText = toCompress
    .map((m, i) => `[Turn ${i + 1}] ${m}`)
    .join('\n\n');

  let totalInput = 0;
  let totalOutput = 0;
  let totalLatency = 0;

  // Call 1: Summarize
  const start1 = performance.now();
  const summaryResp = await callGemini(
    `Summarize the following conversation into a detailed state snapshot. Preserve ALL specific technical details: file paths, error messages, version numbers, API endpoints, configuration values, commands, and decisions made.\n\n${compressText}`,
    'You are a precise technical summarizer. Preserve every specific technical detail mentioned.',
  );
  totalLatency += performance.now() - start1;
  totalInput += summaryResp.promptTokens;
  totalOutput += summaryResp.outputTokens;

  // Call 2: Verify
  const start2 = performance.now();
  const verifyResp = await callGemini(
    `Critically evaluate this summary. Did it omit any specific technical details, file paths, tool results, or user constraints from the original conversation? If anything is missing, generate an improved summary. Otherwise repeat it exactly.\n\nOriginal conversation (abbreviated, ${toCompress.length} messages):\n${compressText.slice(0, 4000)}\n\nSummary to verify:\n${summaryResp.text}`,
  );
  totalLatency += performance.now() - start2;
  totalInput += verifyResp.promptTokens;
  totalOutput += verifyResp.outputTokens;

  return {
    summary: verifyResp.text || summaryResp.text,
    preservedMessages: toKeep,
    inputTokens: totalInput,
    outputTokens: totalOutput,
    callCount: 2,
    totalLatencyMs: totalLatency,
  };
}

// ─── Load Conversations ──────────────────────────────────────────────────────
interface ConvMessage {
  role: string;
  author: string;
  body: string;
  created_at: string;
}

interface ConvFile {
  source: string;
  repo: string;
  issue_number: number;
  title: string;
  url: string;
  messages: ConvMessage[];
}

function loadConversations(): ConvFile[] {
  const files = fs
    .readdirSync(CONV_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, NUM_CONVERSATIONS);

  return files.map((f) => {
    const raw = fs.readFileSync(path.join(CONV_DIR, f), 'utf-8');
    return JSON.parse(raw) as ConvFile;
  });
}

// ─── H1: Recall ──────────────────────────────────────────────────────────────
interface Question {
  question: string;
  groundTruth: string;
}

interface TrialResult {
  conversationId: string;
  questionIdx: number;
  question: string;
  flatCorrect: boolean;
  unionCorrect: boolean;
}

async function generateQuestions(
  messages: string[],
): Promise<Question[]> {
  const sample = messages
    .filter((_, i) => i % 3 === 0)
    .slice(0, 40)
    .map((m, i) => `[${i + 1}] ${m.slice(0, 300)}`)
    .join('\n\n');

  const resp = await callGemini(
    `Given this coding conversation, generate exactly ${QUESTIONS_PER_CONV} factual questions that can be answered from the conversation content. Focus on SPECIFIC technical details: error messages, version numbers, file paths, API names, configuration values, specific solutions proposed.\n\nFormat each as:\nQ: <question>\nA: <brief factual answer>\n\nConversation:\n${sample}`,
  );

  const pairs = resp.text.split(/\n(?=Q:)/g).filter((s) => s.startsWith('Q:'));
  const questions: Question[] = [];
  for (const pair of pairs) {
    const qMatch = pair.match(/Q:\s*(.+)/);
    const aMatch = pair.match(/A:\s*(.+)/);
    if (qMatch && aMatch) {
      questions.push({ question: qMatch[1].trim(), groundTruth: aMatch[1].trim() });
    }
  }
  return questions.slice(0, QUESTIONS_PER_CONV);
}

async function judgeAnswer(
  question: string,
  groundTruth: string,
  compressedContext: string,
): Promise<{ correct: boolean; answer: string }> {
  const resp = await callGemini(
    `Based ONLY on the following context, answer this question. If the information is not available in the context, say "NOT FOUND".\n\nContext:\n${compressedContext.slice(0, 8000)}\n\nQuestion: ${question}\n\nAnswer concisely:`,
  );

  const answer = resp.text.trim();

  const judgeResp = await callGemini(
    `Is this answer correct based on the ground truth? Answer ONLY "CORRECT" or "INCORRECT".\n\nQuestion: ${question}\nGround truth: ${groundTruth}\nGiven answer: ${answer}\n\nVerdict:`,
  );

  const correct = judgeResp.text.trim().toUpperCase().includes('CORRECT') &&
    !judgeResp.text.trim().toUpperCase().includes('INCORRECT');

  return { correct, answer };
}

// ─── McNemar's Test ──────────────────────────────────────────────────────────
function mcnemarsTest(results: TrialResult[]) {
  let a = 0, b = 0, c = 0, d = 0;
  for (const r of results) {
    if (r.flatCorrect && r.unionCorrect) a++;
    else if (r.flatCorrect && !r.unionCorrect) b++;
    else if (!r.flatCorrect && r.unionCorrect) c++;
    else d++;
  }
  const chi2 = b + c > 0 ? Math.pow(Math.abs(b - c) - 1, 2) / (b + c) : 0;
  const z = Math.sqrt(chi2);
  const t = 1 / (1 + 0.2316419 * z);
  const dn = 0.3989422804014327;
  const p = 2 * dn * Math.exp((-z * z) / 2) *
    (t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return { a, b, c, d, chi2, pValue: chi2 <= 0 ? 1.0 : p, n: results.length };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

// ─── Main Experiment ─────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  v2 EXPERIMENT: Union-Find (overlap window) vs Flat        ║');
  console.log('║  Model: gemini-3.1-flash-lite-preview                      ║');
  console.log(`║  Date: ${new Date().toISOString()}                 ║`);
  console.log('║  Classification: Exploratory benchmark validation          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  graduateAt=${GRADUATE_AT}, evictAt=${EVICT_AT}, maxCold=${MAX_COLD_CLUSTERS}, threshold=${MERGE_THRESHOLD}`);
  console.log('');

  const conversations = loadConversations();
  console.log(`Loaded ${conversations.length} conversations`);
  for (const conv of conversations) {
    console.log(
      `  ${conv.repo}#${conv.issue_number}: ${conv.messages.length} msgs — ${conv.title.slice(0, 60)}`,
    );
  }
  console.log('');

  // ─── Storage ──────────────────────────────────────────────────────────────
  const allTrialResults: TrialResult[] = [];
  const h2aAppendLatencies: Array<{ convId: string; msgIdx: number; latencyMs: number }> = [];
  const h2aRenderLatencies: Array<{ convId: string; latencyMs: number }> = [];
  const h2bResolveLatencies: Array<{ convId: string; latencyMs: number; dirtyClusters: number; summarizeCalls: number }> = [];
  const h3Flat = { totalInput: 0, totalOutput: 0, calls: 0 };
  const h3Union = { totalInput: 0, totalOutput: 0, calls: 0 };

  const perConvSummary: Array<{
    convId: string;
    repo: string;
    issue: number;
    msgCount: number;
    questionsGenerated: number;
    flatRecall: number;
    unionRecall: number;
    unionResolveCalls: number;
    coldClusters: number;
    hotCount: number;
  }> = [];

  // ─── Process each conversation ─────────────────────────────────────────────
  for (let ci = 0; ci < conversations.length; ci++) {
    const conv = conversations[ci];
    const convId = `conv_${String(ci + 1).padStart(2, '0')}`;
    const msgs = conv.messages
      .slice(0, MESSAGES_PER_CONV)
      .map((m) => `[${m.author}] ${m.body.slice(0, 500)}`);

    console.log(`\n━━━ ${convId}: ${conv.repo}#${conv.issue_number} (${msgs.length} msgs) ━━━`);

    // Step 1: Generate questions from uncompressed content
    console.log('  Generating questions...');
    const questions = await generateQuestions(msgs);
    console.log(`  Generated ${questions.length} questions`);
    for (const q of questions) {
      console.log(`    Q: ${q.question.slice(0, 80)}...`);
    }

    // Step 2: Flat compression (contemporaneous baseline)
    console.log('  Running flat compression...');
    const flatResult = await flatCompress(msgs);
    const flatContext = `${flatResult.summary}\n\n---RECENT---\n${flatResult.preservedMessages.join('\n')}`;
    h3Flat.totalInput += flatResult.inputTokens;
    h3Flat.totalOutput += flatResult.outputTokens;
    h3Flat.calls += flatResult.callCount;
    console.log(`  Flat: ${flatResult.callCount} calls, ${flatResult.inputTokens + flatResult.outputTokens} tokens`);

    // Step 3: Union-find v2 compression
    console.log('  Running union-find v2...');
    const embedder = new TFIDFEmbedder();
    const summarizer = new RealSummarizer();
    const contextWindow = new ContextWindow(embedder, summarizer, {
      graduateAt: GRADUATE_AT,
      evictAt: EVICT_AT,
      maxColdClusters: MAX_COLD_CLUSTERS,
      mergeThreshold: MERGE_THRESHOLD,
    });

    // H2a: Measure per-append latency (should be ~0ms, no LLM calls)
    for (let mi = 0; mi < msgs.length; mi++) {
      const start = performance.now();
      contextWindow.append(msgs[mi]); // SYNCHRONOUS — no await
      const elapsed = performance.now() - start;
      h2aAppendLatencies.push({ convId, msgIdx: mi, latencyMs: elapsed });
    }

    // H2a: Measure render latency (should be ~0ms, synchronous cached summaries)
    const renderStart = performance.now();
    const rendered = contextWindow.render(null);
    const renderElapsed = performance.now() - renderStart;
    h2aRenderLatencies.push({ convId, latencyMs: renderElapsed });

    // H2b: Measure resolveDirty latency (async, LLM calls happen here)
    const dirtyClusters = contextWindow.forest.dirtyRoots().length;
    const callsBefore = summarizer.callCount;
    const resolveStart = performance.now();
    await contextWindow.resolveDirty();
    const resolveElapsed = performance.now() - resolveStart;
    const resolveCalls = summarizer.callCount - callsBefore;
    h2bResolveLatencies.push({ convId, latencyMs: resolveElapsed, dirtyClusters, summarizeCalls: resolveCalls });

    // Re-render after resolve to get resolved summaries for H1 evaluation
    const resolvedRendered = contextWindow.render(null);
    const unionContext = resolvedRendered.join('\n\n');

    h3Union.totalInput += summarizer.totalInputTokens;
    h3Union.totalOutput += summarizer.totalOutputTokens;
    h3Union.calls += summarizer.callCount;

    console.log(
      `  Union-find v2: ${summarizer.callCount} calls (in resolveDirty), ` +
      `${summarizer.totalInputTokens + summarizer.totalOutputTokens} tokens, ` +
      `${contextWindow.coldClusterCount} clusters, ${contextWindow.hotCount} hot`,
    );
    console.log(
      `  Append p95: ${percentile(h2aAppendLatencies.filter(l => l.convId === convId).map(l => l.latencyMs).sort((a,b) => a-b), 95).toFixed(3)} ms, ` +
      `Render: ${renderElapsed.toFixed(3)} ms, ` +
      `ResolveDirty: ${resolveElapsed.toFixed(0)} ms (${resolveCalls} calls, ${dirtyClusters} dirty)`,
    );

    // Step 4: Score recall (blinded LLM-as-judge)
    console.log('  Scoring recall (blinded judge)...');
    let flatCorrectCount = 0;
    let unionCorrectCount = 0;

    for (let qi = 0; qi < questions.length; qi++) {
      const q = questions[qi];

      // Randomize order to avoid position bias
      const flatFirst = Math.random() > 0.5;
      const [ctx1, ctx2] = flatFirst
        ? [flatContext, unionContext]
        : [unionContext, flatContext];

      const [j1, j2] = await Promise.all([
        judgeAnswer(q.question, q.groundTruth, ctx1),
        judgeAnswer(q.question, q.groundTruth, ctx2),
      ]);

      const [flatJudge, unionJudge] = flatFirst ? [j1, j2] : [j2, j1];

      if (flatJudge.correct) flatCorrectCount++;
      if (unionJudge.correct) unionCorrectCount++;

      allTrialResults.push({
        conversationId: convId,
        questionIdx: qi,
        question: q.question,
        flatCorrect: flatJudge.correct,
        unionCorrect: unionJudge.correct,
      });

      const fMark = flatJudge.correct ? '✓' : '✗';
      const uMark = unionJudge.correct ? '✓' : '✗';
      console.log(`    Q${qi + 1}: flat=${fMark} union=${uMark} | ${q.question.slice(0, 60)}`);
    }

    perConvSummary.push({
      convId,
      repo: conv.repo,
      issue: conv.issue_number,
      msgCount: msgs.length,
      questionsGenerated: questions.length,
      flatRecall: questions.length > 0 ? flatCorrectCount / questions.length : 0,
      unionRecall: questions.length > 0 ? unionCorrectCount / questions.length : 0,
      unionResolveCalls: summarizer.callCount,
      coldClusters: contextWindow.coldClusterCount,
      hotCount: contextWindow.hotCount,
    });

    console.log(
      `  Recall: flat=${flatCorrectCount}/${questions.length} ` +
      `(${((flatCorrectCount / Math.max(questions.length, 1)) * 100).toFixed(0)}%), ` +
      `union=${unionCorrectCount}/${questions.length} ` +
      `(${((unionCorrectCount / Math.max(questions.length, 1)) * 100).toFixed(0)}%)`,
    );

    // Throttle between conversations
    if (ci < conversations.length - 1) {
      console.log('  Cooling down 2s...');
      await sleep(2000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                      v2 RESULTS                            ║');
  console.log(`║  Elapsed: ${elapsedMin} min, API calls: ${totalApiCalls}, tokens: ${totalApiTokens}  `);
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ─── H1: Recall ────────────────────────────────────────────────────────────
  console.log('\n═══ H1: RECALL ═══');
  const totalQ = allTrialResults.length;
  const flatTotal = allTrialResults.filter((r) => r.flatCorrect).length;
  const unionTotal = allTrialResults.filter((r) => r.unionCorrect).length;
  const flatPct = (flatTotal / totalQ) * 100;
  const unionPct = (unionTotal / totalQ) * 100;
  const diffPP = unionPct - flatPct;

  console.log(`Total questions: ${totalQ}`);
  console.log(`Flat recall:       ${flatTotal}/${totalQ} (${flatPct.toFixed(1)}%)`);
  console.log(`Union-find recall: ${unionTotal}/${totalQ} (${unionPct.toFixed(1)}%)`);
  console.log(`Difference: ${diffPP >= 0 ? '+' : ''}${diffPP.toFixed(1)}pp`);

  const mcn = mcnemarsTest(allTrialResults);
  console.log(`\nMcNemar's test:`);
  console.log(`  Both correct: ${mcn.a}, Flat only: ${mcn.b}, Union only: ${mcn.c}, Neither: ${mcn.d}`);
  console.log(`  Chi-squared: ${mcn.chi2.toFixed(4)}, p-value: ${mcn.pValue.toFixed(6)}`);

  const h1Pass = diffPP >= 5 && mcn.pValue < 0.05;
  console.log(`\n  CRITERION: union-find >= flat + 5pp AND p < 0.05`);
  console.log(`  VERDICT: ${h1Pass ? 'PASS ✅' : 'FAIL ❌'}`);

  // Per-conversation table
  console.log('\n  Per-conversation:');
  console.log('  Conv | Repo                           | Flat   | Union  | Diff');
  console.log('  -----|--------------------------------|--------|--------|------');
  for (const s of perConvSummary) {
    const diff = s.unionRecall - s.flatRecall;
    console.log(
      `  ${s.convId} | ${(s.repo + '#' + s.issue).padEnd(30)} | ` +
      `${(s.flatRecall * 100).toFixed(0).padStart(4)}%  | ` +
      `${(s.unionRecall * 100).toFixed(0).padStart(4)}%  | ` +
      `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(0)}pp`,
    );
  }

  // ─── H2a: Append + Render Latency ─────────────────────────────────────────
  console.log('\n═══ H2a: APPEND + RENDER LATENCY ═══');
  const appendLat = h2aAppendLatencies.map((l) => l.latencyMs).sort((a, b) => a - b);
  const renderLat = h2aRenderLatencies.map((l) => l.latencyMs).sort((a, b) => a - b);

  console.log(`Append (${appendLat.length} operations):`);
  console.log(`  p50: ${percentile(appendLat, 50).toFixed(3)} ms`);
  console.log(`  p95: ${percentile(appendLat, 95).toFixed(3)} ms`);
  console.log(`  p99: ${percentile(appendLat, 99).toFixed(3)} ms`);
  console.log(`  Max: ${appendLat[appendLat.length - 1].toFixed(3)} ms`);

  console.log(`\nRender (${renderLat.length} calls):`);
  console.log(`  p50: ${percentile(renderLat, 50).toFixed(3)} ms`);
  console.log(`  p95: ${percentile(renderLat, 95).toFixed(3)} ms`);
  console.log(`  Max: ${renderLat[renderLat.length - 1].toFixed(3)} ms`);

  const h2aP95 = Math.max(percentile(appendLat, 95), percentile(renderLat, 95));
  const h2aPass = h2aP95 < 100;
  console.log(`\n  CRITERION: p95 < 100ms (both append and render)`);
  console.log(`  VERDICT: ${h2aPass ? 'PASS ✅' : 'FAIL ❌'} (p95 = ${h2aP95.toFixed(3)} ms)`);

  // ─── H2b: ResolveDirty Latency ────────────────────────────────────────────
  console.log('\n═══ H2b: RESOLVEDIRTY LATENCY (background) ═══');
  const resolveLat = h2bResolveLatencies.map((l) => l.latencyMs).sort((a, b) => a - b);

  console.log(`ResolveDirty (${resolveLat.length} calls):`);
  console.log(`  p50: ${percentile(resolveLat, 50).toFixed(0)} ms`);
  console.log(`  p90: ${percentile(resolveLat, 90).toFixed(0)} ms`);
  console.log(`  p95: ${percentile(resolveLat, 95).toFixed(0)} ms`);
  console.log(`  p99: ${percentile(resolveLat, 99).toFixed(0)} ms`);
  console.log(`  Max: ${resolveLat[resolveLat.length - 1].toFixed(0)} ms`);

  console.log(`\n  Per-conversation:`);
  for (const r of h2bResolveLatencies) {
    console.log(`    ${r.convId}: ${r.latencyMs.toFixed(0)} ms (${r.summarizeCalls} calls, ${r.dirtyClusters} dirty clusters)`);
  }
  console.log(`  NOTE: No pass/fail — runs in background during main LLM call (5-30s)`);

  // ─── H3: Cost ──────────────────────────────────────────────────────────────
  console.log('\n═══ H3: COST ═══');
  const flatTokens = h3Flat.totalInput + h3Flat.totalOutput;
  const unionTokens = h3Union.totalInput + h3Union.totalOutput;
  const ratio = unionTokens / Math.max(flatTokens, 1);

  console.log(`Flat:`);
  console.log(`  Calls: ${h3Flat.calls}`);
  console.log(`  Input tokens: ${h3Flat.totalInput}`);
  console.log(`  Output tokens: ${h3Flat.totalOutput}`);
  console.log(`  Total: ${flatTokens}`);
  console.log(`Union-find v2:`);
  console.log(`  Calls: ${h3Union.calls}`);
  console.log(`  Input tokens: ${h3Union.totalInput}`);
  console.log(`  Output tokens: ${h3Union.totalOutput}`);
  console.log(`  Total: ${unionTokens}`);
  console.log(`\n  Ratio: ${ratio.toFixed(2)}x`);

  const h3Pass = ratio <= 2.0;
  console.log(`  CRITERION: union-find <= 2x flat`);
  console.log(`  VERDICT: ${h3Pass ? 'PASS ✅' : 'FAIL ❌'}`);

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║                  v2 EXPERIMENT SUMMARY                      ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  H1  (Recall):        ${h1Pass ? 'PASS ✅' : 'FAIL ❌'}  (${diffPP >= 0 ? '+' : ''}${diffPP.toFixed(1)}pp, p=${mcn.pValue.toFixed(4)})`.padEnd(63) + '║');
  console.log(`║  H2a (Append+Render): ${h2aPass ? 'PASS ✅' : 'FAIL ❌'}  (p95 = ${h2aP95.toFixed(3)} ms)`.padEnd(63) + '║');
  console.log(`║  H2b (ResolveDirty):  INFO   (p95 = ${percentile(resolveLat, 95).toFixed(0)} ms)`.padEnd(63) + '║');
  console.log(`║  H3  (Cost):          ${h3Pass ? 'PASS ✅' : 'FAIL ❌'}  (${ratio.toFixed(2)}x)`.padEnd(63) + '║');
  console.log('╚══════════════════════════════════════════════════════════════╝');

  // ─── Write JSON results ────────────────────────────────────────────────────
  const results = {
    metadata: {
      version: 'v2',
      date: new Date().toISOString(),
      model: MODEL,
      classification: 'Exploratory benchmark validation on reused data',
      conversations: NUM_CONVERSATIONS,
      messagesPerConv: MESSAGES_PER_CONV,
      questionsPerConv: QUESTIONS_PER_CONV,
      totalApiCalls,
      totalApiTokens,
      elapsedMinutes: parseFloat(elapsedMin),
      commit: 'b9a854c57',
      branch: 'feat/union-find-compaction',
      params: { graduateAt: GRADUATE_AT, evictAt: EVICT_AT, maxColdClusters: MAX_COLD_CLUSTERS, mergeThreshold: MERGE_THRESHOLD },
    },
    h1: {
      totalQuestions: totalQ,
      flatRecall: flatPct,
      unionFindRecall: unionPct,
      diffPP,
      mcnemar: { a: mcn.a, b: mcn.b, c: mcn.c, d: mcn.d, chi2: mcn.chi2, pValue: mcn.pValue },
      pass: h1Pass,
      perConversation: perConvSummary,
      trialResults: allTrialResults,
    },
    h2a: {
      appendCount: appendLat.length,
      appendP50: percentile(appendLat, 50),
      appendP95: percentile(appendLat, 95),
      appendP99: percentile(appendLat, 99),
      appendMax: appendLat[appendLat.length - 1],
      renderCount: renderLat.length,
      renderP50: percentile(renderLat, 50),
      renderP95: percentile(renderLat, 95),
      renderMax: renderLat[renderLat.length - 1],
      pass: h2aPass,
    },
    h2b: {
      resolveCount: resolveLat.length,
      resolveP50: percentile(resolveLat, 50),
      resolveP90: percentile(resolveLat, 90),
      resolveP95: percentile(resolveLat, 95),
      resolveP99: percentile(resolveLat, 99),
      resolveMax: resolveLat[resolveLat.length - 1],
      perConversation: h2bResolveLatencies,
    },
    h3: {
      flat: { calls: h3Flat.calls, inputTokens: h3Flat.totalInput, outputTokens: h3Flat.totalOutput, total: flatTokens },
      unionFind: { calls: h3Union.calls, inputTokens: h3Union.totalInput, outputTokens: h3Union.totalOutput, total: unionTokens },
      ratio,
      pass: h3Pass,
    },
  };

  fs.mkdirSync(path.join(OUT_DIR, 'performance'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'quality-test'), { recursive: true });
  fs.mkdirSync(path.join(OUT_DIR, 'cost'), { recursive: true });

  fs.writeFileSync(
    path.join(OUT_DIR, 'results-v2.json'),
    JSON.stringify(results, null, 2),
  );
  console.log(`\nResults written to ${OUT_DIR}/results-v2.json`);

  // Write latency CSVs
  const appendCsv = ['conv_id,msg_idx,latency_ms'];
  for (const l of h2aAppendLatencies) {
    appendCsv.push(`${l.convId},${l.msgIdx},${l.latencyMs.toFixed(6)}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'performance', 'append-latencies.csv'), appendCsv.join('\n'));

  const renderCsv = ['conv_id,latency_ms'];
  for (const l of h2aRenderLatencies) {
    renderCsv.push(`${l.convId},${l.latencyMs.toFixed(6)}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'performance', 'render-latencies.csv'), renderCsv.join('\n'));

  const resolveCsv = ['conv_id,latency_ms,dirty_clusters,summarize_calls'];
  for (const l of h2bResolveLatencies) {
    resolveCsv.push(`${l.convId},${l.latencyMs.toFixed(2)},${l.dirtyClusters},${l.summarizeCalls}`);
  }
  fs.writeFileSync(path.join(OUT_DIR, 'performance', 'resolve-dirty-latencies.csv'), resolveCsv.join('\n'));

  console.log('Latency CSVs written to experiment/v2/performance/');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
