# H2 Performance Analysis

## Summary

Union-find per-append latency **fails** the p95 < 100ms criterion.

- **With mock summarizer (local computation only):** p95 = 0.176ms — PASS
- **With real LLM (Gemini 3.1 Flash Lite):** p95 = 3,416ms — FAIL

The bottleneck is entirely LLM API call time, not local computation.

## Merge Frequency

| Append Type | Count | % | p50 | p95 |
|---|---|---|---|---|
| Hot-only (msgs 1-30) | 360 | 25.0% | <0.1ms | 0.1ms |
| Graduation, no merge | 120 | 8.3% | <0.1ms | 0.3ms |
| **Graduation + merge** | **960** | **66.7%** | **2,268ms** | **3,622ms** |

## Why So Many Merges?

With `hotSize=30` and `maxColdClusters=10`:

```
Messages 1-30:   Hot zone fills                    → 0 merges
Messages 31-40:  Graduation creates cold clusters  → 0 merges (cluster count < 10)
Messages 41+:    Every graduation triggers merge   → 1 merge per append
```

After 10 cold clusters exist, every new graduation either:
1. Merges into an existing cluster (similarity ≥ 0.15), or
2. Creates a new singleton, pushing count to 11, forcing a merge of the two most similar clusters

Either way: **1 LLM call per append** for the remaining ~80 messages per conversation.

## Flat Comparison

Flat compression has no per-append latency — it triggers once when hitting the threshold, blocks for 10-30 seconds (2 LLM calls), then returns. The blocking is concentrated rather than distributed.

| System | Per-append overhead | Total blocking time |
|---|---|---|
| Flat | 0ms (until threshold) | 10-30s (once) |
| Union-find | ~2-4s per append (after msg 40) | ~160-320s cumulative |

## Architectural Fix

To achieve p95 < 100ms, `append()` must return immediately:

```
append(msg) {
  this._hot.push(msg);
  if (this._hot.length > hotSize) {
    // Don't await — schedule in background
    this._graduateAsync(this._hot.shift()!);
  }
  return msgId; // Returns immediately
}
```

This is an **architectural change** (sync → async), classified as exploratory per preregistration.
