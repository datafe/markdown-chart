# @datafe-open/markdown-chart-table

Interactive table renderer for Markdown Chart, built on AG Grid Community. It
supports typed sorting and filters, quick search, CSV export, pinned columns,
structured number/date formatting, change indicators, bars, progress cells,
and inline SVG sparklines.

Install it directly when building a custom registry:

```sh
pnpm add ag-grid-community @datafe-open/markdown-chart-table
```

```ts
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import {
  createTableDataViewProvider,
  createTableRenderer,
} from '@datafe-open/markdown-chart-table';

const registry = new ChartRendererRegistry();
const options = { resolveDataRef, validateDataRef };
registry.register(createTableRenderer(options));
registry.registerDataViewProvider(createTableDataViewProvider(options));
```

The React and Vue zero-config components register both integrations
automatically. The provider is loaded only when a user opens a tabular Data
view. If it cannot load, the core HTML data view remains available.

Use `renderer: "table"` with canonical table data:

````markdown
```markdown-chart
{
  "version": 1,
  "renderer": "table",
  "data": {
    "kind": "inline",
    "source": [
      { "region": "华东", "sales": 1280000, "growth": 0.18, "apr": 31, "may": 36, "jun": 42 },
      { "region": "华南", "sales": 960000, "growth": -0.04, "apr": 27, "may": 26, "jun": 25 }
    ]
  },
  "spec": {
    "title": "区域销售",
    "height": 420,
    "columns": [
      { "field": "region", "title": "区域", "pinned": "left" },
      { "field": "sales", "title": "销售额", "type": "number", "format": { "style": "currency", "currency": "CNY", "notation": "compact" } },
      { "field": "growth", "title": "同比", "type": "number", "format": { "style": "percent" }, "cell": { "kind": "change", "polarity": "higher-is-better" } },
      { "id": "trend", "title": "近三月", "cell": { "kind": "sparkline", "fields": ["apr", "may", "jun"], "labels": ["4月", "5月", "6月"], "scale": "column" } }
    ],
    "initialSort": [{ "field": "sales", "direction": "desc" }]
  }
}
```
````

`columns` accepts 1–50 entries. A column can bind a source `field`, or use an
`id` for a derived sparkline. Types are `string`, `number`, `date`, and
`boolean`; date columns require ISO dates or timestamps with a timezone and are
displayed in UTC. Omitted types infer number only when every non-null value is
numeric and boolean only when every non-null value is boolean; dates are never
inferred.

The default table budget is 10,000 rows and 200,000 cells. Override it with
`createTableRenderer({ limits })` and pass the same options to
`createTableDataViewProvider`. CSV export uses filtered and sorted source rows,
keeps raw canonical values, and protects formula-like strings.
