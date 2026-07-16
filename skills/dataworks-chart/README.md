# DataWorks Chart Skill

`dataworks-chart` teaches an agent to emit dataset-backed canonical
`markdown-chart` fenced code blocks that explicitly select the ECharts renderer.

Installing this skill is the signal that the host can render those blocks. The
agent should not be expected to detect whether the renderer is available.

## Host Requirements

Use this skill with a client that implements the Markdown Chart v1 protocol and
registers the `echarts` renderer. The packages in this repository provide that
support for React + react-markdown and Vue 3 + markdown-it.

The host should:

- Register a Markdown code block renderer for the language tag `markdown-chart`.
- Parse the block body as a strict JSON envelope.
- Require `version: 1` and dispatch `renderer: "echarts"` to the ECharts renderer.
- Read renderer-neutral tabular data from `data.dimensions` and `data.source`.
- Inject the resolved dataset into the ECharts option stored in `spec` without
  evaluating JavaScript.
- Resolve `data.kind="ref"` only through a host-controlled resolver when real
  controlled refs are available; ref envelopes include `ref`, `format`, and
  `dimensions`, and the resolver should receive those as metadata.
- Support switching between chart and data views from the same canonical dataset
  when the client wants a table view.
- Hide incomplete streaming chart blocks until valid JSON is available.

## Output Shape

The skill emits one block like this:

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["day", "orders"],
    "source": [
      ["Mon", 120],
      ["Tue", 200]
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
````

The block body must be valid JSON, not JavaScript. `renderer` is always
`"echarts"`; inline rows are arrays in the same order as `data.dimensions`; and
the ECharts option belongs in `spec`, without `spec.dataset`.

For large data, the skill may emit `data.kind="ref"` only when the host has
provided a real controlled ref, for example:

```json
{
  "kind": "ref",
  "ref": "artifact://chart-data/sales-q1.csv",
  "format": "csv",
  "dimensions": ["day", "orders"]
}
```

See the repository's [protocol specification](../../SPEC.md) for the complete
canonical envelope and data rules.
