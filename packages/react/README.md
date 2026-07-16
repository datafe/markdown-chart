# @datafe/markdown-chart-react

Provider, chart block, and `createMarkdownChartComponents()` adapter for
react-markdown. The adapter replaces the surrounding `pre` element for chart
fences, avoiding invalid `<pre><div /></pre>` markup.

The `pre` adapter reads the live registry from `MarkdownChartProvider`; newly
registered renderer aliases work without rebuilding a language list. Give the
chart class a non-zero height so the chart runtime can measure its container.
