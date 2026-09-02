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

Renderer packages MAY explicitly define shorthand fence aliases. A renderer
identifier alone is not a fence language. A shorthand fence sends the entire
JSON body to that renderer. A renderer-owned shorthand MAY define a versioned
envelope and MAY normalize its data into renderer-neutral `ChartData` for the
shared Data view. That shorthand version belongs to the renderer schema and
does not change the canonical protocol version. Aliases are resolved by the
registry; the core has no hard-coded ECharts, Plotly, or Vega branches.

Markdown adapters MUST route shorthand fences through the live registry rather
than maintain renderer-specific language defaults. The canonical
`markdown-chart` fence is recognized independently of which renderers are
currently registered.

## Data

Canonical data is either inline or referenced. Inline data is directly
available to hosts for actions such as “View data”. The default framework
adapters expose a Chart/Data switch for inline data and for referenced data
after a renderer materializes the reference as inline rows:

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
  interpret the reference or perform network requests. A renderer MAY return
  resolved inline rows from its materialization step. The adapter then creates
  the shared Chart/Data view before mounting the chart.

Rows MUST be arrays of JSON scalar values or objects whose values are JSON
scalars. `dimensions`, when present, MUST contain non-empty strings.

Core exports renderer-neutral `ResolvedChartData`, `ResolveChartDataRef`, and
`materializeChartData`. The helper validates resolver output and explicit row
and cell limits, maps resolver failures to stable chart errors, and returns
inline rows. It never interprets a ref, selects a transport, or performs a
request. Renderer packages may retain renderer-specific aliases for backwards
compatibility while sharing this boundary.

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

## KPI specification

The independent KPI renderer uses `renderer: "kpi"` and requires canonical
`data`. Data and configuration are separate: wide rows contain values, while
`spec` contains only field bindings, safe formatting, trends, status, and
references. `spec.items` contains 1–12 entries:

```json
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [
      { "day": "2026-08-31", "conversion": 0.38, "tone": "warning" },
      { "day": "2026-09-01", "conversion": 0.4, "tone": "negative" }
    ]
  },
  "spec": {
    "timeField": "day",
    "items": [{
      "id": "conversion_rate",
      "title": "Conversion rate",
      "value": {
        "field": "conversion",
        "reduce": "lastNonNull",
        "format": { "style": "percent", "maximumFractionDigits": 0 }
      },
      "status": {
        "text": { "literal": "Below target" },
        "tone": { "field": "tone" }
      },
      "trend": {
        "type": "area",
        "compare": {
          "lag": 1,
          "mode": "absolute",
          "polarity": "higher-is-better"
        },
        "yScale": { "includeZero": true }
      },
      "references": [{
        "ref": "docs://metrics/conversion-rate",
        "label": "Metric definition"
      }]
    }]
  }
}
```

`value.field` is required; `reduce` defaults to and currently only supports
`lastNonNull`. `format.style` is `text`, `decimal`, `percent`, `currency`, or
`unit`. Formatting is a validated `Intl.NumberFormat` subset: currency, unit,
notation, fraction digits, prefix, suffix, and null display. Functions,
expressions, locale injection, and JavaScript formatters are not supported.

Status text and tone each use exactly one `{ "field": ... }` or
`{ "literal": ... }` binding. A group MAY mix items with and without `trend`.
A trend uses `spec.timeField` unless it overrides `timeField`, and uses the KPI
value field unless it overrides `field`. It supports `line`/`area`, optional
absolute/relative lag comparison with polarity, and optional zero-inclusive Y
scale. Source row order is authoritative and is never sorted. `lag` addresses
an exact source-row offset and does not skip null rows. A trend with fewer than
two valid numeric points is omitted without failing the KPI. A non-null,
non-numeric trend value is invalid. Trend and dataset sizes are bounded.

Each item MAY contain 1–3 references, with no duplicate `ref` in one item.
`ref` is opaque to the renderer; `label` is the accessible description.
Unknown fields are rejected. Array rows require unique `dimensions` matching
their width. Referenced data is resolved once through the host callback and the
same materialized rows serve values, trends, comparisons, and the shared Data
view.

## Renderer reference actions

A renderer MAY expose reference controls only through host-supplied generic
actions. The core forwards `{ rendererId, reference: { ref, label } }` without
interpreting the reference. `canOpen`, when supplied, determines whether a
control is available; `open` handles an accepted click. Renderers MUST NOT
navigate, fetch reference content, infer authorization, or expose raw refs as
user-facing labels. The host owns scheme validation, authorization, and the
resulting UI.

A renderer MAY also offer a renderer-specific, trusted host presentation hook
for the decorative reference glyph. Such a hook MUST NOT change the opaque
reference payload, authorization checks, accessible label, or activation
behavior. The KPI renderer's `referenceIcon` factory falls back to its default
link glyph when no valid host icon is supplied.

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

The outer `markdown-chart.version` belongs only to the canonical envelope.
Renderer specifications inside canonical `spec` do not introduce a second
protocol version. A renderer-owned shorthand MAY independently version its own
envelope; that version is interpreted only under the exact shorthand fence.
New incompatible canonical envelopes or data schemas require a new numeric
canonical `version`; incompatible renderer schemas should use a new renderer
identifier or shorthand version. New renderer implementations are published as
independent packages and registered at runtime.
