import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer } from '@datafe-open/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChartProvider,
} from '@datafe-open/markdown-chart-react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

const source = `# Sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "data": {
    "kind": "inline",
    "dimensions": ["category", "value"],
    "source": [["A", 10], ["B", 20]]
  },
  "spec": {
    "xAxis": { "type": "category" },
    "yAxis": {},
    "series": [{ "type": "bar", "encode": { "x": "category", "y": "value" } }]
  }
}
\`\`\``;

const chartComponents = createMarkdownChartComponents({
  chartStyle: { minHeight: 360 },
});

export function App() {
  const registry = useMemo(
    () => new ChartRendererRegistry().register(createEChartsRenderer()),
    [],
  );

  return (
    <MarkdownChartProvider registry={registry}>
      <ReactMarkdown components={chartComponents}>{source}</ReactMarkdown>
    </MarkdownChartProvider>
  );
}
