import { MarkdownChart } from '@datafe-open/markdown-chart-react';

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

export function App() {
  return <MarkdownChart source={source} />;
}
