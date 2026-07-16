// @vitest-environment jsdom
import MarkdownIt from 'markdown-it';
import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';
import { ChartRendererRegistry, type ChartRenderer } from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import { MarkdownChart } from '../src/index';

function testRenderer(onMount: () => void): ChartRenderer {
  return {
    id: 'test',
    parse: (spec) => spec,
    mount() {
      onMount();
    },
  };
}

describe('MarkdownChart reactive object props', () => {
  it('provides zero-config parsing, registry, and chart height defaults', async () => {
    const source = '```markdown-chart\n{"version":1,"renderer":"echarts","data":{"kind":"inline","source":[]},"spec":{"series":[]}}\n```';
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, { source, streaming: true });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => {
      const placeholder = root.querySelector<HTMLElement>('.markdown-chart-placeholder');
      expect(placeholder?.style.minHeight).toBe('360px');
    });
    app.unmount();
  });

  it('refreshes when markdownIt or registry instances are replaced', async () => {
    const firstMount = vi.fn();
    const secondMount = vi.fn();
    const firstRegistry = new ChartRendererRegistry().register(testRenderer(firstMount));
    const secondRegistry = new ChartRendererRegistry().register(testRenderer(secondMount));
    const firstMarkdownIt = new MarkdownIt().use(markdownChartPlugin, { registry: firstRegistry });
    const secondMarkdownIt = new MarkdownIt().use(markdownChartPlugin, { registry: secondRegistry });
    secondMarkdownIt.renderer.rules.heading_open = () => '<h1 data-markdown-it="second">';

    const registry = shallowRef(firstRegistry);
    const markdownIt = shallowRef(firstMarkdownIt);
    const source = '# Chart\n\n```markdown-chart\n{"version":1,"renderer":"test","spec":{}}\n```';
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          markdownIt: markdownIt.value,
          registry: registry.value,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => expect(firstMount).toHaveBeenCalledOnce());
    registry.value = secondRegistry;
    await nextTick();
    await vi.waitFor(() => expect(secondMount).toHaveBeenCalledOnce());

    markdownIt.value = secondMarkdownIt;
    await nextTick();
    await vi.waitFor(() => {
      expect(root.querySelector('[data-markdown-it="second"]')).not.toBeNull();
    });
    app.unmount();
  });

  it('routes the temporary ChatBI fence in simple and advanced modes', async () => {
    const source = '```echarts-chatbi_query_8660210443288600709-0\nvar option = {};\n//#end\n```';
    const resolveLegacyEChartQuery = async () => ({
      data: { kind: 'inline' as const, source: [] },
      spec: { series: [] },
    });

    const simpleApp = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          streaming: true,
          resolveLegacyEChartQuery,
        });
      },
    }));
    const simpleRoot = document.createElement('div');
    simpleApp.mount(simpleRoot);
    await vi.waitFor(() => {
      expect(simpleRoot.querySelector('.markdown-chart-placeholder')).not.toBeNull();
    });
    simpleApp.unmount();

    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      resolveLegacyEChartQuery,
    }));
    const markdownIt = new MarkdownIt().use(markdownChartPlugin, { registry });
    const advancedApp = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          markdownIt,
          registry,
          streaming: true,
        });
      },
    }));
    const advancedRoot = document.createElement('div');
    advancedApp.mount(advancedRoot);
    await vi.waitFor(() => {
      expect(advancedRoot.querySelector('.markdown-chart-placeholder')).not.toBeNull();
    });
    advancedApp.unmount();
  });
});
