// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLegacySandboxHostAdapter } from '@datafe-open/markdown-chart-echarts';
import { ChatBIChartMessage } from './App';
import { createChatBILegacySandboxTransport } from './data';

vi.mock('@datafe-open/markdown-chart-react', async () => (
  import('../../../packages/react/src/index')
));

const echartsRuntime = vi.hoisted(() => ({
  init: vi.fn(() => ({
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('echarts', () => ({ init: echartsRuntime.init }));

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

function rpcResult(result: unknown): Response {
  return Response.json({
    RequestId: 'trace-id',
    JsonRpcResponse: { Jsonrpc: '2.0', Id: '1', Result: result },
  });
}

const closedChart = `\`\`\`echarts-chatbi_query_42-0
var option = { series: [{ type: 'bar' }] };
//#end
\`\`\``;

const closedFilepathChart = `\`\`\`echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv
var option = { series: [{ type: 'bar' }] };
//#end
\`\`\``;

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

describe('ChatBIChartMessage streaming integration', () => {
  it('renders with the required requestId and does not repeat work when source grows', async () => {
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
        return rpcResult({ ArtifactContent: 'name,value\nA,10\n' });
      }
      throw new Error(`Unexpected endpoint: ${endpoint}`);
    });
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={closedChart}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar' }] });
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(echartsRuntime.init).toHaveBeenCalledOnce();
    });
    const originalChart = container.querySelector('.markdown-chart-placeholder');

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={`${closedChart}\n\nMore streamed analysis.`}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });

    expect(container.querySelector('.markdown-chart-placeholder')).toBe(originalChart);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/dataworks/list-agent-session-artifacts',
      '/api/dataworks/get-agent-session-artifact-meta',
    ]);
    expect(echartsRuntime.init).toHaveBeenCalledOnce();

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={`${closedChart}\n\nMore streamed analysis.`}
          sessionId="session-1"
          requestId="request-2"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [20] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(2));

    const listParams = fetcher.mock.calls
      .filter(([input]) => String(input).endsWith('/list-agent-session-artifacts'))
      .map(([, init]) => (
        JSON.parse(init?.body as string) as { Params: Record<string, unknown> }
      ).Params);
    expect(listParams).toEqual([
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      { SessionId: 'session-1', RequestId: 'request-2', MaxResults: 50 },
    ]);

    await act(async () => root.unmount());
  });

  it('falls back from live request scope to session scope with exact OpenAPI params', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = String(input);
      const params = (
        JSON.parse(init?.body as string) as { Params: Record<string, unknown> }
      ).Params;
      if (endpoint.endsWith('/list-agent-session-artifacts')) {
        if (params.RequestId) {
          return Response.json({ Code: 'NotFound' }, { status: 404 });
        }
        return rpcResult({
          NextToken: null,
          Artifacts: [{
            ArtifactName: 'chatbi_query_42.csv',
            ArtifactPath: 'artifacts/chatbi_query_42.csv',
          }],
        });
      }
      return rpcResult({ ArtifactContent: 'name,value\nA,10\n' });
    });
    const hostAdapter = createLegacySandboxHostAdapter({
      transport: createChatBILegacySandboxTransport({
        fetch: fetcher as unknown as typeof fetch,
      }),
    });
    const binding = hostAdapter.bind({
      sessionId: 'session-1',
      requestId: 'request-1',
      phase: 'live',
      cacheScopeKey: 'tenant-1:user-1',
    });
    if (!binding) throw new Error('Expected a complete host context');
    const pending = binding.resolveLegacyArtifactContent({
      language: 'echarts-chatbi_query_42-0',
      jobId: 'chatbi_query_42',
      index: 0,
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(7_000);
    await expect(pending).resolves.toBe('name,value\nA,10\n');
    const listParams = fetcher.mock.calls
      .filter(([input]) => String(input).endsWith('/list-agent-session-artifacts'))
      .map(([, init]) => (
        JSON.parse(init?.body as string) as { Params: Record<string, unknown> }
      ).Params);
    expect(listParams).toEqual([
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      { SessionId: 'session-1', MaxResults: 50 },
    ]);
  });

  it('uses session-only lookup in the final phase', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => (
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
    const hostAdapter = createLegacySandboxHostAdapter({
      transport: createChatBILegacySandboxTransport({
        fetch: fetcher as unknown as typeof fetch,
      }),
    });
    const finalBinding = hostAdapter.bind({
      sessionId: 'session-1',
      requestId: 'request-ignored-in-final',
      phase: 'final',
      cacheScopeKey: 'tenant-1:user-1',
    });
    if (!finalBinding) throw new Error('Expected a complete final host context');
    await expect(finalBinding.resolveLegacyArtifactContent({
      language: 'echarts-chatbi_query_42-0',
      jobId: 'chatbi_query_42',
      index: 0,
      signal: new AbortController().signal,
    })).resolves.toBe('name,value\nA,10\n');
    const firstParams = (
      JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as {
        Params: Record<string, unknown>;
      }
    ).Params;
    expect(firstParams).toEqual({ SessionId: 'session-1', MaxResults: 50 });
  });

  it('creates a fresh principal client for A -> B -> A and resolves the filepath each time', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).endsWith('/list-agent-session-artifacts')
        ? rpcResult({
            NextToken: null,
            Artifacts: [{
              ArtifactName: 'Foo.csv',
              ArtifactPath: 'sandbox/App/CSV/Foo.csv',
            }],
          })
        : rpcResult({ ArtifactContent: 'name,value\nA,10\n' })
    ));
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div');
    const root = createRoot(container);
    const renderScope = async (cacheScopeKey: string): Promise<void> => {
      await act(async () => {
        root.render(
          <ChatBIChartMessage
            markdown={closedFilepathChart}
            sessionId="session-1"
            requestId="request-1"
            streaming
            cacheScopeKey={cacheScopeKey}
          />,
        );
      });
    };

    await renderScope('tenant-1:user-a');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [10] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(1));

    await renderScope('tenant-1:user-b');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [20] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(2));

    await renderScope('tenant-1:user-a');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(6));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [30] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledTimes(3));

    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/dataworks/list-agent-session-artifacts',
      '/api/dataworks/get-agent-session-artifact-meta',
      '/api/dataworks/list-agent-session-artifacts',
      '/api/dataworks/get-agent-session-artifact-meta',
      '/api/dataworks/list-agent-session-artifacts',
      '/api/dataworks/get-agent-session-artifact-meta',
    ]);
    await act(async () => root.unmount());
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
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={closedChart}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-a"
        />,
      );
    });
    await vi.waitFor(() => expect(firstSignal).toBeDefined());

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={closedChart}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-b"
        />,
      );
    });
    await vi.waitFor(() => expect(firstSignal?.aborted).toBe(true));
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [20] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(container.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();

    await act(async () => root.unmount());
  });
});
