#!/usr/bin/env node
import fs from "node:fs";
import { callGroq, ACTION_TOOLS, MODEL_DEEP } from "../shared/ai/chat-core.js";

function parseArgs(argv) {
  const args = {
    fixtures: "eval/fixtures/conversations.json",
    runs: "eval/fixtures/sample-runs.jsonl",
    live: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures") args.fixtures = argv[i + 1];
    if (token === "--runs") args.runs = argv[i + 1];
    if (token === "--live") args.live = true;
  }
  return args;
}

function loadFixtures(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function loadRuns(path) {
  if (!fs.existsSync(path)) return [];
  return fs.readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function setMetrics(expectedTools, predictedTools) {
  const expected = new Set(expectedTools || []);
  const predicted = new Set(predictedTools || []);
  const truePositives = [...predicted].filter((tool) => expected.has(tool)).length;
  const precision = predicted.size === 0 ? (expected.size === 0 ? 1 : 0) : truePositives / predicted.size;
  const recall = expected.size === 0 ? (predicted.size === 0 ? 1 : 0) : truePositives / expected.size;
  return { precision, recall };
}

function evaluate(fixtures, runs) {
  const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
  const rows = [];
  for (const run of runs) {
    const fixture = fixtureById.get(run.fixture_id);
    if (!fixture) continue;
    const expected = fixture.expected || {};
    const { precision, recall } = setMetrics(expected.tools || [], run.predicted_tools || []);
    const shouldClarify = Boolean(expected.should_clarify);
    const didClarify = Boolean(run.clarification);
    const clarificationAppropriate = shouldClarify === didClarify ? 1 : 0;
    const allowedFields = new Set(expected.allowed_fields || []);
    const hallucinated = (run.action_fields || []).filter((field) => !allowedFields.has(field));
    const hallucinatedFieldRate = (run.action_fields || []).length === 0
      ? 0
      : hallucinated.length / run.action_fields.length;
    rows.push({
      prompt_version: run.prompt_version,
      model_revision: run.model_revision,
      latency_ms: Number(run.latency_ms) || 0,
      precision,
      recall,
      clarificationAppropriate,
      hallucinatedFieldRate,
    });
  }

  const aggregate = {
    total_runs: rows.length,
    tool_precision: rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.precision, 0) / rows.length,
    tool_recall: rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.recall, 0) / rows.length,
    clarification_appropriateness: rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.clarificationAppropriate, 0) / rows.length,
    hallucinated_field_rate: rows.length === 0 ? 0 : rows.reduce((sum, row) => sum + row.hallucinatedFieldRate, 0) / rows.length,
  };

  const byRevision = {};
  for (const row of rows) {
    const key = `${row.model_revision}::${row.prompt_version}`;
    if (!byRevision[key]) byRevision[key] = [];
    byRevision[key].push(row.latency_ms);
  }

  const latency = Object.fromEntries(
    Object.entries(byRevision).map(([key, values]) => [
      key,
      { p50_ms: percentile(values, 50), p95_ms: percentile(values, 95), sample_size: values.length },
    ])
  );

  return { aggregate, latency };
}

// Minimal routing-focused system prompt — enough context for the model to exercise
// all tool-selection paths without any real user data. The date anchor prevents
// the model from hallucinating relative dates into the past.
function buildEvalSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are SOS, a student scheduling assistant. Today is ${today}.`,
    "When the student gives you actionable information, call the right tool.",
    "When required fields are missing or ambiguous, call ask_clarification.",
    "Never invent values. Never use placeholders.",
  ].join("\n");
}

async function runLive(fixtures, runsPath, apiKey) {
  const systemPrompt = buildEvalSystemPrompt();
  const promptVersion = "eval-live-v1";
  const modelRevision = MODEL_DEEP;
  const lines = [];

  for (const fixture of fixtures) {
    const t0 = Date.now();
    let result;
    try {
      result = await callGroq(
        apiKey,
        modelRevision,
        systemPrompt,
        fixture.messages,
        512,
        null,
        null,
        true,
        ACTION_TOOLS,
        "auto",
        null,
        { disableFallback: true }
      );
    } catch (err) {
      process.stderr.write(`[eval] fixture ${fixture.id} failed: ${err.message}\n`);
      continue;
    }
    const latencyMs = Date.now() - t0;

    const predictedTools = [
      ...(result.actions || []).map((a) => a.type),
      ...(result.clarifications && result.clarifications.length > 0 ? [] : []),
    ].filter(Boolean);

    // ask_clarification shows up in clarifications, not actions
    const clarification = result.clarifications && result.clarifications.length > 0
      ? result.clarifications[0]
      : null;

    // Collect all unique field names across all actions
    const actionFields = [...new Set(
      (result.actions || []).flatMap((a) => Object.keys(a))
    )];

    const record = {
      fixture_id: fixture.id,
      prompt_version: promptVersion,
      model_revision: modelRevision,
      predicted_tools: predictedTools,
      clarification: clarification ? { question: clarification.question } : null,
      action_fields: actionFields,
      latency_ms: latencyMs,
    };
    lines.push(JSON.stringify(record));
    process.stderr.write(`[eval] ${fixture.id}: tools=${predictedTools.join(",") || "(none)"} latency=${latencyMs}ms\n`);
  }

  fs.writeFileSync(runsPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
  process.stderr.write(`[eval] wrote ${lines.length} runs to ${runsPath}\n`);
}

const args = parseArgs(process.argv);

if (args.live) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    process.stderr.write("Error: GROQ_API_KEY env var is required for --live mode\n");
    process.exit(1);
  }
  const fixtures = loadFixtures(args.fixtures);
  await runLive(fixtures, args.runs, apiKey);
}

const fixtures = loadFixtures(args.fixtures);
const runs = loadRuns(args.runs);
const report = evaluate(fixtures, runs);
console.log(JSON.stringify(report, null, 2));
