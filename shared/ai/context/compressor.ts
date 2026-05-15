// Compress older conversation turns into a short bullet summary. Used when the
// trailing window of full messages exceeds the chat budget.
//
// Uses the summarize intent (Flash tier) — fast, cheap, deterministic.

import type { Message } from "../providers/types.js";
import { callModel } from "../chat-core.js";

const SUMMARIZE_PROMPT =
  "Compress the following conversation turns into 6 bullet points. " +
  "Keep concrete facts (names, dates, subjects), drop pleasantries, never invent details.";

export interface CompressOptions {
  budgetMessages: number;
}

export async function compressOlderTurns(messages: Message[], opts: CompressOptions): Promise<Message[]> {
  if (messages.length <= opts.budgetMessages) return messages;
  const drop = messages.length - opts.budgetMessages;
  const olderTurns = messages.slice(0, drop);
  const keptTurns = messages.slice(drop);

  const transcript = olderTurns
    .map((m) => `${m.role.toUpperCase()}: ${typeof m.content === "string" ? m.content : ""}`)
    .join("\n");

  const summary = await callModel({
    intent: "summarize",
    systemPrompt: SUMMARIZE_PROMPT,
    messages: [{ role: "user", content: transcript }],
    toolSet: "none",
    temperature: 0.1,
    maxOutputTokens: 400,
    thinkingBudget: 0,
  });

  const summaryNote: Message = {
    role: "system",
    content: `Earlier conversation summary:\n${summary.content}`,
  };
  return [summaryNote, ...keptTurns];
}
