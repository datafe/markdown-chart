// @vitest-environment jsdom
import MarkdownIt from 'markdown-it';
import { describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { ChartRendererRegistry, type ChartRenderer } from '@datafe/markdown-chart';
import { createEChartsRenderer, type EChartsRuntime } from '@datafe/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe/markdown-chart-markdown-it';
import {
  MarkdownChart,
  useMarkdownChart,
  type UseMarkdownChartResult,
} from '../src/index';

function testRenderer(onMount: () => void): ChartRenderer {
  return {
    id: 'test',
    parse: (spec) => spec,
    mount() {
      onMount();
    },
  };
}

function fakeEChartsRuntime(): EChartsRuntime {
  return {
    init() {
      return {
        setOption() {},
        resize() {},
        dispose() {},
      };
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

  it('shows materialized legacy data in simple and advanced modes', async () => {
    const source = '```echarts-chatbi_query_8660210443288600709-0\nvar option = {};\n//#end\n```';
    const resolveLegacyEChartQuery = async () => ({
      data: {
        kind: 'inline' as const,
        dimensions: ['name', 'value'],
        source: [['A', 10], ['B', 20]],
      },
      spec: { series: [{ type: 'bar' }] },
    });
    const assertDataView = async (root: HTMLElement): Promise<void> => {
      await vi.waitFor(() => {
        expect(root.querySelector('button[aria-label="Show data"]')).not.toBeNull();
      });
      root.querySelector<HTMLButtonElement>('button[aria-label="Show data"]')?.click();
      const dataView = root.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
      expect(dataView?.hidden).toBe(false);
      expect(dataView?.querySelector('tbody')?.textContent).toContain('A10');
      expect(dataView?.querySelector('tbody')?.textContent).toContain('B20');
    };

    const simpleApp = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          resolveLegacyEChartQuery,
          echarts: {
            loadECharts: fakeEChartsRuntime,
            resizeObserver: false,
          },
        });
      },
    }));
    const simpleRoot = document.createElement('div');
    simpleApp.mount(simpleRoot);
    await assertDataView(simpleRoot);
    simpleApp.unmount();

    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: fakeEChartsRuntime,
      resolveLegacyEChartQuery,
      resizeObserver: false,
    }));
    const markdownIt = new MarkdownIt().use(markdownChartPlugin, { registry });
    const advancedApp = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          markdownIt,
          registry,
        });
      },
    }));
    const advancedRoot = document.createElement('div');
    advancedApp.mount(advancedRoot);
    await assertDataView(advancedRoot);
    advancedApp.unmount();
  });

  it('retries a failed entry with the same input and clears its error state', async () => {
    let attempts = 0;
    const mount = vi.fn((container: HTMLElement) => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('first mount failed');
      }
      container.dataset.mounted = 'true';
    });
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount,
    });
    const markdownIt = new MarkdownIt().use(markdownChartPlugin, { registry });
    const source = '```test\n{}\n```';
    let state: UseMarkdownChartResult | undefined;
    const app = createApp(defineComponent({
      setup() {
        const chartState = useMarkdownChart({ source, markdownIt, registry });
        state = chartState;
        return () => h('div', {
          ref: chartState.container,
          innerHTML: chartState.html.value,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => {
      const placeholder = root.querySelector('.markdown-chart-placeholder');
      expect(mount).toHaveBeenCalledOnce();
      expect(placeholder?.classList.contains('markdown-chart-error')).toBe(true);
      expect(placeholder?.getAttribute('role')).toBe('alert');
      expect(placeholder?.textContent).toBe('Chart unavailable');
    });

    await state?.refresh();
    await vi.waitFor(() => {
      const placeholder = root.querySelector<HTMLElement>('.markdown-chart-placeholder');
      expect(mount).toHaveBeenCalledTimes(2);
      expect(placeholder?.dataset.mounted).toBe('true');
      expect(placeholder?.classList.contains('markdown-chart-error')).toBe(false);
      expect(placeholder?.hasAttribute('role')).toBe(false);
      expect(placeholder?.textContent).not.toContain('Chart unavailable');
    });
    app.unmount();
  });

  it('preserves a completed chart while streaming text is appended', async () => {
    const mount = vi.fn();
    const dispose = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount(container) {
        mount(container);
        return { dispose };
      },
    });
    const body = JSON.stringify({
      version: 1,
      renderer: 'test',
      data: {
        kind: 'inline',
        dimensions: ['month', 'sales'],
        source: [['Jan', 100], ['Feb', 180]],
      },
      spec: {},
    });
    const complete = `\`\`\`markdown-chart\n${body}\n\`\`\``;
    const source = ref(complete);
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source: source.value,
          registry,
          streaming: true,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const original = root.querySelector('.markdown-chart-placeholder');

    source.value = `${complete}\n\nThe analysis continues.`;
    await nextTick();
    await vi.waitFor(() => {
      expect(root.textContent).toContain('The analysis continues.');
    });
    expect(root.querySelector('.markdown-chart-placeholder')).toBe(original);
    expect(mount).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    const showData = root.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    showData?.click();
    expect(root.querySelector<HTMLElement>('[data-markdown-chart-data-view]')?.hidden).toBe(false);
    expect(root.textContent).toContain('Jan');

    app.unmount();
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('mounts only after the active streaming fence closes', async () => {
    const mount = vi.fn();
    const parse = vi.fn((spec) => spec);
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse,
      mount() {
        mount();
      },
    });
    const body = JSON.stringify({ version: 1, renderer: 'test', spec: {} });
    const source = ref(`\`\`\`markdown-chart\n${body}`);
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source: source.value,
          registry,
          streaming: true,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.querySelector('.markdown-chart-streaming')).not.toBeNull();
    });
    expect(parse).not.toHaveBeenCalled();

    source.value = `${source.value}\n\`\`\``;
    await nextTick();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(parse).toHaveBeenCalledOnce();
    app.unmount();
  });
});
