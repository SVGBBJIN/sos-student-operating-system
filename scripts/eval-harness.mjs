#!/usr/bin/env node
// Eval harness for the Gemini-native SOS chat surface.
//
// Modes:
//   --live    Run each fixture against Gemini, write sample-runs.jsonl
//   --shadow  Run twice (Pro + Flash tiers) and diff the predicted tool sets
//   default   Score the cached sample-runs.jsonl against the fixtures
//
// Env: GEMINI_API_KEY

import fs from "node:fs";
import { callModel, route } from "../shared/ai/index.js";

function parseArgs(argv) {
  const args = {
    fixtures: "eval/fixtures/conversations.json",
    runs: "eval/fixtures/sample-runs.jsonl",
    live: false,
    shadow: false,
    tier: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures") args.fixtures = argv[i + 1];
    if (token === "--runs") args.runs = argv[i + 1];
    if (token === "--live") args.live = true;
    if (token === "--shadow") args.shadow = true;
    if (token === "--tier") args.tier = argv[i + 1];
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
    tool_precision: rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.precision, 0) / rows.length,
    tool_recall: rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.recall, 0) / rows.length,
    clarification_appropriateness: rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.clarificationAppropriate, 0) / rows.length,
    hallucinated_field_rate: rows.length === 0 ? 0 : rows.reduce((s, r) => s + r.hallucinatedFieldRate, 0) / rows.length,
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

function buildEvalSystemPrompt() {
  const today = new Date().toISOString().slice(0, 10);
  return [
    `You are SOS, a student scheduling assistant. Today is ${today}.`,
    "When the student gives you actionable information, call the right tool.",
    "When required fields are missing or ambiguous, call ask_clarification.",
    "Never invent values. Never use placeholders.",
  ].join("\n");
}

async function runFixture(fixture, systemPrompt, tierOverride) {
  const t0 = Date.now();
  try {
    const result = await callModel({
      intent: "action_routing",
      tierOverride,
      systemPrompt,
      messages: fixture.messages,
      toolSet: "action",
      maxOutputTokens: 512,
      thinkingBudget: 0,
    });
    const latencyMs = Date.now() - t0;
    const predictedTools = (result.actions || []).map((a) => a.type).filter(Boolean);
    const clarification = (result.clarifications || [])[0] ?? null;
    const actionFields = [...new Set((result.actions || []).flatMap((a) => Object.keys(a)))];
    return {
      ok: true,
      record: {
        fixture_id: fixture.id,
        prompt_version: "eval-live-gemini",
        model_revision: result.model_used,
        predicted_tools: predictedTools,
        clarification: clarification ? { question: clarification.question } : null,
        action_fields: actionFields,
        latency_ms: latencyMs,
      },
    };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err), fixtureId: fixture.id };
  }
}

async function runLive(fixtures, runsPath, tier) {
  const systemPrompt = buildEvalSystemPrompt();
  const lines = [];
  for (const fixture of fixtures) {
    const r = await runFixture(fixture, systemPrompt, tier);
    if (!r.ok) {
      process.stderr.write(`[eval] fixture ${r.fixtureId} failed: ${r.error}\n`);
      continue;
    }
    lines.push(JSON.stringify(r.record));
    process.stderr.write(`[eval] ${r.record.fixture_id}: tools=${r.record.predicted_tools.join(",") || "(none)"} latency=${r.record.latency_ms}ms\n`);
  }
  fs.writeFileSync(runsPath, lines.join("\n") + (lines.length > 0 ? "\n" : ""), "utf8");
  process.stderr.write(`[eval] wrote ${lines.length} runs to ${runsPath}\n`);
}

async function runShadow(fixtures) {
  const systemPrompt = buildEvalSystemPrompt();
  const rows = [];
  for (const fixture of fixtures) {
    const [flash, pro] = await Promise.all([
      runFixture(fixture, systemPrompt, "flash"),
      runFixture(fixture, systemPrompt, "pro"),
    ]);
    rows.push({ fixture_id: fixture.id, flash, pro });
    const flashTools = flash.ok ? flash.record.predicted_tools.join(",") : "(error)";
    const proTools = pro.ok ? pro.record.predicted_tools.join(",") : "(error)";
    const diff = flashTools !== proTools ? "DIFF" : "OK";
    process.stderr.write(`[shadow] ${fixture.id} ${diff} flash=${flashTools} pro=${proTools}\n`);
  }
  const flashTiers = rows.flatMap((r) => (r.flash.ok ? [{ model_revision: r.flash.record.model_revision, prompt_version: "shadow-flash", latency_ms: r.flash.record.latency_ms, precision: 1, recall: 1, clarificationAppropriate: 1, hallucinatedFieldRate: 0 }] : []));
  const proTiers = rows.flatMap((r) => (r.pro.ok ? [{ model_revision: r.pro.record.model_revision, prompt_version: "shadow-pro", latency_ms: r.pro.record.latency_ms, precision: 1, recall: 1, clarificationAppropriate: 1, hallucinatedFieldRate: 0 }] : []));
  const summary = {
    pairs: rows.length,
    flash_latency_p50: percentile(flashTiers.map((r) => r.latency_ms), 50),
    pro_latency_p50: percentile(proTiers.map((r) => r.latency_ms), 50),
    flash_latency_p95: percentile(flashTiers.map((r) => r.latency_ms), 95),
    pro_latency_p95: percentile(proTiers.map((r) => r.latency_ms), 95),
    diff_rate: rows.filter((r) => {
      if (!r.flash.ok || !r.pro.ok) return true;
      return r.flash.record.predicted_tools.join(",") !== r.pro.record.predicted_tools.join(",");
    }).length / Math.max(1, rows.length),
  };
  console.log(JSON.stringify(summary, null, 2));
}

const args = parseArgs(process.argv);

if (args.live || args.shadow) {
  if (!process.env.GEMINI_API_KEY) {
    process.stderr.write("Error: GEMINI_API_KEY env var is required\n");
    process.exit(1);
  }
}

if (args.live) {
  const fixtures = loadFixtures(args.fixtures);
  await runLive(fixtures, args.runs, args.tier ?? undefined);
} else if (args.shadow) {
  const fixtures = loadFixtures(args.fixtures);
  await runShadow(fixtures);
} else {
  const fixtures = loadFixtures(args.fixtures);
  const runs = loadRuns(args.runs);
  const report = evaluate(fixtures, runs);
  console.log(JSON.stringify(report, null, 2));
}

// Reference unused import so linters don't warn — used by --shadow.
void route;
