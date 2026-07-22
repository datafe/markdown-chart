import {
  isJsonObject,
  type JsonValue,
} from '@datafe-open/markdown-chart';
import {
  createLegacySandboxErrorClassifier,
  type LegacySandboxFailureKind,
  type LegacySandboxFile,
  type LegacySandboxTransport,
} from '@datafe-open/markdown-chart-echarts';

interface ListArtifactsResult {
  readonly NextToken?: unknown;
  readonly Artifacts?: unknown;
}

interface ArtifactMetaResult {
  readonly ArtifactContent?: unknown;
}

export interface ChatBILegacySandboxTransportOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly listEndpoint?: string;
  readonly metaEndpoint?: string;
  /** Maximum UTF-8 bytes read from one same-origin proxy response. */
  readonly maxResponseBytes?: number;
}

const DEFAULT_LIST_ENDPOINT = '/api/dataworks/list-agent-session-artifacts';
const DEFAULT_META_ENDPOINT = '/api/dataworks/get-agent-session-artifact-meta';
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_ARTIFACT_PAGES = 100;
let jsonRpcId = 0;

class OpenApiTransportError extends Error {
  readonly kind: LegacySandboxFailureKind | undefined;
  readonly status: number | undefined;

  constructor(
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly kind?: LegacySandboxFailureKind;
      readonly status?: number;
    },
  ) {
    super(message, options && 'cause' in options ? { cause: options.cause } : undefined);
    this.name = 'OpenApiTransportError';
    this.kind = options?.kind;
    this.status = options?.status;
  }
}

function failure(
  kind: LegacySandboxFailureKind,
  message: string,
  cause?: unknown,
): OpenApiTransportError {
  return new OpenApiTransportError(message, {
    kind,
    ...(cause === undefined ? {} : { cause }),
  });
}

function httpFailure(status: number, message: string): OpenApiTransportError {
  return new OpenApiTransportError(message, { status });
}

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw failure('fatal', `${label} is required`);
  return normalized;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw failure('fatal', `${label} must be a positive safe integer`);
  }
  return value;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorDetail(value: unknown): string | undefined {
  if (!isJsonObject(value)) return undefined;
  const code = typeof value.Code === 'string' ? value.Code : undefined;
  const message = typeof value.Message === 'string' ? value.Message : undefined;
  return [code, message].filter(Boolean).join(': ') || undefined;
}

async function readResponseText(
  response: Response,
  operation: string,
  maxResponseBytes: number,
): Promise<string> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxResponseBytes) {
      throw failure('fatal', `${operation} exceeds the ${maxResponseBytes} byte response limit`);
    }
  }
  if (!response.body) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
      throw failure('fatal', `${operation} exceeds the ${maxResponseBytes} byte response limit`);
    }
    return body;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let body = '';
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        body += decoder.decode();
        return body;
      }
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > maxResponseBytes) {
        await reader.cancel();
        throw failure('fatal', `${operation} exceeds the ${maxResponseBytes} byte response limit`);
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function postJsonRpc<Result>(
  fetcher: typeof globalThis.fetch,
  endpoint: string,
  params: Record<string, JsonValue>,
  signal: AbortSignal,
  operation: string,
  maxResponseBytes: number,
): Promise<Result> {
  jsonRpcId += 1;
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Jsonrpc: '2.0', Id: String(jsonRpcId), Params: params }),
      signal,
    });
  } catch (cause) {
    if (signal.aborted) throw signal.reason ?? cause;
    if (isAbortError(cause)) throw cause;
    throw failure('retryable', `${operation} could not reach the OpenAPI proxy`, cause);
  }

  let text: string;
  try {
    text = await readResponseText(response, operation, maxResponseBytes);
  } catch (cause) {
    if (signal.aborted) throw signal.reason ?? cause;
    if (isAbortError(cause) || cause instanceof OpenApiTransportError) throw cause;
    throw failure('retryable', `${operation} could not read the OpenAPI proxy response`, cause);
  }

  if (!response.ok) {
    let parsedError: unknown;
    try {
      parsedError = JSON.parse(text) as unknown;
    } catch {
      parsedError = undefined;
    }
    const detail = errorDetail(parsedError);
    throw httpFailure(
      response.status,
      `${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw failure('fatal', `${operation} returned invalid JSON`, cause);
  }
  if (!isJsonObject(parsed)) {
    throw failure('fatal', `${operation} returned an invalid JSON-RPC envelope`);
  }
  if (parsed.Code !== undefined || parsed.Message !== undefined) {
    throw failure('fatal', `${operation} failed: ${errorDetail(parsed) ?? 'OpenAPI error'}`);
  }
  const jsonRpcResponse = parsed.JsonRpcResponse;
  if (!isJsonObject(jsonRpcResponse)) {
    throw failure('fatal', `${operation} returned an invalid JSON-RPC envelope`);
  }
  if (jsonRpcResponse.Error !== undefined && jsonRpcResponse.Error !== null) {
    throw failure(
      'fatal',
      `${operation} failed: ${errorDetail(jsonRpcResponse.Error) ?? 'JSON-RPC error'}`,
    );
  }
  if (!Object.prototype.hasOwnProperty.call(jsonRpcResponse, 'Result')) {
    throw failure('fatal', `${operation} returned no JSON-RPC result`);
  }
  return jsonRpcResponse.Result as Result;
}

function mapArtifact(value: unknown): LegacySandboxFile {
  const artifactName = isJsonObject(value) && typeof value.ArtifactName === 'string'
    ? value.ArtifactName
    : '';
  const artifactPath = isJsonObject(value) && typeof value.ArtifactPath === 'string'
    ? value.ArtifactPath
    : '';
  const isCsv = artifactName.trim().toLowerCase().endsWith('.csv')
    || artifactPath.trim().toLowerCase().endsWith('.csv');
  return {
    fileName: artifactName,
    filePath: artifactPath,
    originalFilePath: artifactPath,
    fileType: isCsv ? 'csv' : '',
  };
}

/** Creates the host-owned OpenAPI list/read adapter used by the shared client. */
export function createChatBILegacySandboxTransport(
  options: ChatBILegacySandboxTransportOptions = {},
): LegacySandboxTransport {
  const fetcher = options.fetch ?? globalThis.fetch;
  const listEndpoint = options.listEndpoint ?? DEFAULT_LIST_ENDPOINT;
  const metaEndpoint = options.metaEndpoint ?? DEFAULT_META_ENDPOINT;
  const maxResponseBytes = positiveSafeInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  );
  const classifyError = createLegacySandboxErrorClassifier({
    getFailureKind: (error) => (
      error instanceof OpenApiTransportError ? error.kind : undefined
    ),
    getStatus: (error) => (
      error instanceof OpenApiTransportError ? error.status : undefined
    ),
  });

  return {
    async listFiles({ sessionId, requestId, signal }) {
      const normalizedSessionId = requiredText(sessionId, 'sessionId');
      const normalizedRequestId = requestId?.trim() || undefined;
      const files: LegacySandboxFile[] = [];
      const seenTokens = new Set<string>();
      let nextToken: string | undefined;
      for (let page = 0; page < MAX_ARTIFACT_PAGES; page += 1) {
        const result = await postJsonRpc<ListArtifactsResult>(
          fetcher,
          listEndpoint,
          {
            SessionId: normalizedSessionId,
            ...(normalizedRequestId ? { RequestId: normalizedRequestId } : {}),
            MaxResults: 50,
            ...(nextToken ? { NextToken: nextToken } : {}),
          },
          signal,
          'ListAgentSessionArtifacts',
          maxResponseBytes,
        );
        if (!isJsonObject(result) || !Array.isArray(result.Artifacts)) {
          throw failure('fatal', 'ListAgentSessionArtifacts returned no artifact list');
        }
        files.push(...result.Artifacts.map(mapArtifact));
        const token = result.NextToken;
        if (token === undefined || token === null || token === '') {
          nextToken = undefined;
          break;
        }
        if (typeof token !== 'string') {
          throw failure('fatal', 'ListAgentSessionArtifacts returned an invalid NextToken');
        }
        if (seenTokens.has(token)) {
          throw failure('fatal', 'ListAgentSessionArtifacts returned a repeated NextToken');
        }
        seenTokens.add(token);
        nextToken = token;
      }
      if (nextToken) {
        throw failure('fatal', `ListAgentSessionArtifacts exceeded ${MAX_ARTIFACT_PAGES} pages`);
      }
      return files;
    },

    async readFile({ sessionId, file, signal }) {
      const normalizedSessionId = requiredText(sessionId, 'sessionId');
      const artifactPath = requiredText(file.originalFilePath, 'file.originalFilePath');
      const meta = await postJsonRpc<ArtifactMetaResult>(
        fetcher,
        metaEndpoint,
        { SessionId: normalizedSessionId, ArtifactPath: artifactPath },
        signal,
        'GetAgentSessionArtifactMeta',
        maxResponseBytes,
      );
      if (!isJsonObject(meta) || typeof meta.ArtifactContent !== 'string') {
        throw failure('fatal', 'GetAgentSessionArtifactMeta returned no ArtifactContent');
      }
      return meta.ArtifactContent;
    },

    classifyError,
  };
}
