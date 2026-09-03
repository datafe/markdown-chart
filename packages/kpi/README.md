# `@datafe-open/markdown-chart-kpi`

Strict, framework-neutral KPI card renderer for
[`@datafe-open/markdown-chart`](../core/README.md).

```ts
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createKpiRenderer } from '@datafe-open/markdown-chart-kpi';

const registry = new ChartRendererRegistry().register(createKpiRenderer());
```

The canonical fence keeps default or named datasets separate from
renderer-owned field, format, trend, status, and reference configuration:

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "data": {
    "kind": "inline",
    "source": [
      { "day": "2026-08-31", "revenue": 16800000, "tone": "warning" },
      { "day": "2026-09-01", "revenue": 18000000, "tone": "positive" }
    ]
  },
  "spec": {
    "timeField": "day",
    "items": [
      {
        "id": "revenue",
        "title": "Revenue",
        "value": {
          "field": "revenue",
          "reduce": "lastNonNull",
          "format": {
            "style": "currency",
            "currency": "CNY",
            "notation": "compact",
            "maximumFractionDigits": 1
          }
        },
        "status": {
          "text": { "literal": "Above target" },
          "tone": { "field": "tone" }
        },
        "trend": {
          "type": "area",
          "compare": {
            "lag": 1,
            "mode": "relative",
            "label": "vs previous day",
            "polarity": "higher-is-better"
          }
        },
        "references": [
          { "ref": "docs://metrics/revenue", "label": "Revenue definition" }
        ]
      }
    ]
  }
}
```
````

`value.field` reads from canonical data and defaults to `lastNonNull` reduction.
Formatting uses a validated subset of `Intl.NumberFormat`: `text`, `decimal`,
`percent`, `currency`, or `unit`, plus notation, fraction digits, prefix,
suffix, and null display. Functions and arbitrary expressions are rejected.

Items use the default top-level `data` unless they set `dataset` to a key in
the top-level `datasets` map. Prefer shared default data for matching grain,
filters, and source; use named datasets when those differ. Each selected
inline/ref dataset is materialized once and total row/cell limits apply across
the selected collection. The default `data` remains the source of the built-in
Data table; a named-only group renders without that single-dataset toggle.

```json
{
  "data": { "kind": "inline", "source": [{ "revenue": 18000000 }] },
  "datasets": {
    "inventory": { "kind": "inline", "source": [{ "stock": 23 }] }
  },
  "spec": {
    "items": [
      { "id": "revenue", "title": "Revenue", "value": { "field": "revenue" } },
      { "id": "inventory", "title": "Inventory", "dataset": "inventory", "value": { "field": "stock" } }
    ]
  }
}
```

An item may omit `trend`, or use a `line`/`area` sparkline with an exact source
row lag, absolute/relative comparison, polarity, and optional zero-inclusive Y
scale. Fewer than two valid numeric points hides the trend without failing the
KPI. Source order is authoritative; null lag rows are not skipped.

Referenced canonical data remains host-owned. Pass a resolver to this renderer
directly or through the React/Vue adapter's `kpi` option:

```ts
const renderer = createKpiRenderer({
  validateDataRef: (ref) => ref.startsWith('dataset://'),
  resolveDataRef: (ref, { signal }) => loadDataset(ref, signal),
  referenceIcon: ({ document }) => createHostReferenceIcon(document),
});
```

The resolved dataset is used once for values, trends, comparisons, and the
shared Data table. The renderer never fetches or interprets refs itself.

References are separate opaque item configuration and only become controls
when the host supplies `referenceActions`:

```ts
const referenceActions = {
  canOpen: ({ reference }: { reference: { ref: string } }) =>
    reference.ref.startsWith('docs://'),
  open: ({ reference }: { reference: { ref: string } }) => {
    openDocumentation(reference.ref);
  },
};
```

`referenceIcon` is a trusted host-only presentation hook. It receives the
opaque reference event plus the control's owner `document` and returns a newly
created decorative HTML/SVG element. If the hook is absent, returns nothing, or
throws, the renderer uses its default link glyph. The renderer does not assign
domain meaning to either icon.

Hosts can align the renderer with their theme through the
`--markdown-chart-kpi-*` CSS custom properties. Unset properties have light and
dark fallbacks selected from the chart mount theme.
