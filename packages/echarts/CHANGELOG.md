# @datafe-open/markdown-chart-echarts

## 0.1.5

### Patch Changes

- 4855b9d: Restore string cell semantics in the deprecated ChatBI legacy CSV adapter so saved chart scripts can continue using string operations on digit-only dates and other CSV values.
  - @datafe-open/markdown-chart@0.1.5

## 0.1.4

### Patch Changes

- 109b61f: Align the default light and dark ECharts theme with the shared chart design system and add a configurable selected Chart/Data foreground for accessible host accents.
- Updated dependencies [109b61f]
  - @datafe-open/markdown-chart@0.1.4

## 0.1.3

### Patch Changes

- 4ed428c: Avoid drawing an ECharts title twice when the shared Chart/Data card displays it, while preserving native titles for direct renderer mounts.
- Updated dependencies [4ed428c]
  - @datafe-open/markdown-chart@0.1.3

## 0.1.2

### Patch Changes

- 5d6949b: Support the strict `dataworks-chart` `echarts-fulldata` JSON envelope and the deprecated ChatBI sandbox-file fence through the shared ECharts lifecycle. Preserve raw dynamic fence tokens across core, markdown-it, React, and Vue; expose host-owned sandbox CSV resolvers; and allow validated string formatter templates.
- Updated dependencies [5d6949b]
  - @datafe-open/markdown-chart@0.1.2

## 0.1.1

### Patch Changes

- ec064cd: Show renderer-provided chart titles in data-view card headers and omit the title when the chart spec has none. Keep chart content clear of the header with explicit vertical spacing.
- Updated dependencies [ec064cd]
  - @datafe-open/markdown-chart@0.1.1

## 0.1.0

### Minor Changes

- Require the canonical `markdown-chart` fence for ECharts content and add an
  isolated, deprecated ChatBI ArtifactContent adapter. The adapter converts CSV in
  a terminable dedicated Worker owned by a unique-origin bootstrap iframe, and
  React/Vue expose an explicit temporary context key for resolver cache control.
  Two-proxy OpenAPI integration examples are included for React and Vue with
  markdown-it.
- cd8572f: Add the built-in Chart/Data switch for datasets materialized by `resolveDataRef`,
  including fallback to dimensions declared on the original ref.
- 1e908b7: Publish the initial framework-neutral Markdown chart protocol, ECharts renderer,
  and React, Vue, and markdown-it integrations with streaming Chart/Data views.

### Patch Changes

- Updated dependencies
- Updated dependencies [1e908b7]
  - @datafe-open/markdown-chart@0.1.0
