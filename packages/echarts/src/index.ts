import {
  MarkdownChartError,
  isJsonObject,
  type ChartHandle,
  type ChartRenderer,
  type JsonPrimitive,
  type JsonValue,
} from '@datafe/markdown-chart';

export type DatasetRow = JsonPrimitive[] | Record<string, JsonPrimitive>;

export interface InlineDataset {
  readonly kind: 'inline';
  readonly dimensions?: readonly string[];
  readonly source: readonly DatasetRow[];
}

export interface RefDataset {
  readonly kind: 'ref';
  readonly ref: string;
  readonly format?: 'csv' | 'json';
  readonly dimensions?: readonly string[];
}

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
  readonly loadECharts: () => LoadedEChartsRuntime | Promise<LoadedEChartsRuntime>;
  readonly resolveDataRef?: ResolveDataRef;
  readonly validateDataRef?: (ref: string) => boolean;
  readonly limits?: Partial<EChartsLimits>;
  readonly resizeObserver?: boolean;
}

export interface ParsedEChartsSpec {
  readonly option: Record<string, JsonValue>;
  readonly data: EChartsDataset | undefined;
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

function parseData(value: JsonValue, limits: EChartsLimits): EChartsDataset {
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

function parseSpec(spec: JsonValue, limits: EChartsLimits): ParsedEChartsSpec {
  if (!isJsonObject(spec)) {
    return schemaError('ECharts specification must be an object');
  }

  let option: Record<string, JsonValue>;
  let data: EChartsDataset | undefined;
  if (Object.prototype.hasOwnProperty.call(spec, 'option')) {
    if (spec.version !== 1) {
      throw new MarkdownChartError('UNSUPPORTED_VERSION', 'Only ECharts envelope version 1 is supported');
    }
    if (!isJsonObject(spec.option)) {
      return schemaError('echarts.option must be an object');
    }
    option = cloneJson(spec.option);
    data = spec.data === undefined ? undefined : parseData(spec.data, limits);
  } else {
    option = cloneJson(spec);
  }

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

function toDatasetOption(dataset: ResolvedDataset, limits: EChartsLimits): Record<string, JsonValue> {
  const source = validateRows(dataset.source, limits, 'resolvedDataset.source');
  const dimensions = dataset.dimensions
    ? readDimensions(dataset.dimensions as unknown as JsonValue, 'resolvedDataset.dimensions')
    : undefined;
  return dimensions ? { dimensions, source } : { source };
}

const EMPTY_HANDLE: ChartHandle = { dispose() {} };

export function createEChartsRenderer(options: CreateEChartsRendererOptions): ChartRenderer<ParsedEChartsSpec> {
  const limits: EChartsLimits = { ...DEFAULT_ECHARTS_LIMITS, ...options.limits };

  return {
    id: 'echarts',
    aliases: ['echarts-fulldata'],
    parse(spec) {
      return parseSpec(spec, limits);
    },
    async mount(container, parsed, context) {
      const option = cloneJson(parsed.option);
      if (parsed.data) {
        let dataset: ResolvedDataset;
        if (parsed.data.kind === 'inline') {
          dataset = parsed.data;
        } else {
          if (options.validateDataRef && !options.validateDataRef(parsed.data.ref)) {
            throw new MarkdownChartError('REF_REJECTED', 'The host rejected the chart data reference');
          }
          if (!options.resolveDataRef) {
            throw new MarkdownChartError('REF_RESOLVER_MISSING', 'A resolveDataRef callback is required');
          }
          try {
            dataset = await options.resolveDataRef(parsed.data.ref, {
              format: parsed.data.format,
              dimensions: parsed.data.dimensions,
              signal: context.signal,
            });
          } catch (cause) {
            if (context.signal.aborted) {
              return EMPTY_HANDLE;
            }
            throw new MarkdownChartError('REF_RESOLUTION_FAILED', 'The chart dataset could not be resolved', { cause });
          }
        }
        option.dataset = toDatasetOption(dataset, limits);
      }

      if (context.signal.aborted) {
        return EMPTY_HANDLE;
      }

      let runtime: EChartsRuntime;
      try {
        runtime = normalizeRuntime(await options.loadECharts());
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
        instance.setOption(option, { notMerge: true, lazyUpdate: false });
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
