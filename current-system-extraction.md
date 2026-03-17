# Gemini-CLI Current Context Compaction - Code Extraction

This document extracts the relevant code implementing context compression/compaction in gemini-cli as of commit 69e2d8c.

## Source File

`packages/core/src/services/chatCompressionService.ts` (476 lines)

## Core Architecture

### When Compression Triggers

**Threshold-based triggering:**
```typescript
const DEFAULT_COMPRESSION_TOKEN_THRESHOLD = 0.5;

// Compress when history exceeds 50% of model's token limit
if (originalTokenCount < threshold * tokenLimit(model)) {
  return NOOP;
}
```

**Manual override:** Can be forced via `/compress` command

### Split Point Logic

**What gets compressed vs preserved:**
```typescript
const COMPRESSION_PRESERVE_THRESHOLD = 0.3;

function findCompressSplitPoint(contents: Content[], fraction: number): number {
  // Find a split point where:
  // 1. We've accumulated >= fraction of total character count
  // 2. Split must occur at a user message (not mid-turn)
  // 3. Don't split if last message has pending function calls

  // Iterates through contents, accumulating character counts
  // Returns index of first user message after target char count
}
```

**Result:** Oldest 70% gets compressed, newest 30% stays verbatim

### Tool Output Budget Management

**Reverse token budget strategy:**
```typescript
const COMPRESSION_FUNCTION_RESPONSE_TOKEN_BUDGET = 50_000;

async function truncateHistoryToBudget(history, config): Promise<Content[]> {
  // Iterate backwards (newest to oldest)
  // Track cumulative function response tokens
  // Keep recent tool outputs in full
  // Once budget exceeded, truncate older large tool responses to last 30 lines
  // Save truncated content to temp files
  // Replace in history with placeholder + file path
}
```

**Purpose:** Prevents massive tool outputs (grep results, logs) from dominating context

### Summarization Process

**Phase 1: Generate snapshot**
```typescript
const summaryResponse = await llm.generateContent({
  contents: [
    ...historyToCompress,
    { role: 'user', parts: [{
      text: `${anchorInstruction}\n\nFirst, reason in your scratchpad. Then, generate the updated <state_snapshot>.`
    }]}
  ],
  systemInstruction: getCompressionPrompt(config)
});
```

**Phase 2: Self-verification ("Probe")**
```typescript
const verificationResponse = await llm.generateContent({
  contents: [
    ...historyToCompress,
    { role: 'model', parts: [{ text: summary }] },
    { role: 'user', parts: [{
      text: 'Critically evaluate the <state_snapshot> you just generated. Did you omit any specific technical details...? If anything is missing, generate a FINAL improved <state_snapshot>.'
    }]}
  ]
});
```

**Result:** Two LLM calls to generate and refine the summary

### Snapshot Integration

**Handling previous compression:**
```typescript
const hasPreviousSnapshot = historyForSummarizer.some(c =>
  c.parts?.some(p => p.text?.includes('<state_snapshot>'))
);

const anchorInstruction = hasPreviousSnapshot
  ? 'A previous <state_snapshot> exists. You MUST integrate all still-relevant information from that snapshot into the new one.'
  : 'Generate a new <state_snapshot> based on the provided history.';
```

**Purpose:** Successive compressions don't lose information from earlier snapshots

### New History Construction

**After compression:**
```typescript
const extraHistory: Content[] = [
  { role: 'user', parts: [{ text: finalSummary }] },      // The <state_snapshot>
  { role: 'model', parts: [{ text: 'Got it. Thanks!' }] }, // Acknowledgment
  ...historyToKeepTruncated                                 // Recent 30% verbatim
];
```

**Context window structure:**
```
[system prompt]
+ [state_snapshot as user message]
+ [model acknowledgment]
+ [recent 30% of history verbatim]
+ [new user message]
```

### High Fidelity Decision

**Choose between original vs truncated for summarizer:**
```typescript
const originalToCompressTokenCount = estimateTokenCountSync(
  originalHistoryToCompress.flatMap(c => c.parts || [])
);

const historyForSummarizer =
  originalToCompressTokenCount < tokenLimit(model)
    ? originalHistoryToCompress      // Send full fidelity
    : historyToCompressTruncated;    // Send truncated
```

**Purpose:** Give summarizer best possible input when it fits

### Failure Modes and Fallbacks

**Empty summary:**
```typescript
if (!finalSummary) {
  return {
    compressionStatus: CompressionStatus.COMPRESSION_FAILED_EMPTY_SUMMARY
  };
}
```

**Token inflation:**
```typescript
if (newTokenCount > originalTokenCount) {
  return {
    compressionStatus: CompressionStatus.COMPRESSION_FAILED_INFLATED_TOKEN_COUNT
  };
}
```

**Previous failure + auto trigger:**
```typescript
if (hasFailedCompressionAttempt && !force) {
  // Only apply truncation, don't attempt LLM summarization again
  return truncatedHistory;
}
```

## Key Characteristics

1. **Flat summarization**: All "to compress" content → single `<state_snapshot>`
2. **Irreversible**: Original messages are discarded after compression
3. **No provenance**: Can't trace which parts of snapshot came from which messages
4. **Two-phase refinement**: Generate + verify for quality
5. **Recent bias**: Always keeps newest 30% verbatim
6. **Tool output aware**: Special handling for large function responses
7. **Iterative**: New snapshots integrate previous snapshots
8. **Model-routed**: Uses cheaper models for compression (flash-lite, flash)

## Token Counts

- **Compression threshold**: 50% of model limit (configurable)
- **Preserve ratio**: 30% of history kept verbatim
- **Tool output budget**: 50,000 tokens across all function responses
- **Truncation threshold**: Last 30 lines for oversized tool outputs

## Model Routing

Compression uses cheaper models via `modelStringToModelConfigAlias()`:
- Gemini 3 Pro → chat-compression-3-pro
- Gemini 2.5 Flash → chat-compression-2.5-flash
- Gemini 2.5 Flash Lite → chat-compression-2.5-flash-lite

Separate model configs allow independent temperature/safety settings for compression.
