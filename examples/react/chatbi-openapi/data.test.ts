import { describe, expect, it, vi } from 'vitest';
import type { ResolveDataRef } from '@datafe/markdown-chart-echarts';
import {
  createChatBIArtifactDataRefResolver,
  createChatBILegacyResolver,
  createExecuteChartSource,
} from './data';

function rpcResult(result: unknown): Response {
  return Response.json({
    RequestId: 'trace-id',
    JsonRpcResponse: { Jsonrpc: '2.0', Id: '1', Result: result },
  });
}

function context(signal: AbortSignal) {
  return { format: 'csv' as const, dimensions: undefined, signal };
}

function artifactFetch(content: string) {
  return vi.fn()
    .mockResolvedValueOnce(rpcResult({
      NextToken: null,
      Artifacts: [{
        ArtifactName: 'chatbi_query_42.csv',
        ArtifactPath: 'artifacts/chatbi_query_42.csv',
      }],
    }))
    .mockResolvedValueOnce(rpcResult({ ArtifactContent: content }));
}

describe('ChatBI OpenAPI data integration', () => {
  it('paginates the list API, finds an exact artifact, gets its content, and parses CSV', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rpcResult({
        NextToken: 'page-2',
        Artifacts: [{
          ArtifactName: 'other.csv',
          ArtifactPath: 'artifacts/other.csv',
        }],
      }))
      .mockResolvedValueOnce(rpcResult({
        NextToken: null,
        Artifacts: [{
          ArtifactName: 'chatbi_query_42.csv',
          ArtifactPath: 'artifacts/chatbi_query_42.csv',
        }],
      }))
      .mockResolvedValueOnce(rpcResult({
        ArtifactContent: 'category,value\nA,10\nB,20\n',
      }));
    const resolveDataRef = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      requestId: 'request-1',
      fetch: fetcher as unknown as typeof fetch,
    });

    const result = await resolveDataRef('chatbi_query_42.csv', context(new AbortController().signal));

    expect(result).toEqual({
      dimensions: ['category', 'value'],
      source: [
        { category: 'A', value: 10 },
        { category: 'B', value: 20 },
      ],
    });
    const firstListBody = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    const secondListBody = JSON.parse(fetcher.mock.calls[1]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    const metaBody = JSON.parse(fetcher.mock.calls[2]?.[1]?.body as string) as {
      Params: Record<string, unknown>;
    };
    expect(firstListBody.Params).toEqual({
      SessionId: 'session-1',
      RequestId: 'request-1',
      MaxResults: 50,
    });
    expect(secondListBody.Params).toEqual({
      SessionId: 'session-1',
      RequestId: 'request-1',
      MaxResults: 50,
      NextToken: 'page-2',
    });
    expect(metaBody.Params).toEqual({
      SessionId: 'session-1',
      ArtifactPath: 'artifacts/chatbi_query_42.csv',
    });
  });

  it('rejects empty and duplicate exact artifact matches', async () => {
    const emptyFetch = vi.fn().mockResolvedValue(rpcResult({ Artifacts: [], NextToken: null }));
    const emptyResolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: emptyFetch as unknown as typeof fetch,
    });
    await expect(emptyResolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('was not found');

    const duplicateFetch = vi.fn().mockResolvedValue(rpcResult({
      Artifacts: [
        { ArtifactName: 'chatbi_query_42.csv', ArtifactPath: 'first.csv' },
        { ArtifactName: 'chatbi_query_42.csv', ArtifactPath: 'second.csv' },
      ],
      NextToken: null,
    }));
    const duplicateResolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: duplicateFetch as unknown as typeof fetch,
    });
    await expect(duplicateResolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('ambiguous (2 matches)');
    expect(duplicateFetch).toHaveBeenCalledOnce();
  });

  it('surfaces HTTP and JSON-RPC errors instead of accepting partial data', async () => {
    const httpFetch = vi.fn().mockResolvedValue(Response.json(
      { Code: 'Forbidden', Message: 'denied' },
      { status: 403 },
    ));
    const httpResolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: httpFetch as unknown as typeof fetch,
    });
    await expect(httpResolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('HTTP 403: Forbidden: denied');

    const rpcFetch = vi.fn().mockResolvedValue(Response.json({
      JsonRpcResponse: {
        Jsonrpc: '2.0',
        Id: '1',
        Error: { Code: 'InvalidParameter', Message: 'bad session' },
      },
    }));
    const rpcResolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: rpcFetch as unknown as typeof fetch,
    });
    await expect(rpcResolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('InvalidParameter: bad session');
  });

  it('passes AbortSignal through to the same-origin proxy request', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    ));
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
    });
    const abortController = new AbortController();
    const pending = resolver('chatbi_query_42.csv', context(abortController.signal));
    abortController.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(abortController.signal);
  });

  it('stops reading an oversized proxy response before parsing JSON', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', {
      headers: { 'Content-Length': '1024' },
    }));
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
      limits: { maxResponseBytes: 128 },
    });

    await expect(resolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('exceeds the 128 byte response limit');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects oversized ArtifactContent before parsing CSV', async () => {
    const fetcher = artifactFetch('name,value\nA,10\n');
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
      limits: { maxArtifactContentBytes: 8 },
    });

    await expect(resolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('ArtifactContent exceeds the 8 byte limit');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('uses a bounded CSV preview and rejects rows beyond the configured limit', async () => {
    const fetcher = artifactFetch('name,value\nA,10\nB,20\nC,30\nD,40\n');
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
      limits: { maxRows: 2 },
    });

    await expect(resolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('exceeds the 2 row limit');
  });

  it('rejects CSV columns beyond the configured limit', async () => {
    const fetcher = artifactFetch('a,b,c\n1,2,3\n');
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
      limits: { maxColumns: 2 },
    });

    await expect(resolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('exceeds the 2 column limit');
  });

  it('rejects CSV cells before normalizing every row', async () => {
    const fetcher = artifactFetch('a,b\n1,2\n3,4\n');
    const resolver = createChatBIArtifactDataRefResolver({
      sessionId: 'session-1',
      fetch: fetcher as unknown as typeof fetch,
      limits: { maxCells: 3 },
    });

    await expect(resolver('chatbi_query_42.csv', context(new AbortController().signal)))
      .rejects.toThrow('exceeds the 3 cell limit');
  });

  it('combines resolveDataRef with the isolated executor into legacy data and spec', async () => {
    const signal = new AbortController().signal;
    const resolveDataRef = vi.fn<ResolveDataRef>(async () => ({
      dimensions: ['category', 'value'],
      source: [{ category: 'A', value: 10 }],
    }));
    const executorFetch = vi.fn().mockResolvedValue(Response.json({
      spec: {
        xAxis: { type: 'category' },
        yAxis: {},
        series: [{ type: 'bar' }],
      },
    }));
    const resolver = createChatBILegacyResolver({
      resolveDataRef,
      executeChartSource: createExecuteChartSource({
        fetch: executorFetch as unknown as typeof fetch,
      }),
    });

    const result = await resolver({
      language: 'temporary-language',
      jobId: 'chatbi_query_42',
      index: 0,
      source: 'var option = build(inputData);',
      signal,
    });

    expect(resolveDataRef).toHaveBeenCalledWith('chatbi_query_42.csv', {
      format: 'csv',
      dimensions: undefined,
      signal,
    });
    const executeBody = JSON.parse(executorFetch.mock.calls[0]?.[1]?.body as string) as unknown;
    expect(executeBody).toEqual({
      source: 'var option = build(inputData);',
      inputData: [{ category: 'A', value: 10 }],
    });
    expect(result).toEqual({
      data: {
        kind: 'inline',
        dimensions: ['category', 'value'],
        source: [{ category: 'A', value: 10 }],
      },
      spec: {
        xAxis: { type: 'category' },
        yAxis: {},
        series: [{ type: 'bar' }],
      },
    });
  });
});
