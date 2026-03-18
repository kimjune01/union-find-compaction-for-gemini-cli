# H1 Recall Analysis

## Summary

Union-find shows a +7.3pp recall advantage over flat compression, but the difference is not statistically significant (McNemar's p=0.169).

## McNemar's Test

|  | Union-find ✓ | Union-find ✗ |
|---|---|---|
| **Flat ✓** | 14 | 6 |
| **Flat ✗** | 13 | 63 |

- Chi-squared (continuity correction): 1.895
- p-value: 0.169
- n = 96 paired observations

The discordant pairs (b=6, c=13) show union-find uniquely answering more questions correctly than flat uniquely does. But with small discordant counts, the test lacks power.

## Per-Conversation Pattern

Union-find wins or ties on 10 of 12 conversations. The two losses (react#13991 at −13pp, react#11347 at −25pp) are both early conversations — possible warm-up effect from the incremental TF-IDF vocabulary.

## Power Analysis (Post-Hoc)

For a McNemar's test with discordant proportion ~0.2 (19/96) and odds ratio ~2.17 (13/6), approximately 200 paired observations would be needed for 80% power at α=0.05.

The experiment had 96 observations — underpowered by roughly 2x.

## Why Both Systems Have Low Recall

Both flat (20.8%) and union-find (28.1%) have low absolute recall because:

1. **GitHub issues are multi-party discussions** with dozens of contributors. Specific details from individual comments are easily lost.
2. **120 messages compress to ~10 clusters** (union-find) or one summary (flat). Compression ratio is extreme (~12x for union-find, ~120x for flat).
3. **Questions target very specific facts** (exact version numbers, specific users' suggestions, particular file paths) — the kind of details most likely lost in compression.

## The Structural Advantage

Union-find preserves more facts because:
- **10 separate summaries** (one per cluster) provide more total output space than 1 flat summary
- Each cluster summarizes a **topically coherent subset** (20-30 related messages) vs flat summarizing all 84 messages at once
- Smaller input → higher preservation ratio per summarization call
