#!/usr/bin/env node
// Regression eval for the planning pipeline's cross-provider fallback.
//
// The new pipeline relies on callModel's cross-provider fallback ladder:
//   - Primary (Groq gpt-oss-120b) succeeds          → 3 iterations
//   - Primary fails → callModel hops to Gemini 2.5 Pro fallback
//   - Both providers fail on draft pass → PlanPipelineError(stage="draft")
//
// We force AI_PROVIDER_OVERRIDE=gemini so the test runs against a single
// provider seam, then monkeypatch the LlmProvider instance returned by
// getProvider() to deterministically simulate failures.

process.env.AI_PROVIDER_OVERRIDE = "gemini";

import { runPlanPipeline, PlanPipelineError, getProvider } from "../shared/ai/index.js";

const SAMPLE_PLAN = {
  type: "make_plan",
  title: "AP Bio Test Prep",
  steps: [
    { title: "Diagnostic + scoping", estimated_minutes: 30 },
    { title: "Cell biology review",   estimated_minutes: 60 },
    { title: "Genetics review",       estimated_minutes: 60 },
    { title: "Mock exam",             estimated_minutes: 90 },
    { title: "Light review + sleep",  estimated_minutes: 30 },
  ],
};

function makeFakeProvider(handler) {
  return {
    name: "fake",
    async chat(req) { return handler(req); },
    async *stream(req) { yield { type: "done", usage: {} }; void req; },
    async embed(req) { void req; return { vectors: [[]], model: "fake-embed", dim: 1536 }; },
  };
}

function buildToolCallResponse() {
  return {
    content: "",
    toolCalls: [{ name: "make_plan", args: SAMPLE_PLAN }],
    usage: {},
    modelUsed: "fake-pro",
    finishReason: "tool_calls",
  };
}

function buildPlain(text) {
  return { content: text, toolCalls: [], usage: {}, modelUsed: "fake-pro", finishReason: "stop" };
}

// Hot-swap the registry's provider with a fake. We poke the cached instance
// out of the provider registry by re-getting with a unique key.
function installFakeProvider(handler) {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";
  const p = getProvider("gemini", process.env.GEMINI_API_KEY);
  const original = { chat: p.chat.bind(p), stream: p.stream.bind(p), embed: p.embed.bind(p) };
  p.chat = handler;
  return () => { p.chat = original.chat; };
}

const SCENARIOS = [
  {
    name: "healthy",
    handler: async (req) => (req.tools && req.tools.length > 0 ? buildToolCallResponse() : buildPlain("ok")),
    assert: (result) => {
      if (!result?.proposal?.title) throw new Error("healthy: no proposal title");
      if (result.iterations !== 3) throw new Error(`healthy: expected 3 iterations, got ${result.iterations}`);
    },
  },
  {
    name: "pro-fails-flash-recovers",
    handler: async (req) => {
      if (req.model === "gemini-2.5-pro") throw new Error("simulated 503 on Pro");
      if (req.model === "gemini-2.5-flash") return req.tools?.length ? buildToolCallResponse() : buildPlain("ok");
      throw new Error(`unexpected model ${req.model}`);
    },
    assert: (result) => {
      if (!result?.proposal?.title) throw new Error("recovery: no proposal title");
      if (!Array.isArray(result.proposal.steps) || result.proposal.steps.length === 0) {
        throw new Error("recovery: proposal had no steps");
      }
    },
  },
  {
    name: "both-tiers-fail",
    handler: async () => { throw new Error("simulated outage"); },
    assertThrows: (err) => {
      if (!(err instanceof PlanPipelineError)) throw new Error(`expected PlanPipelineError, got ${err?.name}: ${err?.message}`);
      if (err.stage !== "draft") throw new Error(`expected stage=draft, got ${err.stage}`);
    },
  },
];

async function runScenario(scenario) {
  const restore = installFakeProvider(scenario.handler);
  try {
    const result = await runPlanPipeline({
      systemPrompt: "you are SOS test",
      staticSystemPrompt: null,
      dynamicContext: null,
      messages: [{ role: "user", content: "make me a study plan for AP Bio next Friday" }],
    });
    if (scenario.assertThrows) throw new Error(`${scenario.name}: expected throw, got result`);
    scenario.assert?.(result);
    console.log(`✓ ${scenario.name}`);
  } catch (err) {
    if (scenario.assertThrows) {
      scenario.assertThrows(err);
      console.log(`✓ ${scenario.name}`);
      return;
    }
    throw err;
  } finally {
    restore();
  }
}

let failed = 0;
for (const scenario of SCENARIOS) {
  try {
    await runScenario(scenario);
  } catch (err) {
    failed += 1;
    console.error(`✗ ${scenario.name}: ${err.message}`);
  }
}
if (failed > 0) {
  console.error(`\n${failed}/${SCENARIOS.length} planning fallback scenarios failed.`);
  process.exit(1);
}
console.log(`\n${SCENARIOS.length}/${SCENARIOS.length} planning fallback scenarios passed.`);
