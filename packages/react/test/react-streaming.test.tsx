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
      root.render(<MarkdownChart source={`\`\`\`markdown-chart\n${canonicalBody}`} registry={registry} streaming />);
    });
    expect(container.querySelector('.markdown-chart-streaming')).not.toBeNull();
    expect(parse).not.toHaveBeenCalled();

    await act(async () => {
      root.render(<MarkdownChart source={closedChart()} registry={registry} streaming />);
    });
    await vi.waitFor(() => expect(mount).toHaveBeenCalledOnce());
    expect(parse).toHaveBeenCalledOnce();

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
