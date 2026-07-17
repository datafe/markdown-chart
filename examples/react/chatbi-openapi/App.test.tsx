// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatBIChartMessage } from './App';

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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  document.querySelectorAll('iframe[title="Temporary chart sandbox"]').forEach((frame) => frame.remove());
});

describe('ChatBIChartMessage streaming integration', () => {
  it('does not repeat List/Get or sandbox conversion for a completed block when source grows', async () => {
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

    await act(async () => root.unmount());
  });
});
