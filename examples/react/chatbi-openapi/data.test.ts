import { describe, expect, it, vi } from 'vitest';
import type { LegacySandboxFile } from '@datafe-open/markdown-chart-echarts';
import { createChatBILegacySandboxTransport } from './data';

function rpcResult(result: unknown): Response {
  return Response.json({
    RequestId: 'trace-id',
    JsonRpcResponse: { Jsonrpc: '2.0', Id: '1', Result: result },
  });
}

function listInput(signal = new AbortController().signal) {
  return { sessionId: 'session-1', requestId: 'request-1', signal };
}

const csvFile: LegacySandboxFile = {
  fileName: 'chatbi_query_42.csv',
  filePath: 'artifacts/chatbi_query_42.csv',
  originalFilePath: 'artifacts/chatbi_query_42.csv',
  fileType: 'csv',
};

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => { throw new Error('Expected the operation to reject'); },
    (error: unknown) => error,
  );
}

describe('React ChatBI OpenAPI legacy sandbox transport', () => {
  it('returns every paginated descriptor and reads raw artifact content', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(rpcResult({
        NextToken: 'page-2',
        Artifacts: [
          { ArtifactName: 'notes.txt', ArtifactPath: 'artifacts/notes.txt' },
          { ArtifactName: 'missing-path.csv' },
        ],
      }))
      .mockResolvedValueOnce(rpcResult({
        NextToken: null,
        Artifacts: [{
          ArtifactName: 'chatbi_query_42.csv',
          ArtifactPath: 'artifacts/chatbi_query_42.csv',
        }],
      }))
      .mockResolvedValueOnce(rpcResult({ ArtifactContent: 'category,value\nA,10\n' }));
    const transport = createChatBILegacySandboxTransport({
      fetch: fetcher as unknown as typeof fetch,
    });

    const files = await transport.listFiles(listInput());
    expect(files).toEqual([
      {
        fileName: 'notes.txt',
        filePath: 'artifacts/notes.txt',
        originalFilePath: 'artifacts/notes.txt',
        fileType: '',
      },
      {
        fileName: 'missing-path.csv',
        filePath: '',
        originalFilePath: '',
        fileType: 'csv',
      },
      csvFile,
    ]);
    await expect(transport.readFile({
      sessionId: 'session-1',
      file: files[2] as LegacySandboxFile,
      signal: new AbortController().signal,
    })).resolves.toBe('category,value\nA,10\n');

    const params = fetcher.mock.calls.map(([, init]) => (
      JSON.parse(init?.body as string) as { Params: Record<string, unknown> }
    ).Params);
    expect(params).toEqual([
      { SessionId: 'session-1', RequestId: 'request-1', MaxResults: 50 },
      {
        SessionId: 'session-1',
        RequestId: 'request-1',
        MaxResults: 50,
        NextToken: 'page-2',
      },
      { SessionId: 'session-1', ArtifactPath: 'artifacts/chatbi_query_42.csv' },
    ]);
  });

  it.each([
    [404, 'not-found'],
    [408, 'retryable'],
    [425, 'retryable'],
    [429, 'retryable'],
    [503, 'retryable'],
    [400, 'fatal'],
    [401, 'fatal'],
    [403, 'fatal'],
  ] as const)('classifies HTTP %i as %s', async (status, kind) => {
    const transport = createChatBILegacySandboxTransport({
      fetch: vi.fn().mockResolvedValue(Response.json({
        Code: 'OpenApiFailure',
        Message: 'request failed',
      }, { status })) as unknown as typeof fetch,
    });
    const error = await rejected(transport.listFiles(listInput()));
    expect(transport.classifyError(error, 'list')).toBe(kind);
  });

  it('classifies network failures as retryable and invalid envelopes/content as fatal', async () => {
    const networkTransport = createChatBILegacySandboxTransport({
      fetch: vi.fn().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch,
    });
    const networkError = await rejected(networkTransport.listFiles(listInput()));
    expect(networkTransport.classifyError(networkError, 'list')).toBe('retryable');

    const readFailureTransport = createChatBILegacySandboxTransport({
      fetch: vi.fn().mockResolvedValue(new Response(new ReadableStream({
        start(controller) {
          controller.error(new Error('response read failed'));
        },
      }))) as unknown as typeof fetch,
    });
    const readError = await rejected(readFailureTransport.listFiles(listInput()));
    expect(readFailureTransport.classifyError(readError, 'list')).toBe('retryable');

    const invalidEnvelope = createChatBILegacySandboxTransport({
      fetch: vi.fn().mockResolvedValue(Response.json({ unexpected: true })) as unknown as typeof fetch,
    });
    const envelopeError = await rejected(invalidEnvelope.listFiles(listInput()));
    expect(invalidEnvelope.classifyError(envelopeError, 'list')).toBe('fatal');

    const invalidContent = createChatBILegacySandboxTransport({
      fetch: vi.fn().mockResolvedValue(rpcResult({ ArtifactContent: null })) as unknown as typeof fetch,
    });
    const contentError = await rejected(invalidContent.readFile({
      sessionId: 'session-1',
      file: csvFile,
      signal: new AbortController().signal,
    }));
    expect(invalidContent.classifyError(contentError, 'read')).toBe('fatal');
  });

  it('passes AbortSignal through unchanged and keeps the response-size boundary', async () => {
    const fetcher = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        }, { once: true });
      })
    ));
    const transport = createChatBILegacySandboxTransport({
      fetch: fetcher as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const pending = transport.listFiles(listInput(controller.signal));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBe(controller.signal);

    const oversized = createChatBILegacySandboxTransport({
      maxResponseBytes: 128,
      fetch: vi.fn().mockResolvedValue(new Response('{}', {
        headers: { 'Content-Length': '1024' },
      })) as unknown as typeof fetch,
    });
    const sizeError = await rejected(oversized.listFiles(listInput()));
    expect(sizeError).toEqual(expect.objectContaining({
      message: 'ListAgentSessionArtifacts exceeds the 128 byte response limit',
    }));
    expect(oversized.classifyError(sizeError, 'list')).toBe('fatal');
  });
});
