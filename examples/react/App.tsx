import ReactMarkdown from 'react-markdown';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChartProvider,
} from '@datafe/markdown-chart-react';

const registry = new ChartRendererRegistry().register(createEChartsRenderer({
  loadECharts: () => import('echarts'),
}));
const components = createMarkdownChartComponents({ chartClassName: 'markdown-chart-block' });
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

export function App() {
  return (
    <MarkdownChartProvider registry={registry}>
      <ReactMarkdown components={components}>{source}</ReactMarkdown>
    </MarkdownChartProvider>
  );
}
