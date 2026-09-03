export type JsonPrimitive = string | number | boolean | null;
export const MARKDOWN_CHART_LANGUAGE = 'markdown-chart' as const;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ChartDataRow = JsonPrimitive[] | Record<string, JsonPrimitive>;

export interface InlineChartData {
  readonly kind: 'inline';
  readonly dimensions?: readonly string[];
  readonly source: readonly ChartDataRow[];
}

export interface RefChartData {
  readonly kind: 'ref';
  readonly ref: string;
  readonly format?: 'csv' | 'json';
  readonly dimensions?: readonly string[];
}

export type ChartData = InlineChartData | RefChartData;
export type ChartDatasets = Readonly<Record<string, ChartData>>;

/** A host-materialized dataset. It intentionally contains no transport metadata. */
export interface ResolvedChartData {
  readonly dimensions?: readonly string[];
  readonly source: readonly ChartDataRow[];
}

export interface ResolveChartDataRefContext {
  readonly format: 'csv' | 'json' | undefined;
  readonly dimensions: readonly string[] | undefined;
  readonly signal: AbortSignal;
}

/** Host-owned resolver boundary. Core never interprets or fetches `ref`. */
export type ResolveChartDataRef = (
  ref: string,
  context: ResolveChartDataRefContext,
) => ResolvedChartData | Promise<ResolvedChartData>;

export interface ChartDataMaterializationLimits {
  readonly maxRows: number;
  readonly maxCells: number;
}

export const DEFAULT_CHART_DATA_MATERIALIZATION_LIMITS: Readonly<ChartDataMaterializationLimits> = Object.freeze({
  maxRows: 2_000,
  maxCells: 40_000,
});

export interface MaterializeChartDataOptions {
  readonly signal: AbortSignal;
  readonly resolveDataRef?: ResolveChartDataRef;
  readonly validateDataRef?: (ref: string) => boolean;
  readonly limits?: Partial<ChartDataMaterializationLimits>;
}

export type ChartErrorCode =
  | 'INVALID_JSON'
  | 'LIMIT_EXCEEDED'
  | 'SCHEMA_INVALID'
  | 'UNSUPPORTED_VERSION'
  | 'RENDERER_NOT_FOUND'
  | 'RENDERER_CONFLICT'
  | 'UNSAFE_SPEC'
  | 'REF_RESOLVER_MISSING'
  | 'REF_REJECTED'
  | 'REF_RESOLUTION_FAILED'
  | 'RUNTIME_LOAD_FAILED'
  | 'RENDER_FAILED'
  | (string & {});

export class MarkdownChartError extends Error {
  readonly code: ChartErrorCode;
  readonly cause: unknown;

  constructor(code: ChartErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'MarkdownChartError';
    this.code = code;
    this.cause = options?.cause;
  }
}

export interface JsonParseLimits {
  maxCharacters: number;
  maxDepth: number;
  maxNodes: number;
}

export const DEFAULT_JSON_LIMITS: Readonly<JsonParseLimits> = Object.freeze({
  maxCharacters: 500_000,
  maxDepth: 40,
  maxNodes: 100_000,
});

const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertChartSourceSize(
  source: string,
  overrides: Partial<JsonParseLimits>,
): void {
  const maxCharacters = overrides.maxCharacters ?? DEFAULT_JSON_LIMITS.maxCharacters;
  if (source.length > maxCharacters) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `Chart fence exceeds the ${maxCharacters} character limit`,
    );
  }
}

export function isJsonObject(value: unknown): value is Record<string, JsonValue> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJsonValue(
  value: unknown,
  limits: JsonParseLimits,
  state: { nodes: number },
  depth: number,
  path: string,
): asserts value is JsonValue {
  state.nodes += 1;
  if (state.nodes > limits.maxNodes) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `Chart JSON exceeds the ${limits.maxNodes} node limit`,
    );
  }
  if (depth > limits.maxDepth) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `Chart JSON exceeds the ${limits.maxDepth} level depth limit`,
    );
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new MarkdownChartError('INVALID_JSON', `${path} contains a non-finite number`);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') {
        continue;
      }
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new MarkdownChartError('INVALID_JSON', `${path} contains a non-JSON array property`);
      }
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new MarkdownChartError('INVALID_JSON', `${path}[${index}] is not a JSON data property`);
      }
      assertJsonValue(descriptor.value, limits, state, depth + 1, `${path}[${index}]`);
    }
    return;
  }
  if (!isJsonObject(value)) {
    throw new MarkdownChartError('INVALID_JSON', `${path} contains a non-JSON value`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new MarkdownChartError('INVALID_JSON', `${path} contains a symbol key`);
    }
    if (FORBIDDEN_KEYS.has(key)) {
      throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains forbidden key ${key}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new MarkdownChartError('INVALID_JSON', `${path}.${key} is not a JSON data property`);
    }
    assertJsonValue(descriptor.value, limits, state, depth + 1, `${path}.${key}`);
  }
}

/**
 * Validates an already materialized value without applying the source-text
 * character limit used for Markdown fences.
 *
 * This is intended for trusted host integration boundaries that return values
 * directly (for example, data resolvers). It still rejects non-JSON values,
 * non-plain object prototypes, dangerous keys, excessive depth, and excessive
 * node counts.
 */
export function validateChartJsonValue(
  value: unknown,
  overrides: Partial<Pick<JsonParseLimits, 'maxDepth' | 'maxNodes'>> = {},
): JsonValue {
  const limits: JsonParseLimits = { ...DEFAULT_JSON_LIMITS, ...overrides };
  assertJsonValue(value, limits, { nodes: 0 }, 0, '$');
  return value;
}

export function parseChartJson(
  source: string,
  overrides: Partial<JsonParseLimits> = {},
): JsonValue {
  const limits: JsonParseLimits = { ...DEFAULT_JSON_LIMITS, ...overrides };
  assertChartSourceSize(source, limits);

  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch (cause) {
    throw new MarkdownChartError('INVALID_JSON', 'Chart fence must contain valid JSON', { cause });
  }
  assertJsonValue(parsed, limits, { nodes: 0 }, 0, '$');
  return parsed;
}

function parseChartDataDimensions(value: JsonValue | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'markdown-chart.data.dimensions must be an array of non-empty strings',
    );
  }
  if (new Set(value).size !== value.length) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'markdown-chart.data.dimensions must be unique',
    );
  }
  return [...value] as string[];
}

function parseChartDataRows(value: JsonValue | undefined): ChartDataRow[] {
  if (!Array.isArray(value)) {
    throw new MarkdownChartError('SCHEMA_INVALID', 'markdown-chart.data.source must be an array');
  }
  return value.map((row, rowIndex): ChartDataRow => {
    if (Array.isArray(row)) {
      if (row.some((cell) => cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))) {
        throw new MarkdownChartError(
          'SCHEMA_INVALID',
          `markdown-chart.data.source[${rowIndex}] must contain only JSON scalars`,
        );
      }
      return [...row] as JsonPrimitive[];
    }
    if (isJsonObject(row)) {
      const result: Record<string, JsonPrimitive> = {};
      for (const [key, cell] of Object.entries(row)) {
        if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            `markdown-chart.data.source[${rowIndex}].${key} must be a JSON scalar`,
          );
        }
        Object.defineProperty(result, key, {
          value: cell as JsonPrimitive,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      return result;
    }
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      `markdown-chart.data.source[${rowIndex}] must be an array or object`,
    );
  });
}

export function parseChartData(value: unknown): ChartData {
  if (!isJsonObject(value) || typeof value.kind !== 'string') {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'markdown-chart.data must be an inline or ref dataset object',
    );
  }
  const dimensions = parseChartDataDimensions(value.dimensions);
  if (value.kind === 'inline') {
    const source = parseChartDataRows(value.source);
    return dimensions ? { kind: 'inline', dimensions, source } : { kind: 'inline', source };
  }
  if (value.kind === 'ref') {
    if (typeof value.ref !== 'string' || value.ref.length === 0) {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        'markdown-chart.data.ref must be a non-empty string',
      );
    }
    if (value.format !== undefined && value.format !== 'csv' && value.format !== 'json') {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        'markdown-chart.data.format must be csv or json',
      );
    }
    return {
      kind: 'ref',
      ref: value.ref,
      ...(value.format ? { format: value.format } : {}),
      ...(dimensions ? { dimensions } : {}),
    };
  }
  throw new MarkdownChartError(
    'SCHEMA_INVALID',
    `Unsupported markdown-chart.data.kind: ${value.kind}`,
  );
}

const CHART_DATASET_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

export function parseChartDatasets(value: unknown): ChartDatasets {
  if (!isJsonObject(value) || Object.keys(value).length === 0) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'markdown-chart.datasets must be a non-empty object of named datasets',
    );
  }
  const datasets: Record<string, ChartData> = {};
  for (const [id, data] of Object.entries(value)) {
    if (!CHART_DATASET_ID.test(id)) {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        `markdown-chart.datasets key ${id} must match ${CHART_DATASET_ID.source}`,
      );
    }
    Object.defineProperty(datasets, id, {
      value: parseChartData(data),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return datasets;
}

function validateMaterializedDimensions(
  dimensions: readonly string[] | undefined,
): string[] | undefined {
  if (dimensions === undefined) return undefined;
  if (
    !Array.isArray(dimensions)
    || dimensions.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'resolvedChartData.dimensions must be an array of non-empty strings',
    );
  }
  if (new Set(dimensions).size !== dimensions.length) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'chart data dimensions must be unique',
    );
  }
  return [...dimensions];
}

function validateMaterializedRows(
  source: readonly ChartDataRow[],
  limits: ChartDataMaterializationLimits,
): ChartDataRow[] {
  if (!Array.isArray(source)) {
    throw new MarkdownChartError('SCHEMA_INVALID', 'resolvedChartData.source must be an array');
  }
  if (source.length > limits.maxRows) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `resolvedChartData.source exceeds the ${limits.maxRows} row limit`,
    );
  }
  let cells = 0;
  const rows = source.map((row, rowIndex): ChartDataRow => {
    if (Array.isArray(row)) {
      const result = row.map((cell, cellIndex) => {
        if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            `resolvedChartData.source[${rowIndex}][${cellIndex}] must be a JSON scalar`,
          );
        }
        if (typeof cell === 'number' && !Number.isFinite(cell)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            `resolvedChartData.source[${rowIndex}][${cellIndex}] must contain only finite numbers`,
          );
        }
        return cell as JsonPrimitive;
      });
      cells += result.length;
      return result;
    }
    if (isJsonObject(row)) {
      const result: Record<string, JsonPrimitive> = {};
      for (const [key, cell] of Object.entries(row)) {
        if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            `resolvedChartData.source[${rowIndex}].${key} must be a JSON scalar`,
          );
        }
        if (typeof cell === 'number' && !Number.isFinite(cell)) {
          throw new MarkdownChartError(
            'SCHEMA_INVALID',
            `resolvedChartData.source[${rowIndex}].${key} must contain only finite numbers`,
          );
        }
        Object.defineProperty(result, key, {
          value: cell as JsonPrimitive,
          enumerable: true,
          configurable: true,
          writable: true,
        });
        cells += 1;
      }
      return result;
    }
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      `resolvedChartData.source[${rowIndex}] must be an array or object`,
    );
  });
  if (cells > limits.maxCells) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `resolvedChartData.source exceeds the ${limits.maxCells} cell limit`,
    );
  }
  return rows;
}

/**
 * Materialize canonical chart data exactly once at the renderer boundary.
 *
 * Reference validation, authorization and transport remain host-owned. An
 * aborted resolution returns undefined so the lifecycle controller can quietly
 * discard stale work.
 */
export async function materializeChartData(
  data: ChartData,
  options: MaterializeChartDataOptions,
): Promise<InlineChartData | undefined> {
  const limits: ChartDataMaterializationLimits = {
    ...DEFAULT_CHART_DATA_MATERIALIZATION_LIMITS,
    ...options.limits,
  };
  let resolved: ResolvedChartData;
  if (data.kind === 'inline') {
    resolved = data;
  } else {
    if (options.validateDataRef && !options.validateDataRef(data.ref)) {
      throw new MarkdownChartError('REF_REJECTED', 'The host rejected the chart data reference');
    }
    if (!options.resolveDataRef) {
      throw new MarkdownChartError('REF_RESOLVER_MISSING', 'A resolveDataRef callback is required');
    }
    try {
      resolved = await options.resolveDataRef(data.ref, {
        format: data.format,
        dimensions: data.dimensions,
        signal: options.signal,
      });
    } catch (cause) {
      if (options.signal.aborted) return undefined;
      throw new MarkdownChartError(
        'REF_RESOLUTION_FAILED',
        'The chart dataset could not be resolved',
        { cause },
      );
    }
    if (options.signal.aborted) return undefined;
    if (resolved === null || typeof resolved !== 'object') {
      throw new MarkdownChartError(
        'REF_RESOLUTION_FAILED',
        `Chart data reference ${data.ref} resolved to an invalid dataset`,
      );
    }
  }

  const dimensions = validateMaterializedDimensions(
    resolved.dimensions ?? (data.kind === 'ref' ? data.dimensions : undefined),
  );
  const source = validateMaterializedRows(resolved.source, limits);
  return dimensions
    ? { kind: 'inline', dimensions, source }
    : { kind: 'inline', source };
}

export interface ChartParseContext {
  readonly language: string;
  /** The original first fence-info token, before case normalization. */
  readonly rawLanguage?: string;
  readonly rendererId: string;
  readonly data: ChartData | undefined;
  readonly datasets?: ChartDatasets;
}

/** An opaque renderer-owned reference that a host may choose to open. */
export interface ChartReference {
  readonly ref: string;
  readonly label: string;
}

/** Host interaction payload. The core never interprets `reference.ref`. */
export interface ChartReferenceEvent {
  readonly rendererId: string;
  readonly reference: ChartReference;
}

/**
 * Optional host boundary for renderer-owned reference controls.
 *
 * Renderers must treat `canOpen` as advisory and invoke it again immediately
 * before `open`. Hosts remain responsible for validating and authorizing the
 * opaque reference.
 */
export interface ChartReferenceActions {
  readonly canOpen?: (event: ChartReferenceEvent) => boolean;
  readonly open: (event: ChartReferenceEvent) => void | Promise<void>;
}

export interface ChartMountContext {
  readonly signal: AbortSignal;
  readonly theme: unknown;
  /** Outer chart host when the renderer mounts into an inner chart-view node. */
  readonly hostContainer?: HTMLElement;
  /** Non-empty title already rendered by host-provided chart chrome. */
  readonly externalizedTitle?: string;
  readonly referenceActions?: ChartReferenceActions;
}

export interface ChartMaterializeContext extends ChartMountContext {
  readonly language: string;
  readonly rawLanguage?: string;
  readonly rendererId: string;
  readonly data: ChartData | undefined;
  readonly datasets?: ChartDatasets;
}

export interface MaterializedChart<Parsed = unknown> {
  readonly parsed: Parsed;
  readonly data: ChartData | undefined;
}

export interface ChartHandle {
  dispose(): void;
  resize?(): void;
}

export interface ChartRenderer<Parsed = unknown> {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly matchLanguage?: (language: string) => boolean;
  parse(spec: JsonValue, context: ChartParseContext): Parsed | Promise<Parsed>;
  parseSource?(source: string, context: ChartParseContext): Parsed | Promise<Parsed>;
  /** Return a concise title for host-provided chart chrome. */
  getTitle?(parsed: Parsed): string | undefined;
  materialize?(
    parsed: Parsed,
    context: ChartMaterializeContext,
  ): MaterializedChart<Parsed> | Promise<MaterializedChart<Parsed>>;
  mount(
    container: HTMLElement,
    parsed: Parsed,
    context: ChartMountContext,
  ): ChartHandle | void | Promise<ChartHandle | void>;
}

export interface PreparedChart {
  readonly renderer: ChartRenderer<unknown>;
  readonly parsed: unknown;
  readonly data: ChartData | undefined;
  readonly datasets?: ChartDatasets;
  readonly language: string;
  readonly rawLanguage: string;
  readonly rendererId: string;
}

export interface ChartRegistryOptions {
  jsonLimits?: Partial<JsonParseLimits>;
}

function normalizeName(name: string, label: string): string {
  const normalized = name.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]*$/.test(normalized)) {
    throw new MarkdownChartError('SCHEMA_INVALID', `Invalid ${label}: ${name}`);
  }
  return normalized;
}

export function extractFenceLanguage(info: string): string {
  return info.trim().split(/\s+/, 1)[0] ?? '';
}

export function normalizeFenceLanguage(info: string): string {
  return extractFenceLanguage(info).toLowerCase();
}

export interface MarkdownChartEnvelope {
  readonly version: 1;
  readonly renderer: string;
  readonly data: ChartData | undefined;
  readonly datasets?: ChartDatasets;
  readonly spec: JsonValue;
}

export function parseMarkdownChartEnvelope(
  source: string,
  jsonLimits: Partial<JsonParseLimits> = {},
): MarkdownChartEnvelope {
  const body = parseChartJson(source, jsonLimits);
  if (!isJsonObject(body)) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'The canonical markdown-chart fence must contain an object',
    );
  }
  if (body.version !== 1) {
    throw new MarkdownChartError(
      'UNSUPPORTED_VERSION',
      'Only markdown-chart protocol version 1 is supported',
    );
  }
  if (typeof body.renderer !== 'string') {
    throw new MarkdownChartError('SCHEMA_INVALID', 'markdown-chart.renderer must be a string');
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'spec')) {
    throw new MarkdownChartError('SCHEMA_INVALID', 'markdown-chart.spec is required');
  }
  return {
    version: 1,
    renderer: normalizeName(body.renderer, 'renderer id'),
    data: body.data === undefined ? undefined : parseChartData(body.data),
    ...(body.datasets === undefined ? {} : { datasets: parseChartDatasets(body.datasets) }),
    spec: body.spec as JsonValue,
  };
}

export class ChartRendererRegistry {
  readonly #renderers = new Map<string, ChartRenderer<unknown>>();
  readonly #aliases = new Map<string, string>();
  readonly #jsonLimits: Partial<JsonParseLimits>;

  constructor(options: ChartRegistryOptions = {}) {
    this.#jsonLimits = options.jsonLimits ?? {};
  }

  register<Parsed>(renderer: ChartRenderer<Parsed>): this {
    const id = normalizeName(renderer.id, 'renderer id');
    const aliases = (renderer.aliases ?? [])
      .map((alias) => normalizeName(alias, 'renderer alias'));
    const existingIdOwner = this.#aliases.get(id);
    if (this.#renderers.has(id) || existingIdOwner) {
      throw new MarkdownChartError(
        'RENDERER_CONFLICT',
        `Renderer id ${id} is already owned by ${existingIdOwner ?? id}`,
      );
    }
    const uniqueAliases = new Set<string>();
    for (const alias of aliases) {
      if (alias === MARKDOWN_CHART_LANGUAGE) {
        throw new MarkdownChartError('RENDERER_CONFLICT', 'The canonical markdown-chart fence cannot be a renderer alias');
      }
      if (uniqueAliases.has(alias)) {
        throw new MarkdownChartError(
          'RENDERER_CONFLICT',
          `Renderer alias ${alias} is declared more than once`,
        );
      }
      uniqueAliases.add(alias);
      const existing = this.#aliases.get(alias)
        ?? (alias !== id && this.#renderers.has(alias) ? alias : undefined);
      if (existing) {
        throw new MarkdownChartError(
          'RENDERER_CONFLICT',
          `Renderer alias ${alias} is already owned by ${existing}`,
        );
      }
    }

    const erased = renderer as ChartRenderer<unknown>;
    this.#renderers.set(id, erased);
    aliases.forEach((alias) => this.#aliases.set(alias, id));
    return this;
  }

  has(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return normalized === MARKDOWN_CHART_LANGUAGE
      || this.#aliases.has(normalized)
      || [...this.#renderers.values()].some((renderer) => renderer.matchLanguage?.(normalized) === true);
  }

  get rendererIds(): readonly string[] {
    return [...this.#renderers.keys()];
  }

  async prepare(languageInfo: string, source: string): Promise<PreparedChart> {
    const rawLanguage = extractFenceLanguage(languageInfo);
    const language = rawLanguage.toLowerCase();

    let rendererId: string;
    let spec: JsonValue;
    let data: ChartData | undefined;
    let datasets: ChartDatasets | undefined;
    let parseSource = false;
    if (language === MARKDOWN_CHART_LANGUAGE) {
      const envelope = parseMarkdownChartEnvelope(source, this.#jsonLimits);
      rendererId = envelope.renderer;
      spec = envelope.spec;
      data = envelope.data;
      datasets = envelope.datasets;
    } else {
      const exact = this.#aliases.get(language);
      const matched = exact ? [] : [...this.#renderers.entries()]
        .filter(([, renderer]) => renderer.matchLanguage?.(language) === true)
        .map(([id]) => id);
      if (!exact && matched.length === 0) {
        throw new MarkdownChartError('RENDERER_NOT_FOUND', `No renderer is registered for ${language || 'this fence'}`);
      }
      if (matched.length > 1) {
        throw new MarkdownChartError(
          'RENDERER_CONFLICT',
          `Multiple renderers match the dynamic fence language ${language}`,
        );
      }
      rendererId = exact ?? matched[0] as string;
      parseSource = !exact;
      if (parseSource) {
        assertChartSourceSize(source, this.#jsonLimits);
      }
      spec = parseSource ? null : parseChartJson(source, this.#jsonLimits);
    }

    const renderer = this.#renderers.get(rendererId);
    if (!renderer) {
      throw new MarkdownChartError('RENDERER_NOT_FOUND', `Renderer ${rendererId} is not registered`);
    }
    const context: ChartParseContext = {
      language,
      rawLanguage,
      rendererId,
      data,
      ...(datasets ? { datasets } : {}),
    };
    if (parseSource && !renderer.parseSource) {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        `Renderer ${rendererId} matched ${language} but cannot parse its source`,
      );
    }
    const parsed = parseSource
      ? await renderer.parseSource!(source, context)
      : await renderer.parse(spec, context);
    return {
      renderer,
      parsed,
      data,
      ...(datasets ? { datasets } : {}),
      language,
      rawLanguage,
      rendererId,
    };
  }
}

export interface ChartRenderRequest {
  readonly language: string;
  readonly source: string;
  readonly theme?: unknown;
  readonly streaming?: boolean;
  readonly loadingLabel?: string;
  readonly labels?: MarkdownChartLabelOverrides;
  readonly referenceActions?: ChartReferenceActions;
}

export const DEFAULT_MARKDOWN_CHART_LOADING_LABEL = 'Rendering chart…';

export interface MarkdownChartTableNoticeContext {
  readonly visibleRows: number;
  readonly totalRows: number;
  readonly visibleColumns: number;
  readonly totalColumns: number;
}

export interface MarkdownChartLabels {
  readonly chartUnavailable: string;
  readonly viewMode: string;
  readonly chart: string;
  readonly data: string;
  readonly showChart: string;
  readonly showData: string;
  readonly noData: string;
  readonly tableNotice: (context: MarkdownChartTableNoticeContext) => string;
}

export type MarkdownChartLabelOverrides = Partial<MarkdownChartLabels>;

export const DEFAULT_MARKDOWN_CHART_LABELS: Readonly<MarkdownChartLabels> = Object.freeze({
  chartUnavailable: 'Chart unavailable',
  viewMode: 'View mode',
  chart: 'Chart',
  data: 'Data',
  showChart: 'Show chart',
  showData: 'Show data',
  noData: 'No data',
  tableNotice: ({
    visibleRows,
    totalRows,
    visibleColumns,
    totalColumns,
  }: MarkdownChartTableNoticeContext) =>
    `Showing ${visibleRows} of ${totalRows} rows and ${visibleColumns} of ${totalColumns} columns.`,
});

export function resolveMarkdownChartLabels(
  overrides?: MarkdownChartLabelOverrides,
): Readonly<MarkdownChartLabels> {
  return overrides
    ? Object.freeze({ ...DEFAULT_MARKDOWN_CHART_LABELS, ...overrides })
    : DEFAULT_MARKDOWN_CHART_LABELS;
}

const MARKDOWN_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const MARKDOWN_BLOCKQUOTE_MARKER = /^ {0,3}>[ \t]?/;

function stripMarkdownBlockquoteDepth(line: string, depth: number): string | undefined {
  let remainder = line;
  for (let index = 0; index < depth; index += 1) {
    const marker = MARKDOWN_BLOCKQUOTE_MARKER.exec(remainder)?.[0];
    if (!marker) {
      return undefined;
    }
    remainder = remainder.slice(marker.length);
  }
  return remainder;
}

/**
 * Returns whether a Markdown fragment that starts with a fenced code block
 * contains its matching closing fence.
 *
 * Streaming adapters use this to distinguish an already completed chart from
 * the active, unterminated chart block at the tail of an LLM response.
 */
export function isMarkdownFenceClosed(source: string): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let openingLine = lines[0] ?? '';
  let blockquoteDepth = 0;
  while (true) {
    const marker = MARKDOWN_BLOCKQUOTE_MARKER.exec(openingLine)?.[0];
    if (!marker) {
      break;
    }
    blockquoteDepth += 1;
    openingLine = openingLine.slice(marker.length);
  }
  const opening = MARKDOWN_FENCE_OPEN.exec(openingLine);
  const marker = opening?.[1];
  if (!marker) {
    return false;
  }

  const markerCharacter = marker[0];
  if (!markerCharacter) {
    return false;
  }
  const closing = new RegExp(
    `^ {0,3}${markerCharacter === '`' ? '`' : '~'}{${marker.length},}[\\t ]*$`,
  );
  return lines.slice(1).some((line) => {
    const normalized = stripMarkdownBlockquoteDepth(line, blockquoteDepth);
    return normalized !== undefined && closing.test(normalized);
  });
}

export interface UnclosedMarkdownFence {
  /** Offset of the opening fence in the original Markdown source. */
  readonly start: number;
  /** Opening marker, including its original backtick or tilde count. */
  readonly marker: string;
  /** Raw info string after the opening marker, without surrounding whitespace. */
  readonly info: string;
  /** First whitespace-delimited token from the info string. */
  readonly language: string;
  /** Content received after the opening-fence line. */
  readonly source: string;
}

/**
 * Finds the active unterminated fenced code block at the tail of a Markdown
 * document. Custom streaming parsers can use this when they render individual
 * blocks and therefore cannot rely on document-relative AST offsets.
 */
export function findUnclosedMarkdownFence(source: string): UnclosedMarkdownFence | undefined {
  let open:
    | {
        readonly start: number;
        readonly marker: string;
        readonly info: string;
        readonly bodyStart: number;
      }
    | undefined;
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newline = source.indexOf('\n', lineStart);
    const lineEnd = newline === -1 ? source.length : newline;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/, '');

    if (open) {
      const markerCharacter = open.marker[0];
      const closing = markerCharacter
        ? new RegExp(
            `^ {0,3}${markerCharacter === '`' ? '`' : '~'}{${open.marker.length},}[\\t ]*$`,
          )
        : undefined;
      if (closing?.test(line)) {
        open = undefined;
      }
    } else {
      const opening = MARKDOWN_FENCE_OPEN.exec(line);
      const marker = opening?.[1];
      if (marker) {
        const openingEnd = (opening.index ?? 0) + opening[0].length;
        open = {
          start: lineStart + (opening.index ?? 0),
          marker,
          info: line.slice(openingEnd).trim(),
          bodyStart: newline === -1 ? source.length : newline + 1,
        };
      }
    }

    if (newline === -1) {
      break;
    }
    lineStart = newline + 1;
  }

  if (!open) {
    return undefined;
  }
  return {
    start: open.start,
    marker: open.marker,
    info: open.info,
    language: open.info.split(/\s+/, 1)[0] ?? '',
    source: source.slice(open.bodyStart),
  };
}

const MAX_VISIBLE_DATA_ROWS = 500;
const MAX_VISIBLE_DATA_COLUMNS = 50;

function inlineDataColumns(data: InlineChartData): string[] {
  if (data.dimensions && data.dimensions.length > 0) {
    return [...data.dimensions];
  }
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of data.source) {
    if (Array.isArray(row)) {
      for (let index = 0; index < row.length; index += 1) {
        const column = String(index + 1);
        if (!seen.has(column)) {
          seen.add(column);
          columns.push(column);
        }
      }
    } else {
      for (const column of Object.keys(row)) {
        if (!seen.has(column)) {
          seen.add(column);
          columns.push(column);
        }
      }
    }
  }
  return columns;
}

function inlineDataCell(
  row: ChartDataRow,
  column: string,
  columnIndex: number,
): JsonPrimitive | undefined {
  return Array.isArray(row) ? row[columnIndex] : row[column];
}

function setStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function createSvgElement(name: string): SVGElement {
  return document.createElementNS(SVG_NAMESPACE, name);
}

function createChartIcon(): SVGSVGElement {
  const svg = createSvgElement('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  setStyles(svg, { width: '16px', height: '16px', fill: 'currentColor' });
  for (const attributes of [
    { x: '3', y: '10', width: '3', height: '6', rx: '1' },
    { x: '8.5', y: '6', width: '3', height: '10', rx: '1' },
    { x: '14', y: '3', width: '3', height: '13', rx: '1' },
  ]) {
    const rectangle = createSvgElement('rect');
    Object.entries(attributes).forEach(([name, value]) => rectangle.setAttribute(name, value));
    svg.append(rectangle);
  }
  return svg;
}

function createDataIcon(): SVGSVGElement {
  const svg = createSvgElement('svg') as SVGSVGElement;
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  setStyles(svg, { width: '16px', height: '16px', fill: 'none' });
  const rectangle = createSvgElement('rect');
  Object.entries({
    x: '3', y: '4', width: '14', height: '12', rx: '1.5',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '1.4',
  }).forEach(([name, value]) => rectangle.setAttribute(name, value));
  const lines = createSvgElement('path');
  lines.setAttribute('d', 'M3 8.5H17M3 12.5H17M8 4V16M13 4V16');
  lines.setAttribute('stroke', 'currentColor');
  lines.setAttribute('stroke-width', '1.4');
  svg.append(rectangle, lines);
  return svg;
}

const MARKDOWN_CHART_LOADING_STYLE = [
  'display:flex',
  'min-height:inherit',
  'width:100%',
  'box-sizing:border-box',
  'align-items:center',
  'justify-content:center',
  'gap:8px',
  'padding:24px',
  'color:var(--markdown-chart-loading-color,currentColor)',
  'opacity:.68',
  "font:400 12px/1.5 system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
].join(';');

const MARKDOWN_CHART_LOADING_SPINNER = [
  '<svg class="markdown-chart-loading-spinner" viewBox="0 0 24 24"',
  ' width="18" height="18" aria-hidden="true" style="flex:none;fill:none">',
  '<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2" opacity=".24"></circle>',
  '<path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" stroke-width="2"',
  ' stroke-linecap="round"><animateTransform attributeName="transform" type="rotate"',
  ' from="0 12 12" to="360 12 12" dur=".8s" repeatCount="indefinite"></animateTransform></path>',
  '</svg>',
].join('');

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] as string);
}

export function createMarkdownChartLoadingMarkup(
  label = DEFAULT_MARKDOWN_CHART_LOADING_LABEL,
): string {
  const escapedLabel = escapeHtmlText(label);
  return [
    '<div class="markdown-chart-loading" data-markdown-chart-loading="true"',
    ` role="status" style="${MARKDOWN_CHART_LOADING_STYLE}">`,
    MARKDOWN_CHART_LOADING_SPINNER,
    `<span class="markdown-chart-loading-label">${escapedLabel}</span>`,
    '</div>',
  ].join('');
}

function createChartLoadingSpinner(): SVGSVGElement {
  const svg = createSvgElement('svg') as SVGSVGElement;
  svg.classList.add('markdown-chart-loading-spinner');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '18');
  svg.setAttribute('aria-hidden', 'true');
  setStyles(svg, { flex: 'none', fill: 'none' });

  const track = createSvgElement('circle');
  Object.entries({
    cx: '12',
    cy: '12',
    r: '9',
    stroke: 'currentColor',
    'stroke-width': '2',
    opacity: '.24',
  }).forEach(([name, value]) => track.setAttribute(name, value));

  const arc = createSvgElement('path');
  Object.entries({
    d: 'M12 3a9 9 0 0 1 9 9',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
  }).forEach(([name, value]) => arc.setAttribute(name, value));
  const animation = createSvgElement('animateTransform');
  Object.entries({
    attributeName: 'transform',
    type: 'rotate',
    from: '0 12 12',
    to: '360 12 12',
    dur: '.8s',
    repeatCount: 'indefinite',
  }).forEach(([name, value]) => animation.setAttribute(name, value));
  arc.append(animation);
  svg.append(track, arc);
  return svg;
}

function findChartLoading(container: HTMLElement): HTMLElement | undefined {
  return [...container.children].find(
    (child): child is HTMLElement =>
      (child as HTMLElement).dataset.markdownChartLoading === 'true',
  );
}

function showChartLoading(
  container: HTMLElement,
  label = DEFAULT_MARKDOWN_CHART_LOADING_LABEL,
): void {
  const existing = findChartLoading(container);
  if (existing) {
    const labelElement = existing.querySelector<HTMLElement>('.markdown-chart-loading-label');
    if (labelElement) {
      labelElement.textContent = label;
    }
    container.setAttribute('aria-busy', 'true');
    return;
  }

  const loading = document.createElement('div');
  loading.className = 'markdown-chart-loading';
  loading.dataset.markdownChartLoading = 'true';
  loading.setAttribute('role', 'status');
  setStyles(loading, {
    display: 'flex',
    minHeight: 'inherit',
    width: '100%',
    boxSizing: 'border-box',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '24px',
    color: 'var(--markdown-chart-loading-color, currentColor)',
    opacity: '.68',
    font: '400 12px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  const labelElement = document.createElement('span');
  labelElement.className = 'markdown-chart-loading-label';
  labelElement.textContent = label;
  loading.append(createChartLoadingSpinner(), labelElement);
  container.replaceChildren(loading);
  container.setAttribute('aria-busy', 'true');
}

function removeChartLoading(container: HTMLElement): void {
  findChartLoading(container)?.remove();
  container.removeAttribute('aria-busy');
}

function createViewButton(
  label: string,
  ariaLabel: string,
  icon: SVGSVGElement,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', ariaLabel);
  button.setAttribute('title', label);
  button.className = 'markdown-chart-toggle-button';
  button.append(icon);
  setStyles(button, {
    display: 'grid',
    width: '30px',
    height: '26px',
    placeItems: 'center',
    padding: '0',
    border: '0',
    borderRadius: '4px',
    background: 'transparent',
    color: 'color-mix(in srgb, currentColor 68%, transparent)',
    cursor: 'pointer',
    transition: 'background-color 0.16s ease, color 0.16s ease',
  });
  return button;
}

interface ChartViewColors {
  readonly background: string;
  readonly subtleBackground: string;
}

function chartViewColors(theme: unknown): ChartViewColors {
  const dark = theme === 'dark';
  return {
    background: `var(--markdown-chart-background, ${dark ? '#0d0d0d' : '#ffffff'})`,
    subtleBackground: `var(--markdown-chart-subtle-background, ${dark ? '#161616' : '#f7f8fa'})`,
  };
}

function createInlineDataTable(
  data: InlineChartData,
  colors: ChartViewColors,
  labels: Readonly<MarkdownChartLabels>,
): HTMLElement {
  const columns = inlineDataColumns(data);
  const visibleColumns = columns.slice(0, MAX_VISIBLE_DATA_COLUMNS);
  const visibleRows = data.source.slice(0, MAX_VISIBLE_DATA_ROWS);
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-chart-data-view';
  wrapper.dataset.markdownChartDataView = 'true';
  setStyles(wrapper, {
    minHeight: '240px',
    maxHeight: 'min(60vh, 520px)',
    overflow: 'auto',
    background: colors.background,
    scrollbarColor: 'color-mix(in srgb, currentColor 18%, transparent) transparent',
  });

  if (columns.length === 0 || data.source.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = labels.noData;
    setStyles(empty, { padding: '24px', textAlign: 'center', opacity: '0.68' });
    wrapper.append(empty);
    return wrapper;
  }

  if (visibleColumns.length < columns.length || visibleRows.length < data.source.length) {
    const notice = document.createElement('div');
    notice.className = 'markdown-chart-data-notice';
    notice.textContent = labels.tableNotice({
      visibleRows: visibleRows.length,
      totalRows: data.source.length,
      visibleColumns: visibleColumns.length,
      totalColumns: columns.length,
    });
    setStyles(notice, {
      position: 'sticky',
      top: '0',
      zIndex: '2',
      padding: '8px 12px',
      borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      background: colors.subtleBackground,
      fontSize: '12px',
      opacity: '0.75',
    });
    wrapper.append(notice);
  }

  const table = document.createElement('table');
  table.className = 'markdown-chart-data-table';
  setStyles(table, {
    width: 'max-content',
    minWidth: '100%',
    borderCollapse: 'separate',
    borderSpacing: '0',
    fontSize: '13px',
  });
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const column of visibleColumns) {
    const cell = document.createElement('th');
    cell.scope = 'col';
    cell.textContent = column;
    setStyles(cell, {
      position: 'sticky',
      top: '0',
      zIndex: '1',
      padding: '8px 12px',
      borderRight: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      background: colors.subtleBackground,
      textAlign: 'left',
      whiteSpace: 'nowrap',
      fontSize: '12px',
      fontWeight: '600',
    });
    headRow.append(cell);
  }
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  for (const row of visibleRows) {
    const tableRow = document.createElement('tr');
    visibleColumns.forEach((column, columnIndex) => {
      const cell = document.createElement('td');
      const value = inlineDataCell(row, column, columnIndex);
      cell.textContent = value === undefined
        ? 'undefined'
        : value === null
          ? 'null'
          : value === ''
            ? '""'
            : String(value);
      setStyles(cell, {
        padding: '9px 12px',
        borderRight: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
        textAlign: 'left',
        verticalAlign: 'top',
      });
      tableRow.append(cell);
    });
    body.append(tableRow);
  }
  table.append(body);
  wrapper.append(table);
  return wrapper;
}

interface ChartView {
  readonly chartContainer: HTMLElement;
  dispose(): void;
}

function createChartView(
  container: HTMLElement,
  data: InlineChartData,
  chartTitle: string | undefined,
  onShowChart: () => void,
  theme: unknown,
  labels: Readonly<MarkdownChartLabels>,
): ChartView {
  const colors = chartViewColors(theme);
  const hadCardClass = container.classList.contains('markdown-chart-card');
  const previousStyles = {
    margin: container.style.margin,
    minWidth: container.style.minWidth,
    maxWidth: container.style.maxWidth,
    overflow: container.style.overflow,
    border: container.style.border,
    borderRadius: container.style.borderRadius,
    background: container.style.background,
    boxShadow: container.style.boxShadow,
  };
  container.classList.add('markdown-chart-card');
  setStyles(container, {
    margin: '10px 0',
    minWidth: '0',
    maxWidth: '100%',
    overflow: 'hidden',
    border: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
    borderRadius: '8px',
    background: colors.background,
    boxShadow: '0 8px 22px rgb(15 23 42 / 5%)',
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'markdown-chart-toolbar';
  setStyles(toolbar, {
    display: 'flex',
    minHeight: '44px',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '0 10px 0 14px',
    borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
    background: colors.subtleBackground,
  });
  const normalizedTitle = chartTitle?.trim();
  let title: HTMLDivElement | undefined;
  if (normalizedTitle) {
    const titleElement = document.createElement('div');
    titleElement.className = 'markdown-chart-title';
    titleElement.textContent = normalizedTitle;
    setStyles(titleElement, {
      minWidth: '0',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: '13px',
      fontWeight: '600',
      lineHeight: '1.3',
    });
    title = titleElement;
  }
  const toggle = document.createElement('div');
  toggle.className = 'markdown-chart-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', labels.viewMode);
  setStyles(toggle, {
    display: 'inline-grid',
    flex: '0 0 auto',
    marginLeft: 'auto',
    gridTemplateColumns: 'repeat(2, 30px)',
    gap: '2px',
    padding: '2px',
    overflow: 'hidden',
    border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
    borderRadius: '6px',
    background: colors.background,
  });
  const chartButton = createViewButton(labels.chart, labels.showChart, createChartIcon());
  const dataButton = createViewButton(labels.data, labels.showData, createDataIcon());
  const chartContainer = document.createElement('div');
  chartContainer.className = 'markdown-chart-chart-view';
  chartContainer.dataset.markdownChartChartView = 'true';
  chartContainer.setAttribute('role', 'img');
  chartContainer.setAttribute('aria-label', labels.chart);
  setStyles(chartContainer, {
    width: 'calc(100% - 20px)',
    minHeight: 'inherit',
    margin: '8px 10px',
    background: colors.background,
  });
  const dataContainer = createInlineDataTable(data, colors, labels);
  dataContainer.hidden = true;
  const selectedBackground = 'var(--markdown-chart-accent, #0033ff)';
  const selectedForeground = 'var(--markdown-chart-accent-foreground, var(--markdown-chart-background, #ffffff))';
  const unselectedForeground = 'color-mix(in srgb, currentColor 68%, transparent)';

  const select = (mode: 'chart' | 'data'): void => {
    const chartSelected = mode === 'chart';
    chartButton.setAttribute('aria-pressed', String(chartSelected));
    dataButton.setAttribute('aria-pressed', String(!chartSelected));
    chartButton.style.background = chartSelected
      ? selectedBackground
      : 'transparent';
    chartButton.style.color = chartSelected ? selectedForeground : unselectedForeground;
    dataButton.style.background = chartSelected
      ? 'transparent'
      : selectedBackground;
    dataButton.style.color = chartSelected ? unselectedForeground : selectedForeground;
    chartContainer.hidden = !chartSelected;
    dataContainer.hidden = chartSelected;
  };
  const showChart = (): void => {
    select('chart');
    onShowChart();
  };
  const showData = (): void => select('data');
  chartButton.addEventListener('click', showChart);
  dataButton.addEventListener('click', showData);
  toggle.append(chartButton, dataButton);
  if (title) {
    toolbar.append(title);
  }
  toolbar.append(toggle);
  container.replaceChildren(toolbar, chartContainer, dataContainer);
  select('chart');

  return {
    chartContainer,
    dispose() {
      chartButton.removeEventListener('click', showChart);
      dataButton.removeEventListener('click', showData);
      if (!hadCardClass) {
        container.classList.remove('markdown-chart-card');
      }
      container.style.margin = previousStyles.margin;
      container.style.minWidth = previousStyles.minWidth;
      container.style.maxWidth = previousStyles.maxWidth;
      container.style.overflow = previousStyles.overflow;
      container.style.border = previousStyles.border;
      container.style.borderRadius = previousStyles.borderRadius;
      container.style.background = previousStyles.background;
      container.style.boxShadow = previousStyles.boxShadow;
    },
  };
}

export class ChartController {
  readonly #registry: ChartRendererRegistry;
  #generation = 0;
  #abortController: AbortController | undefined;
  #handle: ChartHandle | undefined;
  #view: ChartView | undefined;
  #hasCompletedRender = false;

  constructor(registry: ChartRendererRegistry) {
    this.#registry = registry;
  }

  async render(container: HTMLElement, request: ChartRenderRequest): Promise<void> {
    if (request.streaming) {
      if (this.#abortController) {
        this.#generation += 1;
        this.#abortController.abort();
        this.#abortController = undefined;
        this.#view?.dispose();
        this.#view = undefined;
        container.replaceChildren();
        this.#hasCompletedRender = false;
      }
      if (this.#hasCompletedRender) {
        container.removeAttribute('aria-busy');
      } else {
        showChartLoading(container, request.loadingLabel);
      }
      return;
    }

    const generation = ++this.#generation;
    this.#abortController?.abort();
    this.#handle?.dispose();
    this.#handle = undefined;
    this.#view?.dispose();
    this.#view = undefined;
    container.replaceChildren();
    this.#hasCompletedRender = false;
    showChartLoading(container, request.loadingLabel);

    const abortController = new AbortController();
    this.#abortController = abortController;
    try {
      const prepared = await this.#registry.prepare(request.language, request.source);
      if (generation !== this.#generation || abortController.signal.aborted) {
        return;
      }

      const materialized = prepared.renderer.materialize
        ? await prepared.renderer.materialize(prepared.parsed, {
            signal: abortController.signal,
            theme: request.theme,
            ...(request.referenceActions
              ? { referenceActions: request.referenceActions }
              : {}),
            language: prepared.language,
            rawLanguage: prepared.rawLanguage,
            rendererId: prepared.rendererId,
            data: prepared.data,
            ...(prepared.datasets ? { datasets: prepared.datasets } : {}),
          })
        : { parsed: prepared.parsed, data: prepared.data };
      if (generation !== this.#generation || abortController.signal.aborted) {
        return;
      }

      const inlineData = materialized.data?.kind === 'inline' ? materialized.data : undefined;
      const chartTitle = prepared.renderer.getTitle?.(materialized.parsed)?.trim() || undefined;
      const labels = resolveMarkdownChartLabels(request.labels);
      const view = inlineData
        ? createChartView(
            container,
            inlineData,
            chartTitle,
            () => this.#handle?.resize?.(),
            request.theme,
            labels,
          )
        : undefined;
      this.#view = view;
      const mountContainer = view?.chartContainer ?? container;
      showChartLoading(mountContainer, request.loadingLabel);
      const handle = await prepared.renderer.mount(mountContainer, materialized.parsed, {
        signal: abortController.signal,
        theme: request.theme,
        hostContainer: container,
        ...(request.referenceActions
          ? { referenceActions: request.referenceActions }
          : {}),
        ...(view && chartTitle ? { externalizedTitle: chartTitle } : {}),
      });
      if (generation !== this.#generation || abortController.signal.aborted) {
        handle?.dispose();
        return;
      }
      this.#handle = handle || undefined;
      this.#hasCompletedRender = true;
      removeChartLoading(mountContainer);
      container.removeAttribute('aria-busy');
    } catch (error) {
      if (generation !== this.#generation || abortController.signal.aborted) {
        return;
      }
      this.#view?.dispose();
      this.#view = undefined;
      container.replaceChildren();
      container.removeAttribute('aria-busy');
      this.#hasCompletedRender = false;
      throw error;
    } finally {
      if (this.#abortController === abortController) {
        this.#abortController = undefined;
      }
    }
  }

  dispose(): void {
    this.#generation += 1;
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#handle?.dispose();
    this.#handle = undefined;
    this.#view?.dispose();
    this.#view = undefined;
    this.#hasCompletedRender = false;
  }
}
