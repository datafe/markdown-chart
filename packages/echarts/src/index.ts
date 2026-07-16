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
} from '@datafe/markdown-chart';
import {
  isLegacyEChartQueryLanguage,
  parseLegacyEChartQueryBlock,
  resolveLegacyArtifactLimits,
  resolveLegacyArtifactQuery,
  type LegacyArtifactLimits,
  type LegacyEChartQueryBlock,
  type ResolveLegacyArtifactContent,
  type ResolveLegacyEChartQuery,
} from './legacy';

export type {
  LegacyArtifactContentRequest,
  LegacyArtifactLimits,
  LegacyEChartQueryBlock,
  LegacyEChartQueryRequest,
  ResolveLegacyArtifactContent,
  ResolvedLegacyEChartQuery,
  ResolveLegacyEChartQuery,
} from './legacy';
export { DEFAULT_LEGACY_ARTIFACT_LIMITS } from './legacy';

export type DatasetRow = ChartDataRow;
export type InlineDataset = InlineChartData;
export type RefDataset = RefChartData;

export type EChartsDataset = InlineDataset | RefDataset;

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
  'formatter',
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
const ASCII_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const URL_LIKE = /(?:^|[\s("'=])(?:https?:|file:|ftp:|blob:|data:|javascript:|vbscript:|\/\/|image:\/\/)/i;
const CSS_URL_LIKE = /\burl\s*\(/i;
const HTML_LIKE_MARKUP = /<\s*\/?\s*[a-z][^>]*>/i;

function schemaError(message: string): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message);
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
      if (ASCII_CONTROL_CHARACTER.test(value)) {
        throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains an ASCII control character`);
      }
      const trimmed = value.trim();
      if (URL_LIKE.test(trimmed) || CSS_URL_LIKE.test(value) || HTML_LIKE_MARKUP.test(value)) {
        throw new MarkdownChartError('UNSAFE_SPEC', `${path} contains a URL, CSS URL, or unsafe markup`);
      }
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
      if (FORBIDDEN_OPTION_KEYS.has(key.toLowerCase()) || URL_BEARING_OPTION_KEY.test(key)) {
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
    muted: '#838d95',
    border: '#e0e6f1',
    axisLine: '#5d666f',
    axisPointer: '#7c8a96',
    tooltipBackground: '#ffffff',
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
    muted: '#9aa3b7',
    border: 'rgba(129,145,209,0.24)',
    axisLine: '#657086',
    axisPointer: '#8a98b3',
    tooltipBackground: '#161616',
    primary: '#8aa0ff',
    palette: [
      '#8AA0FF', '#60CCC5', '#C2A5FF', '#5F99F9',
      '#A9AFFF', '#33AFA9', '#AB7BFF', '#8EB8FE',
      '#E0E3FE', '#98E3DD', '#E8E1FA', '#D7E6FF',
    ],
  },
} satisfies Record<DefaultStyleTheme, {
  background: string;
  foreground: string;
  muted: string;
  border: string;
  axisLine: string;
  axisPointer: string;
  tooltipBackground: string;
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
      itemStyle: { borderColor: tokens.background, borderWidth: 2 },
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
      itemStyle: { borderColor: tokens.background, borderWidth: 2 },
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
    backgroundColor: tokens.tooltipBackground,
    borderColor: tokens.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: tokens.foreground, fontSize: 12 },
    axisPointer: {
      lineStyle: { color: tokens.axisPointer, width: 1 },
      crossStyle: { color: tokens.axisPointer, width: 1 },
    },
  });
  styled.legend = styleComponent(styled.legend, {
    type: 'scroll',
    bottom: 8,
    padding: [4, 16],
    textStyle: { color: tokens.muted, fontSize: 12 },
    pageIconColor: tokens.primary,
    pageIconInactiveColor: tokens.border,
    pageTextStyle: { color: tokens.muted },
  });
  if (styled.xAxis !== undefined) {
    styled.xAxis = styleAxis(styled.xAxis, () => ({
      axisLine: { show: true, lineStyle: { color: tokens.axisLine } },
      axisTick: { show: true, lineStyle: { color: tokens.axisLine } },
      axisLabel: { color: tokens.muted, fontSize: 12, hideOverlap: true },
      splitLine: { show: false, lineStyle: { color: tokens.border } },
      nameTextStyle: { color: tokens.muted },
    }));
  }
  if (styled.yAxis !== undefined) {
    styled.yAxis = styleAxis(styled.yAxis, (index) => ({
      alignTicks: true,
      axisLine: { show: false, lineStyle: { color: tokens.axisLine } },
      axisTick: { show: false, lineStyle: { color: tokens.axisLine } },
      axisLabel: { color: tokens.muted, fontSize: 12, hideOverlap: true },
      splitLine: { show: index === 0, lineStyle: { color: tokens.border } },
      nameGap: 12,
      nameTextStyle: { color: tokens.muted, align: index === 0 ? 'left' : 'right' },
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
    matchLanguage: isLegacyEChartQueryLanguage,
    parse(spec, context) {
      return parseSpec(spec, context.data, limits);
    },
    parseSource(source, context) {
      return {
        option: {},
        data: undefined,
        legacyEChartQuery: parseLegacyEChartQueryBlock(context.language, source),
      };
    },
    async materialize(parsed, context) {
      if (!parsed.legacyEChartQuery) {
        if (parsed.data?.kind === 'ref') {
          const data = await resolveReferencedData(parsed.data, context.signal);
          if (!data) {
            return { parsed, data: context.data };
          }
          return { parsed: { ...parsed, data }, data };
        }
        return { parsed, data: context.data };
      }
      if (!options.resolveLegacyArtifactContent && !options.resolveLegacyEChartQuery) {
        throw new MarkdownChartError(
          'REF_RESOLVER_MISSING',
          'resolveLegacyArtifactContent is required for this temporary ChatBI fence',
        );
      }
      let resolved: unknown;
      try {
        resolved = options.resolveLegacyArtifactContent
          ? await resolveLegacyArtifactQuery({
              block: parsed.legacyEChartQuery,
              signal: context.signal,
              resolveArtifactContent: options.resolveLegacyArtifactContent,
              limits: legacyArtifactLimits as LegacyArtifactLimits,
            })
          : await options.resolveLegacyEChartQuery?.({
              ...parsed.legacyEChartQuery,
              signal: context.signal,
            });
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
      if (parsed.legacyEChartQuery) {
        return schemaError('Temporary ChatBI charts must be materialized before mounting');
      }

      const option = cloneJson(parsed.option);
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
