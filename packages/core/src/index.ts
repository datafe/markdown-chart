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

export interface ChartMaterializeContext extends ChartMountContext {
  readonly language: string;
  readonly rendererId: string;
  readonly data: ChartData | undefined;
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

function createViewButton(label: string, icon: SVGSVGElement): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', `Show ${label.toLowerCase()}`);
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

function createInlineDataTable(data: InlineChartData, colors: ChartViewColors): HTMLElement {
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
  onShowChart: () => void,
  theme: unknown,
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
  const title = document.createElement('div');
  title.className = 'markdown-chart-title';
  title.textContent = 'Chart';
  setStyles(title, {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: '1.3',
  });
  const toggle = document.createElement('div');
  toggle.className = 'markdown-chart-toggle';
  toggle.setAttribute('role', 'group');
  toggle.setAttribute('aria-label', 'View mode');
  setStyles(toggle, {
    display: 'inline-grid',
    flex: '0 0 auto',
    gridTemplateColumns: 'repeat(2, 30px)',
    gap: '2px',
    padding: '2px',
    overflow: 'hidden',
    border: '1px solid color-mix(in srgb, currentColor 16%, transparent)',
    borderRadius: '6px',
    background: colors.background,
  });
  const chartButton = createViewButton('Chart', createChartIcon());
  const dataButton = createViewButton('Data', createDataIcon());
  const chartContainer = document.createElement('div');
  chartContainer.className = 'markdown-chart-chart-view';
  chartContainer.dataset.markdownChartChartView = 'true';
  chartContainer.setAttribute('role', 'img');
  chartContainer.setAttribute('aria-label', 'Chart');
  setStyles(chartContainer, {
    width: 'calc(100% - 20px)',
    minHeight: 'inherit',
    margin: '0 10px 8px',
    background: colors.background,
  });
  const dataContainer = createInlineDataTable(data, colors);
  dataContainer.hidden = true;

  const select = (mode: 'chart' | 'data'): void => {
    const chartSelected = mode === 'chart';
    chartButton.setAttribute('aria-pressed', String(chartSelected));
    dataButton.setAttribute('aria-pressed', String(!chartSelected));
    chartButton.style.background = chartSelected
      ? 'var(--markdown-chart-accent, #0033ff)'
      : 'transparent';
    chartButton.style.color = chartSelected ? '#ffffff' : 'color-mix(in srgb, currentColor 68%, transparent)';
    dataButton.style.background = chartSelected
      ? 'transparent'
      : 'var(--markdown-chart-accent, #0033ff)';
    dataButton.style.color = chartSelected ? 'color-mix(in srgb, currentColor 68%, transparent)' : '#ffffff';
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
  toolbar.append(title, toggle);
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
            language: prepared.language,
            rendererId: prepared.rendererId,
            data: prepared.data,
          })
        : { parsed: prepared.parsed, data: prepared.data };
      if (generation !== this.#generation || abortController.signal.aborted) {
        return;
      }

      const inlineData = materialized.data?.kind === 'inline' ? materialized.data : undefined;
      const view = inlineData
        ? createChartView(container, inlineData, () => this.#handle?.resize?.(), request.theme)
        : undefined;
      this.#view = view;
      const handle = await prepared.renderer.mount(view?.chartContainer ?? container, materialized.parsed, {
        signal: abortController.signal,
        theme: request.theme,
      });
      if (generation !== this.#generation || abortController.signal.aborted) {
        handle?.dispose();
        return;
      }
      this.#handle = handle || undefined;
    } catch (error) {
      if (generation !== this.#generation || abortController.signal.aborted) {
        return;
      }
      this.#view?.dispose();
      this.#view = undefined;
      container.replaceChildren();
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
  }
}
