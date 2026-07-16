import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChartProvider,
} from '@datafe/markdown-chart-react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

const source = `# Sales

\`\`\`markdown-chart
{
  "version": 1,
  "renderer": "echarts",
  "spec": {
    "xAxis": { "type": "category", "data": ["A", "B"] },
    "yAxis": {},
    "series": [{ "type": "bar", "data": [10, 20] }]
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
