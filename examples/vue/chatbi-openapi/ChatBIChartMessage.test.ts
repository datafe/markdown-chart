// @vitest-environment jsdom
import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import {
  createLegacySandboxClient,
  type LegacySandboxTransport,
} from '@datafe-open/markdown-chart-echarts';
import { MarkdownChart } from '@datafe-open/markdown-chart-vue';
import MarkdownIt from 'markdown-it';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, type Reactive } from 'vue';
import {
  createChatBIChartContext,
  useChatBIChartMessageLifecycle,
} from './chart-context';
import { createChatBILegacySandboxTransport } from './data';

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
  vi.useRealTimers();
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

const closedFilepathChart = `\`\`\`echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv
var option = { series: [{ type: 'bar' }] };
//#end
\`\`\``;

function mixedMarkdown(legacyFence: string): string {
  return `# Mixed analysis

Visible narrative before the charts.

\`\`\`text
ordinary-code-stays
\`\`\`

${legacyFence}

Visible narrative after the charts.`;
}

const orderedUppercaseMixedMarkdown = `# List-contained chart

1. \`\`\`ECHARTS-CHATBI_QUERY_42-0
   var option = { series: [{ type: 'bar' }] };
   //#end
   \`\`\`
2. \`\`\`text
   list-nonlegacy-stays
   \`\`\`
3. list-sibling-stays

> ~~~text
> quoted-tilde-stays
> ~~~

\`\`\`echarts-chatbi_query_99-0
var option = { series: [{ type: 'line' }] };`;

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

interface ChatBIChartMessageHarnessState {
  markdown: string;
  sessionId: string;
  requestId?: string;
  streaming: boolean;
  cacheScopeKey: string;
}

function mountChatBIChartMessageLifecycle(
  state: Reactive<ChatBIChartMessageHarnessState>,
): { app: ReturnType<typeof createApp>; root: HTMLDivElement } {
  const app = createApp(defineComponent({
    setup() {
      const { chartContext, renderSource, deferredCount } = useChatBIChartMessageLifecycle({
        markdown: () => state.markdown,
        sessionId: () => state.sessionId,
        requestId: () => state.requestId,
        streaming: () => state.streaming,
        cacheScopeKey: () => state.cacheScopeKey,
      }, createChatBILegacySandboxTransport());
      return () => h('div', {
        'aria-busy': deferredCount.value > 0 ? 'true' : undefined,
        'data-chatbi-legacy-chart-pending': deferredCount.value > 0 ? 'true' : undefined,
      }, [
        h(MarkdownChart, {
            source: renderSource.value,
            streaming: state.streaming,
            markdownIt: chartContext.value.markdownIt,
            registry: chartContext.value.registry,
        }),
      ]);
    },
  }));
  const root = document.createElement('div');
  app.mount(root);
  return { app, root };
}

describe('Vue + markdown-it ChatBI message integration', () => {
  it.each([
    {
      kind: 'query',
      markdown: closedChart,
      artifactName: 'chatbi_query_42.csv',
      artifactPath: 'artifacts/chatbi_query_42.csv',
    },
    {
      kind: 'sandbox filepath',
      markdown: closedFilepathChart,
      artifactName: 'Foo.csv',
      artifactPath: 'sandbox/App/CSV/Foo.csv',
    },
  ])('keeps only a closed live $kind fence pending until requestId arrives', async ({
    markdown,
    artifactName,
    artifactPath,
  }) => {
    const source = mixedMarkdown(markdown);
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/list-agent-session-artifacts')
        ? rpcResult({
            NextToken: null,
            Artifacts: [{ ArtifactName: artifactName, ArtifactPath: artifactPath }],
          })
        : rpcResult({ ArtifactContent: 'name,value\nA,10\n' })
    ));
    vi.stubGlobal('fetch', fetcher);
    const state = reactive<{
      markdown: string;
      sessionId: string;
      requestId?: string;
      streaming: boolean;
      cacheScopeKey: string;
    }>({
      markdown: source,
      sessionId: 'session-1',
      streaming: true,
      cacheScopeKey: 'tenant-1:user-1',
    });
    const { app, root } = mountChatBIChartMessageLifecycle(state);
    await nextTick();

    expect(fetcher).not.toHaveBeenCalled();
    expect(root.querySelector('[data-chatbi-legacy-chart-pending]')).not.toBeNull();
    expect(root.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(root.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(root.textContent).not.toContain('Chart unavailable');
    expect(root.textContent).toContain('Visible narrative before the charts.');
    expect(root.textContent).toContain('ordinary-code-stays');
    expect(root.textContent).toContain('Visible narrative after the charts.');
    expect(root.textContent).toContain('Chart data is still being prepared.');
    expect(root.querySelector('pre code')?.textContent).toContain('ordinary-code-stays');

    state.requestId = 'request-1';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [10] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(root.querySelector('[data-chatbi-legacy-chart-pending]')).toBeNull();
    expect(root.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(root.textContent).toContain('Visible narrative before the charts.');
    expect(root.textContent).toContain('ordinary-code-stays');
    expect(root.textContent).toContain('Visible narrative after the charts.');
    expect(root.textContent).not.toContain('Chart data is still being prepared.');

    app.unmount();
  });

  it('defers an uppercase query fence inside an ordered list without replacing sibling blocks', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/list-agent-session-artifacts')
        ? rpcResult({
            NextToken: null,
            Artifacts: [{
              ArtifactName: 'chatbi_query_42.csv',
              ArtifactPath: 'artifacts/chatbi_query_42.csv',
            }],
          })
        : rpcResult({ ArtifactContent: 'name,value\nA,10\n' })
    ));
    vi.stubGlobal('fetch', fetcher);
    const state = reactive<ChatBIChartMessageHarnessState>({
      markdown: orderedUppercaseMixedMarkdown,
      sessionId: 'session-1',
      streaming: true,
      cacheScopeKey: 'tenant-1:user-1',
    });
    const { app, root } = mountChatBIChartMessageLifecycle(state);
    await nextTick();

    expect(fetcher).not.toHaveBeenCalled();
    expect(root.querySelector('[data-chatbi-legacy-chart-pending]')).not.toBeNull();
    expect(root.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(root.textContent).toContain('list-nonlegacy-stays');
    expect(root.textContent).toContain('list-sibling-stays');
    expect(root.textContent).toContain('quoted-tilde-stays');
    expect(root.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(root.textContent?.match(/Chart data is still being prepared\./g)).toHaveLength(1);

    state.requestId = 'request-1';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [10] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(root.querySelector('[data-chatbi-legacy-chart-pending]')).toBeNull();
    expect(root.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(root.textContent).toContain('list-nonlegacy-stays');
    expect(root.textContent).toContain('list-sibling-stays');
    expect(root.textContent).toContain('quoted-tilde-stays');
    expect(root.textContent).not.toContain('Chart data is still being prepared.');

    app.unmount();
  });

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
    const state = reactive({
      markdown: closedChart,
      sessionId: 'session-1',
      requestId: 'request-1',
      streaming: true,
      cacheScopeKey: 'tenant-1:user-1',
    });
    const { app, root } = mountChatBIChartMessageLifecycle(state);

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

    state.markdown = `${closedChart}\n\nMore streamed analysis.`;
    await nextTick();
    await vi.waitFor(() => expect(root.textContent).toContain('More streamed analysis.'));
    expect(root.querySelector('.markdown-chart-placeholder')).toBe(originalChart);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(echartsRuntime.init).toHaveBeenCalledOnce();
    expect(document.querySelector('iframe[title="Temporary chart sandbox"]')).toBeNull();

    state.sessionId = 'session-2';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [30] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(2));

    state.requestId = 'request-2';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [40] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(3));

    state.cacheScopeKey = 'tenant-1:user-2';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(8));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [50] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(4));

    state.cacheScopeKey = 'tenant-1:user-1';
    await nextTick();
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(10));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [60] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(5));

    expect(countEndpoint(fetcher, '/list-agent-session-artifacts')).toBe(5);
    expect(countEndpoint(fetcher, '/get-agent-session-artifact-meta')).toBe(5);
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
      { SessionId: 'session-2', RequestId: 'request-2' },
      { SessionId: 'session-2', RequestId: 'request-2' },
    ]);

    app.unmount();
  });

  it('aborts the old chart controller when the principal registry changes', async () => {
    let firstSignal: AbortSignal | undefined;
    const fetcher = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input);
      if (fetcher.mock.calls.length === 1) {
        firstSignal = init?.signal as AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          firstSignal?.addEventListener('abort', () => {
            reject(firstSignal?.reason ?? new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      }
      if (endpoint.endsWith('/list-agent-session-artifacts')) {
        return Promise.resolve(rpcResult({
          NextToken: null,
          Artifacts: [{
            ArtifactName: 'chatbi_query_42.csv',
            ArtifactPath: 'artifacts/chatbi_query_42.csv',
          }],
        }));
      }
      return Promise.resolve(rpcResult({ ArtifactContent: 'name,value\nA,10\n' }));
    });
    vi.stubGlobal('fetch', fetcher);
    const state = reactive({
      markdown: closedChart,
      sessionId: 'session-1',
      requestId: 'request-1',
      streaming: true,
      cacheScopeKey: 'tenant-1:user-a',
    });
    const { app, root } = mountChatBIChartMessageLifecycle(state);
    await vi.waitFor(() => expect(firstSignal).toBeDefined());

    state.cacheScopeKey = 'tenant-1:user-b';
    await nextTick();
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [20] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(root.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();

    app.unmount();
  });

  it('uses a host-created markdown-it instance and renderer registry', () => {
    const transport: LegacySandboxTransport = {
      listFiles: vi.fn(async () => []),
      readFile: vi.fn(async () => ''),
      classifyError: vi.fn<LegacySandboxTransport['classifyError']>(() => 'fatal'),
    };
    const legacySandbox = createLegacySandboxClient({ transport }).bind({
      sessionId: 'session-1',
      phase: 'final',
      cacheScopeKey: 'tenant-1:user-1',
    });
    const { registry, markdownIt } = createChatBIChartContext({ legacySandbox });
    expect(markdownIt).toBeInstanceOf(MarkdownIt);
    expect(registry).toBeInstanceOf(ChartRendererRegistry);
  });

  it('uses final session-only lookup and exposes live no-request deferral', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (
      String(input).endsWith('/list-agent-session-artifacts')
        ? rpcResult({
            NextToken: null,
            Artifacts: [{ ArtifactName: 'Foo.csv', ArtifactPath: 'App/CSV/Foo.csv' }],
          })
        : rpcResult({ ArtifactContent: 'name,value\nA,10\n' })
    ));
    const client = createLegacySandboxClient({
      transport: createChatBILegacySandboxTransport({
        fetch: fetcher as unknown as typeof fetch,
      }),
    });
    const finalBinding = client.bind({
      sessionId: 'session-1',
      requestId: 'request-is-not-sent',
      phase: 'final',
      cacheScopeKey: 'tenant-1:user-1',
    });
    await expect(finalBinding.resolveLegacySandboxFileContent({
      language: 'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
      filePath: 'App/CSV/Foo.csv',
      signal: new AbortController().signal,
    })).resolves.toContain('A,10');
    const params = (
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as {
        Params: Record<string, unknown>;
      }
    ).Params;
    expect(params).toEqual({ SessionId: 'session-1', MaxResults: 50 });

    fetcher.mockClear();
    const deferred = client.bind({
      sessionId: 'session-1',
      phase: 'live',
      cacheScopeKey: 'tenant-1:user-1',
    });
    expect(deferred.shouldDefer('echarts-chatbi_query_42-0')).toBe(true);
    expect(deferred.shouldDefer('echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv')).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
