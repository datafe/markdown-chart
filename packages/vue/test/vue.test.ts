// @vitest-environment jsdom
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { ChartRendererRegistry, type ChartRenderer } from '@datafe-open/markdown-chart';
import { createEChartsRenderer, type EChartsRuntime } from '@datafe-open/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe-open/markdown-chart-markdown-it';
import {
  MarkdownChart,
  useMarkdownChart,
  type UseMarkdownChartResult,
} from '../src/index';

const LEGACY_CHANNEL = '@datafe-open/markdown-chart/legacy-echart-query';
const LEGACY_REQUEST_ID = '00000001000000020000000300000004';

beforeEach(() => {
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(((array: ArrayBufferView) => {
    if (array instanceof Uint32Array) {
      array.set([1, 2, 3, 4]);
    }
    return array;
  }) as Crypto['getRandomValues']);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

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

async function answerLegacySandbox(option: Record<string, unknown>): Promise<void> {
  await vi.waitFor(() => {
    expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).not.toBeNull();
  });
  const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Temporary chart sandbox"]');
  if (!iframe?.contentWindow) throw new Error('temporary sandbox is missing');
  window.dispatchEvent(new MessageEvent('message', {
    source: iframe.contentWindow,
    data: {
      channel: LEGACY_CHANNEL,
      type: 'result',
      requestId: LEGACY_REQUEST_ID,
      option,
    },
  }));
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

  it('leaves the removed echarts shorthand as code', async () => {
    const language = 'echarts';
    const source = `\`\`\`${language}\n{"series":[]}\n\`\`\``;
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, { source });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await nextTick();
    expect(root.querySelector(`code.language-${language}`)).not.toBeNull();
    expect(root.querySelector('.markdown-chart-placeholder')).toBeNull();
    app.unmount();
  });

  it('routes the dataworks-chart compact ECharts fence', async () => {
    const source = '```echarts-fulldata\n{"version":1,"data":{"kind":"inline","dimensions":["name","value"],"source":[["A",1]]},"option":{"series":[]}}\n```';
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, { source, streaming: true });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await nextTick();
    expect(root.querySelector('.markdown-chart-placeholder')).not.toBeNull();
    expect(root.querySelector('code.language-echarts-fulldata')).toBeNull();
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
    const resolveLegacyArtifactContent = async () => 'name,value\nA,10\nB,20\n';
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
          resolveLegacyArtifactContent,
          echarts: {
            loadECharts: fakeEChartsRuntime,
            resizeObserver: false,
          },
        });
      },
    }));
    const simpleRoot = document.createElement('div');
    simpleApp.mount(simpleRoot);
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await assertDataView(simpleRoot);
    simpleApp.unmount();

    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: fakeEChartsRuntime,
      resolveLegacyArtifactContent,
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
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await assertDataView(advancedRoot);
    advancedApp.unmount();
  });

  it('passes the original sandbox file path through the top-level resolver prop', async () => {
    const source = '```echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv\nvar option = { series: [] };\n//#end\n```';
    const resolver = vi.fn(async () => 'name,value\nA,10\n');
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          resolveLegacySandboxFileContent: resolver,
          legacySandboxFileContextKey: 'session-a',
          echarts: { loadECharts: fakeEChartsRuntime, resizeObserver: false },
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    await answerLegacySandbox({ series: [] });
    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="Show data"]')).not.toBeNull();
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      filePath: 'App/CSV/Foo.csv',
    }));
    app.unmount();
  });

  it('does not refetch when an inline legacy resolver changes identity under one context key', async () => {
    const chart = '```echarts-chatbi_query_42-0\nvar option = { series: [] };\n//#end\n```';
    const source = ref(chart);
    const resolver = vi.fn(async (_request: unknown) => 'name,value\nA,10\n');
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source: source.value,
          streaming: true,
          legacyArtifactContextKey: 'session-a',
          resolveLegacyArtifactContent: (request) => resolver(request),
          echarts: {
            loadECharts: fakeEChartsRuntime,
            resizeObserver: false,
          },
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    await answerLegacySandbox({ series: [] });

    source.value = `${chart}\n\nMore streamed analysis.`;
    await nextTick();
    await vi.waitFor(() => expect(root.textContent).toContain('More streamed analysis.'));
    expect(resolver).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).toBeNull();

    app.unmount();
  });

  it('refetches when an unkeyed legacy resolver changes identity', async () => {
    const source = '```echarts-chatbi_query_42-0\nvar option = { series: [] };\n//#end\n```';
    const firstResolver = vi.fn(async () => 'name,value\nA,10\n');
    const secondResolver = vi.fn(async () => 'name,value\nB,20\n');
    const activeResolver = shallowRef(firstResolver);
    const echarts = {
      loadECharts: fakeEChartsRuntime,
      resizeObserver: false,
    };
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          echarts,
          resolveLegacyArtifactContent: activeResolver.value,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => expect(firstResolver).toHaveBeenCalledOnce());
    await answerLegacySandbox({ series: [] });

    activeResolver.value = secondResolver;
    await nextTick();
    await vi.waitFor(() => expect(secondResolver).toHaveBeenCalledOnce());
    await answerLegacySandbox({ series: [] });
    expect(firstResolver).toHaveBeenCalledOnce();
    expect(secondResolver).toHaveBeenCalledOnce();

    app.unmount();
  });

  it('refetches when the explicit legacy artifact context key changes', async () => {
    const source = '```echarts-chatbi_query_42-0\nvar option = { series: [] };\n//#end\n```';
    const contextKey = ref('session-a');
    const resolver = vi.fn(async () => 'name,value\nA,10\n');
    const echarts = {
      loadECharts: fakeEChartsRuntime,
      resizeObserver: false,
    };
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          echarts,
          legacyArtifactContextKey: contextKey.value,
          resolveLegacyArtifactContent: resolver,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(1));
    await answerLegacySandbox({ series: [] });

    contextKey.value = 'session-b';
    await nextTick();
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [] });
    expect(resolver).toHaveBeenCalledTimes(2);

    app.unmount();
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
      aliases: ['test'],
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
