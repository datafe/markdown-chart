import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { ChartRendererRegistry } from '@datafe/markdown-chart';
import {
  createMarkdownChartComponents,
  MarkdownChart,
  MarkdownChartProvider,
} from '../src/index';

describe('react-markdown runtime adapter', () => {
  it('provides a zero-config ECharts component with a default height', () => {
    const source = '```markdown-chart\n{"version":1,"renderer":"echarts","spec":{"series":[]}}\n```';
    const html = renderToStaticMarkup(<MarkdownChart source={source} />);
    expect(html).toContain('markdown-chart-placeholder');
    expect(html).toContain('min-height:360px');
    expect(html).not.toContain('<pre>');
  });

  it('routes a newly registered alias through the provider registry', () => {
    const registry = new ChartRendererRegistry();
    const components = createMarkdownChartComponents({ chartClassName: 'plotly-chart' });
    const source = '```plotly-json\n{"data":[]}\n```';
    const render = () => renderToStaticMarkup(
      <MarkdownChartProvider registry={registry}>
        <ReactMarkdown components={components}>{source}</ReactMarkdown>
      </MarkdownChartProvider>,
    );

    expect(render()).toContain('<pre><code class="language-plotly-json">');
    registry.register({
      id: 'plotly',
      aliases: ['plotly-json'],
      parse: (spec) => spec,
      mount() {},
    });
    const chartHtml = render();
    expect(chartHtml).toContain('markdown-chart-placeholder plotly-chart');
    expect(chartHtml).not.toContain('<pre>');
  });
});
