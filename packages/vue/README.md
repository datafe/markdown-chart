# @datafe-open/markdown-chart-vue

Vue 3 `<MarkdownChart>` component, `useMarkdownChart` composable, and lower-level
placeholder mounting utility for markdown-it applications.

`<MarkdownChart :source="markdown" />` works without supplying a markdown-it
instance or renderer registry. The component creates safe defaults, registers
ECharts, and applies a 360px minimum chart height automatically. Canonical
inline datasets and ECharts-resolved referenced datasets automatically include
a Chart/Data switch.
The switch uses chart and table icons while retaining accessible labels.

Install the zero-config component with:

```sh
pnpm add echarts @datafe-open/markdown-chart-vue
```

`markdown-it` is included by this package. Applications importing it directly
for a custom parser should still declare `markdown-it` as their own dependency.

The component observes replacement `markdownIt` and `registry` props. The
composable accepts either plain instances or Vue refs for both values.

Set `:streaming="true"` while tokens are arriving. Closed fences render
immediately, and their existing DOM and chart controller are reused as later
Markdown is appended. Only the active unterminated tail fence waits.

The deprecated ChatBI migration prop `resolveLegacyArtifactContent` accepts a
callback that returns raw CSV content. `legacyArtifactContextKey` can keep an
equivalent inline callback stable across rerenders; change the key when its
session or authorization context changes. If the key is omitted, callback
identity is used as the safe cache boundary.

For deprecated `echarts-chatbi_sandbox_filepath_<filePath>` content, use
`resolveLegacySandboxFileContent`. Its request preserves the original
case-sensitive `filePath`; `legacySandboxFileContextKey` provides the same
stable session/authorization cache boundary. Configure each resolver either as
a top-level prop or in `echarts` options, never both.

Chart placeholders must have a non-zero height so ECharts can measure its
container:

```css
.markdown-chart-placeholder {
  min-height: 360px;
}
```
