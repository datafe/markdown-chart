# @datafe-open/markdown-chart

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
