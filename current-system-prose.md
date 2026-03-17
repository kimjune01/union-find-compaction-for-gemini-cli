# Gemini-CLI Current Context Compaction - Prose Description

This document describes how gemini-cli currently handles context window management, without referencing specific code constructs.

## The Problem

Chat conversations grow without bound. Each user message, model response, and tool result consumes tokens. When the accumulated history approaches the model's token limit, the system must reduce context size or fail. Gemini-cli solves this through **context compression**: summarizing old history into a compact form that preserves meaning while freeing tokens for new turns.

## When Compression Triggers

Compression activates automatically when the conversation history exceeds half the model's token limit. This threshold leaves headroom for the next turn while ensuring compression happens before context overflow becomes critical. Users can also manually trigger compression regardless of token count.

The system distinguishes between automatic triggers (periodic background compression) and manual triggers (explicit user command), firing hooks appropriately so extensions can respond to each case differently.

## Deciding What to Compress

Not all history is equally important. Recent exchanges provide immediate context for the current task. Older history provides background but doesn't need full fidelity. The compression strategy reflects this by preserving the newest portion verbatim while compressing the oldest portion.

The system uses a **character-count-based split point calculation**. It accumulates character counts from oldest to newest message until reaching a target threshold (70% of total history), then identifies the next user message boundary as the split point. This split-on-user-message constraint ensures compression doesn't leave the model expecting a response to a function call that was cut off mid-turn.

The result: the oldest 70% of history becomes candidates for compression, while the newest 30% stays in the context window exactly as written.

If the conversation contains a previous compression snapshot, the system ensures that snapshot appears in the "to compress" section so its information gets integrated into the new snapshot rather than lost.

## Tool Output Management

Function responses (tool outputs) present a special challenge. A single grep result or log dump can contain thousands of lines. If left unchecked, tool outputs would dominate the compression budget, forcing the summarizer to spend most of its capacity on ephemeral tool results rather than substantive conversation.

The system applies a **reverse token budget** before compression: it walks backwards through history (newest to oldest), tracking cumulative tokens in function responses. Recent tool outputs stay intact—they're likely relevant to the current task. Once the cumulative token count exceeds a budget (50,000 tokens), older oversized tool outputs get truncated to their last 30 lines and saved to temporary files. The history then contains a placeholder with the file path instead of the full output.

This ensures that even conversations with massive tool outputs compress effectively, and the summarizer sees a balanced mix of conversation and tool results rather than drowning in stale grep output.

## Summarization Process

With the split point determined and tool outputs managed, the system sends the "to compress" history to a language model with instructions to generate a **state snapshot**. This snapshot is a prose summary capturing the conversation's current state: what problem the user is working on, what's been tried, what constraints or preferences have been established, what tools have been used, and what the next steps might be.

The prompt emphasizes preserving specific technical details: version numbers, ports, file paths, exact commands, function names, threshold values. The goal is extractive summarization—pulling facts from the history into a compact form—rather than abstractive paraphrasing that might introduce errors.

### Two-Phase Refinement

Compression uses a two-phase approach to improve quality:

**Phase 1 (Generate):** The model receives the history and generates an initial snapshot. The prompt asks it to reason in a scratchpad first, then produce the snapshot. This encourages the model to explicitly consider what to include before committing to the summary.

**Phase 2 (Verify):** The system immediately sends the generated snapshot back to the model with a critical evaluation prompt: "Did you omit any specific technical details, file paths, tool results, or user constraints? If anything is missing or could be more precise, generate a FINAL improved snapshot. Otherwise, repeat the exact same snapshot."

This self-verification pass catches common summarization failures: dropped version numbers, missing file paths, vague paraphrases instead of exact commands. The second pass can recover these details because the history is still available in context.

The final snapshot from phase 2 becomes the summary.

### Integrating Previous Snapshots

If the history already contains a previous snapshot (from earlier compression), the system modifies the prompt to say: "A previous snapshot exists. You MUST integrate all still-relevant information from that snapshot into the new one, updating it with more recent events."

This prevents information loss across successive compressions. Without this integration instruction, the summarizer might treat the old snapshot as just another message and omit its contents. With it, the new snapshot accumulates knowledge: each compression round adds recent history while preserving critical context from all previous rounds.

## New History Construction

After summarization succeeds, the system constructs a new chat history:

1. The compressed snapshot, injected as a user message
2. A model acknowledgment ("Got it. Thanks for the additional context!")
3. The preserved recent 30% of history, verbatim

This structure makes the snapshot look like additional user context provided at the start of the conversation, followed by the actual recent exchange. The model sees a clean boundary: old context in summary form, recent context in full fidelity.

## High Fidelity Decision

Before sending history to the summarizer, the system checks whether the original "to compress" content fits within the model's token limit. If it does, it sends the original full-fidelity history for summarization. If not, it sends the truncated version (with tool outputs already condensed).

This high fidelity choice ensures the summarizer always sees the best possible input. When compression is triggered early (history at 50% of limit, but the 70% to compress is only 35% of limit), the summarizer gets pristine input. Only when the "to compress" section alone exceeds model capacity does it fall back to truncated input.

## Failure Handling

Compression can fail in several ways:

**Empty summary:** The model returns nothing or only whitespace. This might happen if the history is malformed or the model refuses the request. The system detects this and aborts compression—better to keep the original history than inject an empty snapshot.

**Token inflation:** The new history (snapshot + recent 30%) contains *more* tokens than the original. This counterintuitive outcome occurs when the model generates a verbose summary that's longer than the content it summarized. The system detects this by counting tokens before and after, rejecting compressions that increase context size.

**Previous failure + auto trigger:** If compression previously failed for this conversation and the current trigger is automatic (not manual), the system skips LLM summarization entirely and only applies tool output truncation. This prevents repeated failed compression attempts from burning API quota. Manual compression still attempts summarization because the user explicitly requested it.

In all failure cases, the system returns the original history unchanged and logs the failure reason.

## Model Routing

Compression uses cheaper, faster models than the main conversation. The system maintains separate model configurations for compression: each primary model (Gemini 3 Pro, Gemini 2.5 Flash, etc.) maps to a corresponding compression model alias. These aliases can be configured independently with different temperature, safety settings, or even entirely different models.

This routing means compression can use Gemini Flash Lite (very cheap, very fast) even when the main conversation uses Gemini Pro (expensive, capable). The compression task—extractive summarization of technical conversation—is well-suited to smaller models, and the cost savings compound over long sessions with multiple compression rounds.

## Key Properties

**Flat structure:** All old history compresses into a single snapshot. There's no internal structure—no clusters, no topics, no separation of concerns. Everything becomes one prose block.

**Irreversible:** Once compressed, the original messages are gone. The system can't expand the snapshot back to source messages. If the summary omits a detail, that detail is lost.

**No provenance:** The snapshot doesn't track which parts came from which messages. If the summary says "port 5433," you can't trace that back to the specific message where the user set it.

**Recent bias:** The newest 30% always stays verbatim. This ensures the model always has high-fidelity context for the current task, at the cost of compressing older (potentially still relevant) history more aggressively.

**Iterative:** Successive compressions integrate previous snapshots, building an accumulated summary. Over many rounds, the snapshot represents the entire conversation history.

**Two LLM calls per compression:** Phase 1 generates, phase 2 verifies. This doubles compression cost but improves quality, especially for capturing technical details.

## Why This Design

The current approach prioritizes **simplicity and robustness**:

- Single snapshot = one summarization call (plus verification), predictable cost
- Split-on-user-message = never leaves dangling function calls
- Preserve recent 30% = guarantee high-fidelity context for current turn
- Reverse token budget = handle massive tool outputs without choking summarizer
- High fidelity decision = give summarizer best input when possible
- Failure detection = don't inject bad summaries that would corrupt conversation

The trade-off is **compression quality under pressure**. When the "to compress" section contains hundreds of messages spanning multiple topics, a single summary must decide what to keep and what to drop. Specific details—scrape intervals, webhook paths, threshold values—compete for space. The summarizer is good, but it's solving a lossy compression problem with no guidance about which details matter most.

## What Compression Achieves

When successful, compression:
- Reduces token count from ~100k to ~40k (typical)
- Preserves enough context for conversation continuity
- Allows conversations to continue beyond model token limits
- Keeps cost manageable by using cheaper models for summarization

## Known Problems

The current compression approach has several user-facing issues observed in production:

**Blocking UX during compression:** The system must complete both LLM calls (generate + verify) before returning control to the user. For large histories, this can take 10-30 seconds. The user sees a spinner and cannot continue working. The conversation pauses completely while compression happens. This interruption breaks flow, especially during iterative debugging sessions where compression might trigger multiple times per hour.

**Lossy compression loses needed details:** The summarizer cannot retain everything from hundreds of messages in a fixed-size snapshot. Users frequently encounter situations where they reference a specific value mentioned earlier—a port number, a file path, an error code—and find it's no longer in context. The model says "I don't see that in our conversation history" even though the user clearly remembers discussing it. The detail was dropped during compression. Users must re-paste information they've already provided, adding friction.

**Unsearchable compressed history:** Once history is compressed into a `<state_snapshot>`, users cannot search or grep through it to find specific mentions. The snapshot is prose, not structured data. If a user wants to find "where did we set the database timeout?", they must read through the entire snapshot manually or re-ask the model, which may not recall that detail if it was omitted during summarization. The original message containing that fact is gone.

**No provenance for snapshot facts:** When the snapshot says "port 5433," there's no way to trace that back to when it was set, why, or whether it's been superseded. If multiple ports were discussed and one was chosen, the snapshot might show the final choice but not the reasoning. This makes debugging configuration issues harder—users can't retrace the decision path.

**Compression artifacts accumulate:** Each successive compression integrates the previous snapshot. Over many rounds, imprecision compounds. A detail that was slightly vague in round 1 becomes vaguer in round 2, and by round 5 might be misleading. "Database on port 5433" becomes "database configured" becomes "environment set up." The signal degrades like a photocopy of a photocopy.

**Cannot expand when more detail is needed:** If the model gives a vague answer based on the compressed snapshot and the user says "no, I need the exact command we used," the system cannot retrieve it. The original message with the full command is gone. The user must provide it again or search external notes. The compressed history is a one-way door.
