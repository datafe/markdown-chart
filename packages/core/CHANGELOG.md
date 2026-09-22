# @datafe-open/markdown-chart

## 0.3.4

### Patch Changes

- e825d78: Simplify KPI groups with borderless metrics, whitespace spacing, plain status text,
  smaller explicit value affixes, and a compact neutral Chart/Data toolbar. Preserve
  44px line/area trends, formatted text, reference actions, and other chart toolbars.

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- eb68fa5: Preserve the host minimum height through the chart viewport so ordinary ECharts charts do not mount into a zero-height canvas.

## 0.3.0

### Minor Changes

- 71b7cf7: Add an interactive AG Grid Community table renderer with filtering, sorting,
  CSV export, value formatting, change indicators, bars, progress cells, and
  inline SVG sparklines. React and Vue zero-config components now register it and
  use it lazily for tabular Data views.

## 0.2.0

### Minor Changes

- b68be9c: Add renderer-neutral graph and hierarchy data, inspectable structured Data views, bounded chart layouts, and ECharts mappings for Sankey, graph, tree, treemap, and sunburst charts. KPI now rejects structured datasets explicitly.

## 0.1.19

## 0.1.18

## 0.1.17

## 0.1.16

## 0.1.15

### Patch Changes

- 94562c4: Add a strict multi-KPI renderer backed by default or named canonical inline/ref
  datasets, optional sparklines and comparisons, safe structured formatting,
  generic host-owned reference actions with an optional host icon factory, and
  zero-config KPI registration in the React/Vue adapters.

## 0.1.14

## 0.1.13

## 0.1.12

## 0.1.11

### Patch Changes

- c636228: Allow hosts to localize chart UI labels and render closed streaming chart fences inside blockquotes.

## 0.1.10

## 0.1.9

### Patch Changes

- 1a67a95: Show a built-in, localizable loading indicator while a chart fence is incomplete and while parsing, data materialization, or runtime mounting is still in progress.
  Expose `findUnclosedMarkdownFence` so block-oriented streaming hosts can identify the active tail fence without hiding it or duplicating Markdown fence parsing.

## 0.1.8

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

### Patch Changes

- 109b61f: Align the default light and dark ECharts theme with the shared chart design system and add a configurable selected Chart/Data foreground for accessible host accents.

## 0.1.3

### Patch Changes

- 4ed428c: Avoid drawing an ECharts title twice when the shared Chart/Data card displays it, while preserving native titles for direct renderer mounts.

## 0.1.2

### Patch Changes

- 5d6949b: Support the strict `dataworks-chart` `echarts-fulldata` JSON envelope and the deprecated ChatBI sandbox-file fence through the shared ECharts lifecycle. Preserve raw dynamic fence tokens across core, markdown-it, React, and Vue; expose host-owned sandbox CSV resolvers; and allow validated string formatter templates.

## 0.1.1

### Patch Changes

- ec064cd: Show renderer-provided chart titles in data-view card headers and omit the title when the chart spec has none. Keep chart content clear of the header with explicit vertical spacing.

## 0.1.0

### Minor Changes

- Require the canonical `markdown-chart` fence for ECharts content and add an
  isolated, deprecated ChatBI ArtifactContent adapter. The adapter converts CSV in
  a terminable dedicated Worker owned by a unique-origin bootstrap iframe, and
  React/Vue expose an explicit temporary context key for resolver cache control.
  Two-proxy OpenAPI integration examples are included for React and Vue with
  markdown-it.
- 1e908b7: Publish the initial framework-neutral Markdown chart protocol, ECharts renderer,
  and React, Vue, and markdown-it integrations with streaming Chart/Data views.
