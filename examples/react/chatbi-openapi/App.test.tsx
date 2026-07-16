// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatBIChartMessage } from './App';

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('ChatBIChartMessage streaming integration', () => {
  it('does not repeat List/Get/execute for a completed block when source grows', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
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
      if (endpoint.endsWith('/chart/execute')) {
        return Response.json({ spec: { series: [{ type: 'bar' }] } });
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
        />,
      );
    });
    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(3);
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
        />,
      );
    });

    expect(container.querySelector('.markdown-chart-placeholder')).toBe(originalChart);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([input]) => String(input))).toEqual([
      '/api/dataworks/list-agent-session-artifacts',
      '/api/dataworks/get-agent-session-artifact-meta',
      '/api/chart/execute',
    ]);
    expect(echartsRuntime.init).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
  });
});
