import { ChartRendererRegistry } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import MarkdownIt from 'markdown-it';
import { createChatBIArtifactContentResolver } from './data';

export interface ChatBIChartContextOptions {
  readonly sessionId: string;
  readonly requestId?: string;
}

export interface ChatBIChartContext {
  readonly registry: ChartRendererRegistry;
  readonly markdownIt: MarkdownIt;
}

/** Builds one parser/renderer context for one ChatBI artifact lookup scope. */
export function createChatBIChartContext(
  options: ChatBIChartContextOptions,
): ChatBIChartContext {
  const resolveLegacyArtifactContent = createChatBIArtifactContentResolver(options);
  const registry = new ChartRendererRegistry().register(createEChartsRenderer({
    resolveLegacyArtifactContent,
  }));
  const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
    registry,
  });
  return { registry, markdownIt };
}
