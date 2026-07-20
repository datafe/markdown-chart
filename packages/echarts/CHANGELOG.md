# @datafe-open/markdown-chart-echarts

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
