import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { createEChartsRenderer } from '@datafe-open/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChart,
  MarkdownChartProvider,
} from '../src/index';

describe('react-markdown runtime adapter', () => {
  it('provides a zero-config ECharts component with a default height', () => {
    const source = '```markdown-chart\n{"version":1,"renderer":"echarts","data":{"kind":"inline","source":[]},"spec":{"series":[]}}\n```';
    const html = renderToStaticMarkup(<MarkdownChart source={source} />);
    expect(html).toContain('markdown-chart-placeholder');
    expect(html).toContain('min-height:360px');
    expect(html).not.toContain('<pre>');
  });

  it.each(['echarts', 'echarts-fulldata'])('leaves the removed %s shorthand as code', (language) => {
    const source = `\`\`\`${language}\n{"series":[]}\n\`\`\``;
    const html = renderToStaticMarkup(<MarkdownChart source={source} />);
    expect(html).toContain(`<code class="language-${language}">`);
    expect(html).not.toContain('markdown-chart-placeholder');
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

  it('routes the temporary ChatBI fence in simple and advanced modes', () => {
    const source = '```echarts-chatbi_query_8660210443288600709-0\nvar option = {};\n//#end\n```';
    const resolveLegacyArtifactContent = async () => 'name,value\nA,10\n';

    const simpleHtml = renderToStaticMarkup(
      <MarkdownChart
        source={source}
        resolveLegacyArtifactContent={resolveLegacyArtifactContent}
      />,
    );
    expect(simpleHtml).toContain('markdown-chart-placeholder');
    expect(simpleHtml).not.toContain('<pre>');

    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      resolveLegacyArtifactContent,
    }));
    const components = createMarkdownChartComponents({ chartStyle: { minHeight: 360 } });
    const advancedHtml = renderToStaticMarkup(
      <MarkdownChartProvider registry={registry}>
        <ReactMarkdown components={components}>{source}</ReactMarkdown>
      </MarkdownChartProvider>,
    );
    expect(advancedHtml).toContain('markdown-chart-placeholder');
    expect(advancedHtml).not.toContain('<pre>');
  });

  it('infers completed and pending fences in advanced streaming mode without an extra source prop', () => {
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount() {},
    });
    const components = createMarkdownChartComponents();
    const render = (source: string) => renderToStaticMarkup(
      <MarkdownChartProvider registry={registry} streaming>
        <ReactMarkdown components={components}>{source}</ReactMarkdown>
      </MarkdownChartProvider>,
    );

    const complete = render('```markdown-chart\n{"version":1,"renderer":"test","spec":{}}\n```\n\nMore');
    expect(complete).toContain('data-markdown-chart-complete="true"');
    expect(complete).not.toContain('aria-busy="true"');

    const pending = render('```markdown-chart\n{"version":1');
    expect(pending).toContain('markdown-chart-streaming');
    expect(pending).toContain('aria-busy="true"');
  });
});
