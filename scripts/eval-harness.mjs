#!/usr/bin/env node
import fs from "node:fs";

function parseArgs(argv) {
  const args = { fixtures: "eval/fixtures/conversations.json", runs: "eval/fixtures/sample-runs.jsonl" };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--fixtures") args.fixtures = argv[i + 1];
    if (token === "--runs") args.runs = argv[i + 1];
  }
  return args;
}

function loadFixtures(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function loadRuns(path) {
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

const args = parseArgs(process.argv);
const fixtures = loadFixtures(args.fixtures);
const runs = loadRuns(args.runs);
const report = evaluate(fixtures, runs);
console.log(JSON.stringify(report, null, 2));
