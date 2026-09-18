# Markdown Chart Skill

`markdown-chart` teaches an agent to emit canonical `markdown-chart` fenced
blocks for interactive tables, KPI cards, and ECharts visualizations. The Skill
contains the generation contract, renderer-specific references, examples, and a
deterministic validator.

The maintained distribution source is the `agentworks-assets` repository. This
copy stays in the public renderer repository so protocol authors and host
integrators can inspect and test the exact agent output contract beside the
implementation.

## Host requirements

Use this Skill with a client that implements the Markdown Chart v1 protocol and
registers the renderers the agent may select:

- `table` for sortable, filterable, searchable, exportable data tables with
  change, bar, progress, and sparkline cells;
- `kpi` for current metrics, comparisons, and compact trends;
- `echarts` for charts, graphs, flows, and hierarchies.

The host parses strict JSON, dispatches by `renderer`, applies resource limits,
and renders only complete streaming fences. It also owns data access. A
`data.kind: "ref"` envelope is opaque to the library and must be resolved by a
host-controlled resolver; the agent may use only a real reference already
provided by the host.

## Agent output

The Skill emits one block per visual:

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "table",
  "data": {
    "kind": "ref",
    "ref": "artifact://reports/regional-sales.json",
    "format": "json"
  },
  "spec": {
    "title": "Regional sales",
    "columns": [
      { "field": "region", "title": "Region", "pinned": "left" },
      { "field": "sales", "title": "Sales", "type": "number", "sortable": true, "filter": true }
    ]
  }
}
```
````

The body must be valid JSON rather than JavaScript. See [SKILL.md](./SKILL.md)
for renderer selection and response rules, and
[references/table.md](./references/table.md) for the interactive table contract.
The repository [protocol specification](../../SPEC.md) defines the shared
envelope and host boundary. Search and CSV export are built-in table controls;
they do not require additional `spec` fields.

## Validation

Validate one or more envelope files with:

```sh
node skills/markdown-chart/scripts/validate_chart.mjs chart.json
```

Run the Skill regression suite from the repository root:

```sh
node --test tests/skills/markdown-chart/*.test.mjs
```

The package includes `SKILL.md`, `references/`, and the validator. Repository
tests and evaluation fixtures are excluded from the distributed Skill package.
