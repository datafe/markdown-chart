import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChartProvider,
} from '@datafe/markdown-chart-react';
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';

const chartComponents = createMarkdownChartComponents({
  chartStyle: { minHeight: 360 },
});

export interface AdvancedExampleProps {
  readonly source: string;
}

export function AdvancedExample({ source }: AdvancedExampleProps) {
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
