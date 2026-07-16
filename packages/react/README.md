# @datafe/markdown-chart-react

Zero-config `<MarkdownChart source={markdown} />`, provider, chart block, and
`createMarkdownChartComponents()` adapter for react-markdown. The zero-config
component registers ECharts automatically and gives chart blocks a 360px
minimum height. Canonical inline datasets and ECharts-resolved referenced
datasets automatically include a Chart/Data icon switch.

Install the zero-config component with:

```sh
pnpm add echarts @datafe/markdown-chart-react
```

`react-markdown` is included by this package. Applications using the lower-level
provider and importing `react-markdown` directly should still declare
`react-markdown` as their own dependency.

The `pre` adapter reads the live registry from `MarkdownChartProvider`; newly
registered renderer aliases work without rebuilding a language list. When
using this lower-level adapter directly, give the chart class a non-zero height
so the chart runtime can measure its container.

Set `streaming` on `MarkdownChart` or `MarkdownChartProvider` while tokens are
arriving. Closed chart fences render immediately; only the active unterminated
tail fence waits. The provider automatically infers the Markdown source from a
direct `ReactMarkdown` child, so the usual advanced integration needs no extra
source prop.
