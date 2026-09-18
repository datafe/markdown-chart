import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { validateEnvelope } from "../../../skills/markdown-chart/scripts/validate_chart.mjs";

const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = path.resolve(TEST_DIRECTORY, "../../../skills/markdown-chart/scripts/validate_chart.mjs");
const WIKI_REF = "kb-wiki://wiki/kb_01M06TNAJERSPD2MXQSW937DCJ/versions/v20260804-120000-ab12cd34/files/metrics/conversion-rate.md#calculation-logic";

function validEnvelope() {
  return {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: ["period", "value"],
      source: [["A", 1], ["B", 2]],
    },
    spec: {
      tooltip: { trigger: "axis" },
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [{ type: "bar", encode: { x: "period", y: "value" } }],
    },
  };
}

function validMultiSeriesEnvelope() {
  return {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: ["week", "mooncake_gift_box", "nuts"],
      source: [
        ["2025-05-26", 713_791, 374_594],
        ["2025-07-14", 391_199, 282_953],
      ],
    },
    spec: {
      tooltip: { trigger: "axis" },
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [
        { name: "月饼礼盒", type: "line", encode: { x: "week", y: "mooncake_gift_box" } },
        { name: "坚果炒货", type: "line", encode: { x: "week", y: "nuts" } },
      ],
    },
  };
}

function validGraphEnvelope(type = "sankey") {
  return {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      shape: "graph",
      source: {
        nodes: [
          { id: "source", name: "重复名称", category: "入口" },
          { id: "target", name: "重复名称", category: "结果" },
        ],
        links: [{ source: "source", target: "target", value: 10 }],
      },
    },
    spec: { series: [{ type }] },
  };
}

function validHierarchyEnvelope(type = "treemap") {
  return {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      shape: "hierarchy",
      source: [{
        id: "root",
        name: "全部",
        children: [
          { id: "a", name: "A", value: 2 },
          { id: "b", name: "B", value: 3 },
        ],
      }],
    },
    spec: { series: [{ type }] },
  };
}

function validTableEnvelope() {
  return {
    version: 1,
    renderer: "table",
    data: {
      kind: "inline",
      source: [
        { region: "华东", sales: 1_280_000, growth: 0.18, target: 0.91, apr: 31, may: 36, jun: 42 },
        { region: "华南", sales: 960_000, growth: -0.04, target: 0.74, apr: 27, may: 26, jun: 25 },
      ],
    },
    spec: {
      title: "区域经营明细",
      height: 420,
      columns: [
        { field: "region", title: "区域", pinned: "left" },
        { field: "sales", title: "销售额", type: "number", format: { style: "currency", currency: "CNY", notation: "compact" } },
        { field: "growth", title: "同比", type: "number", format: { style: "percent" }, cell: { kind: "change", polarity: "higher-is-better" } },
        { field: "target", title: "目标完成", type: "number", format: { style: "percent" }, cell: { kind: "progress", min: 0, max: 1, clamp: true } },
        { id: "trend", title: "近三月", cell: { kind: "sparkline", fields: ["apr", "may", "jun"], labels: ["4月", "5月", "6月"], scale: "column" } },
      ],
      initialSort: [{ field: "sales", direction: "desc" }],
    },
  };
}

function validKpiEnvelope() {
  return {
    version: 1,
    renderer: "kpi",
    data: {
      kind: "inline",
      dimensions: ["day", "conversion_rate", "revenue", "inventory", "status", "tone"],
      source: [
        ["2026-08-30", 0.36, 15_700_000, "25/48", "库存偏低", "warning"],
        ["2026-08-31", 0.38, 16_800_000, "24/48", "库存偏低", "warning"],
        ["2026-09-01", 0.4, 18_000_000, "23/48", "低于安全水平", "negative"],
      ],
    },
    spec: {
      timeField: "day",
      items: [
        {
          id: "conversion_rate",
          title: "转化率",
          value: {
            field: "conversion_rate",
            reduce: "lastNonNull",
            format: { style: "percent", maximumFractionDigits: 0 },
          },
          status: { text: { literal: "低于目标" }, tone: { literal: "negative" } },
          trend: {
            type: "area",
            compare: { lag: 1, mode: "absolute", label: "较昨日", polarity: "higher-is-better" },
            yScale: { includeZero: true },
          },
          references: [{ ref: WIKI_REF, label: "转化率 / Calculation Logic" }],
        },
        {
          id: "revenue",
          title: "累计营收",
          value: {
            field: "revenue",
            format: { style: "currency", currency: "CNY", notation: "compact", maximumFractionDigits: 1 },
          },
          trend: {
            type: "line",
            compare: { lag: 1, mode: "relative", polarity: "higher-is-better" },
          },
        },
        {
          id: "inventory",
          title: "门店库存",
          value: { field: "inventory", format: { style: "text" } },
          status: { text: { field: "status" }, tone: { field: "tone" } },
        },
      ],
    },
  };
}

test("accepts a canonical inline ECharts dataset envelope", () => {
  assert.deepEqual(validateEnvelope(validEnvelope()), []);
});

test("keeps existing ECharts formatter and dataset safeguards", () => {
  const envelope = validEnvelope();
  envelope.spec.tooltip.formatter = "{b}: {c}";
  envelope.spec.series[0].label = { show: true, formatter: "{c}" };
  envelope.spec.series[0].markPoint = { label: { formatter: "peak" } };
  envelope.spec.series[0].markLine = { label: { formatter: "limit" } };
  envelope.data.source[1] = ["B"];
  envelope.spec.dataset = { source: [] };
  envelope.spec.xAxis.data = ["A", "B"];
  envelope.spec.series[0].data = [1, 2];

  const errors = validateEnvelope(envelope);
  const codes = new Set(errors.map((error) => error.code));
  for (const code of [
    "FORBIDDEN_FORMATTER",
    "ROW_WIDTH_MISMATCH",
    "FORBIDDEN_DATASET",
    "DUPLICATE_AXIS_DATA",
    "DUPLICATE_SERIES_DATA",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
  assert.deepEqual(
    errors.filter((error) => error.code === "FORBIDDEN_FORMATTER").map((error) => error.path),
    [
      "$.spec.tooltip.formatter",
      "$.spec.series[0].label.formatter",
      "$.spec.series[0].markPoint.label.formatter",
      "$.spec.series[0].markLine.label.formatter",
    ],
  );
});

test("keeps controlled ECharts ref validation", () => {
  const envelope = validEnvelope();
  envelope.data = {
    kind: "ref",
    ref: "artifact://chart-data/sales-q1.csv",
    format: "csv",
    dimensions: ["period", "value"],
  };
  assert.deepEqual(validateEnvelope(envelope), []);
  envelope.data.ref = "https://example.com/chart.csv";
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "INVALID_REF"), true);
});

test("accepts chart-ready wide multi-series data", () => {
  assert.deepEqual(validateEnvelope(validMultiSeriesEnvelope()), []);
});

test("requires explicit unique names for multiple line or bar series", () => {
  const missing = validMultiSeriesEnvelope();
  delete missing.spec.series[0].name;
  assert.deepEqual(
    validateEnvelope(missing).filter((error) => error.code === "INVALID_SERIES_NAME"),
    [{
      code: "INVALID_SERIES_NAME",
      path: "$.spec.series[0].name",
      message: "multiple line/bar series require an explicit non-empty series.name.",
    }],
  );

  const duplicate = validMultiSeriesEnvelope();
  duplicate.spec.series[1].name = duplicate.spec.series[0].name;
  assert.deepEqual(
    validateEnvelope(duplicate).filter((error) => error.code === "DUPLICATE_SERIES_NAME"),
    [{
      code: "DUPLICATE_SERIES_NAME",
      path: "$.spec.series[1].name",
      message: "series.name must be unique among line/bar series.",
    }],
  );

  const single = validEnvelope();
  assert.deepEqual(validateEnvelope(single), []);
});

test("rejects duplicate canonical x/y mappings for the same line or bar type", () => {
  const longTable = {
    version: 1,
    renderer: "echarts",
    data: {
      kind: "inline",
      dimensions: ["week", "category", "GMV"],
      source: [
        ["2025-07-14", "月饼礼盒", 391_199],
        ["2025-07-14", "坚果炒货", 282_953],
      ],
    },
    spec: {
      xAxis: { type: "category" },
      yAxis: { type: "value" },
      series: [
        { name: "月饼礼盒", type: "line", encode: { x: "week", y: "GMV", seriesName: "category" } },
        { name: "坚果炒货", type: "line", encode: { x: 0, y: 2, seriesName: "category" } },
      ],
    },
  };

  assert.deepEqual(
    validateEnvelope(longTable).filter((error) => error.code === "DUPLICATE_SERIES_MAPPING"),
    [{
      code: "DUPLICATE_SERIES_MAPPING",
      path: "$.spec.series[1].encode",
      message: "line series duplicates the canonical x/y mapping of $.spec.series[0].",
    }],
  );
});

test("allows a line and bar combination to share the same x/y mapping", () => {
  const envelope = validEnvelope();
  envelope.spec.series = [
    { name: "订单柱", type: "bar", encode: { x: "period", y: "value" } },
    { name: "订单线", type: "line", encode: { x: "period", y: "value" } },
  ];

  assert.deepEqual(validateEnvelope(envelope), []);
});

test("does not treat disabled or empty encode channels as duplicate mappings", () => {
  const disabled = validMultiSeriesEnvelope();
  disabled.spec.series[0].encode.y = -1;
  disabled.spec.series[1].encode.y = -1;
  assert.deepEqual(validateEnvelope(disabled), []);

  const empty = validMultiSeriesEnvelope();
  empty.spec.series[0].encode.x = [];
  empty.spec.series[1].encode.x = [];
  assert.deepEqual(validateEnvelope(empty), []);
});

test("validates every ECharts encode dimension reference", () => {
  const accepted = validMultiSeriesEnvelope();
  accepted.spec.series[0].encode = { x: 0, y: [1], tooltip: [1, -1] };
  accepted.spec.series[1].encode = { x: ["week"], y: 2, tooltip: -1 };
  assert.deepEqual(validateEnvelope(accepted), []);

  const invalid = validEnvelope();
  invalid.spec.series[0].encode = {
    x: "missing",
    y: 3,
    tooltip: -2,
    label: { field: "value" },
  };
  assert.deepEqual(
    validateEnvelope(invalid).map(({ code, path }) => ({ code, path })),
    [
      { code: "MISSING_ENCODE_FIELD", path: "$.spec.series[0].encode.x" },
      { code: "INVALID_ENCODE_INDEX", path: "$.spec.series[0].encode.y" },
      { code: "INVALID_ENCODE_INDEX", path: "$.spec.series[0].encode.tooltip" },
      { code: "INVALID_ENCODE_VALUE", path: "$.spec.series[0].encode.label" },
    ],
  );
});

test("rejects named datasets for ECharts", () => {
  const envelope = validEnvelope();
  envelope.datasets = {
    secondary: { kind: "inline", dimensions: ["period", "value"], source: [["A", 2]] },
  };
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "UNSUPPORTED_DATASETS"), true);
});

test("accepts canonical graph and hierarchy envelopes without table encode", () => {
  assert.deepEqual(validateEnvelope(validGraphEnvelope()), []);
  assert.deepEqual(validateEnvelope(validGraphEnvelope("graph")), []);
  assert.deepEqual(validateEnvelope(validHierarchyEnvelope()), []);
  assert.deepEqual(validateEnvelope(validHierarchyEnvelope("sunburst")), []);
  assert.deepEqual(validateEnvelope(validHierarchyEnvelope("tree")), []);
});

test("accepts JSON structured refs and rejects CSV or dimensions", () => {
  const envelope = validGraphEnvelope("graph");
  envelope.data = {
    kind: "ref",
    shape: "graph",
    format: "json",
    ref: "artifact://chart-data/network.json",
  };
  assert.deepEqual(validateEnvelope(envelope), []);

  envelope.data.format = "csv";
  envelope.data.dimensions = ["id"];
  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  assert.equal(codes.has("INVALID_REF_FORMAT"), true);
  assert.equal(codes.has("STRUCTURED_DIMENSIONS"), true);
});

test("validates graph ids, endpoints, duplicate facts, and shape-series matching", () => {
  const envelope = validGraphEnvelope();
  envelope.data.source.nodes.push({ id: "target", name: "Duplicate" });
  envelope.data.source.links.push({ source: "missing", target: "source", value: -1 });
  envelope.spec.series[0].data = [];
  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  for (const code of [
    "DUPLICATE_GRAPH_NODE_ID",
    "UNKNOWN_GRAPH_ENDPOINT",
    "INVALID_GRAPH_LINK_VALUE",
    "DUPLICATE_SERIES_DATA",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }

  const mismatch = validGraphEnvelope();
  mismatch.spec.series[0].type = "tree";
  assert.equal(validateEnvelope(mismatch).some((error) => error.code === "SHAPE_SERIES_MISMATCH"), true);

  const multiple = validGraphEnvelope();
  multiple.spec.series.push({ type: "graph" });
  assert.equal(validateEnvelope(multiple).some((error) => error.code === "INVALID_STRUCTURED_SERIES"), true);
});

test("enforces sankey DAG and positive flow while allowing cycles for graph", () => {
  const cyclic = validGraphEnvelope();
  cyclic.data.source.links.push({ source: "target", target: "source", value: 1 });
  assert.equal(validateEnvelope(cyclic).some((error) => error.code === "SANKEY_CYCLE"), true);
  cyclic.spec.series[0].type = "graph";
  assert.deepEqual(validateEnvelope(cyclic), []);

  const zero = validGraphEnvelope();
  zero.data.source.links[0].value = 0;
  assert.equal(validateEnvelope(zero).some((error) => error.code === "SANKEY_POSITIVE_FLOW_REQUIRED"), true);
});

test("enforces hierarchy parent, leaf, root, and depth rules", () => {
  const parentValue = validHierarchyEnvelope();
  parentValue.data.source[0].value = 5;
  assert.equal(validateEnvelope(parentValue).some((error) => error.code === "NON_LEAF_HIERARCHY_VALUE"), true);

  const missingLeaf = validHierarchyEnvelope("sunburst");
  delete missingLeaf.data.source[0].children[0].value;
  assert.equal(validateEnvelope(missingLeaf).some((error) => error.code === "HIERARCHY_LEAF_VALUE_REQUIRED"), true);

  const multiRoot = validHierarchyEnvelope("tree");
  multiRoot.data.source.push({ id: "other", name: "Other" });
  assert.equal(validateEnvelope(multiRoot).some((error) => error.code === "TREE_ROOT_COUNT"), true);

  let node = { id: "leaf", name: "Leaf" };
  for (let depth = 0; depth < 20; depth += 1) {
    node = { id: `parent-${depth}`, name: `Parent ${depth}`, children: [node] };
  }
  const tooDeep = validHierarchyEnvelope("tree");
  tooDeep.data.source = [node];
  assert.equal(validateEnvelope(tooDeep).some((error) => error.code === "HIERARCHY_DEPTH_LIMIT"), true);
});

test("rejects structured datasets for KPI", () => {
  const envelope = validKpiEnvelope();
  envelope.data = validGraphEnvelope("graph").data;
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "UNSUPPORTED_KPI_DATA_SHAPE"), true);
});

test("accepts canonical inline and controlled-ref table envelopes", () => {
  assert.deepEqual(validateEnvelope(validTableEnvelope()), []);

  const ref = validTableEnvelope();
  ref.data = {
    kind: "ref",
    ref: "artifact://analysis/region-performance.json",
    format: "json",
    dimensions: ["region", "sales", "growth", "target", "apr", "may", "jun"],
  };
  assert.deepEqual(validateEnvelope(ref), []);
});

test("validates table fields, formats, derived cells, and initial sort", () => {
  const envelope = validTableEnvelope();
  envelope.spec.columns[1].field = "missing";
  envelope.spec.columns[2].format = { style: "currency", currency: "usd" };
  envelope.spec.columns[3].type = "string";
  envelope.spec.columns[4].cell.fields = ["apr", "unknown"];
  envelope.data.source[0].apr = "31";
  envelope.spec.initialSort = [{ field: "trend", direction: "sideways" }];

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  for (const code of [
    "MISSING_TABLE_FIELD",
    "INVALID_TABLE_CURRENCY",
    "TABLE_CELL_TYPE_MISMATCH",
    "TABLE_TYPE_MISMATCH",
    "INVALID_TABLE_SORT_DIRECTION",
    "UNSORTABLE_TABLE_FIELD",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
});

test("aligns inferred table types and numeric format validation with the renderer", () => {
  const inferredNumber = validTableEnvelope();
  delete inferredNumber.spec.columns[1].type;
  assert.deepEqual(validateEnvelope(inferredNumber), []);

  const inferredStringCell = validTableEnvelope();
  inferredStringCell.spec.columns[0].cell = { kind: "change" };
  assert.equal(validateEnvelope(inferredStringCell).some((error) => error.code === "TABLE_CELL_TYPE_MISMATCH"), true);

  const invalidUnit = validTableEnvelope();
  invalidUnit.spec.columns[1].format = { style: "unit", unit: "foobar-unit" };
  assert.equal(validateEnvelope(invalidUnit).some((error) => error.code === "INVALID_TABLE_FORMAT"), true);
});

test("validates resolved bar and unclamped progress bounds", () => {
  const degenerateBar = validTableEnvelope();
  degenerateBar.data.source = [{ sales: 10 }];
  degenerateBar.spec.columns = [{ field: "sales", type: "number", cell: { kind: "bar", min: 10 } }];
  assert.equal(validateEnvelope(degenerateBar).some((error) => error.code === "INVALID_TABLE_BOUND"), true);

  const unclampedProgress = validTableEnvelope();
  unclampedProgress.data.source = [{ rate: 2 }];
  unclampedProgress.spec.columns = [{ field: "rate", type: "number", cell: { kind: "progress", min: 0, max: 1, clamp: false } }];
  assert.equal(validateEnvelope(unclampedProgress).some((error) => error.code === "TABLE_CELL_VALUE_OUT_OF_RANGE"), true);
});

test("enforces table data budgets and explicit array dimensions", () => {
  const noDimensions = validTableEnvelope();
  noDimensions.data = { kind: "inline", source: [["华东", 1]] };
  assert.equal(validateEnvelope(noDimensions).some((error) => error.code === "TABLE_DIMENSIONS_REQUIRED"), true);

  const cellBudget = validTableEnvelope();
  cellBudget.data.source = Array.from({ length: 4_001 }, (_, row) => Object.fromEntries(
    Array.from({ length: 50 }, (_, column) => [`field_${column}`, row + column]),
  ));
  cellBudget.spec = {};
  assert.equal(validateEnvelope(cellBudget).some((error) => error.code === "TABLE_DATA_LIMIT"), true);

  const inferred = validTableEnvelope();
  inferred.data.source = [Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`field_${index}`, index]))];
  inferred.spec = {};
  assert.equal(validateEnvelope(inferred).some((error) => error.code === "TABLE_INFERRED_COLUMN_LIMIT"), true);
});

test("rejects uncontrolled table refs and non-table shapes", () => {
  const ref = validTableEnvelope();
  ref.data = { kind: "ref", ref: "https://example.com/data.json", format: "xml" };
  const refCodes = new Set(validateEnvelope(ref).map((error) => error.code));
  assert.equal(refCodes.has("INVALID_TABLE_DATA_REF"), true);
  assert.equal(refCodes.has("INVALID_TABLE_DATA_FORMAT"), true);

  const graph = validTableEnvelope();
  graph.data.shape = "graph";
  assert.equal(validateEnvelope(graph).some((error) => error.code === "UNSUPPORTED_TABLE_DATA_SHAPE"), true);
});

test("preserves existing ECharts acceptance of unrelated top-level metadata", () => {
  const envelope = validEnvelope();
  envelope.metadata = { source: "agent" };

  assert.deepEqual(validateEnvelope(envelope), []);
});

test("accepts canonical KPI data with mixed area, line, and no-trend items", () => {
  assert.deepEqual(validateEnvelope(validKpiEnvelope()), []);

  const objectRows = validKpiEnvelope();
  delete objectRows.data.dimensions;
  objectRows.data.source = [
    { day: "2026-08-31", conversion_rate: 0.38, revenue: 16_800_000, inventory: "24/48", status: "低", tone: "warning" },
    { day: "2026-09-01", conversion_rate: 0.4, revenue: 18_000_000, inventory: "23/48", status: "低", tone: "negative" },
  ];
  assert.deepEqual(validateEnvelope(objectRows), []);
});

test("accepts tone-only KPI status bindings", () => {
  const envelope = validKpiEnvelope();
  envelope.spec.items[0].status = { tone: { literal: "warning" } };

  assert.deepEqual(validateEnvelope(envelope), []);
});

test("reduces object-row fields from own properties only", () => {
  const envelope = validKpiEnvelope();
  delete envelope.spec.timeField;
  envelope.data = {
    kind: "inline",
    source: [{ toString: 100 }, { metric: 2 }],
  };
  envelope.spec.items = [{
    id: "prototype_named_metric",
    title: "Prototype named metric",
    value: { field: "toString", format: { style: "decimal" } },
  }];

  assert.deepEqual(validateEnvelope(envelope), []);
});

test("accepts controlled KPI ref data and optional ref format", () => {
  const envelope = validKpiEnvelope();
  envelope.data = {
    kind: "ref",
    ref: "session-file://analysis/kpi-wide.json",
    dimensions: ["day", "conversion_rate", "revenue", "inventory", "status", "tone"],
  };
  assert.deepEqual(validateEnvelope(envelope), []);

  delete envelope.data.dimensions;
  assert.deepEqual(validateEnvelope(envelope), []);
});

test("rejects uncontrolled KPI refs and unsupported ref formats", () => {
  const envelope = validKpiEnvelope();
  envelope.data = {
    kind: "ref",
    ref: "https://example.com/kpi.json",
    format: "xml",
    dimensions: ["day", "conversion_rate", "revenue", "inventory", "status", "tone"],
  };

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  assert.equal(codes.has("INVALID_KPI_DATA_REF"), true);
  assert.equal(codes.has("INVALID_KPI_DATA_FORMAT"), true);
});

test("accepts default and named KPI datasets selected with item.dataset", () => {
  const envelope = validKpiEnvelope();
  envelope.datasets = {
    availability: {
      kind: "inline",
      source: [
        { recorded_at: "2026-08-31", available: 0.91 },
        { recorded_at: "2026-09-01", available: 0.94 },
      ],
    },
  };
  envelope.spec.items.push({
    id: "availability",
    title: "可用率",
    dataset: "availability",
    value: { field: "available", format: { style: "percent" } },
    trend: { type: "line", timeField: "recorded_at" },
  });
  assert.deepEqual(validateEnvelope(envelope), []);

  delete envelope.data;
  envelope.spec.items = envelope.spec.items.filter((item) => item.dataset === "availability");
  assert.deepEqual(validateEnvelope(envelope), []);
});

test("rejects invalid or missing KPI dataset selections", () => {
  const envelope = validKpiEnvelope();
  envelope.datasets = {
    summary: { kind: "inline", source: [{ value: 1 }] },
  };
  envelope.spec.items[0].dataset = "missing";
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "MISSING_KPI_DATASET"), true);

  delete envelope.data;
  delete envelope.spec.items[0].dataset;
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "MISSING_KPI_DEFAULT_DATA"), true);
});

test("rejects empty and malformed named KPI datasets", () => {
  const empty = validKpiEnvelope();
  empty.datasets = {};
  assert.equal(validateEnvelope(empty).some((error) => error.code === "INVALID_KPI_DATASETS"), true);

  const malformed = validKpiEnvelope();
  malformed.datasets = { "bad name": { kind: "inline", source: [{ value: 1 }] } };
  assert.equal(validateEnvelope(malformed).some((error) => error.code === "INVALID_KPI_DATASET_ID"), true);
});

test("enforces KPI row limits across selected datasets", () => {
  const envelope = validKpiEnvelope();
  envelope.data.source = Array.from({ length: 1_000 }, (_, index) => [
    `default-${index}`, 0.4, 18_000_000, "23/48", "低", "negative",
  ]);
  envelope.datasets = {
    secondary: {
      kind: "inline",
      dimensions: ["day", "value"],
      source: Array.from({ length: 1_001 }, (_, index) => [`secondary-${index}`, index]),
    },
  };
  envelope.spec.items.push({
    id: "secondary",
    title: "Secondary",
    dataset: "secondary",
    value: { field: "value" },
  });
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "KPI_DATA_LIMIT"), true);
});

test("does not count an unused default dataset toward KPI limits", () => {
  const envelope = validKpiEnvelope();
  envelope.data.source = Array.from({ length: 2_000 }, (_, index) => [
    `default-${index}`, 0.4, 18_000_000, "23/48", "低", "negative",
  ]);
  envelope.datasets = {
    selected: {
      kind: "inline",
      source: [{ value: 1 }],
    },
  };
  envelope.spec.items = [{
    id: "selected",
    title: "Selected",
    dataset: "selected",
    value: { field: "value" },
  }];

  assert.deepEqual(validateEnvelope(envelope), []);
});

test("rejects the removed literal KPI schema, missing data, and item affixes", () => {
  const envelope = validKpiEnvelope();
  delete envelope.data;
  envelope.spec.items[0].value = "40%";
  envelope.spec.items[0].prefix = "¥";

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  assert.equal(codes.has("MISSING_KPI_DATA"), true);
  assert.equal(codes.has("INVALID_KPI_VALUE"), true);
  assert.equal(codes.has("UNKNOWN_KEY"), true);
});

test("rejects unknown fields, invalid ids, missing bound fields, and invalid status bindings", () => {
  const envelope = validKpiEnvelope();
  envelope.extra = true;
  envelope.spec.extra = true;
  envelope.spec.items[0].id = "bad id";
  envelope.spec.items[0].value.field = "missing_metric";
  envelope.spec.items[0].status.text = { field: "status", literal: "duplicate" };
  envelope.spec.items[0].status.tone = { literal: "critical" };

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  for (const code of ["UNKNOWN_KEY", "INVALID_KPI_ID", "MISSING_KPI_FIELD", "INVALID_KPI_BINDING", "INVALID_KPI_TONE"]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
});

test("rejects duplicate KPI item ids", () => {
  const envelope = validKpiEnvelope();
  envelope.spec.items.push({
    id: envelope.spec.items[0].id,
    title: "Duplicate conversion rate",
    value: { field: "conversion_rate", format: { style: "percent" } },
  });

  assert.equal(validateEnvelope(envelope).some((error) => error.code === "DUPLICATE_KPI_ID"), true);
});

test("validates structured number formats and reduced value types", () => {
  const envelope = validKpiEnvelope();
  envelope.spec.items[0].value.format = {
    style: "currency",
    currency: "rmb",
    unit: "meter",
    minimumFractionDigits: 3,
    maximumFractionDigits: 1,
  };
  envelope.spec.items[2].value.format = { style: "decimal" };

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  for (const code of [
    "INVALID_KPI_CURRENCY",
    "INVALID_KPI_FORMAT_OPTION",
    "INVALID_KPI_FRACTION_DIGITS",
    "NON_NUMERIC_KPI_VALUE",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
});

test("rejects non-ISO currencies and does not cascade numeric errors from an invalid format", () => {
  const currency = validKpiEnvelope();
  currency.spec.items[0].value.format = { style: "currency", currency: "RMB" };
  assert.equal(validateEnvelope(currency).some((error) => error.code === "INVALID_KPI_CURRENCY"), true);

  const invalidFormat = validKpiEnvelope();
  invalidFormat.spec.items[2].value.format = "percent";
  const codes = validateEnvelope(invalidFormat).map((error) => error.code);
  assert.equal(codes.includes("INVALID_KPI_FORMAT"), true);
  assert.equal(codes.includes("NON_NUMERIC_KPI_VALUE"), false);
});

test("loads without Intl.supportedValuesOf and keeps shape-only currency validation", () => {
  const validatorUrl = `${pathToFileURL(VALIDATOR_PATH).href}?without-supported-values`;
  const probe = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      [
        'Object.defineProperty(Intl, "supportedValuesOf", { value: undefined, configurable: true });',
        `const { validateEnvelope } = await import(${JSON.stringify(validatorUrl)});`,
        "const errors = validateEnvelope({",
        '  version: 1, renderer: "kpi",',
        '  data: { kind: "inline", source: [{ revenue: 100 }] },',
        '  spec: { items: [{ id: "revenue", title: "Revenue",',
        '    value: { field: "revenue", format: { style: "currency", currency: "RMB" } } }] },',
        "});",
        "process.stdout.write(JSON.stringify(errors));",
      ].join("\n"),
    ],
    { encoding: "utf8" },
  );

  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), []);
});

test("rejects Unicode display line and control separators", () => {
  const envelope = validKpiEnvelope();
  envelope.spec.items[0].title = "Revenue\u2028today";

  assert.equal(validateEnvelope(envelope).some((error) => error.code === "INVALID_DISPLAY_STRING"), true);
});

test("validates field-bound KPI status text and tone values", () => {
  const envelope = validKpiEnvelope();
  envelope.data.source[2][4] = "bad\u2028status";
  envelope.data.source[2][5] = "danger";

  const codes = new Set(validateEnvelope(envelope).map((error) => error.code));
  assert.equal(codes.has("INVALID_DISPLAY_STRING"), true);
  assert.equal(codes.has("INVALID_KPI_TONE"), true);
});

test("accepts a single trend point but rejects nonnumeric trends and invalid compare settings", () => {
  const single = validKpiEnvelope();
  single.data.source = [single.data.source[0]];
  assert.deepEqual(validateEnvelope(single), []);

  const invalid = validKpiEnvelope();
  invalid.data.source[1][1] = "not-a-number";
  invalid.spec.items[0].trend.compare = { lag: 0, mode: "ratio", polarity: "unknown" };
  invalid.spec.items[0].trend.yScale = { includeZero: "yes" };
  const codes = new Set(validateEnvelope(invalid).map((error) => error.code));
  for (const code of [
    "NON_NUMERIC_KPI_TREND",
    "INVALID_KPI_COMPARE_LAG",
    "INVALID_KPI_COMPARE_MODE",
    "INVALID_KPI_POLARITY",
    "INVALID_KPI_Y_SCALE",
  ]) {
    assert.equal(codes.has(code), true, `expected ${code}`);
  }
});

test("distinguishes missing and invalid KPI trend time fields", () => {
  const missing = validKpiEnvelope();
  delete missing.spec.timeField;
  assert.equal(validateEnvelope(missing).some((error) => error.code === "MISSING_KPI_TIME_FIELD"), true);

  const invalid = validKpiEnvelope();
  invalid.spec.items[0].trend.timeField = "123";
  const codes = validateEnvelope(invalid).map((error) => error.code);
  assert.equal(codes.includes("INVALID_KPI_FIELD"), true);
  assert.equal(codes.includes("MISSING_KPI_TIME_FIELD"), false);

  const invalidCommon = validKpiEnvelope();
  invalidCommon.spec.timeField = "123";
  const commonCodes = validateEnvelope(invalidCommon).map((error) => error.code);
  assert.equal(commonCodes.includes("INVALID_KPI_FIELD"), true);
  assert.equal(commonCodes.includes("MISSING_KPI_TIME_FIELD"), false);
});

test("enforces KPI item and trend limits", () => {
  const envelope = validKpiEnvelope();
  envelope.spec.items = Array.from({ length: 13 }, (_, index) => ({
    id: `metric_${index}`,
    title: `Metric ${index}`,
    value: { field: "revenue" },
  }));
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "INVALID_KPI_ITEMS"), true);

  const tooManyPoints = validKpiEnvelope();
  tooManyPoints.data.source = Array.from({ length: 501 }, (_, index) => [
    `day-${index}`, 0.4, 18_000_000, "23/48", "低", "negative",
  ]);
  assert.equal(validateEnvelope(tooManyPoints).some((error) => error.code === "KPI_TREND_LIMIT"), true);
});

test("accepts only version-pinned finalized Wiki references for KPI items", () => {
  const envelope = validKpiEnvelope();
  const validReference = envelope.spec.items[0].references[0];
  envelope.spec.items[0].references = [
    validReference,
    { ...validReference, ref: validReference.ref.replace("#calculation-logic", "#source-fields") },
  ];
  assert.deepEqual(validateEnvelope(envelope), []);

  envelope.spec.items[0].references.push({ ...validReference });
  assert.equal(validateEnvelope(envelope).some((error) => error.code === "DUPLICATE_KPI_REFERENCE"), true);

  envelope.spec.items[0].references = [
    { ref: "https://example.com/wiki", label: "External" },
    { ref: "kb-wiki://wiki/kb_bad/versions/latest/files/metric.md", label: "Forged" },
    { ref: validReference.ref, label: " trailing " },
  ];
  const errors = validateEnvelope(envelope);
  assert.equal(errors.filter((error) => error.code === "INVALID_KPI_REFERENCE_REF").length, 2);
  assert.equal(errors.some((error) => error.path.endsWith("[2].label")), true);

  const shortKnowledgeBaseId = validKpiEnvelope();
  shortKnowledgeBaseId.spec.items[0].references[0].ref = WIKI_REF.replace(
    "kb_01M06TNAJERSPD2MXQSW937DCJ",
    "kb_abc12345",
  );
  assert.deepEqual(validateEnvelope(shortKnowledgeBaseId), []);
});

test("keeps renderer dispatch behavior", () => {
  const envelope = validEnvelope();
  envelope.renderer = "unknown";
  assert.deepEqual(validateEnvelope(envelope).map((error) => error.code), ["INVALID_RENDERER"]);

  const malformedUnknown = validEnvelope();
  malformedUnknown.renderer = "unknown";
  malformedUnknown.data = "invalid";
  assert.deepEqual(
    validateEnvelope(malformedUnknown).map((error) => error.code),
    ["INVALID_RENDERER", "INVALID_DATA"],
  );

  const missingData = validEnvelope();
  delete missingData.data;
  assert.deepEqual(validateEnvelope(missingData).map((error) => error.code), ["INVALID_DATA"]);
});

test("CLI validates multiple files and returns indexed JSONPath errors", async () => {
  const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "markdown-chart-validator-"));
  try {
    const validPath = path.join(tempDirectory, "valid.json");
    const invalidPath = path.join(tempDirectory, "invalid.json");
    const invalidEnvelope = validEnvelope();
    invalidEnvelope.spec.tooltip.formatter = "{c}";
    await fs.writeFile(validPath, JSON.stringify(validKpiEnvelope()), "utf8");
    await fs.writeFile(invalidPath, JSON.stringify(invalidEnvelope), "utf8");

    const result = spawnSync(process.execPath, [VALIDATOR_PATH, validPath, invalidPath], { encoding: "utf8" });
    assert.equal(result.status, 1);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schema_version, "markdown-chart-validator/v1");
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.errors[0], {
      input: 2,
      code: "FORBIDDEN_FORMATTER",
      path: "$.spec.tooltip.formatter",
      message: "Declarative markdown-chart specs cannot contain a formatter key.",
    });
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
});
