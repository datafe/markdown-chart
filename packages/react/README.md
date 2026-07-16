# @datafe/markdown-chart-react

Zero-config `<MarkdownChart source={markdown} />`, provider, chart block, and
`createMarkdownChartComponents()` adapter for react-markdown. The zero-config
component registers ECharts automatically and gives chart blocks a 360px
minimum height.

The `pre` adapter reads the live registry from `MarkdownChartProvider`; newly
registered renderer aliases work without rebuilding a language list. When
using this lower-level adapter directly, give the chart class a non-zero height
so the chart runtime can measure its container.
