import {
  MarkdownChartError,
  isJsonObject,
  validateChartJsonValue,
  type ChartHandle,
  type ChartDataRow,
  type ChartRenderer,
  type InlineChartData,
  type JsonPrimitive,
  type JsonValue,
  type RefChartData,
} from '@datafe-open/markdown-chart';
import {
  isLegacyEChartLanguage,
  isLegacyEChartSandboxFileLanguage,
  parseLegacyEChartQueryBlock,
  parseLegacyEChartSandboxFileBlock,
  resolveLegacyArtifactLimits,
  resolveLegacyArtifactQuery,
  resolveLegacySandboxFile,
  type LegacyArtifactLimits,
  type LegacyEChartQueryBlock,
  type LegacyEChartSandboxFileBlock,
  type ResolveLegacyArtifactContent,
  type ResolveLegacyEChartQuery,
  type ResolveLegacySandboxFileContent,
} from './legacy';

export type {
  LegacyArtifactContentRequest,
  LegacyArtifactLimits,
  LegacyEChartQueryBlock,
  LegacyEChartQueryRequest,
  LegacyEChartSandboxFileBlock,
  LegacySandboxFileContentRequest,
  ResolveLegacyArtifactContent,
  ResolveLegacySandboxFileContent,
  ResolvedLegacyEChartQuery,
  ResolveLegacyEChartQuery,
} from './legacy';
export { DEFAULT_LEGACY_ARTIFACT_LIMITS } from './legacy';

export type DatasetRow = ChartDataRow;
export type InlineDataset = InlineChartData;
export type RefDataset = RefChartData;

export type EChartsDataset = InlineDataset | RefDataset;

export interface CompactInlineData {
  readonly kind: 'inline';
  readonly dimensions: readonly string[];
  readonly source: readonly (readonly JsonPrimitive[])[];
}

export interface CompactRefData {
  readonly kind: 'ref';
  readonly ref: string;
  readonly format: 'csv' | 'json';
  readonly dimensions: readonly string[];
}

export interface DataWorksChartEChartsEnvelope {
  readonly version: 1;
  readonly data: CompactInlineData | CompactRefData;
  readonly option: Record<string, JsonValue>;
}

export interface ResolvedDataset {
  readonly dimensions?: readonly string[];
  readonly source: readonly DatasetRow[];
}

export interface ResolveDataRefContext {
  readonly format: 'csv' | 'json' | undefined;
  readonly dimensions: readonly string[] | undefined;
  readonly signal: AbortSignal;
}

export type ResolveDataRef = (
  ref: string,
  context: ResolveDataRefContext,
) => ResolvedDataset | Promise<ResolvedDataset>;

export interface EChartsInstance {
  setOption(option: Record<string, JsonValue>, options?: Record<string, JsonValue>): void;
  resize(): void;
  dispose(): void;
}

export interface EChartsRuntime {
  init(container: HTMLElement, theme?: string | object | null): EChartsInstance;
}

export type LoadedEChartsRuntime = EChartsRuntime | { readonly default: EChartsRuntime };

export interface EChartsLimits {
  readonly maxRows: number;
  readonly maxCells: number;
  readonly maxSeries: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
}

export const DEFAULT_ECHARTS_LIMITS: Readonly<EChartsLimits> = Object.freeze({
  maxRows: 2_000,
  maxCells: 40_000,
  maxSeries: 100,
  maxDepth: 40,
  maxNodes: 100_000,
});

export interface CreateEChartsRendererOptions {
  readonly loadECharts?: () => LoadedEChartsRuntime | Promise<LoadedEChartsRuntime>;
  readonly resolveDataRef?: ResolveDataRef;
  readonly validateDataRef?: (ref: string) => boolean;
  readonly limits?: Partial<EChartsLimits>;
  readonly resizeObserver?: boolean;
  /** Apply Qwen Code WebShell-inspired safe defaults while preserving explicit spec values. */
  readonly defaultStyle?: boolean;
  /**
   * @deprecated Temporary ChatBI migration hook. Return raw CSV ArtifactContent.
   * The renderer parses the CSV and converts the legacy source in an isolated iframe.
   */
  readonly resolveLegacyArtifactContent?: ResolveLegacyArtifactContent;
  /** @deprecated Temporary ChatBI sandbox-file migration hook. Return raw CSV. */
  readonly resolveLegacySandboxFileContent?: ResolveLegacySandboxFileContent;
  /** @deprecated Limits for the temporary ChatBI migration adapter. */
  readonly legacyArtifactLimits?: Partial<LegacyArtifactLimits>;
  /** @deprecated Temporary ChatBI migration hook. Do not use for new content. */
  readonly resolveLegacyEChartQuery?: ResolveLegacyEChartQuery;
}

export interface ParsedEChartsSpec {
  readonly option: Record<string, JsonValue>;
  readonly data: EChartsDataset | undefined;
  /** @deprecated Temporary ChatBI migration state. */
  readonly legacyEChartQuery?: LegacyEChartQueryBlock;
  /** @deprecated Temporary ChatBI migration state. */
  readonly legacyEChartSandboxFile?: LegacyEChartSandboxFileBlock;
}

const ALLOWED_TOP_LEVEL_OPTION_KEYS = new Set([
  'angleAxis',
  'aria',
  'animation',
  'animationDelay',
  'animationDelayUpdate',
  'animationDuration',
  'animationDurationUpdate',
  'animationEasing',
  'animationEasingUpdate',
  'animationThreshold',
  'axisPointer',
  'backgroundColor',
  'blendMode',
  'brush',
  'calendar',
  'color',
  'darkMode',
  'dataset',
  'dataZoom',
  'geo',
  'grid',
  'hoverLayerThreshold',
  'legend',
  'parallel',
  'parallelAxis',
  'polar',
  'progressive',
  'progressiveChunkMode',
  'progressiveThreshold',
  'radar',
  'radiusAxis',
  'series',
  'singleAxis',
  'stateAnimation',
  'textStyle',
  'title',
  'tooltip',
  'useUTC',
  'visualMap',
  'xAxis',
  'yAxis',
]);
const FORBIDDEN_OPTION_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
  'extracsstext',
  'renderitem',
  'graphic',
  'image',
  'toolbox',
  'dataview',
  'transform',
  'link',
  'sublink',
  'href',
  'src',
  'url',
]);
const URL_BEARING_OPTION_KEY = /(?:url|uri|href|src|link)$/i;
const UNSAFE_ASCII_CONTROL_CHARACTER = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const URL_LIKE = /(?:^|[\s("'=])(?:https?:|file:|ftp:|blob:|data:|javascript:|vbscript:|\/\/|image:\/\/)/i;
const CSS_URL_LIKE = /\burl\s*\(/i;
const HTML_LIKE_MARKUP = /<\s*\/?\s*[a-z][^>]*>/i;
const HTML_ENTITY = /&(?:#\d+|#x[\da-f]+|[a-z][\da-z]+);/i;
const COMPACT_DIMENSION = /^[A-Za-z_][A-Za-z0-9_]*$/;

function schemaError(message: string): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message);
}

function assertOwnKeys(value: Record<string, JsonValue>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      schemaError(`${path}.${key} is not allowed`);
    }
  }
}

function readCompactDimensions(value: JsonValue | undefined, path: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    return schemaError(`${path} must be a non-empty array`);
  }
  const dimensions = value.map((item, index) => {
    if (typeof item !== 'string' || !COMPACT_DIMENSION.test(item)) {
      return schemaError(`${path}[${index}] must be a stable ASCII identifier`);
    }
    return item;
  });
  if (new Set(dimensions).size !== dimensions.length) {
    return schemaError(`${path} must not contain duplicate dimensions`);
  }
  return dimensions;
}

function parseCompactData(value: JsonValue, limits: EChartsLimits): EChartsDataset {
  if (!isJsonObject(value) || typeof value.kind !== 'string') {
    return schemaError('echarts-fulldata.data must be an inline or ref dataset object');
  }
  if (value.kind === 'inline') {
    assertOwnKeys(value, new Set(['kind', 'dimensions', 'source']), 'echarts-fulldata.data');
    const dimensions = readCompactDimensions(value.dimensions, 'echarts-fulldata.data.dimensions');
    if (!Array.isArray(value.source)) {
      return schemaError('echarts-fulldata.data.source must be an array');
    }
    value.source.forEach((row, rowIndex) => {
      if (!Array.isArray(row)) {
        schemaError(`echarts-fulldata.data.source[${rowIndex}] must be an array`);
      }
      if (row.length !== dimensions.length) {
        schemaError(`echarts-fulldata.data.source[${rowIndex}] must contain ${dimensions.length} cells`);
      }
    });
    const source = validateRows(value.source, limits, 'echarts-fulldata.data.source');
    return { kind: 'inline', dimensions, source };
  }
  if (value.kind === 'ref') {
    assertOwnKeys(value, new Set(['kind', 'ref', 'format', 'dimensions']), 'echarts-fulldata.data');
    if (typeof value.ref !== 'string' || value.ref.trim().length === 0) {
      return schemaError('echarts-fulldata.data.ref must be a non-empty string');
    }
    if (value.format !== 'csv' && value.format !== 'json') {
      return schemaError('echarts-fulldata.data.format must be csv or json');
    }
    const dimensions = readCompactDimensions(value.dimensions, 'echarts-fulldata.data.dimensions');
    return { kind: 'ref', ref: value.ref, format: value.format, dimensions };
  }
  return schemaError(`Unsupported echarts-fulldata.data.kind: ${value.kind}`);
}

interface EChartsTitleEntry {
  readonly index: number;
  readonly isArray: boolean;
  readonly title: Record<string, JsonValue>;
  readonly text: string;
}

function findEChartsTitleEntry(option: Record<string, JsonValue>): EChartsTitleEntry | undefined {
  const isArray = Array.isArray(option.title);
  const titles = isArray ? option.title as JsonValue[] : [option.title];
  for (const [index, title] of titles.entries()) {
    if (!isJsonObject(title) || typeof title.text !== 'string') {
      continue;
    }
    const text = title.text.trim();
    if (text) {
      return { index, isArray, title, text };
    }
  }
  return undefined;
}

function getEChartsTitle(option: Record<string, JsonValue>): string | undefined {
  return findEChartsTitleEntry(option)?.text;
}

function removeExternalizedEChartsTitle(
  option: Record<string, JsonValue>,
  externalizedTitle: string,
): void {
  const match = findEChartsTitleEntry(option);
  if (!match || match.text !== externalizedTitle.trim()) {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(match.title, 'subtext')) {
    delete match.title.text;
    return;
  }
  if (match.isArray) {
    (option.title as JsonValue[]).splice(match.index, 1);
    return;
  }
  delete option.title;
}

function cloneJson<T extends JsonValue>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJson(item)) as T;
  }
  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    ) as T;
  }
  return value;
}

function readDimensions(value: JsonValue | undefined, path: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    schemaError(`${path} must be an array of non-empty strings`);
  }
  return [...value] as string[];
}

function validateRows(
  value: unknown,
  limits: EChartsLimits,
  path: string,
): DatasetRow[] {
  if (!Array.isArray(value)) {
    schemaError(`${path} must be an array`);
  }
  if (value.length > limits.maxRows) {
    throw new MarkdownChartError('LIMIT_EXCEEDED', `${path} exceeds the ${limits.maxRows} row limit`);
  }

  let cells = 0;
  const rows = value.map((row, rowIndex): DatasetRow => {
    if (Array.isArray(row)) {
      const output = row.map((cell, cellIndex) => {
        if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
          schemaError(`${path}[${rowIndex}][${cellIndex}] must be a JSON scalar`);
        }
        return cell as JsonPrimitive;
      });
      cells += output.length;
      return output;
    }
    if (isJsonObject(row)) {
      const output: Record<string, JsonPrimitive> = {};
      for (const [key, cell] of Object.entries(row)) {
        if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) {
          schemaError(`${path}[${rowIndex}].${key} must be a JSON scalar`);
        }
        output[key] = cell as JsonPrimitive;
        cells += 1;
      }
      return output;
    }
    return schemaError(`${path}[${rowIndex}] must be an array or object`);
  });

  if (cells > limits.maxCells) {
    throw new MarkdownChartError('LIMIT_EXCEEDED', `${path} exceeds the ${limits.maxCells} cell limit`);
  }
  return rows;
}

function parseData(value: unknown, limits: EChartsLimits): EChartsDataset {
  if (!isJsonObject(value) || typeof value.kind !== 'string') {
    return schemaError('echarts.data must be an inline or ref dataset object');
  }
  const dimensions = readDimensions(value.dimensions, 'echarts.data.dimensions');
  if (value.kind === 'inline') {
    const source = validateRows(value.source, limits, 'echarts.data.source');
    return dimensions ? { kind: 'inline', dimensions, source } : { kind: 'inline', source };
  }
  if (value.kind === 'ref') {
    if (typeof value.ref !== 'string' || value.ref.length === 0) {
      return schemaError('echarts.data.ref must be a non-empty string');
    }
    if (value.format !== undefined && value.format !== 'csv' && value.format !== 'json') {
      return schemaError('echarts.data.format must be csv or json');
    }
    const result: RefDataset = {
      kind: 'ref',
      ref: value.ref,
      ...(value.format ? { format: value.format } : {}),
      ...(dimensions ? { dimensions } : {}),
    };
    return result;
  }
  return schemaError(`Unsupported echarts.data.kind: ${value.kind}`);
}

function assertSafeString(value: string, path: string): void {
  if (UNSAFE_ASCII_CONTROL_CHARACTER.test(value)) {
    throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains an ASCII control character`);
  }
  const normalizedForProtocolCheck = value.replace(/[\n\r\t]/g, '');
  const trimmed = value.trim();
  if (
    URL_LIKE.test(trimmed)
    || URL_LIKE.test(normalizedForProtocolCheck.trim())
    || CSS_URL_LIKE.test(value)
    || HTML_LIKE_MARKUP.test(value)
    || HTML_ENTITY.test(value)
  ) {
    throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains a URL, CSS URL, or unsafe markup`);
  }
}

function assertSafeOption(option: Record<string, JsonValue>, limits: EChartsLimits): void {
  for (const key of Object.keys(option)) {
    if (!ALLOWED_TOP_LEVEL_OPTION_KEYS.has(key)) {
      throw new MarkdownChartError('UNSAFE_SPEC', `echarts.option.${key} is not allowed`);
    }
  }

  let nodes = 0;
  const visit = (value: JsonValue, path: string, depth: number): void => {
    nodes += 1;
    if (nodes > limits.maxNodes) {
      throw new MarkdownChartError('LIMIT_EXCEEDED', `ECharts option exceeds the ${limits.maxNodes} node limit`);
    }
    if (depth > limits.maxDepth) {
      throw new MarkdownChartError('LIMIT_EXCEEDED', `ECharts option exceeds the ${limits.maxDepth} depth limit`);
    }
    if (typeof value === 'string') {
      assertSafeString(value, path);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${path}[${index}]`, depth + 1));
      return;
    }
    if (!isJsonObject(value)) {
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase();
      if (normalizedKey === 'formatter') {
        if (typeof child !== 'string') {
          throw new MarkdownChartError('UNSAFE_SPEC', `${path}.${key} must be a string`);
        }
        assertSafeString(child, `${path}.${key}`);
        continue;
      }
      if (FORBIDDEN_OPTION_KEYS.has(normalizedKey) || URL_BEARING_OPTION_KEY.test(key)) {
        throw new MarkdownChartError('UNSAFE_SPEC', `${path}.${key} is not allowed`);
      }
      if (key === 'type' && child === 'custom') {
        throw new MarkdownChartError('UNSAFE_SPEC', 'Custom ECharts series are not allowed');
      }
      visit(child, `${path}.${key}`, depth + 1);
    }
  };
  visit(option, 'echarts.option', 0);

  if (Array.isArray(option.series) && option.series.length > limits.maxSeries) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `ECharts option exceeds the ${limits.maxSeries} series limit`,
    );
  }

  if (option.dataset !== undefined) {
    const datasets = Array.isArray(option.dataset) ? option.dataset : [option.dataset];
    datasets.forEach((dataset, index) => {
      if (!isJsonObject(dataset)) {
        schemaError(`echarts.option.dataset[${index}] must be an object`);
      }
      if (dataset.source !== undefined) {
        validateRows(dataset.source, limits, `echarts.option.dataset[${index}].source`);
      }
    });
  }
}

function parseSpec(
  spec: JsonValue,
  envelopeData: unknown,
  limits: EChartsLimits,
): ParsedEChartsSpec {
  if (!isJsonObject(spec)) {
    return schemaError('ECharts specification must be an object');
  }

  if (
    Object.prototype.hasOwnProperty.call(spec, 'option')
    || Object.prototype.hasOwnProperty.call(spec, 'data')
  ) {
    return schemaError(
      'Canonical markdown-chart data must be a sibling of spec; spec must contain the ECharts option directly',
    );
  }
  const option = cloneJson(spec);
  const data = envelopeData === undefined ? undefined : parseData(envelopeData, limits);

  if (data && Object.prototype.hasOwnProperty.call(option, 'dataset')) {
    return schemaError('echarts.option.dataset cannot be combined with echarts.data');
  }
  assertSafeOption(option, limits);
  return { option, data };
}

function parseCompactEnvelope(
  value: JsonValue,
  limits: EChartsLimits,
): ParsedEChartsSpec {
  if (!isJsonObject(value)) {
    return schemaError('echarts-fulldata must contain an object');
  }
  assertOwnKeys(value, new Set(['version', 'data', 'option']), 'echarts-fulldata');
  if (value.version !== 1) {
    throw new MarkdownChartError(
      'UNSUPPORTED_VERSION',
      'Only echarts-fulldata version 1 is supported',
    );
  }
  if (!Object.prototype.hasOwnProperty.call(value, 'data')) {
    return schemaError('echarts-fulldata.data is required');
  }
  if (!isJsonObject(value.option)) {
    return schemaError('echarts-fulldata.option must be an object');
  }
  const data = parseCompactData(value.data as JsonValue, limits);
  return parseSpec(value.option, data, limits);
}

function normalizeRuntime(loaded: LoadedEChartsRuntime): EChartsRuntime {
  const runtime = 'default' in loaded ? loaded.default : loaded;
  if (!runtime || typeof runtime.init !== 'function') {
    throw new MarkdownChartError('RUNTIME_LOAD_FAILED', 'The supplied ECharts runtime has no init function');
  }
  return runtime;
}

function materializeDataset(
  dataset: ResolvedDataset,
  limits: EChartsLimits,
): { readonly data: InlineDataset; readonly option: Record<string, JsonValue> } {
  const source = validateRows(dataset.source, limits, 'resolvedDataset.source');
  const dimensions = dataset.dimensions
    ? readDimensions(dataset.dimensions as unknown as JsonValue, 'resolvedDataset.dimensions')
    : undefined;
  return dimensions
    ? {
        data: { kind: 'inline', dimensions, source },
        option: { dimensions, source },
      }
    : {
        data: { kind: 'inline', source },
        option: { source },
      };
}

type DefaultStyleTheme = 'light' | 'dark';

const DEFAULT_STYLE_THEME = {
  light: {
    background: '#ffffff',
    foreground: '#343434',
    legendText: '#555555',
    titleText: '#343434',
    subtext: '#aaaaaa',
    axisLine: '#5d666f',
    valueAxisLine: '#6E7079',
    axisLabel: '#838d95',
    splitLine: '#e0e6f1',
    splitAreaA: 'rgba(250,250,250,0.2)',
    splitAreaB: 'rgba(210,219,238,0.2)',
    seriesBorder: '#ffffff',
    pointer: '#7c8a96',
    tooltipBg: '#ffffff',
    primary: '#6250f9',
    palette: [
      '#6250F9', '#33AFA9', '#AB7BFF', '#5F99F9',
      '#A9AFFF', '#60CCC5', '#C2A5FF', '#8EB8FE',
      '#E0E3FE', '#98E3DD', '#E8E1FA', '#D7E6FF',
    ],
  },
  dark: {
    background: '#0d0d0d',
    foreground: '#f4f7ff',
    legendText: '#c8cad0',
    titleText: '#e0e2e8',
    subtext: '#8a8d93',
    axisLine: '#555a63',
    valueAxisLine: '#555a63',
    axisLabel: '#9da1a8',
    splitLine: '#3a3e47',
    splitAreaA: 'rgba(60,60,70,0.2)',
    splitAreaB: 'rgba(80,80,90,0.2)',
    seriesBorder: '#2a2d35',
    pointer: '#6a707a',
    tooltipBg: 'rgba(30, 32, 40, 0.95)',
    primary: '#8aa0ff',
    palette: [
      '#8EA0FF', '#61D6D1', '#C8A7FF', '#8EB8FE',
      '#C7CCFF', '#8DE7E2', '#D8C5FF', '#B8D2FF',
      '#EEF0FF', '#C2F0ED', '#F0EAFE', '#E8F1FF',
    ],
  },
} satisfies Record<DefaultStyleTheme, {
  background: string;
  foreground: string;
  legendText: string;
  titleText: string;
  subtext: string;
  axisLine: string;
  valueAxisLine: string;
  axisLabel: string;
  splitLine: string;
  splitAreaA: string;
  splitAreaB: string;
  seriesBorder: string;
  pointer: string;
  tooltipBg: string;
  primary: string;
  palette: string[];
}>;

function mergeObjectDefaults(
  defaults: Record<string, JsonValue>,
  value: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const merged: Record<string, JsonValue> = { ...cloneJson(defaults), ...value };
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const explicitValue = value[key];
    if (isJsonObject(defaultValue) && isJsonObject(explicitValue)) {
      merged[key] = mergeObjectDefaults(defaultValue, explicitValue);
    }
  }
  return merged;
}

function styleComponent(
  value: JsonValue | undefined,
  defaults: Record<string, JsonValue>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => isJsonObject(entry)
      ? mergeObjectDefaults(defaults, entry)
      : entry);
  }
  if (isJsonObject(value)) {
    return mergeObjectDefaults(defaults, value);
  }
  return value === undefined || value === null ? cloneJson(defaults) : value;
}

function styleAxis(
  value: JsonValue,
  defaults: (index: number) => Record<string, JsonValue>,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry, index) => isJsonObject(entry)
      ? mergeObjectDefaults(defaults(index), entry)
      : entry);
  }
  return isJsonObject(value) ? mergeObjectDefaults(defaults(0), value) : value;
}

function styleSeriesEntry(
  series: Record<string, JsonValue>,
  tokens: (typeof DEFAULT_STYLE_THEME)[DefaultStyleTheme],
): Record<string, JsonValue> {
  const type = typeof series.type === 'string' ? series.type : undefined;
  let defaults: Record<string, JsonValue> = {
    emphasis: {
      focus: 'series',
      itemStyle: { borderColor: tokens.seriesBorder, borderWidth: 2 },
    },
    labelLayout: { hideOverlap: true },
  };
  if (type === 'line') {
    defaults = mergeObjectDefaults(defaults, {
      lineStyle: { width: 2 },
      itemStyle: { borderWidth: 1 },
      symbol: 'circle',
      symbolSize: 4,
    });
  } else if (type === 'bar') {
    defaults = mergeObjectDefaults(defaults, {
      barCategoryGap: '48%',
      barMaxWidth: 42,
      itemStyle: { borderRadius: [3, 3, 0, 0] },
    });
  } else if (type === 'pie') {
    defaults = mergeObjectDefaults(defaults, {
      itemStyle: { borderColor: tokens.seriesBorder, borderWidth: 2 },
    });
  }
  return mergeObjectDefaults(defaults, series);
}

function defaultTooltipTrigger(option: Record<string, JsonValue>): 'axis' | 'item' {
  if (!Object.prototype.hasOwnProperty.call(option, 'xAxis')
    && !Object.prototype.hasOwnProperty.call(option, 'yAxis')) {
    return 'item';
  }
  const series = Array.isArray(option.series)
    ? option.series.filter(isJsonObject)
    : isJsonObject(option.series) ? [option.series] : [];
  const itemOnlyTypes = new Set(['pie', 'funnel', 'gauge', 'radar', 'treemap']);
  return series.length > 0
    && series.every((entry) => typeof entry.type === 'string' && itemOnlyTypes.has(entry.type))
    ? 'item'
    : 'axis';
}

function resolveDefaultStyleTheme(theme: unknown): DefaultStyleTheme | undefined {
  if (theme === undefined || theme === null || theme === 'light') {
    return 'light';
  }
  return theme === 'dark' ? 'dark' : undefined;
}

export function applyEChartsDefaultStyle(
  option: Record<string, JsonValue>,
  theme: DefaultStyleTheme = 'light',
): Record<string, JsonValue> {
  const tokens = DEFAULT_STYLE_THEME[theme];
  const styled = cloneJson(option);
  styled.backgroundColor ??= tokens.background;
  styled.color ??= [...tokens.palette];
  styled.textStyle = styleComponent(styled.textStyle, {
    color: tokens.foreground,
    fontFamily: "'pingfang SC', 'helvetica neue', arial, 'hiragino sans gb', 'microsoft yahei ui', 'microsoft yahei', sans-serif",
  });
  if (styled.title !== undefined) {
    styled.title = styleComponent(styled.title, {
      textStyle: { color: tokens.titleText },
      subtextStyle: { color: tokens.subtext },
    });
  }
  styled.grid = styleComponent(styled.grid, {
    top: 24,
    right: 36,
    bottom: 48,
    left: 24,
    containLabel: true,
  });
  styled.tooltip = styleComponent(styled.tooltip, {
    trigger: defaultTooltipTrigger(option),
    confine: true,
    enterable: false,
    renderMode: 'richText',
    backgroundColor: tokens.tooltipBg,
    borderColor: tokens.splitLine,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tokens.titleText, fontSize: 12 },
    axisPointer: {
      lineStyle: { color: tokens.pointer, width: 1 },
      crossStyle: { color: tokens.pointer, width: 1 },
    },
  });
  styled.legend = styleComponent(styled.legend, {
    type: 'scroll',
    bottom: 8,
    padding: [4, 16],
    textStyle: { color: tokens.legendText, fontSize: 12 },
    pageIconColor: tokens.primary,
    pageIconInactiveColor: tokens.splitLine,
    pageTextStyle: { color: tokens.legendText },
  });
  if (styled.xAxis !== undefined) {
    styled.xAxis = styleAxis(styled.xAxis, () => ({
      axisLine: { show: true, lineStyle: { color: tokens.axisLine } },
      axisTick: { show: true, lineStyle: { color: tokens.axisLine } },
      axisLabel: { color: tokens.axisLabel, fontSize: 12, hideOverlap: true },
      splitLine: { show: false, lineStyle: { color: tokens.splitLine } },
      splitArea: {
        show: false,
        areaStyle: { color: [tokens.splitAreaA, tokens.splitAreaB] },
      },
      nameTextStyle: { color: tokens.axisLabel },
    }));
  }
  if (styled.yAxis !== undefined) {
    styled.yAxis = styleAxis(styled.yAxis, (index) => ({
      alignTicks: true,
      axisLine: { show: false, lineStyle: { color: tokens.valueAxisLine } },
      axisTick: { show: false, lineStyle: { color: tokens.valueAxisLine } },
      axisLabel: { color: tokens.axisLabel, fontSize: 12, hideOverlap: true },
      splitLine: { show: index === 0, lineStyle: { color: tokens.splitLine } },
      splitArea: {
        show: false,
        areaStyle: { color: [tokens.splitAreaA, tokens.splitAreaB] },
      },
      nameGap: 12,
      nameTextStyle: { color: tokens.axisLabel, align: index === 0 ? 'left' : 'right' },
    }));
  }
  if (Array.isArray(styled.series)) {
    styled.series = styled.series.map((entry) => isJsonObject(entry)
      ? styleSeriesEntry(entry, tokens)
      : entry);
  } else if (isJsonObject(styled.series)) {
    styled.series = styleSeriesEntry(styled.series, tokens);
  }
  return styled;
}

const EMPTY_HANDLE: ChartHandle = { dispose() {} };

export function createEChartsRenderer(
  options: CreateEChartsRendererOptions = {},
): ChartRenderer<ParsedEChartsSpec> {
  if (options.resolveLegacyArtifactContent && options.resolveLegacyEChartQuery) {
    throw new MarkdownChartError(
      'SCHEMA_INVALID',
      'Configure either resolveLegacyArtifactContent or resolveLegacyEChartQuery, not both',
    );
  }
  const limits: EChartsLimits = { ...DEFAULT_ECHARTS_LIMITS, ...options.limits };
  const legacyArtifactLimits = options.resolveLegacyArtifactContent
    || options.resolveLegacySandboxFileContent
    ? resolveLegacyArtifactLimits({
        maxRows: limits.maxRows,
        maxCells: limits.maxCells,
      }, options.legacyArtifactLimits)
    : undefined;
  const loadECharts = options.loadECharts ?? (async () => (
    await import('echarts') as unknown as LoadedEChartsRuntime
  ));
  const resolveReferencedData = async (
    data: RefDataset,
    signal: AbortSignal,
  ): Promise<InlineDataset | undefined> => {
    if (options.validateDataRef && !options.validateDataRef(data.ref)) {
      throw new MarkdownChartError('REF_REJECTED', 'The host rejected the chart data reference');
    }
    if (!options.resolveDataRef) {
      throw new MarkdownChartError('REF_RESOLVER_MISSING', 'A resolveDataRef callback is required');
    }
    let resolvedDataset: ResolvedDataset;
    try {
      resolvedDataset = await options.resolveDataRef(data.ref, {
        format: data.format,
        dimensions: data.dimensions,
        signal,
      });
    } catch (cause) {
      if (signal.aborted) {
        return undefined;
      }
      throw new MarkdownChartError(
        'REF_RESOLUTION_FAILED',
        'The chart dataset could not be resolved',
        { cause },
      );
    }
    if (signal.aborted) {
      return undefined;
    }
    const dataset = resolvedDataset.dimensions || !data.dimensions
      ? resolvedDataset
      : { ...resolvedDataset, dimensions: data.dimensions };
    return materializeDataset(dataset, limits).data;
  };

  return {
    id: 'echarts',
    aliases: ['echarts-fulldata'],
    matchLanguage: isLegacyEChartLanguage,
    parse(spec, context) {
      if (context.language === 'echarts-fulldata') {
        return parseCompactEnvelope(spec, limits);
      }
      return parseSpec(spec, context.data, limits);
    },
    parseSource(source, context) {
      if (isLegacyEChartSandboxFileLanguage(context.language)) {
        return {
          option: {},
          data: undefined,
          legacyEChartSandboxFile: parseLegacyEChartSandboxFileBlock(
            context.rawLanguage ?? context.language,
            source,
          ),
        };
      }
      return {
        option: {},
        data: undefined,
        legacyEChartQuery: parseLegacyEChartQueryBlock(context.language, source),
      };
    },
    getTitle(parsed) {
      return getEChartsTitle(parsed.option);
    },
    async materialize(parsed, context) {
      if (!parsed.legacyEChartQuery && !parsed.legacyEChartSandboxFile) {
        if (parsed.data?.kind === 'ref') {
          const data = await resolveReferencedData(parsed.data, context.signal);
          if (!data) {
            return { parsed, data: context.data };
          }
          return { parsed: { ...parsed, data }, data };
        }
        return { parsed, data: parsed.data };
      }
      if (
        parsed.legacyEChartQuery
        && !options.resolveLegacyArtifactContent
        && !options.resolveLegacyEChartQuery
      ) {
        throw new MarkdownChartError(
          'REF_RESOLVER_MISSING',
          'resolveLegacyArtifactContent is required for this temporary ChatBI fence',
        );
      }
      if (parsed.legacyEChartSandboxFile && !options.resolveLegacySandboxFileContent) {
        throw new MarkdownChartError(
          'REF_RESOLVER_MISSING',
          'resolveLegacySandboxFileContent is required for this temporary ChatBI fence',
        );
      }
      let resolved: unknown;
      try {
        if (parsed.legacyEChartSandboxFile) {
          resolved = await resolveLegacySandboxFile({
            block: parsed.legacyEChartSandboxFile,
            signal: context.signal,
            resolveSandboxFileContent: options.resolveLegacySandboxFileContent as ResolveLegacySandboxFileContent,
            limits: legacyArtifactLimits as LegacyArtifactLimits,
          });
        } else {
          resolved = options.resolveLegacyArtifactContent
            ? await resolveLegacyArtifactQuery({
                block: parsed.legacyEChartQuery as LegacyEChartQueryBlock,
                signal: context.signal,
                resolveArtifactContent: options.resolveLegacyArtifactContent,
                limits: legacyArtifactLimits as LegacyArtifactLimits,
              })
            : await options.resolveLegacyEChartQuery?.({
                ...parsed.legacyEChartQuery as LegacyEChartQueryBlock,
                signal: context.signal,
              });
        }
      } catch (cause) {
        if (context.signal.aborted) {
          return { parsed, data: context.data };
        }
        if (cause instanceof MarkdownChartError) {
          throw cause;
        }
        throw new MarkdownChartError(
          'REF_RESOLUTION_FAILED',
          'The temporary ChatBI chart could not be resolved',
          { cause },
        );
      }
      if (context.signal.aborted) {
        return { parsed, data: context.data };
      }
      let normalized: JsonValue;
      try {
        normalized = validateChartJsonValue(resolved, {
          maxDepth: limits.maxDepth,
          maxNodes: limits.maxNodes,
        });
      } catch (cause) {
        if (cause instanceof MarkdownChartError) {
          throw cause;
        }
        throw new MarkdownChartError(
          'SCHEMA_INVALID',
          'Temporary ChatBI resolver returned a non-JSON result',
          { cause },
        );
      }
      if (!isJsonObject(normalized)) {
        return schemaError('Temporary ChatBI resolver must return an object');
      }
      if (
        !Object.prototype.hasOwnProperty.call(normalized, 'data')
        || !Object.prototype.hasOwnProperty.call(normalized, 'spec')
      ) {
        return schemaError('Temporary ChatBI resolver must return data and spec');
      }
      const resolvedSpec = parseSpec(
        normalized.spec as JsonValue,
        normalized.data,
        limits,
      );
      if (resolvedSpec.data?.kind !== 'inline') {
        return schemaError('Temporary ChatBI resolver must return inline data');
      }
      return { parsed: resolvedSpec, data: resolvedSpec.data };
    },
    async mount(container, parsed, context) {
      if (parsed.legacyEChartQuery || parsed.legacyEChartSandboxFile) {
        return schemaError('Temporary ChatBI charts must be materialized before mounting');
      }

      const option = cloneJson(parsed.option);
      if (context.externalizedTitle) {
        removeExternalizedEChartsTitle(option, context.externalizedTitle);
      }
      if (parsed.data) {
        let dataset: InlineDataset;
        if (parsed.data.kind === 'inline') {
          dataset = parsed.data;
        } else {
          const resolved = await resolveReferencedData(parsed.data, context.signal);
          if (!resolved) {
            return EMPTY_HANDLE;
          }
          dataset = resolved;
        }
        const resolved = materializeDataset(dataset, limits);
        option.dataset = resolved.option;
      }

      if (context.signal.aborted) {
        return EMPTY_HANDLE;
      }

      let runtime: EChartsRuntime;
      try {
        runtime = normalizeRuntime(await loadECharts());
      } catch (cause) {
        if (cause instanceof MarkdownChartError) {
          throw cause;
        }
        throw new MarkdownChartError('RUNTIME_LOAD_FAILED', 'The ECharts runtime could not be loaded', { cause });
      }
      if (context.signal.aborted) {
        return EMPTY_HANDLE;
      }

      let instance: EChartsInstance | undefined;
      let observer: ResizeObserver | undefined;
      try {
        const theme = typeof context.theme === 'string' || isJsonObject(context.theme)
          ? context.theme
          : undefined;
        instance = runtime.init(container, theme);
        const styleTheme = resolveDefaultStyleTheme(context.theme);
        const renderedOption = options.defaultStyle === false || !styleTheme
          ? option
          : applyEChartsDefaultStyle(option, styleTheme);
        instance.setOption(renderedOption, { notMerge: true, lazyUpdate: false });
        if (options.resizeObserver !== false && typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => instance?.resize());
          observer.observe(container);
        }
      } catch (cause) {
        try {
          observer?.disconnect();
        } catch {
          // Preserve the original render failure.
        }
        try {
          instance?.dispose();
        } catch {
          // Preserve the original render failure.
        }
        throw new MarkdownChartError('RENDER_FAILED', 'ECharts failed to render the chart', { cause });
      }
      const mountedInstance = instance;
      let disposed = false;
      return {
        resize: () => mountedInstance.resize(),
        dispose() {
          if (disposed) {
            return;
          }
          disposed = true;
          observer?.disconnect();
          mountedInstance.dispose();
        },
      };
    },
  };
}
