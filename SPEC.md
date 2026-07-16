# Markdown Chart Protocol v1

## Goals

The protocol identifies a renderer and keeps renderer-neutral data separate
from the renderer-owned JSON chart specification. It does not prescribe a UI
framework, data transport, or chart engine.

## Canonical fence

The canonical language is `markdown-chart`. Its body is a strict JSON object:

```json
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["category", "value"],
    "source": [["A", 1], ["B", 2]]
  },
  "spec": {}
}
```

- `version` MUST be `1`.
- `renderer` MUST be a non-empty renderer identifier registered by the host.
- `data` is optional. When present, it MUST use the renderer-neutral dataset
  schema below so hosts can inspect it without understanding `spec`.
- `spec` MUST be JSON. Its schema belongs to the selected renderer.
- Unknown renderer identifiers MUST fail without falling back to executable
  content.

Renderer packages MAY define shorthand fence aliases. A shorthand fence sends
the entire JSON body to that renderer and does not create renderer-neutral
canonical data. Aliases are resolved by the registry; the core has no
hard-coded ECharts, Plotly, or Vega branches.

Markdown adapters MUST route shorthand fences through the live registry rather
than maintain renderer-specific language defaults. The canonical
`markdown-chart` fence is recognized independently of which renderers are
currently registered.

## Data

Canonical data is either inline or referenced. Inline data is directly
available to hosts for actions such as “View data”. The default framework
adapters expose a Chart/Data switch for inline data:

```json
{
  "kind": "inline",
  "dimensions": ["category", "value"],
  "source": [["A", 1], ["B", 2]]
}
```

`data.kind` is either:

- `inline`: contains `source` and optional `dimensions`.
- `ref`: contains an opaque `ref`, optional `format`, and optional
  `dimensions`. A host-provided resolver returns the source. Renderers do not
  interpret the reference or perform network requests.

Rows MUST be arrays of JSON scalar values or objects whose values are JSON
scalars. `dimensions`, when present, MUST contain non-empty strings.

## ECharts specification

For the canonical fence, `spec` is the ECharts option object directly:

```json
{
  "xAxis": { "type": "category" },
  "yAxis": {},
  "series": [{ "type": "bar", "encode": { "x": "category", "y": "value" } }]
}
```

When canonical `data` is present, `spec.dataset` is reserved and MUST NOT also
be set. The renderer inserts the resolved dataset before calling ECharts.

For the `echarts` and `echarts-fulldata` shorthand fences, the body MAY remain
a direct ECharts option or the renderer-specific `{ "data": ..., "option": ...
}` envelope. Renderer-specific shorthand data is not exposed as canonical data
to host data viewers.

## Streaming

Hosts pass the outer document streaming state to a Markdown adapter. The adapter
MUST translate it into block-level state: explicitly closed chart fences render
immediately, while only an unterminated fence at the active tail is deferred.
An implicitly closed fence followed by later document content is complete.

Adapters SHOULD preserve the DOM element and mounted renderer for unchanged,
completed blocks as later tokens arrive. An incomplete block is not parsed or
mounted. Once its fence closes, the same block is rendered normally. Invalid
JSON in an explicitly completed block is an error even while the surrounding
document is still streaming.

## Evolution

`version` belongs only to the canonical `markdown-chart` envelope. Renderer
specifications do not introduce a second version field. New incompatible
canonical envelopes or data schemas require a new numeric `version`;
incompatible renderer schemas should use a new renderer identifier. New
renderer implementations are published as independent packages and registered
at runtime.
