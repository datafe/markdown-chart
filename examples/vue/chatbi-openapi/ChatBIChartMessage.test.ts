// @vitest-environment jsdom
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import { markdownChartPlugin } from '@datafe-open/markdown-chart-markdown-it';
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computed, createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createChatBIChartContext } from './chart-context';

vi.mock('@datafe-open/markdown-chart-vue', async () => (
  import('../../../packages/vue/src/index')
));

const echartsRuntime = vi.hoisted(() => {
  const setOption = vi.fn();
  return {
    setOption,
    init: vi.fn(() => ({
      setOption,
      resize: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock('echarts', () => ({ init: echartsRuntime.init }));

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

function rpcResult(result: unknown): Response {
  return Response.json({
    RequestId: 'trace-id',
    JsonRpcResponse: { Jsonrpc: '2.0', Id: '1', Result: result },
  });
}

const closedChart = `\`\`\`echarts-chatbi_query_42-0
var option = {
  xAxis: { type: 'category', data: inputData.map(row => row.name) },
  yAxis: {},
  series: [{ type: 'bar', data: inputData.map(row => row.value) }]
};
//#end
\`\`\``;

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

function countEndpoint(fetcher: ReturnType<typeof vi.fn>, suffix: string): number {
  return fetcher.mock.calls.filter(([input]) => String(input).endsWith(suffix)).length;
}

describe('Vue + markdown-it ChatBI message integration', () => {
  it('reuses completed charts while streaming and rebuilds artifact context for session/request changes', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const endpoint = String(input);
      if (endpoint.endsWith('/list-agent-session-artifacts')) {
        return rpcResult({
          NextToken: null,
          Artifacts: [{
            ArtifactName: 'chatbi_query_42.csv',
            ArtifactPath: 'artifacts/chatbi_query_42.csv',
          }],
        });
      }
      if (endpoint.endsWith('/get-agent-session-artifact-meta')) {
        return rpcResult({ ArtifactContent: 'name,value\nA,10\nB,20\n' });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    vi.stubGlobal('fetch', fetcher);

    const markdown = ref(closedChart);
    const sessionId = ref('session-1');
    const requestId = ref('request-1');
    const app = createApp(defineComponent({
      setup() {
        const context = computed(() => createChatBIChartContext({
          sessionId: sessionId.value,
          requestId: requestId.value,
        }));
        return () => h(MarkdownChart, {
          source: markdown.value,
          streaming: true,
          markdownIt: context.value.markdownIt,
          registry: context.value.registry,
        });
      },
    }));
    const root = document.createElement('div');
    app.mount(root);

    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({
      xAxis: { type: 'category', data: ['A', 'B'] },
      yAxis: {},
      series: [{ type: 'bar', data: ['10', '20'] }],
    });
    await vi.waitFor(() => {
      expect(echartsRuntime.init).toHaveBeenCalledOnce();
      expect(echartsRuntime.setOption).toHaveBeenCalledOnce();
      expect(root.querySelector('button[aria-label="Show data"]')).not.toBeNull();
    });
    expect(echartsRuntime.setOption.mock.calls[0]?.[0]).toMatchObject({
      dataset: { dimensions: ['name', 'value'], source: [{ name: 'A', value: '10' }, { name: 'B', value: '20' }] },
      series: [{ type: 'bar', data: ['10', '20'] }],
    });
    root.querySelector<HTMLButtonElement>('button[aria-label="Show data"]')?.click();
    const dataView = root.querySelector<HTMLElement>('[data-markdown-chart-data-view]');
    expect(dataView?.hidden).toBe(false);
    expect(dataView?.querySelector('tbody')?.textContent).toContain('A10');
    const originalChart = root.querySelector('.markdown-chart-placeholder');

    markdown.value = `${closedChart}\n\nMore streamed analysis.`;
    await nextTick();
    await vi.waitFor(() => expect(root.textContent).toContain('More streamed analysis.'));
    expect(root.querySelector('.markdown-chart-placeholder')).toBe(originalChart);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(echartsRuntime.init).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).toBeNull();

    sessionId.value = 'session-2';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [30] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(2));

    requestId.value = 'request-2';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [40] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(3));

    expect(countEndpoint(fetcher, '/list-agent-session-artifacts')).toBe(3);
    expect(countEndpoint(fetcher, '/get-agent-session-artifact-meta')).toBe(3);
    const listBodies = fetcher.mock.calls
      .filter(([input]) => String(input).endsWith('/list-agent-session-artifacts'))
      .map(([, init]) => JSON.parse(init?.body as string) as { Params: Record<string, unknown> });
    expect(listBodies.map(({ Params }) => ({
      SessionId: Params.SessionId,
      RequestId: Params.RequestId,
    }))).toEqual([
      { SessionId: 'session-1', RequestId: 'request-1' },
      { SessionId: 'session-2', RequestId: 'request-1' },
      { SessionId: 'session-2', RequestId: 'request-2' },
    ]);

    app.unmount();
  });

  it('uses a host-created markdown-it instance and renderer registry', () => {
    const registry = new ChartRendererRegistry();
    const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, { registry });
    expect(markdownIt).toBeInstanceOf(MarkdownIt);
    expect(registry).toBeInstanceOf(ChartRendererRegistry);
  });
});
