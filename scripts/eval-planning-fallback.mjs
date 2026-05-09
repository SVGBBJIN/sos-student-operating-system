#!/usr/bin/env node
// Regression eval for the planning pipeline's MODEL_DEEP→MODEL_FAST fallback.
//
// Runs three scenarios against `runPlanningPipeline` with `callGroq` stubbed
// at the network layer:
//   1. healthy: heavy model succeeds on the first attempt for all three passes.
//   2. heavy-fails-once: every heavy call throws → fallback to MODEL_FAST should
//      recover and the pipeline should still return a proposal.
//   3. both-fail: both models throw → pipeline should throw a typed
//      PlanningPipelineError with cause_code === "both_models_failed".
//
// We stub `globalThis.fetch` so callGroq is exercised end-to-end (including
// the new try/catch fallback wrapper) without hitting Groq.
//
// Run: `node scripts/eval-planning-fallback.mjs`
// Exit non-zero on any assertion failure so CI can gate on it.

import { runPlanningPipeline, PlanningPipelineError } from "../shared/ai/planning-pipeline.js";
import { MODEL_DEEP, MODEL_FAST } from "../shared/ai/chat-core.js";

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

function buildToolCallResponse() {
  return {
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "tc_1",
              type: "function",
              function: {
                name: "make_plan",
                arguments: JSON.stringify(SAMPLE_PLAN),
              },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

function buildPlainResponse(text) {
  return { choices: [{ message: { content: text }, finish_reason: "stop" }] };
}

// Fake fetch driver that lets each scenario decide per-call behavior.
function installFetchStub(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init?.body || "{}");
    const result = await handler({ url, body });
    if (result instanceof Error) throw result;
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      json: async () => result,
      text: async () => JSON.stringify(result),
    };
  };
  return () => { globalThis.fetch = original; };
}

const SCENARIOS = [
  {
    name: "healthy",
    handler: ({ body }) => {
      // Heavy model returns a valid tool call on every pass.
      if (body.model !== MODEL_DEEP) {
        return new Error(`unexpected model ${body.model} on healthy path`);
      }
      const wantsToolCall = Array.isArray(body.tools) && body.tools.length > 0;
      return wantsToolCall ? buildToolCallResponse() : buildPlainResponse("ok");
    },
    assert: (result) => {
      if (!result?.proposal?.title) throw new Error("healthy: no proposal title");
      if (result.iterations !== 3) throw new Error(`healthy: expected 3 iterations, got ${result.iterations}`);
    },
  },
  {
    name: "heavy-fails-fallback-recovers",
    handler: ({ body }) => {
      if (body.model === MODEL_DEEP) {
        return new Error("simulated 500 on MODEL_DEEP");
      }
      if (body.model === MODEL_FAST) {
        const wantsToolCall = Array.isArray(body.tools) && body.tools.length > 0;
        return wantsToolCall ? buildToolCallResponse() : buildPlainResponse("ok");
      }
      return new Error(`unexpected model ${body.model}`);
    },
    assert: (result) => {
      if (!result?.proposal?.title) throw new Error("fallback: no proposal title");
      // Even if some passes go to fast, we should still ship a usable plan.
      if (!Array.isArray(result.proposal.steps) || result.proposal.steps.length === 0) {
        throw new Error("fallback: proposal had no steps");
      }
    },
  },
  {
    name: "both-models-fail",
    handler: () => new Error("simulated outage"),
    assertThrows: (err) => {
      if (!(err instanceof PlanningPipelineError)) {
        throw new Error(`expected PlanningPipelineError, got ${err?.name || typeof err}: ${err?.message}`);
      }
      if (err.stage !== "draft") {
        throw new Error(`expected stage=draft, got ${err.stage}`);
      }
      if (err.cause_code !== "both_models_failed") {
        throw new Error(`expected cause_code=both_models_failed, got ${err.cause_code}`);
      }
    },
  },
];

async function runScenario(scenario) {
  const restore = installFetchStub(scenario.handler);
  try {
    const result = await runPlanningPipeline({
      apiKey: "test-key",
      systemPrompt: "you are SOS test",
      staticSystemPrompt: null,
      dynamicContext: null,
      messages: [{ role: "user", content: "make me a study plan for AP Bio next Friday" }],
    });
    if (scenario.assertThrows) {
      throw new Error(`${scenario.name}: expected throw, got result`);
    }
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

(async () => {
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
})();
