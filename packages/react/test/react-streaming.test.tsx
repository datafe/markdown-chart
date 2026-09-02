// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  type EChartsRuntime,
  type LegacySandboxBinding,
} from '@datafe-open/markdown-chart-echarts';
import {
  createMarkdownChartComponents,
  MarkdownChart,
  MarkdownChartProvider,
} from '../src/index';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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

const canonicalBody = JSON.stringify({
  version: 1,
  renderer: 'test',
  data: {
    kind: 'inline',
    dimensions: ['month', 'sales'],
    source: [['Jan', 100], ['Feb', 180]],
  },
  spec: {},
});

function closedChart(trailing = ''): string {
  return `\`\`\`markdown-chart\n${canonicalBody}\n\`\`\`${trailing}`;
}

const kpiBody = JSON.stringify({
  version: 1,
  renderer: 'kpi',
  spec: {
    items: [
      {
        id: 'unmet_demand',
        title: '未满足需求',
        value: '40',
        suffix: '%',
        references: [
          { ref: 'docs://metrics/unmet-demand', label: '未满足需求口径' },
          { ref: 'docs://metrics/unmet-demand-trend', label: '未满足需求趋势说明' },
        ],
      },
      { id: 'lost_revenue', title: '累计流失营收', value: '720', suffix: '万' },
    ],
  },
});

function closedKpi(trailing = ''): string {
  return `\`\`\`markdown-chart\n${kpiBody}\n\`\`\`${trailing}`;
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

describe('MarkdownChart streaming lifecycle', () => {
  it('zero-config renders KPI references and preserves completed cards while text streams', async () => {
    const open = vi.fn();
    const canOpen = vi.fn(() => true);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownChart
          source={closedKpi()}
          streaming
          referenceActions={{ canOpen, open }}
        />,
      );
    });
    await vi.waitFor(() => {
      expect(container.querySelectorAll('[data-markdown-chart-kpi-id]')).toHaveLength(2);
    });
    const original = container.querySelector('.markdown-chart-placeholder');
    const originalCard = container.querySelector('[data-markdown-chart-kpi-id="unmet_demand"]');
    const buttons = container.querySelectorAll<HTMLButtonElement>(
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

    await act(async () => {
      root.render(
        <MarkdownChart
          source={closedKpi('\n\nThe analysis continues.')}
          streaming
          referenceActions={{ canOpen, open }}
        />,
      );
    });
    expect(container.querySelector('.markdown-chart-placeholder')).toBe(original);
    expect(container.querySelector('[data-markdown-chart-kpi-id="unmet_demand"]')).toBe(originalCard);
    expect(container.textContent).toContain('The analysis continues.');

    await act(async () => root.unmount());
  });

  it('renders a closed fence during streaming and preserves it as text is appended', async () => {
    const mount = vi.fn();
    const dispose = vi.fn();
    const resize = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount(container) {
        mount(container);
        return { dispose, resize };
      },
    });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownChart source={closedChart()} registry={registry} streaming />);
    });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    const original = container.querySelector('.markdown-chart-placeholder');

    await act(async () => {
      root.render(
        <MarkdownChart
          source={closedChart('\n\nThe analysis continues.')}
          registry={registry}
          streaming
        />,
      );
    });
    expect(container.querySelector('.markdown-chart-placeholder')).toBe(original);
    expect(mount).toHaveBeenCalledOnce();
    expect(dispose).not.toHaveBeenCalled();

    const showData = container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]');
    const dataView = container.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    showData?.click();
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.textContent).toContain('Jan');

    const showChart = container.querySelector<HTMLButtonElement>('button[aria-label="Show chart"]');
    showChart?.click();
    expect(resize).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(dispose).toHaveBeenCalledOnce();
  });

  it('waits for the active unterminated fence and mounts it when closed', async () => {
    const mount = vi.fn();
    const parse = vi.fn((spec) => spec);
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse,
      mount() {
        mount();
      },
    });
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownChart
          source={`\`\`\`markdown-chart\n${canonicalBody}`}
          registry={registry}
          streaming
          loadingLabel="Generating visualization…"
        />,
      );
    });
    expect(container.querySelector('.markdown-chart-streaming')).not.toBeNull();
    expect(container.querySelector('.markdown-chart-loading')?.textContent)
      .toBe('Generating visualization…');
    expect(parse).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MarkdownChart source={closedChart()} registry={registry} streaming />);
    });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(parse).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });

  it('renders a closed chart fence inside a streaming blockquote', async () => {
    const mount = vi.fn();
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      parse: (spec) => spec,
      mount() {
        mount();
      },
    });
    const source = closedChart()
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(<MarkdownChart source={source} registry={registry} streaming />);
    });

    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(container.querySelector('.markdown-chart-streaming')).toBeNull();
    await act(async () => root.unmount());
  });

  it('uses host-provided labels for React placeholders and errors', async () => {
    const registry = new ChartRendererRegistry().register({
      id: 'test',
      aliases: ['test'],
      parse() {
        throw new Error('invalid');
      },
      mount() {},
    });
    const source = '```test\n{}\n```';
    const labels = {
      chart: '图表',
      chartUnavailable: '图表不可用',
    };
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownChartProvider registry={registry} labels={labels}>
          <ReactMarkdown components={createMarkdownChartComponents()}>{source}</ReactMarkdown>
        </MarkdownChartProvider>,
      );
    });

    const placeholder = container.querySelector('.markdown-chart-placeholder');
    await vi.waitFor(() => expect(placeholder?.textContent).toBe('图表不可用'));
    expect(placeholder?.getAttribute('aria-label')).toBe('图表');
    await act(async () => root.unmount());
  });

  it('shows materialized legacy data in simple and advanced integrations', async () => {
    const source = '```echarts-chatbi_query_8660210443288600709-0\nvar option = {};\n//#end\n```';
    const resolveLegacyArtifactContent = async () => 'name,value\nA,10\nB,20\n';
    const legacySandbox = legacySandboxBinding({
      resolveLegacyArtifactContent,
    });
    const assertDataView = async (container: HTMLElement): Promise<void> => {
      await vi.waitFor(() => {
        expect(container.querySelector('button[aria-label="Show data"]')).not.toBeNull();
      });
      expect(container.querySelector('.markdown-chart-title')).toBeNull();
      container.querySelector<HTMLButtonElement>('button[aria-label="Show data"]')?.click();
      const dataView = container.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
      expect(dataView?.hidden).toBe(false);
      expect(dataView?.querySelector('tbody')?.textContent).toContain('A10');
      expect(dataView?.querySelector('tbody')?.textContent).toContain('B20');
    };

    const simpleContainer = document.createElement('div');
    const simpleRoot = createRoot(simpleContainer);
    await act(async () => {
      simpleRoot.render(
        <MarkdownChart
          source={source}
          echarts={{
            legacySandbox,
            loadECharts: fakeEChartsRuntime,
            resizeObserver: false,
          }}
        />,
      );
    });
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await assertDataView(simpleContainer);
    await act(async () => simpleRoot.unmount());

    const registry = new ChartRendererRegistry().register(createEChartsRenderer({
      loadECharts: fakeEChartsRuntime,
      legacySandbox,
      resizeObserver: false,
    }));
    const components = createMarkdownChartComponents({ chartStyle: { minHeight: 360 } });
    const advancedContainer = document.createElement('div');
    const advancedRoot = createRoot(advancedContainer);
    await act(async () => {
      advancedRoot.render(
        <MarkdownChartProvider registry={registry}>
          <ReactMarkdown components={components}>{source}</ReactMarkdown>
        </MarkdownChartProvider>,
      );
    });
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await assertDataView(advancedContainer);
    await act(async () => advancedRoot.unmount());
  });

  it('passes the original sandbox file path through the legacySandbox binding', async () => {
    const source = '```echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv\nvar option = { series: [] };\n//#end\n```';
    const resolver = vi.fn(async () => 'name,value\nA,10\n');
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MarkdownChart
          source={source}
          echarts={{
            legacySandbox: legacySandboxBinding({
              resolveLegacySandboxFileContent: resolver,
            }),
            loadECharts: fakeEChartsRuntime,
            resizeObserver: false,
          }}
        />,
      );
    });
    await vi.waitFor(() => expect(resolver).toHaveBeenCalledOnce());
    await answerLegacySandbox({ series: [] });
    await vi.waitFor(() => {
      expect(container.querySelector('button[aria-label="Show data"]')).not.toBeNull();
    });
    expect(resolver).toHaveBeenCalledWith(expect.objectContaining({
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      filePath: 'App/CSV/Foo.csv',
    }));
    await act(async () => root.unmount());
  });

});
