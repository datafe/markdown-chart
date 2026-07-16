---
name: markdown-chart
description: >
  Automatically generate renderable, dataset-backed charts with canonical
  `markdown-chart` fenced code blocks and the ECharts renderer. Use for
  statistical summaries, trends, time-series changes, comparisons, rankings,
  distributions, composition/share, correlations, anomalies, and multi-metric
  KPI analysis when a chart would make the answer easier to understand; also use
  when the user explicitly asks for a chart, visualization, or ECharts output.
  Assume that enabling this skill means the host can render `markdown-chart`;
  do not try to detect renderer support. Do not use when the user asks for
  text/table only.
---

# Markdown Chart Skill

Use this skill to emit dataset-backed **`markdown-chart` chart blocks** that
select the ECharts renderer. This skill defines only the model output contract;
it does not load or execute the chart runtime.

Assume that installing or enabling this skill means the host environment is
prepared to render `markdown-chart` blocks. Do not ask whether renderer support
is available and do not condition chart output on client detection.

## Use Criteria

Use this skill when either condition is true:

- The response contains structured quantitative data where a chart would improve
  understanding.
- The user explicitly asks for visual output, a chart, visualization, or ECharts.

If the user asks for plain text/table output, or if the answer is not
chart-worthy, use normal Markdown, tables, or prose instead.

## Chart Automatically For

Emit a chart by default when the answer includes enough data for any of these
patterns:

- Trend or time-series change: line chart with time on the x-axis.
- Category comparison, period-over-period comparison, or ranking: bar chart,
  sorted by the main metric when order matters.
- Distribution: histogram-style bar chart with explicit bins, or a box plot
  only when the data already supports quartiles.
- Composition, share, or percentage contribution: pie chart for a few categories,
  or stacked/regular bar chart when there are many categories.
- Correlation between paired numeric measures: scatter plot.
- Multi-metric KPI analysis: grouped bars or multiple lines; use dual y-axes
  only when units or scales differ, and label both axes clearly.
- Anomaly or metric movement explanation: chart the movement and emphasize the
  affected point or period with ECharts annotations when useful.

Do not chart automatically when the response is purely qualitative or procedural,
has only one or two scalar values without a meaningful comparison, has ambiguous
or insufficient data, would require guessing values, has too many categories or
series without aggregation, or the user asks for plain text/table output.

## Output Contract

Emit one fenced code block whose language tag is exactly `markdown-chart`.

The block body must be **one valid JSON object** that can be parsed directly with
`JSON.parse`. That object is the canonical Markdown Chart envelope, not the
Apache ECharts option itself. Always use this top-level shape:

- Set `"version": 1`.
- Set `"renderer": "echarts"`. Never omit `renderer` or use a different value.
- Set `"data.kind": "inline"` for normal generated output.
- Put stable ASCII column keys in `"data.dimensions"` as a string array.
- Put complete small tabular data in `"data.source"` as array-of-arrays, with
  each row in the exact same order and length as `"data.dimensions"`.
- Put the native ECharts option in `"spec"`, excluding `spec.dataset`; the
  renderer injects the canonical dataset before rendering the chart or data
  table.
- Use `series.encode` to map dimensions to axes, values, labels, tooltips, or
  other visual channels.
- Use only one dataset. Do not output multiple datasets, transforms, or dataset
  refs unless the host has provided a real supported ref.
- Do not set duplicate category data in `xAxis.data` or values in `series.data`
  when the injected dataset plus `series.encode` already defines them.

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["day", "orders"],
    "source": [
      ["Mon", 120],
      ["Tue", 200],
      ["Wed", 150],
      ["Thu", 80],
      ["Fri", 240]
    ]
  },
  "spec": {
    "title": { "text": "Weekly orders" },
    "tooltip": { "trigger": "axis" },
    "xAxis": { "type": "category" },
    "yAxis": { "type": "value" },
    "series": [{ "type": "bar", "encode": { "x": "day", "y": "orders" } }]
  }
}
```

Inline data is for small chart-ready tables only. For medium data, aggregate,
rank, bucket, or sample first and explain the treatment outside the block. For
large data, use `"data.kind": "ref"` only when the host has already provided a
real usable controlled reference such as `artifact://...` or
`session-file://...`; include the provided `ref`, `"format": "csv"` or
`"format": "json"`, and `dimensions`. Never invent or pretend an artifact ref
exists.

Reference data envelope example, only when a real host-provided ref exists:

```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "ref",
    "ref": "artifact://chart-data/sales-q1.csv",
    "format": "csv",
    "dimensions": ["day", "orders"]
  },
  "spec": {
    "title": { "text": "Weekly orders" },
    "xAxis": { "type": "category" },
    "yAxis": { "type": "value" },
    "series": [{ "type": "bar", "encode": { "x": "day", "y": "orders" } }]
  }
}
```

## Safety Rules

- Output JSON data only, not JavaScript.
- Do not output `const option = ...`, expressions, comments, trailing commas,
  functions, or callbacks.
- Do not ask the host to use `eval`, `new Function`, or script injection.
- Do not reference local files, URLs, the DOM, globals, network requests,
  randomness, timers, `document`, `window`, or the filesystem. For ref data,
  only use a real controlled ref, format, and dimensions that the host
  explicitly made available.
- Put all inline chart data inside `data.source`. Avoid duplicating the same
  data in `xAxis.data` or `series.data` when the injected dataset plus `encode`
  can express it.
- Do not set `spec.dataset`; canonical `data` is the only dataset source.
- Do not emit large `data.source` payloads, and strictly do not use large
  object-row datasets. Inline rows must be arrays, not objects.
- For visible value labels, use `"label": { "show": true }`; do not emit
  `label.formatter`, because formatter fields are rejected by the renderer's
  safety policy. Put units in axis names, chart titles, or the surrounding
  explanation instead.
- If the data is too large, aggregate or sample it first, and explain that
  treatment outside the block.

## Response Format

When a chart is appropriate, including automatic chart-worthy analysis scenarios,
respond in this order:

1. One short takeaway describing the main point shown by the chart.
2. One `markdown-chart` fenced code block containing the complete JSON envelope
   with `"renderer": "echarts"` and either inline array rows or a real
   host-provided controlled ref.
3. Optional notes such as metric definitions, aggregation choices, or reading
   guidance.

Do not nest the chart block inside any other Markdown container. Because the
renderer can switch between chart and data views from the canonical dataset, do
not add a separate Markdown table unless the user asks for one or a tiny table is
essential to the explanation.

## Chart Guidance

- Trends: Prefer a line chart with time on the x-axis and the metric on the
  y-axis.
- Rankings: Prefer a bar chart sorted by the metric in descending order.
- Composition: Use a pie chart for a small number of categories; use a bar chart
  when there are many categories.
- Multi-metric comparisons: Prefer grouped bars or multiple lines, and avoid
  overcrowding the chart with too many series.
- Annotations: Use `markPoint`, `markLine`, or `markArea` for notable peaks,
  thresholds, targets, or changed periods when they help explain the insight.
- Keep titles, axes, units, and legends clear.

## When Unsure

If there is not enough data to draw a chart, explain the reason in normal
Markdown first. Do not guess by emitting a `markdown-chart` block.
