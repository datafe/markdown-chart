import Papa from 'papaparse';
import {
  isJsonObject,
  validateChartJsonValue,
  type JsonValue,
} from '@datafe/markdown-chart';
import type {
  DatasetRow,
  ResolveDataRef,
  ResolveLegacyEChartQuery,
  ResolvedDataset,
} from '@datafe/markdown-chart-echarts';
import { DEFAULT_ECHARTS_LIMITS } from '@datafe/markdown-chart-echarts';

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
  readonly RequestId?: unknown;
  readonly JsonRpcResponse?: JsonRpcResponse<Result>;
  readonly Code?: unknown;
  readonly Message?: unknown;
}

export interface ChatBIArtifactResolverOptions {
  readonly sessionId: string;
  readonly requestId?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly listEndpoint?: string;
  readonly metaEndpoint?: string;
  readonly limits?: Partial<ChatBIArtifactResolverLimits>;
}

export interface ChatBIArtifactResolverLimits {
  /** Maximum UTF-8 bytes read from any one same-origin proxy response. */
  readonly maxResponseBytes: number;
  /** Maximum UTF-8 bytes accepted from ArtifactContent before CSV parsing. */
  readonly maxArtifactContentBytes: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCells: number;
}

export interface ExecuteChartSourceRequest {
  readonly source: string;
  readonly inputData: readonly DatasetRow[];
  readonly signal: AbortSignal;
}

export type ExecuteChartSource = (
  request: ExecuteChartSourceRequest,
) => Promise<Record<string, JsonValue>>;

export interface ExecuteChartSourceOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly endpoint?: string;
  readonly maxResponseBytes?: number;
}

const DEFAULT_LIST_ENDPOINT = '/api/dataworks/list-agent-session-artifacts';
const DEFAULT_META_ENDPOINT = '/api/dataworks/get-agent-session-artifact-meta';
const DEFAULT_EXECUTE_ENDPOINT = '/api/chart/execute';
const MAX_ARTIFACT_PAGES = 100;
const DEFAULT_PROXY_RESPONSE_BYTES = 8 * 1024 * 1024;
export const DEFAULT_CHATBI_ARTIFACT_LIMITS: Readonly<ChatBIArtifactResolverLimits> = Object.freeze({
  maxResponseBytes: DEFAULT_PROXY_RESPONSE_BYTES,
  maxArtifactContentBytes: 5 * 1024 * 1024,
  maxRows: DEFAULT_ECHARTS_LIMITS.maxRows,
  maxColumns: 200,
  maxCells: DEFAULT_ECHARTS_LIMITS.maxCells,
});
let jsonRpcId = 0;

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`${label} is required`);
  }
  return normalized;
}

function errorDetail(value: unknown): string | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }
  const code = typeof value.Code === 'string' ? value.Code : undefined;
  const message = typeof value.Message === 'string' ? value.Message : undefined;
  return [code, message].filter(Boolean).join(': ') || undefined;
}

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function artifactLimits(
  overrides: Partial<ChatBIArtifactResolverLimits> | undefined,
): ChatBIArtifactResolverLimits {
  const merged = { ...DEFAULT_CHATBI_ARTIFACT_LIMITS, ...overrides };
  return {
    maxResponseBytes: positiveSafeInteger(merged.maxResponseBytes, 'limits.maxResponseBytes'),
    maxArtifactContentBytes: positiveSafeInteger(
      merged.maxArtifactContentBytes,
      'limits.maxArtifactContentBytes',
    ),
    maxRows: positiveSafeInteger(merged.maxRows, 'limits.maxRows'),
    maxColumns: positiveSafeInteger(merged.maxColumns, 'limits.maxColumns'),
    maxCells: positiveSafeInteger(merged.maxCells, 'limits.maxCells'),
  };
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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
    if (utf8ByteLength(body) > maxResponseBytes) {
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

async function readJson(
  response: Response,
  operation: string,
  maxResponseBytes: number,
): Promise<unknown> {
  const body = await readResponseText(response, operation, maxResponseBytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch (cause) {
    throw new Error(`${operation} returned invalid JSON`, { cause });
  }
  if (!response.ok) {
    const detail = errorDetail(parsed);
    throw new Error(`${operation} failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return parsed;
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
  const parsed = await readJson(response, operation, maxResponseBytes);
  if (!isJsonObject(parsed)) {
    throw new Error(`${operation} returned an invalid JSON-RPC envelope`);
  }
  const body = parsed as unknown as OpenApiEnvelope<Result>;
  const rpcError = body.JsonRpcResponse?.Error;
  if (rpcError) {
    throw new Error(`${operation} failed: ${errorDetail(rpcError) ?? 'JSON-RPC error'}`);
  }
  if (body.Code !== undefined || body.Message !== undefined) {
    throw new Error(`${operation} failed: ${errorDetail(body) ?? 'OpenAPI error'}`);
  }
  if (body.JsonRpcResponse?.Result === undefined) {
    throw new Error(`${operation} returned no JSON-RPC result`);
  }
  return body.JsonRpcResponse.Result;
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
  return {
    ArtifactName: value.ArtifactName,
    ArtifactPath: value.ArtifactPath,
  };
}

async function findArtifact(
  fetcher: typeof globalThis.fetch,
  listEndpoint: string,
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
      listEndpoint,
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
    for (const item of result.Artifacts) {
      const artifact = parseArtifact(item);
      if (artifact.ArtifactName === artifactName) {
        matches.push(artifact);
      }
    }

    const token = typeof result.NextToken === 'string' && result.NextToken
      ? result.NextToken
      : undefined;
    if (!token) {
      break;
    }
    if (seenTokens.has(token)) {
      throw new Error('ListAgentSessionArtifacts returned a repeated NextToken');
    }
    seenTokens.add(token);
    nextToken = token;
  }

  if (nextToken && seenTokens.size >= MAX_ARTIFACT_PAGES) {
    throw new Error(`ListAgentSessionArtifacts exceeded ${MAX_ARTIFACT_PAGES} pages`);
  }
  if (matches.length === 0) {
    throw new Error(`Artifact ${artifactName} was not found`);
  }
  if (matches.length > 1) {
    throw new Error(`Artifact ${artifactName} is ambiguous (${matches.length} matches)`);
  }
  return matches[0] as ArtifactSummary;
}

function parseCsv(
  content: string,
  limits: ChatBIArtifactResolverLimits,
): ResolvedDataset {
  const contentBytes = utf8ByteLength(content);
  if (contentBytes > limits.maxArtifactContentBytes) {
    throw new Error(
      `ArtifactContent exceeds the ${limits.maxArtifactContentBytes} byte limit`,
    );
  }
  const parsed = Papa.parse<Record<string, string | number | boolean | null>>(content, {
    dynamicTyping: true,
    header: true,
    preview: limits.maxRows + 1,
    skipEmptyLines: 'greedy',
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0];
    throw new Error(`Artifact CSV is invalid: ${first?.message ?? 'unknown parse error'}`);
  }
  const dimensions = parsed.meta.fields?.filter((field) => field.length > 0) ?? [];
  if (dimensions.length === 0) {
    throw new Error('Artifact CSV has no header columns');
  }
  if (parsed.data.length > limits.maxRows) {
    throw new Error(`Artifact CSV exceeds the ${limits.maxRows} row limit`);
  }
  if (dimensions.length > limits.maxColumns) {
    throw new Error(`Artifact CSV exceeds the ${limits.maxColumns} column limit`);
  }
  const cells = parsed.data.length * dimensions.length;
  if (cells > limits.maxCells) {
    throw new Error(`Artifact CSV exceeds the ${limits.maxCells} cell limit`);
  }
  const source = parsed.data.map((row): Record<string, string | number | boolean | null> => {
    const normalized: Record<string, string | number | boolean | null> = {};
    for (const dimension of dimensions) {
      const value = row[dimension];
      if (value !== undefined && value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        throw new Error(`Artifact CSV column ${dimension} contains a non-scalar value`);
      }
      normalized[dimension] = value ?? null;
    }
    return normalized;
  });
  return { dimensions, source };
}

export function createChatBIArtifactDataRefResolver(
  options: ChatBIArtifactResolverOptions,
): ResolveDataRef {
  const sessionId = requiredText(options.sessionId, 'sessionId');
  const requestId = options.requestId?.trim() || undefined;
  const fetcher = options.fetch ?? globalThis.fetch;
  const listEndpoint = options.listEndpoint ?? DEFAULT_LIST_ENDPOINT;
  const metaEndpoint = options.metaEndpoint ?? DEFAULT_META_ENDPOINT;
  const limits = artifactLimits(options.limits);

  return async (ref, context) => {
    if (context.format !== undefined && context.format !== 'csv') {
      throw new Error(`ChatBI artifact resolver does not support ${context.format}`);
    }
    if (!/^[a-zA-Z0-9._-]+\.csv$/.test(ref)) {
      throw new Error(`Invalid ChatBI artifact reference: ${ref}`);
    }
    const artifact = await findArtifact(
      fetcher,
      listEndpoint,
      sessionId,
      requestId,
      ref,
      context.signal,
      limits.maxResponseBytes,
    );
    const meta = await postJsonRpc<ArtifactMetaResult>(
      fetcher,
      metaEndpoint,
      { SessionId: sessionId, ArtifactPath: artifact.ArtifactPath },
      context.signal,
      'GetAgentSessionArtifactMeta',
      limits.maxResponseBytes,
    );
    if (typeof meta.ArtifactContent !== 'string') {
      throw new Error('GetAgentSessionArtifactMeta returned no ArtifactContent');
    }
    return parseCsv(meta.ArtifactContent, limits);
  };
}

export function createExecuteChartSource(
  options: ExecuteChartSourceOptions = {},
): ExecuteChartSource {
  const fetcher = options.fetch ?? globalThis.fetch;
  const endpoint = options.endpoint ?? DEFAULT_EXECUTE_ENDPOINT;
  const maxResponseBytes = positiveSafeInteger(
    options.maxResponseBytes ?? DEFAULT_PROXY_RESPONSE_BYTES,
    'maxResponseBytes',
  );
  return async ({ source, inputData, signal }) => {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, inputData }),
      signal,
    });
    const body = await readJson(response, 'executeChartSource', maxResponseBytes);
    if (!isJsonObject(body) || !Object.prototype.hasOwnProperty.call(body, 'spec')) {
      throw new Error('executeChartSource must return { spec }');
    }
    const spec = validateChartJsonValue(body.spec);
    if (!isJsonObject(spec)) {
      throw new Error('executeChartSource.spec must be a JSON object');
    }
    return spec;
  };
}

export function createChatBILegacyResolver(options: {
  readonly resolveDataRef: ResolveDataRef;
  readonly executeChartSource: ExecuteChartSource;
}): ResolveLegacyEChartQuery {
  return async ({ jobId, source, signal }) => {
    const data = await options.resolveDataRef(`${jobId}.csv`, {
      format: 'csv',
      dimensions: undefined,
      signal,
    });
    const spec = await options.executeChartSource({
      source,
      inputData: data.source,
      signal,
    });
    return {
      data: {
        kind: 'inline',
        ...(data.dimensions ? { dimensions: data.dimensions } : {}),
        source: data.source,
      },
      spec,
    };
  };
}
