# H3 Cost Comparison

## Summary

Union-find consumes **26.6x** more tokens than flat compression. FAIL (criterion: ≤ 2x).

## Token Breakdown

| Metric | Flat | Union-find | Ratio |
|---|---|---|---|
| LLM calls | 24 | 960 | 40x |
| Input tokens | 125,075 | 3,543,410 | 28.3x |
| Output tokens | 17,964 | 261,807 | 14.6x |
| **Total tokens** | **143,039** | **3,805,217** | **26.6x** |

## Per-Conversation Average

| Metric | Flat | Union-find |
|---|---|---|
| Calls | 2 | 80 |
| Input tokens | 10,423 | 295,284 |
| Output tokens | 1,497 | 21,817 |
| Total | 11,920 | 317,101 |

## Why the Preregistration Estimate Was Wrong

**Expected:** ~10 LLM calls per 200-message conversation (based on reference paper)
**Actual:** 80 LLM calls per 120-message conversation

The estimate assumed:
- Most appends only add to hot zone (no LLM call)
- Merges are rare events (only when forced by cluster limit)
- Each merge involves 2-3 small clusters

Reality:
- After cold zone fills (msg ~40), EVERY graduation triggers a merge
- TF-IDF cosine similarity ≥ 0.15 is easy to hit on related messages
- Clusters grow large (10-20 members), making each re-summarization expensive

## Cost Model: O(n²) Problem

Each `union()` call:
1. Collects ALL member IDs from both clusters
2. Reads ALL member content
3. Sends ALL content to the LLM as input

As clusters grow, input size per call grows linearly. With ~80 calls and linearly growing input, total cost is **quadratic** in conversation length.

## What Would Fix This

**Incremental summarization:** Instead of re-reading all members, update the existing summary:

```
// Current (expensive):
summarize([msg1, msg2, msg3, ..., msgN, newMsg])

// Better (O(1) per merge):
updateSummary(existingSummary, newMsg)
```

This would reduce cost from O(n²) to O(n), bringing the ratio close to 1x.
