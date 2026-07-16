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

const MARKDOWN_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Returns whether a Markdown fragment that starts with a fenced code block
 * contains its matching closing fence.
 *
 * Streaming adapters use this to distinguish an already completed chart from
 * the active, unterminated chart block at the tail of an LLM response.
 */
export function isMarkdownFenceClosed(source: string): boolean {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const opening = MARKDOWN_FENCE_OPEN.exec(lines[0] ?? '');
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
  return lines.slice(1).some((line) => closing.test(line));
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

function setStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

function createViewButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', `Show ${label.toLowerCase()}`);
  setStyles(button, {
    padding: '5px 10px',
    border: '0',
    borderRadius: '5px',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    font: 'inherit',
    fontSize: '12px',
  });
  return button;
}

function createInlineDataTable(data: InlineChartData): HTMLElement {
  const columns = inlineDataColumns(data);
  const visibleColumns = columns.slice(0, MAX_VISIBLE_DATA_COLUMNS);
  const visibleRows = data.source.slice(0, MAX_VISIBLE_DATA_ROWS);
  const wrapper = document.createElement('div');
  wrapper.className = 'markdown-chart-data-view';
  wrapper.dataset.markdownChartDataView = 'true';
  setStyles(wrapper, {
    maxHeight: 'min(60vh, 520px)',
    overflow: 'auto',
  });

  if (columns.length === 0 || data.source.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No data';
    setStyles(empty, { padding: '24px', textAlign: 'center', opacity: '0.68' });
    wrapper.append(empty);
    return wrapper;
  }

  if (visibleColumns.length < columns.length || visibleRows.length < data.source.length) {
    const notice = document.createElement('div');
    notice.className = 'markdown-chart-data-notice';
    notice.textContent = `Showing ${visibleRows.length} of ${data.source.length} rows and ${visibleColumns.length} of ${columns.length} columns.`;
    setStyles(notice, {
      position: 'sticky',
      top: '0',
      zIndex: '2',
      padding: '8px 12px',
      borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      background: 'Canvas',
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
    borderCollapse: 'collapse',
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
      padding: '8px 12px',
      border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      background: 'Canvas',
      textAlign: 'left',
      whiteSpace: 'nowrap',
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
      cell.textContent = value == null ? '' : String(value);
      setStyles(cell, {
        padding: '8px 12px',
        border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
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
  onShowChart: () => void,
): ChartView {
  container.classList.add('markdown-chart-card');
  setStyles(container, {
    overflow: 'hidden',
    border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
    borderRadius: '8px',
  });

  const toolbar = document.createElement('div');
  toolbar.className = 'markdown-chart-toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'View mode');
  setStyles(toolbar, {
    display: 'flex',
    minHeight: '40px',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '2px',
    padding: '0 8px',
    borderBottom: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
  });
  const chartButton = createViewButton('Chart');
  const dataButton = createViewButton('Data');
  const chartContainer = document.createElement('div');
  chartContainer.className = 'markdown-chart-chart-view';
  chartContainer.dataset.markdownChartChartView = 'true';
  setStyles(chartContainer, { width: '100%', minHeight: 'inherit' });
  const dataContainer = createInlineDataTable(data);
  dataContainer.hidden = true;

  const select = (mode: 'chart' | 'data'): void => {
    const chartSelected = mode === 'chart';
    chartButton.setAttribute('aria-pressed', String(chartSelected));
    dataButton.setAttribute('aria-pressed', String(!chartSelected));
    chartButton.style.background = chartSelected ? 'Highlight' : 'transparent';
    chartButton.style.color = chartSelected ? 'HighlightText' : 'inherit';
    dataButton.style.background = chartSelected ? 'transparent' : 'Highlight';
    dataButton.style.color = chartSelected ? 'inherit' : 'HighlightText';
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
  toolbar.append(chartButton, dataButton);
  container.replaceChildren(toolbar, chartContainer, dataContainer);
  select('chart');

  return {
    chartContainer,
    dispose() {
      chartButton.removeEventListener('click', showChart);
      dataButton.removeEventListener('click', showData);
    },
  };
}

export class ChartController {
  readonly #registry: ChartRendererRegistry;
  #generation = 0;
  #abortController: AbortController | undefined;
  #handle: ChartHandle | undefined;
  #view: ChartView | undefined;

  constructor(registry: ChartRendererRegistry) {
    this.#registry = registry;
  }

  async render(container: HTMLElement, request: ChartRenderRequest): Promise<void> {
    if (request.streaming) {
      return;
    }

    const generation = ++this.#generation;
    this.#abortController?.abort();
    this.#handle?.dispose();
    this.#handle = undefined;
    this.#view?.dispose();
    this.#view = undefined;
    container.replaceChildren();

    const abortController = new AbortController();
    this.#abortController = abortController;
    const prepared = await this.#registry.prepare(request.language, request.source);
    if (generation !== this.#generation || abortController.signal.aborted) {
      return;
    }

    const inlineData = prepared.data?.kind === 'inline' ? prepared.data : undefined;
    const view = inlineData
      ? createChartView(container, inlineData, () => this.#handle?.resize?.())
      : undefined;
    this.#view = view;
    const handle = await prepared.renderer.mount(view?.chartContainer ?? container, prepared.parsed, {
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
    this.#view?.dispose();
    this.#view = undefined;
  }
}
