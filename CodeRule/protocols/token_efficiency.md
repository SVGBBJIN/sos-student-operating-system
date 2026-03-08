## 🔋 Refinement Protocol: Surgical Token Use
- **Diffs Only:** Prohibit `cat` or full file rewrites for existing files > 50 lines. Use line-specific patches.
- **State Memory:** Do not re-read `src/lib/database.types.ts` multiple times. Cache the schema in your internal summary.
- **Greedy Search:** Use `grep -r` to find existing logic before asking the user where a function is.
- **Minimalist Summaries:** In "Refinement Mode," omit the "Here is what I did" summary. The code diff is the summary.

1. Input/Output Compression (The "Lean Buffer" Rule)

Acknowledge Without Repetition: Do not repeat the user's instructions back to them. A brief "Acknowledged, implementing [Feature Name]" is sufficient.

Differential Outputs: When updating files, DO NOT rewrite the entire file. Use standard git-diff format or targeted code blocks labeled with the specific line numbers/functions being changed.

No Prose Filler: Omit conversational pleasantries, apologies for errors, or detailed explanations of "how" a basic function works unless specifically asked.

2. Strategic Context Pruning

Targeted Reads: Before using cat or reading a file, use grep or ls to locate the exact line or directory needed. Do not ingest 500 lines of code to find a 5-line bug.

Sequential Awareness: If you have already read a file in the current session, rely on your internal state unless you have reason to believe the file has changed on disk.

Dependency Management: Do not read library documentation or node_modules content. Rely on your training data for standard API usage.

3. Operational Thrift

Batching: Combine multiple small file operations (e.g., creating 3 folders and 2 empty files) into a single shell command (e.g., mkdir -p ... && touch ...).

Self-Correction Loop Limit: If a tool call or build command fails twice with the same error, STOP. Do not retry a third time. Analyze the log, explain the roadblock concisely, and wait for human intervention.

Draft Mode: For large architectural changes, provide a high-level summary/pseudocode first. Only generate the full implementation once the human confirms the "vibe" and logic.

4. Media & Asset Handling

Placeholder Usage: Do not generate or process large binary assets (images/videos) within the chat context. Use descriptive placeholders (e.g., [Image: Neon-Blue-Hero-Graphic]) and let the shipyard tools handle asset linking.

Agent Logic Gate

Before every response, pass your planned output through this internal filter:

Is this necessary? (Does it move the project forward?)

Is this minimal? (Can this be a diff instead of a rewrite?)

Is this efficient? (Am I reading more files than I need to?)

Directive Status: ACTIVE. Failure to follow this protocol results in resource depletion and mission failure.

