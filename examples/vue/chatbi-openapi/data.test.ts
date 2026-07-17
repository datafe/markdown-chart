import { describe, expect, it, vi } from 'vitest';
import { createChatBIArtifactContentResolver } from './data';

function rpcResult(result: unknown): Response {
  return Response.json({
    RequestId: 'trace-id',
    JsonRpcResponse: { Jsonrpc: '2.0', Id: '1', Result: result },
  });
}

function request(signal = new AbortController().signal) {
  return {
    language: 'echarts-chatbi_query_42-0',
    jobId: 'chatbi_query_42',
    index: 0,
    signal,
  };
}

describe('Vue ChatBI OpenAPI ArtifactContent integration', () => {
  it('paginates List, selects the exact artifact, then returns raw Get meta content', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rpcResult({
        NextToken: 'page-2',
        Artifacts: [{ ArtifactName: 'other.csv', ArtifactPath: 'artifacts/other.csv' }],
      }))
      .mockResolvedValueOnce(rpcResult({
        NextToken: null,
        Artifacts: [{
          ArtifactName: 'chatbi_query_42.csv',
          ArtifactPath: 'artifacts/chatbi_query_42.csv',
        }],
      }))
      .mockResolvedValueOnce(rpcResult({ ArtifactContent: 'category,value\nA,10\n' }));
    const resolver = createChatBIArtifactContentResolver({
      sessionId: 'session-1',
      requestId: 'request-1',
      fetch: fetcher as unknown as typeof fetch,
    });

    await expect(resolver(request())).resolves.toBe('category,value\nA,10\n');
    const first = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    const second = JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    const meta = JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    expect(first.Params).toEqual({
      SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50,
    });
    expect(second.Params).toEqual({
      SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50, NextToken: 'page-2',
    });
    expect(meta.Params).toEqual({
      SessionId: 'session-1', ArtifactPath: 'artifacts/chatbi_query_42.csv',
    });
  });

  it('reports proxy and artifact response errors', async () => {
    const failed = createChatBIArtifactContentResolver({
      sessionId: 'session-1',
      fetch: vi.fn().mockResolvedValue(Response.json({
        Code: 'Forbidden',
        Message: 'denied',
      }, { status: 403 })) as unknown as typeof fetch,
    });
    await expect(failed(request())).rejects.toThrow(
      'ListAgentSessionArtifacts failed with HTTP 403: Forbidden: denied',
    );

    const invalidMetaFetch = vi.fn()
      .mockResolvedValueOnce(rpcResult({
        NextToken: null,
        Artifacts: [{ ArtifactName: 'chatbi_query_42.csv', ArtifactPath: 'a.csv' }],
      }))
      .mockResolvedValueOnce(rpcResult({ ArtifactContent: null }));
    const invalidMeta = createChatBIArtifactContentResolver({
      sessionId: 'session-1',
      fetch: invalidMetaFetch as unknown as typeof fetch,
    });
    await expect(invalidMeta(request())).rejects.toThrow('returned no ArtifactContent');
  });

  it('passes AbortSignal through and bounds each proxy response', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    ));
    const resolver = createChatBIArtifactContentResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const pending = resolver(request(controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    const oversized = createChatBIArtifactContentResolver({
      sessionId: 'session-1',
      maxResponseBytes: 128,
      fetch: vi.fn().mockResolvedValue(new Response('{}', {
        headers: { 'Content-Length': '1024' },
      })) as unknown as typeof fetch,
    });
    await expect(oversized(request())).rejects.toThrow('exceeds the 128 byte response limit');
  });
});
