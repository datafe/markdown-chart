// @vitest-environment jsdom
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref, shallowRef } from 'vue';
import { ChartRendererRegistry, type ChartRenderer } from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  type EChartsRuntime,
  type LegacySandboxBinding,
} from '@datafe-open/markdown-chart-echarts';
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

const answerLegacySandbox = (() => {
  interface PendingReply {
    readonly iframe: HTMLIFrameElement;
    readonly request: { readonly channel: string; readonly requestId: string };
    readonly replyPort: MessagePort;
  }
  const pending: PendingReply[] = [];
  const append = document.body.append.bind(document.body);
  document.body.append = (...nodes) => {
    append(...nodes);
    const iframe = nodes.find((node): node is HTMLIFrameElement => (
      node instanceof HTMLIFrameElement
      && node.title === 'Temporary chart sandbox'
    ));
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage = ((
      request: PendingReply['request'],
      _targetOrigin: string,
      transfer?: Transferable[],
    ) => {
      const replyPort = transfer?.[0];
      if (replyPort instanceof MessagePort) pending.push({ iframe, request, replyPort });
    }) as typeof iframe.contentWindow.postMessage;
  };
  return async (option: Record<string, unknown>): Promise<void> => {
    await vi.waitFor(() => {
      expect(pending.some(({ iframe }) => iframe.isConnected)).toBe(true);
    });
    const index = pending.findIndex(({ iframe }) => iframe.isConnected);
    const entry = pending.splice(index, 1)[0];
    if (!entry) throw new Error('temporary sandbox reply port is missing');
    expect(entry.request).toMatchObject({
      channel: LEGACY_CHANNEL,
      requestId: LEGACY_REQUEST_ID,
    });
    entry.replyPort.postMessage({
      channel: entry.request.channel,
      type: 'result',
      requestId: entry.request.requestId,
      option,
    });
  };
})();

function legacySandboxBinding(
  overrides: Partial<LegacySandboxBinding> = {},
): LegacySandboxBinding {
  return {
    resolveLegacyArtifactContent: async () => 'name,value\nA,10\n',
    resolveLegacySandboxFileContent: async () => 'name,value\nA,10\n',
    shouldDefer: () => false,
    ...overrides,
  };
}

describe('MarkdownChart reactive object props', () => {
  it('forwards KPI ref resolver options through the zero-config component once', async () => {
    const resolveDataRef = vi.fn(async () => ({
      dimensions: ['day', 'value'],
      source: [['2026-09-01', 42]],
    }));
    const source = `\`\`\`markdown-chart\n${JSON.stringify({
      version: 1,
      renderer: 'kpi',
      data: { kind: 'ref', ref: 'dataset://kpi', dimensions: ['day', 'value'] },
      spec: { items: [{ id: 'value', title: 'Value', value: { field: 'value' } }] },
    })}\n\`\`\``;
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, { source, kpi: { resolveDataRef } });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.querySelector('[data-markdown-chart-kpi-value]')?.textContent).toBe('42');
    });
    expect(resolveDataRef).toHaveBeenCalledOnce();
    app.unmount();
  });

  it('zero-config renders KPI references and preserves completed cards while text streams', async () => {
    const body = JSON.stringify({
      version: 1,
      renderer: 'kpi',
      data: {
        kind: 'inline',
        source: [
          { day: '2026-08-31', unmet: 0.38, lostRevenue: 650 },
          { day: '2026-09-01', unmet: 0.4, lostRevenue: 720 },
        ],
      },
      spec: {
        timeField: 'day',
        items: [
          {
            id: 'unmet_demand',
            title: '未满足需求',
            value: { field: 'unmet', format: { style: 'percent', maximumFractionDigits: 0 } },
            trend: {
              type: 'line',
              compare: { lag: 1, mode: 'absolute', polarity: 'lower-is-better' },
            },
            references: [
              { ref: 'docs://metrics/unmet-demand', label: '未满足需求口径' },
              { ref: 'docs://metrics/unmet-demand-trend', label: '未满足需求趋势说明' },
            ],
          },
          {
            id: 'lost_revenue',
            title: '累计流失营收',
            value: { field: 'lostRevenue', format: { style: 'decimal', suffix: '万' } },
          },
        ],
      },
    });
    const complete = `\`\`\`markdown-chart\n${body}\n\`\`\``;
    const source = ref(complete);
    const open = vi.fn();
    const canOpen = vi.fn(() => true);
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source: source.value,
          streaming: true,
          referenceActions: { canOpen, open },
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => {
      expect(root.querySelectorAll('[data-markdown-chart-kpi-id]')).toHaveLength(2);
    });
    const original = root.querySelector('.markdown-chart-placeholder');
    const originalCard = root.querySelector('[data-markdown-chart-kpi-id="unmet_demand"]');
    const buttons = root.querySelectorAll<HTMLButtonElement>(
      '[data-markdown-chart-kpi-reference]',
    );
    expect(buttons).toHaveLength(2);
    buttons[1]?.click();
    expect(open).toHaveBeenCalledWith({
      rendererId: 'kpi',
      reference: {
        ref: 'docs://metrics/unmet-demand-trend',
        label: '未满足需求趋势说明',
      },
    });

    source.value = `${complete}\n\nThe analysis continues.`;
    await nextTick();
    await vi.waitFor(() => expect(root.textContent).toContain('The analysis continues.'));
    expect(root.querySelector('.markdown-chart-placeholder')).toBe(original);
    expect(root.querySelector('[data-markdown-chart-kpi-id="unmet_demand"]')).toBe(originalCard);

    app.unmount();
  });

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

  it('passes host-provided labels through Vue and markdown-it', async () => {
    const source = '```markdown-chart\n{"version":1,"renderer":"test","data":{"kind":"inline","source":[["A",1]]},"spec":{}}\n```';
    const registry = new ChartRendererRegistry().register(testRenderer(() => {}));
    const labels = {
      chart: '图表',
      data: '数据',
      viewMode: '视图模式',
      showChart: '显示图表',
      showData: '显示数据',
    };
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, { source, registry, labels });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="显示数据"]')).not.toBeNull();
    });
    expect(root.querySelector('.markdown-chart-toggle')?.getAttribute('aria-label'))
      .toBe('视图模式');
    expect(root.querySelector('button[aria-label="显示图表"]')?.getAttribute('title'))
      .toBe('图表');
    expect(root.querySelector('button[aria-label="显示数据"]')?.getAttribute('title'))
      .toBe('数据');
    expect(root.querySelector('.markdown-chart-placeholder')?.getAttribute('aria-label'))
      .toBe('图表');
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
    const legacySandbox = legacySandboxBinding({ resolveLegacyArtifactContent });
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
          echarts: {
            legacySandbox,
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
      legacySandbox,
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

  it('passes the original sandbox file path through the legacySandbox binding', async () => {
    const source = '```echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv\nvar option = { series: [] };\n//#end\n```';
    const resolver = vi.fn(async () => 'name,value\nA,10\n');
    const app = createApp(defineComponent({
      setup() {
        return () => h(MarkdownChart, {
          source,
          echarts: {
            legacySandbox: legacySandboxBinding({
              resolveLegacySandboxFileContent: resolver,
            }),
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
    await vi.waitFor(() => {
      expect(root.querySelector('button[aria-label="Show data"]')).not.toBeNull();
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      filePath: 'App/CSV/Foo.csv',
    }));
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
    const labels = { chartUnavailable: '图表不可用' };
    let state: UseMarkdownChartResult | undefined;
    const app = createApp(defineComponent({
      setup() {
        const chartState = useMarkdownChart({ source, markdownIt, registry, labels });
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
      expect(placeholder?.textContent).toBe('图表不可用');
    });

    await state?.refresh();
    await vi.waitFor(() => {
      const placeholder = root.querySelector<HTMLElement>('.markdown-chart-placeholder');
      expect(mount).toHaveBeenCalledTimes(2);
      expect(placeholder?.dataset.mounted).toBe('true');
      expect(placeholder?.classList.contains('markdown-chart-error')).toBe(false);
      expect(placeholder?.hasAttribute('role')).toBe(false);
      expect(placeholder?.textContent).not.toContain('图表不可用');
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
          loadingLabel: 'Loading Vue chart…',
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);
    await vi.waitFor(() => {
      expect(root.querySelector('.markdown-chart-streaming')).not.toBeNull();
    });
    expect(root.querySelector('.markdown-chart-loading')?.textContent)
      .toBe('Loading Vue chart…');
    expect(parse).not.toHaveBeenCalled();

    source.value = `${source.value}\n\`\`\``;
    await nextTick();
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(parse).toHaveBeenCalledOnce();
    app.unmount();
  });
});
