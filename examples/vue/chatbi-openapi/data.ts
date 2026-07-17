import {
  isJsonObject,
  type JsonValue,
} from '@datafe-open/markdown-chart';
import type { ResolveLegacyArtifactContent } from '@datafe-open/markdown-chart-echarts';

interface ArtifactSummary {
  readonly ArtifactName: string;
  readonly ArtifactPath: string;
}

interface ListArtifactsResult {
  readonly NextToken?: string | null;
  readonly Artifacts?: readonly unknown[];
}

interface ArtifactMetaResult {
  readonly ArtifactContent?: unknown;
}

interface JsonRpcError {
  readonly Code?: unknown;
  readonly Message?: unknown;
}

interface JsonRpcResponse<Result> {
  readonly Result?: Result;
  readonly Error?: JsonRpcError;
}

interface OpenApiEnvelope<Result> {
  readonly JsonRpcResponse?: JsonRpcResponse<Result>;
  readonly Code?: unknown;
  readonly Message?: unknown;
}

export interface ChatBIArtifactContentResolverOptions {
  readonly sessionId: string;
  readonly requestId?: string;
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

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
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
      throw new Error(`${operation} exceeds the ${maxResponseBytes} byte response limit`);
    }
  }
  if (!response.body) {
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > maxResponseBytes) {
      throw new Error(`${operation} exceeds the ${maxResponseBytes} byte response limit`);
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
        throw new Error(`${operation} exceeds the ${maxResponseBytes} byte response limit`);
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
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Jsonrpc: '2.0', Id: String(jsonRpcId), Params: params }),
    signal,
  });
  const text = await readResponseText(response, operation, maxResponseBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new Error(`${operation} returned invalid JSON`, { cause });
  }
  if (!response.ok) {
    const detail = errorDetail(parsed);
    throw new Error(`${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  if (!isJsonObject(parsed)) {
    throw new Error(`${operation} returned an invalid JSON-RPC envelope`);
  }
  const envelope = parsed as unknown as OpenApiEnvelope<Result>;
  if (envelope.JsonRpcResponse?.Error) {
    throw new Error(
      `${operation} failed: ${errorDetail(envelope.JsonRpcResponse.Error) ?? 'JSON-RPC error'}`,
    );
  }
  if (envelope.Code !== undefined || envelope.Message !== undefined) {
    throw new Error(`${operation} failed: ${errorDetail(envelope) ?? 'OpenAPI error'}`);
  }
  if (envelope.JsonRpcResponse?.Result === undefined) {
    throw new Error(`${operation} returned no JSON-RPC result`);
  }
  return envelope.JsonRpcResponse.Result;
}

function parseArtifact(value: unknown): ArtifactSummary {
  if (
    !isJsonObject(value)
    || typeof value.ArtifactName !== 'string'
    || typeof value.ArtifactPath !== 'string'
    || !value.ArtifactPath
  ) {
    throw new Error('ListAgentSessionArtifacts returned an invalid artifact entry');
  }
  return { ArtifactName: value.ArtifactName, ArtifactPath: value.ArtifactPath };
}

async function findArtifact(
  fetcher: typeof globalThis.fetch,
  endpoint: string,
  sessionId: string,
  requestId: string | undefined,
  artifactName: string,
  signal: AbortSignal,
  maxResponseBytes: number,
): Promise<ArtifactSummary> {
  const matches: ArtifactSummary[] = [];
  const seenTokens = new Set<string>();
  let nextToken: string | undefined;
  for (let page = 0; page < MAX_ARTIFACT_PAGES; page += 1) {
    const result = await postJsonRpc<ListArtifactsResult>(
      fetcher,
      endpoint,
      {
        SessionId: sessionId,
        ...(requestId ? { RequestId: requestId } : {}),
        MaxResults: 50,
        ...(nextToken ? { NextToken: nextToken } : {}),
      },
      signal,
      'ListAgentSessionArtifacts',
      maxResponseBytes,
    );
    if (!Array.isArray(result.Artifacts)) {
      throw new Error('ListAgentSessionArtifacts returned no artifact list');
    }
    for (const value of result.Artifacts) {
      const artifact = parseArtifact(value);
      if (artifact.ArtifactName === artifactName) matches.push(artifact);
    }
    const token = typeof result.NextToken === 'string' && result.NextToken
      ? result.NextToken
      : undefined;
    if (!token) {
      nextToken = undefined;
      break;
    }
    if (seenTokens.has(token)) {
      throw new Error('ListAgentSessionArtifacts returned a repeated NextToken');
    }
    seenTokens.add(token);
    nextToken = token;
  }
  if (nextToken) {
    throw new Error(`ListAgentSessionArtifacts exceeded ${MAX_ARTIFACT_PAGES} pages`);
  }
  if (matches.length === 0) throw new Error(`Artifact ${artifactName} was not found`);
  if (matches.length > 1) {
    throw new Error(`Artifact ${artifactName} is ambiguous (${matches.length} matches)`);
  }
  return matches[0] as ArtifactSummary;
}

/** Creates the only callback a third-party host needs for the temporary format. */
export function createChatBIArtifactContentResolver(
  options: ChatBIArtifactContentResolverOptions,
): ResolveLegacyArtifactContent {
  const sessionId = requiredText(options.sessionId, 'sessionId');
  const requestId = options.requestId?.trim() || undefined;
  const fetcher = options.fetch ?? globalThis.fetch;
  const listEndpoint = options.listEndpoint ?? DEFAULT_LIST_ENDPOINT;
  const metaEndpoint = options.metaEndpoint ?? DEFAULT_META_ENDPOINT;
  const maxResponseBytes = positiveSafeInteger(
    options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    'maxResponseBytes',
  );

  return async ({ jobId, signal }) => {
    if (!/^chatbi_query_\d+$/.test(jobId)) {
      throw new Error(`Invalid ChatBI jobId: ${jobId}`);
    }
    const artifactName = `${jobId}.csv`;
    const artifact = await findArtifact(
      fetcher,
      listEndpoint,
      sessionId,
      requestId,
      artifactName,
      signal,
      maxResponseBytes,
    );
    const meta = await postJsonRpc<ArtifactMetaResult>(
      fetcher,
      metaEndpoint,
      { SessionId: sessionId, ArtifactPath: artifact.ArtifactPath },
      signal,
      'GetAgentSessionArtifactMeta',
      maxResponseBytes,
    );
    if (typeof meta.ArtifactContent !== 'string') {
      throw new Error('GetAgentSessionArtifactMeta returned no ArtifactContent');
    }
    return meta.ArtifactContent;
  };
}
