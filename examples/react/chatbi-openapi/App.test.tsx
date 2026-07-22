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

function mixedMarkdown(legacyFence: string): string {
  return `# Mixed analysis

Visible narrative before the charts.

\`\`\`text
ordinary-code-stays
\`\`\`

${legacyFence}

Visible narrative after the charts.`;
}

const bulletUppercaseMixedMarkdown = `# List-contained chart

- \`\`\`ECHARTS-CHATBI_QUERY_42-0
  var option = { series: [{ type: 'bar' }] };
  //#end
  \`\`\`
- \`\`\`text
  list-nonlegacy-stays
  \`\`\`
- list-sibling-stays

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

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

describe('ChatBIChartMessage streaming integration', () => {
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
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={source}
          sessionId="session-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('[data-chatbi-legacy-chart-pending]')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(container.textContent).not.toContain('Chart unavailable');
    expect(container.textContent).toContain('Visible narrative before the charts.');
    expect(container.textContent).toContain('ordinary-code-stays');
    expect(container.textContent).toContain('Visible narrative after the charts.');
    expect(container.textContent).toContain('Chart data is still being prepared.');
    expect(container.querySelector('pre code')?.textContent).toContain('ordinary-code-stays');

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={source}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [10] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-chatbi-legacy-chart-pending]')).toBeNull();
    expect(container.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(container.textContent).toContain('Visible narrative before the charts.');
    expect(container.textContent).toContain('ordinary-code-stays');
    expect(container.textContent).toContain('Visible narrative after the charts.');
    expect(container.textContent).not.toContain('Chart data is still being prepared.');

    await act(async () => root.unmount());
  });

  it('does not defer ordinary markdown while a live requestId is absent', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown="# Narrative only"
          sessionId="session-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });

    expect(container.textContent).toContain('Narrative only');
    expect(container.querySelector('[data-chatbi-legacy-chart-pending]')).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('defers an uppercase query fence inside a bullet list without replacing sibling blocks', async () => {
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
    const container = document.createElement('div');
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={bulletUppercaseMixedMarkdown}
          sessionId="session-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });

    expect(fetcher).not.toHaveBeenCalled();
    expect(container.querySelector('[data-chatbi-legacy-chart-pending]')).not.toBeNull();
    expect(container.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(container.textContent).toContain('list-nonlegacy-stays');
    expect(container.textContent).toContain('list-sibling-stays');
    expect(container.textContent).toContain('quoted-tilde-stays');
    expect(container.querySelectorAll('li').length).toBeGreaterThanOrEqual(3);
    expect(container.textContent?.match(/Chart data is still being prepared\./g)).toHaveLength(1);

    await act(async () => {
      root.render(
        <ChatBIChartMessage
          markdown={bulletUppercaseMixedMarkdown}
          sessionId="session-1"
          requestId="request-1"
          streaming
          cacheScopeKey="tenant-1:user-1"
        />,
      );
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    await answerLegacySandbox({ series: [{ type: 'bar', data: [10] }] });
    await vi.waitFor(() => expect(echartsRuntime.init).toHaveBeenCalledOnce());
    expect(container.querySelector('[data-chatbi-legacy-chart-pending]')).toBeNull();
    expect(container.querySelector('.markdown-chart-error, [role="alert"]')).toBeNull();
    expect(container.textContent).toContain('list-nonlegacy-stays');
    expect(container.textContent).toContain('list-sibling-stays');
    expect(container.textContent).toContain('quoted-tilde-stays');
    expect(container.textContent).not.toContain('Chart data is still being prepared.');

    await act(async () => root.unmount());
  });

  it('does not repeat List/Get or sandbox conversion for a completed block when source grows', async () => {
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

  it('uses session-only final lookup and defers live legacy blocks without a request', async () => {
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

    fetcher.mockClear();
    const liveWithoutRequest = hostAdapter.bind({
      sessionId: 'session-1',
      phase: 'live',
      cacheScopeKey: 'tenant-1:user-1',
    });
    if (!liveWithoutRequest) throw new Error('Expected a complete live host context');
    expect(liveWithoutRequest.shouldDefer('echarts-chatbi_query_42-0')).toBe(true);
    expect(liveWithoutRequest.shouldDefer(
      'echarts-chatbi_sandbox_filepath_App/CSV/Foo.csv',
    )).toBe(true);
    await expect(liveWithoutRequest.resolveLegacyArtifactContent({
      language: 'echarts-chatbi_query_42-0',
      jobId: 'chatbi_query_42',
      index: 0,
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ code: 'LEGACY_SANDBOX_NOT_FOUND' });
    expect(fetcher).not.toHaveBeenCalled();
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
