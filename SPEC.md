# Markdown Chart Protocol v1

## Goals

The protocol identifies a renderer and carries a JSON chart specification. It
does not prescribe a UI framework, data transport, or chart engine.

## Canonical fence

The canonical language is `chart`. Its body is a strict JSON object:

```json
{
  "version": 1,
  "renderer": "echarts",
  "spec": {}
}
```

- `version` MUST be `1`.
- `renderer` MUST be a non-empty renderer identifier registered by the host.
- `spec` MUST be JSON. Its schema belongs to the selected renderer.
- Unknown renderer identifiers MUST fail without falling back to executable
  content.

Renderer packages MAY define shorthand fence aliases. A shorthand fence sends
the entire JSON body to that renderer. Aliases are resolved by the registry;
the core has no hard-coded ECharts, Plotly, or Vega branches.

Markdown adapters MUST route shorthand fences through the live registry rather
than maintain renderer-specific language defaults. The canonical `chart` fence
is recognized independently of which renderers are currently registered.

## ECharts v1 specification

An ECharts spec is either an ECharts option object or this envelope:

```json
{
  "version": 1,
  "data": {
    "kind": "inline",
    "dimensions": ["category", "value"],
    "source": [["A", 1], ["B", 2]]
  },
  "option": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar" }]
  }
}
```

`data.kind` is either:

- `inline`: contains `source` and optional `dimensions`.
- `ref`: contains an opaque `ref`, optional `format`, and optional
  `dimensions`. The host-provided resolver returns the source. The renderer
  does not interpret the reference or perform network requests.

When `data` is present, `option.dataset` is reserved and MUST NOT also be set.
The renderer inserts the resolved dataset before calling ECharts.

## Streaming

Hosts pass streaming state to the lifecycle controller. A streaming block is
not parsed or mounted. Once complete, the same block can be rendered normally.

## Evolution

New incompatible canonical or renderer envelopes require a new numeric
`version`. New renderer implementations are published as independent packages
and registered at runtime.
