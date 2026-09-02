# `@datafe-open/markdown-chart-kpi`

Strict, framework-neutral KPI card renderer for
[`@datafe-open/markdown-chart`](../core/README.md).

```ts
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createKpiRenderer } from '@datafe-open/markdown-chart-kpi';

const registry = new ChartRendererRegistry().register(createKpiRenderer());
```

The canonical fence keeps a wide dataset separate from renderer-owned field,
format, trend, status, and reference configuration:

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

Hosts can align the renderer with their theme through the
`--markdown-chart-kpi-*` CSS custom properties. Unset properties have light and
dark fallbacks selected from the chart mount theme.
