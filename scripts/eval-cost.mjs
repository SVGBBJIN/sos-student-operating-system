#!/usr/bin/env node
// Cost rollup: re-runs the eval fixtures against Gemini and tallies cost-per-
// 1k-requests by tier. Used as a gate before flipping prod default.

import { callModel } from "../shared/ai/index.js";

const TIERS = ["flash", "pro"];

const FIXTURE_TEXTS = [
  "add calc quiz on friday",
  "what's on my schedule tomorrow",
  "make me flashcards on photosynthesis",
  "delete the chem lab event",
  "i need a study plan for finals",
];

const PRICING = {
  "gemini-3-flash":   { in: 0.00010, out: 0.00040 },
  "gemini-2.5-flash": { in: 0.00007, out: 0.00030 },
  "gemini-2.5-pro":   { in: 0.00125, out: 0.00500 },
};

function cost(model, usage) {
  const p = PRICING[model];
  if (!p) return 0;
  const ipt = (usage?.prompt_tokens ?? 0) / 1000;
  const opt = (usage?.output_tokens ?? 0) / 1000;
  return ipt * p.in + opt * p.out;
}

if (!process.env.GEMINI_API_KEY) {
  process.stderr.write("Error: GEMINI_API_KEY required\n");
  process.exit(1);
}

const totals = {};
for (const tier of TIERS) {
  let cum = 0;
  for (const text of FIXTURE_TEXTS) {
    const res = await callModel({
      intent: "action_routing",
      tierOverride: tier,
      systemPrompt: "You are SOS, a student scheduling assistant.",
      messages: [{ role: "user", content: text }],
      toolSet: "action",
      maxOutputTokens: 256,
      thinkingBudget: 0,
    });
    cum += cost(res.model_used, res.usage);
  }
  totals[tier] = {
    sample_size: FIXTURE_TEXTS.length,
    total_usd: cum,
    cost_per_1k_usd: (cum / FIXTURE_TEXTS.length) * 1000,
  };
}
console.log(JSON.stringify(totals, null, 2));
