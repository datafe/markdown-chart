# `@datafe-open/markdown-chart-kpi`

Strict, framework-neutral KPI card renderer for
[`@datafe-open/markdown-chart`](../core/README.md).

```ts
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createKpiRenderer } from '@datafe-open/markdown-chart-kpi';

const registry = new ChartRendererRegistry().register(createKpiRenderer());
```

The canonical fence uses renderer-owned presentation strings and intentionally
omits canonical `data`:

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "kpi",
  "spec": {
    "items": [
      {
        "id": "revenue",
        "title": "Revenue",
        "prefix": "$",
        "value": "1,800",
        "suffix": "K",
        "status": { "text": "Above target", "tone": "positive" },
        "references": [
          { "ref": "docs://metrics/revenue", "label": "Revenue definition" }
        ]
      }
    ]
  }
}
```
````

`value`, `prefix`, and `suffix` are rendered verbatim. The renderer never
calculates, formats, fetches, or navigates. References are opaque strings and
only become controls when the host supplies `referenceActions`:

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
