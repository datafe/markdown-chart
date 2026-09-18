import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEnvelope } from "../../../skills/markdown-chart/scripts/validate_chart.mjs";

// Inspect the delivered Markdown, never a draft or a successful tool log.
export function checkFinalAnswer(markdown, { renderer, blockCount = 1 } = {}) {
  const charts = [];
  const errors = [];
  let fence = null;
  let count = 0;
  for (const line of markdown.split(/\r?\n/)) {
    if (!fence) {
      const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/);
      if (opening) {
        const chart = opening[2].trim() === "markdown-chart";
        fence = { marker: opening[1][0], length: opening[1].length, chart, lines: [] };
        if (chart) count += 1;
      }
      continue;
    }
    const closing = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (!closing || closing[1][0] !== fence.marker || closing[1].length < fence.length) {
      fence.lines.push(line);
      continue;
    }
    if (fence.chart) {
      try {
        const envelope = JSON.parse(fence.lines.join("\n"));
        const issues = validateEnvelope(envelope);
        errors.push(...issues.map(issue => ({ block: count, ...issue })));
        if (envelope?.renderer === "echarts") {
          const axes = [envelope.spec?.xAxis, envelope.spec?.yAxis].flat().filter(Boolean);
          if (axes.some(axis => Object.hasOwn(axis, "data"))) {
            errors.push({ block: count, code: "DUPLICATE_CATEGORY_DATA", path: "$.spec" });
          }
        }
        if (renderer && envelope?.renderer !== renderer) {
          errors.push({ block: count, code: "WRONG_RENDERER", path: "$.renderer" });
        }
        charts.push(envelope);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        errors.push({ block: count, code: "INVALID_JSON", path: "$" });
      }
    }
    fence = null;
  }
  if (fence?.chart) errors.push({ block: count, code: "UNCLOSED_CHART", path: "$" });
  if (count !== blockCount) errors.push({ code: "BLOCK_COUNT", expected: blockCount, actual: count });
  return { ok: errors.length === 0, blockCount: count, errors, charts };
}

function fieldValue(data, row, field) {
  if (Array.isArray(field)) {
    if (field.length !== 1) return undefined;
    [field] = field;
  }
  const index = typeof field === "number" ? field : data.dimensions?.indexOf(field);
  return Array.isArray(row) ? row[index] : row[field];
}

function canonicalField(data, field) {
  if (Array.isArray(field)) {
    if (field.length !== 1) return undefined;
    [field] = field;
  }
  if (typeof field === "number") return field;
  return data.dimensions?.indexOf(field);
}

export function checkCase(markdown, testCase) {
  const result = checkFinalAnswer(markdown, testCase);
  if (!result.ok) return result;
  const chart = result.charts[0];
  const mismatch = message => result.errors.push({ code: "DATA_MISMATCH", message });
  if (testCase.tooltip && !chart.spec.tooltip) mismatch("Missing tooltip");
  if (chart.data?.kind !== "inline") mismatch("These cases require inline source data.");
  else if (testCase.wideSeries) {
    const expectedEntries = Object.entries(testCase.wideSeries.values);
    const lineSeries = chart.spec.series.filter(series => series.type === "line");
    if (lineSeries.length !== expectedEntries.length) mismatch(`Expected ${expectedEntries.length} line series, got ${lineSeries.length}`);
    if (chart.spec.series.length !== expectedEntries.length) mismatch(`Expected exactly ${expectedEntries.length} series, got ${chart.spec.series.length}`);
    if (chart.data.source.length !== testCase.wideSeries.xValues.length) mismatch(`Expected exactly ${testCase.wideSeries.xValues.length} data rows, got ${chart.data.source.length}`);
    if (lineSeries.some(series => Object.hasOwn(series.encode ?? {}, "seriesName"))) mismatch("Wide series must not use encode.seriesName");
    const names = lineSeries.map(series => series.name);
    if (new Set(names).size !== names.length) mismatch("Series names must be unique");
    const yFields = lineSeries.map(series => canonicalField(chart.data, series.encode?.y));
    if (yFields.some(index => !Number.isInteger(index) || index < 0)) mismatch("Every line series must bind an existing y dimension");
    if (new Set(yFields).size !== yFields.length) mismatch("Each line series must bind a different y dimension");
    for (const [name, expectedValues] of expectedEntries) {
      const series = lineSeries.find(item => item.name === name);
      if (!series) { mismatch(`Missing line series ${name}`); continue; }
      for (const [index, xValue] of testCase.wideSeries.xValues.entries()) {
        const row = chart.data.source.find(row => fieldValue(chart.data, row, series.encode.x) === xValue);
        const actual = row && fieldValue(chart.data, row, series.encode.y);
        if (actual !== expectedValues[index]) mismatch(`${name} ${xValue}: expected ${expectedValues[index]}, got ${actual}`);
      }
    }
  } else if (testCase.series) {
    for (const expected of testCase.series) {
      const series = chart.spec.series.find(item => item.type === expected.type);
      if (!series) { mismatch(`Missing ${expected.type} series`); continue; }
      if (testCase.labels && !series.label?.show) mismatch(`Missing ${expected.type} labels`);
      if (expected.categoryColors && (series.colorBy !== "data" || !Array.isArray(chart.spec.color) || chart.spec.color.length < Object.keys(expected.values).length)) {
        mismatch("Missing declarative category palette");
      }
      const category = expected.categoryAxis ?? "x";
      const value = category === "x" ? "y" : "x";
      const rows = chart.data.source;
      if (rows.length !== Object.keys(expected.values).length) mismatch("Unexpected category count");
      for (const [name, amount] of Object.entries(expected.values)) {
        const row = rows.find(row => fieldValue(chart.data, row, series.encode[category]) === name);
        const actual = row && fieldValue(chart.data, row, series.encode[value]);
        if (typeof actual !== "number" || Math.abs(actual - amount) > (expected.tolerance ?? 0.0001)) {
          mismatch(`${expected.type} ${name}: expected ${amount}, got ${actual}`);
        }
      }
      if (expected.axisUnit) {
        const axes = chart.spec[`${value}Axis`];
        const axis = Array.isArray(axes) ? axes[series[`${value}AxisIndex`] ?? 0] : axes;
        if (!axis?.name?.includes(expected.axisUnit)) mismatch(`Missing axis unit ${expected.axisUnit}`);
      }
    }
  } else if (testCase.kpis) {
    for (const expected of testCase.kpis) {
      const item = chart.spec.items.find(item => item.title === expected.title);
      if (!item) { mismatch(`Missing KPI ${expected.title}`); continue; }
      const data = item.dataset ? chart.datasets[item.dataset] : chart.data;
      const value = data.source.map(row => fieldValue(data, row, item.value.field)).filter(v => v != null).at(-1);
      const format = item.value.format ?? {};
      const actual = format.style === "percent" ? value * 100 : value;
      if (typeof actual !== "number" || Math.abs(actual - expected.displayValue) > 0.0001) {
        mismatch(`${expected.title}: expected display ${expected.displayValue}, got ${actual}`);
      }
      if (format.style !== "percent" && format.suffix !== "%") mismatch(`${expected.title}: missing percent unit`);
      if (testCase.fractionDigits !== undefined && (format.minimumFractionDigits !== testCase.fractionDigits || format.maximumFractionDigits !== testCase.fractionDigits)) {
        mismatch(`${expected.title}: expected ${testCase.fractionDigits} decimal places`);
      }
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [answerPath, caseId] = process.argv.slice(2);
  if (!answerPath) throw new Error("Usage: node check_final_answer.mjs <final-answer.md> [case-id]");
  const markdown = fs.readFileSync(answerPath, "utf8");
  const cases = JSON.parse(fs.readFileSync(new URL("./evals.json", import.meta.url), "utf8")).evals;
  const testCase = cases.find(item => String(item.id) === caseId);
  if (caseId && !testCase) throw new Error(`Unknown case: ${caseId}`);
  const result = testCase ? checkCase(markdown, testCase) : checkFinalAnswer(markdown);
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
