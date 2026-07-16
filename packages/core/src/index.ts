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
    value.forEach((item, index) => assertJsonValue(item, limits, state, depth + 1, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) {
    throw new MarkdownChartError('INVALID_JSON', `${path} contains a non-JSON value`);
  }
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains forbidden key ${key}`);
    }
    assertJsonValue(child, limits, state, depth + 1, `${path}.${key}`);
  }
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
        result[key] = cell as JsonPrimitive;
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

export interface ChartParseContext {
  readonly language: string;
  readonly rendererId: string;
  readonly data: ChartData | undefined;
}

export interface ChartMountContext {
  readonly signal: AbortSignal;
  readonly theme: unknown;
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
  readonly language: string;
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

export function normalizeFenceLanguage(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

export interface MarkdownChartEnvelope {
  readonly version: 1;
  readonly renderer: string;
  readonly data: ChartData | undefined;
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
    spec: body.spec as JsonValue,
  };
}

export class ChartRendererRegistry {
  readonly #renderers = new Map<string, ChartRenderer<unknown>>();
  readonly #names = new Map<string, string>();
  readonly #jsonLimits: Partial<JsonParseLimits>;

  constructor(options: ChartRegistryOptions = {}) {
    this.#jsonLimits = options.jsonLimits ?? {};
  }

  register<Parsed>(renderer: ChartRenderer<Parsed>): this {
    const id = normalizeName(renderer.id, 'renderer id');
    const names = [id, ...(renderer.aliases ?? []).map((alias) => normalizeName(alias, 'renderer alias'))];
    for (const name of names) {
      if (name === MARKDOWN_CHART_LANGUAGE) {
        throw new MarkdownChartError('RENDERER_CONFLICT', 'The canonical markdown-chart fence cannot be a renderer alias');
      }
      const existing = this.#names.get(name);
      if (existing) {
        throw new MarkdownChartError(
          'RENDERER_CONFLICT',
          `Renderer name ${name} is already owned by ${existing}`,
        );
      }
    }

    const erased = renderer as ChartRenderer<unknown>;
    this.#renderers.set(id, erased);
    names.forEach((name) => this.#names.set(name, id));
    return this;
  }

  has(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return normalized === MARKDOWN_CHART_LANGUAGE
      || this.#names.has(normalized)
      || [...this.#renderers.values()].some((renderer) => renderer.matchLanguage?.(normalized) === true);
  }

  get rendererIds(): readonly string[] {
    return [...this.#renderers.keys()];
  }

  async prepare(languageInfo: string, source: string): Promise<PreparedChart> {
    const language = normalizeFenceLanguage(languageInfo);

    let rendererId: string;
    let spec: JsonValue;
    let data: ChartData | undefined;
    let parseSource = false;
    if (language === MARKDOWN_CHART_LANGUAGE) {
      const envelope = parseMarkdownChartEnvelope(source, this.#jsonLimits);
      rendererId = envelope.renderer;
      spec = envelope.spec;
      data = envelope.data;
    } else {
      const exact = this.#names.get(language);
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
    const context: ChartParseContext = { language, rendererId, data };
    if (parseSource && !renderer.parseSource) {
      throw new MarkdownChartError(
        'SCHEMA_INVALID',
        `Renderer ${rendererId} matched ${language} but cannot parse its source`,
      );
    }
    const parsed = parseSource
      ? await renderer.parseSource!(source, context)
      : await renderer.parse(spec, context);
    return { renderer, parsed, data, language, rendererId };
  }
}

export interface ChartRenderRequest {
  readonly language: string;
  readonly source: string;
  readonly theme?: unknown;
  readonly streaming?: boolean;
}

export class ChartController {
  readonly #registry: ChartRendererRegistry;
  #generation = 0;
  #abortController: AbortController | undefined;
  #handle: ChartHandle | undefined;

  constructor(registry: ChartRendererRegistry) {
    this.#registry = registry;
  }

  async render(container: HTMLElement, request: ChartRenderRequest): Promise<void> {
    const generation = ++this.#generation;
    this.#abortController?.abort();
    this.#handle?.dispose();
    this.#handle = undefined;

    if (request.streaming) {
      this.#abortController = undefined;
      return;
    }

    const abortController = new AbortController();
    this.#abortController = abortController;
    const prepared = await this.#registry.prepare(request.language, request.source);
    if (generation !== this.#generation || abortController.signal.aborted) {
      return;
    }

    const handle = await prepared.renderer.mount(container, prepared.parsed, {
      signal: abortController.signal,
      theme: request.theme,
    });
    if (generation !== this.#generation || abortController.signal.aborted) {
      handle?.dispose();
      return;
    }
    this.#handle = handle || undefined;
  }

  dispose(): void {
    this.#generation += 1;
    this.#abortController?.abort();
    this.#abortController = undefined;
    this.#handle?.dispose();
    this.#handle = undefined;
  }
}
