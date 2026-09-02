import {
  MarkdownChartError,
  isJsonObject,
  materializeChartData,
  type ChartData,
  type ChartDataMaterializationLimits,
  type ChartHandle,
  type ChartMountContext,
  type ChartReferenceActions,
  type ChartReferenceEvent,
  type ChartRenderer,
  type InlineChartData,
  type JsonPrimitive,
  type JsonValue,
  type ResolveChartDataRef,
} from '@datafe-open/markdown-chart';

export type KpiTone = 'neutral' | 'positive' | 'warning' | 'negative';
export type KpiFormatStyle = 'text' | 'decimal' | 'percent' | 'currency' | 'unit';
export type KpiTrendType = 'line' | 'area';
export type KpiCompareMode = 'absolute' | 'relative';
export type KpiPolarity = 'higher-is-better' | 'lower-is-better' | 'neutral';

export interface KpiReference {
  readonly ref: string;
  readonly label: string;
}

export interface KpiFieldBinding {
  readonly field: string;
}

export interface KpiLiteralBinding {
  readonly literal: string;
}

export type KpiTextBinding = KpiFieldBinding | KpiLiteralBinding;
export type KpiToneBinding = KpiFieldBinding | { readonly literal: KpiTone };

export interface KpiValueFormat {
  readonly style: KpiFormatStyle;
  readonly currency?: string;
  readonly unit?: string;
  readonly notation?: 'standard' | 'compact' | 'scientific' | 'engineering';
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly nullDisplay?: string;
}

export interface KpiValueBinding {
  readonly field: string;
  readonly reduce: 'lastNonNull';
  readonly format?: KpiValueFormat;
}

export interface KpiStatusBinding {
  readonly text: KpiTextBinding;
  readonly tone?: KpiToneBinding;
}

export interface KpiTrendCompare {
  readonly lag: number;
  readonly mode: KpiCompareMode;
  readonly label?: string;
  readonly polarity: KpiPolarity;
}

export interface KpiTrend {
  readonly type: KpiTrendType;
  readonly field?: string;
  readonly timeField?: string;
  readonly compare?: KpiTrendCompare;
  readonly yScale?: { readonly includeZero: boolean };
}

export interface KpiItem {
  readonly id: string;
  readonly title: string;
  readonly value: KpiValueBinding;
  readonly status?: KpiStatusBinding;
  readonly trend?: KpiTrend;
  readonly references?: readonly KpiReference[];
}

export interface KpiSpec {
  readonly timeField?: string;
  readonly items: readonly KpiItem[];
}

export interface KpiLimits extends ChartDataMaterializationLimits {
  readonly maxTrendPoints: number;
}

export interface KpiReferenceIconContext {
  readonly event: ChartReferenceEvent;
  readonly document: Document;
}

/**
 * Trusted host presentation hook. Return a newly created decorative element
 * for one reference control; returning nothing or throwing uses the default
 * link glyph.
 */
export type KpiReferenceIconFactory = (
  context: KpiReferenceIconContext,
) => HTMLElement | SVGElement | null | undefined;

export interface CreateKpiRendererOptions {
  readonly resolveDataRef?: ResolveChartDataRef;
  readonly validateDataRef?: (ref: string) => boolean;
  readonly limits?: Partial<KpiLimits>;
  readonly referenceIcon?: KpiReferenceIconFactory;
}

interface MaterializedTrend {
  readonly type: KpiTrendType;
  readonly values: readonly (number | null)[];
  readonly includeZero: boolean;
  readonly comparison?: { readonly text: string; readonly tone: KpiTone };
}

interface MaterializedKpiItem {
  readonly id: string;
  readonly title: string;
  readonly displayValue: string;
  readonly status?: { readonly text: string; readonly tone: KpiTone };
  readonly trend?: MaterializedTrend;
  readonly references?: readonly KpiReference[];
}

interface ParsedKpiChart {
  readonly spec: KpiSpec;
  readonly data: ChartData;
  readonly items?: readonly MaterializedKpiItem[];
}

export const KPI_RENDERER_ID = 'kpi' as const;
export const DEFAULT_KPI_LIMITS: Readonly<KpiLimits> = Object.freeze({
  maxRows: 2_000,
  maxCells: 40_000,
  maxTrendPoints: 500,
});

const MAX_ITEMS = 12;
const MAX_REFERENCES_PER_ITEM = 3;
const MAX_TITLE_CODE_POINTS = 120;
const MAX_FIELD_CODE_POINTS = 120;
const MAX_LABEL_CODE_POINTS = 120;
const MAX_AFFIX_CODE_POINTS = 32;
const MAX_NULL_DISPLAY_CODE_POINTS = 80;
const MAX_REFERENCE_CODE_UNITS = 16_384;
const MAX_REFERENCE_LABEL_CODE_POINTS = 120;
const MAX_COMPARE_LAG = 10_000;
const KPI_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DISPLAY_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const TONES = new Set<KpiTone>(['neutral', 'positive', 'warning', 'negative']);
const FORMAT_STYLES = new Set<KpiFormatStyle>(['text', 'decimal', 'percent', 'currency', 'unit']);
const NOTATIONS = new Set(['standard', 'compact', 'scientific', 'engineering']);

function schemaError(message: string): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message);
}

function assertOwnKeys(value: Record<string, JsonValue>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) schemaError(`${path}.${key} is not allowed`);
  }
}

function readDisplayString(value: JsonValue | undefined, path: string, maxCodePoints: number): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || [...value].length > maxCodePoints
    || DISPLAY_CONTROL_CHARACTER.test(value)
  ) {
    return schemaError(`${path} must be a trimmed display string of 1-${maxCodePoints} code points`);
  }
  return value;
}

function readOptionalDisplayString(
  value: JsonValue | undefined,
  path: string,
  maxCodePoints: number,
): string | undefined {
  return value === undefined ? undefined : readDisplayString(value, path, maxCodePoints);
}

function readField(value: JsonValue | undefined, path: string): string {
  return readDisplayString(value, path, MAX_FIELD_CODE_POINTS);
}

function readOptionalInteger(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 20) {
    return schemaError(`${path} must be an integer between 0 and 20`);
  }
  return value;
}

function createNumberFormatter(format: KpiValueFormat): Intl.NumberFormat {
  const options: Intl.NumberFormatOptions = {
    style: format.style === 'unit' || format.style === 'currency' || format.style === 'percent'
      ? format.style
      : 'decimal',
    ...(format.currency ? { currency: format.currency, currencyDisplay: 'narrowSymbol' as const } : {}),
    ...(format.unit ? { unit: format.unit, unitDisplay: 'short' as const } : {}),
    ...(format.notation ? { notation: format.notation } : {}),
    ...(format.minimumFractionDigits !== undefined
      ? { minimumFractionDigits: format.minimumFractionDigits }
      : format.maximumFractionDigits !== undefined
        ? { minimumFractionDigits: 0 }
        : {}),
    ...(format.maximumFractionDigits !== undefined
      ? { maximumFractionDigits: format.maximumFractionDigits }
      : {}),
  };
  return new Intl.NumberFormat('en-US', options);
}

function parseFormat(value: JsonValue | undefined, path: string): KpiValueFormat | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set([
    'style', 'currency', 'unit', 'notation', 'minimumFractionDigits',
    'maximumFractionDigits', 'prefix', 'suffix', 'nullDisplay',
  ]), path);
  if (typeof value.style !== 'string' || !FORMAT_STYLES.has(value.style as KpiFormatStyle)) {
    return schemaError(`${path}.style must be text, decimal, percent, currency, or unit`);
  }
  const style = value.style as KpiFormatStyle;
  if (value.notation !== undefined && (typeof value.notation !== 'string' || !NOTATIONS.has(value.notation))) {
    return schemaError(`${path}.notation is not supported`);
  }
  const minimumFractionDigits = readOptionalInteger(value.minimumFractionDigits, `${path}.minimumFractionDigits`);
  const maximumFractionDigits = readOptionalInteger(value.maximumFractionDigits, `${path}.maximumFractionDigits`);
  if (minimumFractionDigits !== undefined && maximumFractionDigits !== undefined && minimumFractionDigits > maximumFractionDigits) {
    return schemaError(`${path}.minimumFractionDigits must not exceed maximumFractionDigits`);
  }
  if (style === 'text' && [value.currency, value.unit, value.notation, minimumFractionDigits, maximumFractionDigits].some((entry) => entry !== undefined)) {
    return schemaError(`${path} text style only supports prefix, suffix, and nullDisplay`);
  }
  if (style === 'currency') {
    if (typeof value.currency !== 'string' || !/^[A-Z]{3}$/.test(value.currency)) {
      return schemaError(`${path}.currency must be an uppercase ISO 4217 code`);
    }
  } else if (value.currency !== undefined) {
    return schemaError(`${path}.currency is only allowed for currency style`);
  }
  if (style === 'unit') {
    if (typeof value.unit !== 'string' || value.unit.length === 0 || value.unit.length > 40) {
      return schemaError(`${path}.unit must be a supported Intl unit string`);
    }
  } else if (value.unit !== undefined) {
    return schemaError(`${path}.unit is only allowed for unit style`);
  }
  const prefix = readOptionalDisplayString(value.prefix, `${path}.prefix`, MAX_AFFIX_CODE_POINTS);
  const suffix = readOptionalDisplayString(value.suffix, `${path}.suffix`, MAX_AFFIX_CODE_POINTS);
  const nullDisplay = readOptionalDisplayString(value.nullDisplay, `${path}.nullDisplay`, MAX_NULL_DISPLAY_CODE_POINTS);
  const notation = typeof value.notation === 'string'
    ? value.notation as NonNullable<KpiValueFormat['notation']>
    : undefined;
  const format: KpiValueFormat = {
    style,
    ...(typeof value.currency === 'string' ? { currency: value.currency } : {}),
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    ...(notation !== undefined ? { notation } : {}),
    ...(minimumFractionDigits !== undefined ? { minimumFractionDigits } : {}),
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits } : {}),
    ...(prefix !== undefined ? { prefix } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
    ...(nullDisplay !== undefined ? { nullDisplay } : {}),
  };
  if (style !== 'text') {
    try {
      createNumberFormatter(format);
    } catch {
      return schemaError(`${path} is not a supported Intl.NumberFormat configuration`);
    }
  }
  return format;
}

function parseValue(value: JsonValue | undefined, path: string): KpiValueBinding {
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['field', 'reduce', 'format']), path);
  if (value.reduce !== undefined && value.reduce !== 'lastNonNull') {
    return schemaError(`${path}.reduce must be lastNonNull`);
  }
  const format = parseFormat(value.format, `${path}.format`);
  return {
    field: readField(value.field, `${path}.field`),
    reduce: 'lastNonNull',
    ...(format ? { format } : {}),
  };
}

function parseTextBinding(value: JsonValue | undefined, path: string): KpiTextBinding {
  if (!isJsonObject(value)) return schemaError(`${path} must be a field or literal binding`);
  assertOwnKeys(value, new Set(['field', 'literal']), path);
  const hasField = Object.prototype.hasOwnProperty.call(value, 'field');
  const hasLiteral = Object.prototype.hasOwnProperty.call(value, 'literal');
  if (hasField === hasLiteral) return schemaError(`${path} must contain exactly one of field or literal`);
  return hasField
    ? { field: readField(value.field, `${path}.field`) }
    : { literal: readDisplayString(value.literal, `${path}.literal`, MAX_LABEL_CODE_POINTS) };
}

function parseToneBinding(value: JsonValue | undefined, path: string): KpiToneBinding | undefined {
  if (value === undefined) return undefined;
  const binding = parseTextBinding(value, path);
  if ('literal' in binding && !TONES.has(binding.literal as KpiTone)) {
    return schemaError(`${path}.literal must be neutral, positive, warning, or negative`);
  }
  return 'field' in binding ? binding : { literal: binding.literal as KpiTone };
}

function parseStatus(value: JsonValue | undefined, path: string): KpiStatusBinding | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['text', 'tone']), path);
  const tone = parseToneBinding(value.tone, `${path}.tone`);
  return {
    text: parseTextBinding(value.text, `${path}.text`),
    ...(tone ? { tone } : {}),
  };
}

function parseCompare(value: JsonValue | undefined, path: string): KpiTrendCompare | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['lag', 'mode', 'label', 'polarity']), path);
  if (typeof value.lag !== 'number' || !Number.isInteger(value.lag) || value.lag < 1 || value.lag > MAX_COMPARE_LAG) {
    return schemaError(`${path}.lag must be an integer between 1 and ${MAX_COMPARE_LAG}`);
  }
  if (value.mode !== 'absolute' && value.mode !== 'relative') {
    return schemaError(`${path}.mode must be absolute or relative`);
  }
  if (value.polarity !== undefined && value.polarity !== 'higher-is-better' && value.polarity !== 'lower-is-better' && value.polarity !== 'neutral') {
    return schemaError(`${path}.polarity is not supported`);
  }
  const label = readOptionalDisplayString(value.label, `${path}.label`, MAX_LABEL_CODE_POINTS);
  return {
    lag: value.lag,
    mode: value.mode,
    polarity: (value.polarity as KpiPolarity | undefined) ?? 'neutral',
    ...(label ? { label } : {}),
  };
}

function parseTrend(value: JsonValue | undefined, path: string): KpiTrend | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['type', 'field', 'timeField', 'compare', 'yScale']), path);
  if (value.type !== 'line' && value.type !== 'area') {
    return schemaError(`${path}.type must be line or area`);
  }
  let yScale: KpiTrend['yScale'];
  if (value.yScale !== undefined) {
    if (!isJsonObject(value.yScale)) return schemaError(`${path}.yScale must be an object`);
    assertOwnKeys(value.yScale, new Set(['includeZero']), `${path}.yScale`);
    if (value.yScale.includeZero !== undefined && typeof value.yScale.includeZero !== 'boolean') {
      return schemaError(`${path}.yScale.includeZero must be a boolean`);
    }
    yScale = { includeZero: value.yScale.includeZero === true };
  }
  const compare = parseCompare(value.compare, `${path}.compare`);
  return {
    type: value.type,
    ...(value.field !== undefined ? { field: readField(value.field, `${path}.field`) } : {}),
    ...(value.timeField !== undefined ? { timeField: readField(value.timeField, `${path}.timeField`) } : {}),
    ...(compare ? { compare } : {}),
    ...(yScale ? { yScale } : {}),
  };
}

function parseReference(value: JsonValue, path: string): KpiReference {
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['ref', 'label']), path);
  if (typeof value.ref !== 'string' || value.ref.length === 0 || value.ref.trim() !== value.ref || value.ref.length > MAX_REFERENCE_CODE_UNITS) {
    return schemaError(`${path}.ref must be an opaque string of 1-${MAX_REFERENCE_CODE_UNITS} code units without surrounding whitespace`);
  }
  return {
    ref: value.ref,
    label: readDisplayString(value.label, `${path}.label`, MAX_REFERENCE_LABEL_CODE_POINTS),
  };
}

function parseReferences(value: JsonValue | undefined, path: string): KpiReference[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REFERENCES_PER_ITEM) {
    return schemaError(`${path} must contain 1-${MAX_REFERENCES_PER_ITEM} references`);
  }
  const references = value.map((reference, index) => parseReference(reference, `${path}[${index}]`));
  if (new Set(references.map((reference) => reference.ref)).size !== references.length) {
    return schemaError(`${path} must not contain duplicate refs`);
  }
  return references;
}

function parseItem(value: JsonValue, path: string): KpiItem {
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set(['id', 'title', 'value', 'status', 'trend', 'references']), path);
  if (typeof value.id !== 'string' || !KPI_ID.test(value.id)) {
    return schemaError(`${path}.id must match ${KPI_ID.source}`);
  }
  const status = parseStatus(value.status, `${path}.status`);
  const trend = parseTrend(value.trend, `${path}.trend`);
  const references = parseReferences(value.references, `${path}.references`);
  return {
    id: value.id,
    title: readDisplayString(value.title, `${path}.title`, MAX_TITLE_CODE_POINTS),
    value: parseValue(value.value, `${path}.value`),
    ...(status ? { status } : {}),
    ...(trend ? { trend } : {}),
    ...(references ? { references } : {}),
  };
}

export function parseKpiSpec(value: JsonValue): KpiSpec {
  if (!isJsonObject(value)) return schemaError('markdown-chart.spec for kpi must be an object');
  assertOwnKeys(value, new Set(['timeField', 'items']), 'markdown-chart.spec');
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
    return schemaError(`markdown-chart.spec.items must contain 1-${MAX_ITEMS} KPI items`);
  }
  const items = value.items.map((item, index) => parseItem(item, `markdown-chart.spec.items[${index}]`));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return schemaError('markdown-chart.spec.items must use unique ids');
  }
  const timeField = value.timeField === undefined ? undefined : readField(value.timeField, 'markdown-chart.spec.timeField');
  items.forEach((item, index) => {
    if (item.trend && !item.trend.timeField && !timeField) {
      schemaError(`markdown-chart.spec.items[${index}].trend requires timeField or spec.timeField`);
    }
  });
  return { ...(timeField ? { timeField } : {}), items };
}

function formatValue(value: JsonPrimitive | undefined, format: KpiValueFormat | undefined): string {
  if (value === null || value === undefined) return format?.nullDisplay ?? '—';
  const style = format?.style ?? 'text';
  let body: string;
  if (style === 'text') {
    body = String(value);
  } else {
    if (typeof value !== 'number') schemaError(`KPI numeric format cannot format ${typeof value}`);
    body = createNumberFormatter(format as KpiValueFormat).format(value);
  }
  return `${format?.prefix ?? ''}${body}${format?.suffix ?? ''}`;
}

function collectFields(data: InlineChartData): Set<string> {
  const fields = new Set(data.dimensions ?? []);
  data.source.forEach((row) => {
    if (!Array.isArray(row)) Object.keys(row).forEach((key) => fields.add(key));
  });
  return fields;
}

function readCell(data: InlineChartData, rowIndex: number, field: string): JsonPrimitive | undefined {
  const row = data.source[rowIndex];
  if (!row) return undefined;
  if (!Array.isArray(row)) return row[field];
  if (!data.dimensions) return schemaError('KPI array rows require markdown-chart.data.dimensions');
  const columnIndex = data.dimensions.indexOf(field);
  return columnIndex < 0 ? undefined : row[columnIndex];
}

function assertBoundFields(data: InlineChartData, spec: KpiSpec): void {
  if (data.dimensions && new Set(data.dimensions).size !== data.dimensions.length) {
    schemaError('markdown-chart.data.dimensions must be unique for KPI field binding');
  }
  if (data.source.some((row) => Array.isArray(row)) && !data.dimensions) {
    schemaError('KPI array rows require markdown-chart.data.dimensions');
  }
  if (data.dimensions) {
    data.source.forEach((row, rowIndex) => {
      if (Array.isArray(row) && row.length !== data.dimensions?.length) {
        schemaError(`markdown-chart.data.source[${rowIndex}] must contain ${data.dimensions?.length} cells`);
      }
    });
  }
  const fields = collectFields(data);
  const requireField = (field: string, path: string): void => {
    if (!fields.has(field)) schemaError(`${path} references missing field ${field}`);
  };
  spec.items.forEach((item, index) => {
    const path = `markdown-chart.spec.items[${index}]`;
    requireField(item.value.field, `${path}.value.field`);
    if (item.status && 'field' in item.status.text) requireField(item.status.text.field, `${path}.status.text.field`);
    if (item.status?.tone && 'field' in item.status.tone) requireField(item.status.tone.field, `${path}.status.tone.field`);
    if (item.trend) {
      requireField(item.trend.field ?? item.value.field, `${path}.trend.field`);
      requireField(item.trend.timeField ?? spec.timeField as string, `${path}.trend.timeField`);
    }
  });
}

function lastNonNull(data: InlineChartData, field: string): {
  readonly value: JsonPrimitive | undefined;
  readonly rowIndex: number | undefined;
} {
  for (let index = data.source.length - 1; index >= 0; index -= 1) {
    const value = readCell(data, index, field);
    if (value !== null && value !== undefined) return { value, rowIndex: index };
  }
  return { value: undefined, rowIndex: undefined };
}

function resolveTextBinding(data: InlineChartData, binding: KpiTextBinding): string {
  const value = 'literal' in binding ? binding.literal : lastNonNull(data, binding.field).value;
  return value === null || value === undefined ? '' : String(value);
}

function resolveToneBinding(data: InlineChartData, binding: KpiToneBinding | undefined): KpiTone {
  if (!binding) return 'neutral';
  const value = 'literal' in binding ? binding.literal : lastNonNull(data, binding.field).value;
  if (typeof value !== 'string' || !TONES.has(value as KpiTone)) {
    return schemaError('KPI status tone field must resolve to a supported tone');
  }
  return value as KpiTone;
}

function comparisonTone(delta: number, polarity: KpiPolarity): KpiTone {
  if (delta === 0 || polarity === 'neutral') return 'neutral';
  const beneficial = polarity === 'higher-is-better' ? delta > 0 : delta < 0;
  return beneficial ? 'positive' : 'negative';
}

function materializeTrend(
  data: InlineChartData,
  item: KpiItem,
  spec: KpiSpec,
  maxTrendPoints: number,
): MaterializedTrend | undefined {
  const trend = item.trend;
  if (!trend) return undefined;
  if (data.source.length > maxTrendPoints) {
    throw new MarkdownChartError('LIMIT_EXCEEDED', `KPI trend exceeds the ${maxTrendPoints} point limit`);
  }
  const field = trend.field ?? item.value.field;
  const timeField = trend.timeField ?? spec.timeField as string;
  const values = data.source.map((_, rowIndex): number | null => {
    const time = readCell(data, rowIndex, timeField);
    const value = readCell(data, rowIndex, field);
    if (value !== null && value !== undefined && typeof value !== 'number') {
      return schemaError(`KPI trend field ${field} must contain only numbers or null`);
    }
    return time === null || time === undefined || value === null || value === undefined ? null : value;
  });
  if (values.filter((value): value is number => value !== null).length < 2) return undefined;

  let comparison: MaterializedTrend['comparison'];
  if (trend.compare) {
    let currentRowIndex = -1;
    for (let index = values.length - 1; index >= 0; index -= 1) {
      if (values[index] !== null) {
        currentRowIndex = index;
        break;
      }
    }
    const currentValue = currentRowIndex >= 0 ? values[currentRowIndex] : null;
    if (typeof currentValue === 'number') {
      const previousIndex = currentRowIndex - trend.compare.lag;
      const previous = previousIndex >= 0 ? readCell(data, previousIndex, field) : undefined;
      if (previous !== null && previous !== undefined && typeof previous !== 'number') {
        schemaError(`KPI trend field ${field} must contain only numbers or null`);
      }
      if (typeof previous === 'number' && !(trend.compare.mode === 'relative' && previous === 0)) {
        const absoluteDelta = currentValue - previous;
        const displayDelta = trend.compare.mode === 'relative' ? absoluteDelta / Math.abs(previous) : absoluteDelta;
        const formatted = trend.compare.mode === 'relative'
          ? new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 }).format(displayDelta)
          : formatValue(displayDelta, item.value.format);
        const signed = displayDelta > 0 ? `+${formatted}` : formatted;
        comparison = {
          text: `${trend.compare.label ?? `vs ${trend.compare.lag} row${trend.compare.lag === 1 ? '' : 's'}`} ${signed}`,
          tone: comparisonTone(displayDelta, trend.compare.polarity),
        };
      }
    }
  }
  return {
    type: trend.type,
    values,
    includeZero: trend.yScale?.includeZero ?? false,
    ...(comparison ? { comparison } : {}),
  };
}

function materializeItems(data: InlineChartData, spec: KpiSpec, limits: KpiLimits): MaterializedKpiItem[] {
  assertBoundFields(data, spec);
  return spec.items.map((item): MaterializedKpiItem => {
    const current = lastNonNull(data, item.value.field);
    const statusText = item.status ? resolveTextBinding(data, item.status.text) : undefined;
    const trend = materializeTrend(data, item, spec, limits.maxTrendPoints);
    return {
      id: item.id,
      title: item.title,
      displayValue: formatValue(current.value, item.value.format),
      ...(item.status && statusText
        ? { status: { text: statusText, tone: resolveToneBinding(data, item.status.tone) } }
        : {}),
      ...(trend ? { trend } : {}),
      ...(item.references ? { references: item.references } : {}),
    };
  });
}

function setStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign((element as HTMLElement).style, styles);
}

function themeFallback(theme: unknown, light: string, dark: string): string {
  return theme === 'dark' ? dark : light;
}

function variable(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

function createReferenceIcon(ownerDocument: Document): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = ownerDocument.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '13');
  icon.setAttribute('height', '13');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const first = ownerDocument.createElementNS(namespace, 'path');
  first.setAttribute('d', 'M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15');
  const second = ownerDocument.createElementNS(namespace, 'path');
  second.setAttribute('d', 'M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15');
  icon.append(first, second);
  return icon;
}

function isReferenceIcon(
  value: unknown,
  ownerDocument: Document,
): value is HTMLElement | SVGElement {
  const view = ownerDocument.defaultView;
  return Boolean(
    view
    && (value instanceof view.HTMLElement || value instanceof view.SVGElement),
  );
}

function createReferenceEvent(reference: KpiReference): ChartReferenceEvent {
  return Object.freeze({
    rendererId: KPI_RENDERER_ID,
    reference: Object.freeze({ ref: reference.ref, label: reference.label }),
  });
}

function canOpenReference(actions: ChartReferenceActions | undefined, event: ChartReferenceEvent): boolean {
  if (!actions) return false;
  try {
    return actions.canOpen?.(event) ?? true;
  } catch {
    return false;
  }
}

interface ReferenceControl {
  readonly button: HTMLButtonElement;
  readonly onClick: () => void;
}

function createReferenceControls(
  references: readonly KpiReference[] | undefined,
  context: ChartMountContext,
  referenceIcon: KpiReferenceIconFactory | undefined,
): { readonly element: HTMLElement; readonly controls: readonly ReferenceControl[] } | undefined {
  const actions = context.referenceActions;
  if (!actions) return undefined;
  const available = (references ?? [])
    .map((reference) => ({ event: createReferenceEvent(reference) }))
    .filter(({ event }) => canOpenReference(actions, event));
  if (available.length === 0) return undefined;
  const element = document.createElement('div');
  element.className = 'markdown-chart-kpi-references';
  element.setAttribute('role', 'group');
  setStyles(element, { display: 'flex', flex: '0 0 auto', alignItems: 'center', gap: '4px', marginLeft: 'auto' });
  const controls = available.map(({ event }, index): ReferenceControl => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-chart-kpi-reference';
    button.dataset.markdownChartKpiReference = String(index + 1);
    button.title = event.reference.label;
    button.setAttribute('aria-label', event.reference.label);
    setStyles(button, {
      display: 'inline-flex', alignItems: 'center', gap: '3px', minWidth: '28px', height: '24px',
      padding: '0 6px', border: '1px solid color-mix(in srgb, currentColor 18%, transparent)',
      borderRadius: '6px', background: 'transparent', color: 'inherit', cursor: 'pointer',
      font: 'inherit', fontSize: '11px', lineHeight: '1',
    });
    let icon: HTMLElement | SVGElement | null | undefined;
    if (referenceIcon) {
      try {
        icon = referenceIcon({ event, document: button.ownerDocument });
      } catch {
        // A host presentation error must not remove the reference affordance.
      }
    }
    const ownerDocument = button.ownerDocument;
    const iconSlot = ownerDocument.createElement('span');
    iconSlot.className = 'markdown-chart-kpi-reference-icon';
    iconSlot.setAttribute('aria-hidden', 'true');
    setStyles(iconSlot, {
      display: 'inline-flex', width: '13px', height: '13px', flex: '0 0 13px',
      alignItems: 'center', justifyContent: 'center', lineHeight: '1',
    });
    const resolvedIcon = isReferenceIcon(icon, ownerDocument)
      ? icon
      : createReferenceIcon(ownerDocument);
    resolvedIcon.setAttribute('aria-hidden', 'true');
    resolvedIcon.setAttribute('focusable', 'false');
    setStyles(resolvedIcon, {
      width: '100%', height: '100%', pointerEvents: 'none',
    });
    iconSlot.append(resolvedIcon);
    button.append(iconSlot, ownerDocument.createTextNode(String(index + 1)));
    const onClick = (): void => {
      if (!canOpenReference(actions, event)) return;
      try {
        void Promise.resolve(actions.open(event)).catch(() => undefined);
      } catch {
        // Host interactions stay isolated from the mounted chart.
      }
    };
    button.addEventListener('click', onClick);
    element.append(button);
    return { button, onClick };
  });
  return { element, controls };
}

function toneColor(tone: KpiTone): string {
  if (tone === 'positive') return variable('--markdown-chart-kpi-positive', '#138a55');
  if (tone === 'warning') return variable('--markdown-chart-kpi-warning', '#b35c00');
  if (tone === 'negative') return variable('--markdown-chart-kpi-negative', '#d93025');
  return variable('--markdown-chart-kpi-muted', '#687386');
}

function createSparkline(trend: MaterializedTrend): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('markdown-chart-kpi-sparkline');
  svg.dataset.markdownChartKpiTrend = trend.type;
  svg.setAttribute('viewBox', '0 0 160 44');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  setStyles(svg, { display: 'block', width: '100%', height: '44px', overflow: 'visible' });

  const numeric = trend.values.filter((value): value is number => value !== null);
  let minimum = Math.min(...numeric);
  let maximum = Math.max(...numeric);
  if (trend.includeZero) {
    minimum = Math.min(minimum, 0);
    maximum = Math.max(maximum, 0);
  }
  if (minimum === maximum) {
    const padding = Math.abs(minimum) * 0.05 || 1;
    minimum -= padding;
    maximum += padding;
  }
  const x = (index: number): number => trend.values.length <= 1 ? 80 : 2 + (index / (trend.values.length - 1)) * 156;
  const y = (value: number): number => 42 - ((value - minimum) / (maximum - minimum)) * 40;
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let segment: Array<{ x: number; y: number }> = [];
  trend.values.forEach((value, index) => {
    if (value === null) {
      if (segment.length > 0) segments.push(segment);
      segment = [];
    } else {
      segment.push({ x: x(index), y: y(value) });
    }
  });
  if (segment.length > 0) segments.push(segment);
  for (const points of segments) {
    if (trend.type === 'area' && points.length >= 2) {
      const area = document.createElementNS(namespace, 'path');
      area.setAttribute('d', `M ${points[0]?.x ?? 0} 42 L ${points.map((point) => `${point.x} ${point.y}`).join(' L ')} L ${points.at(-1)?.x ?? 0} 42 Z`);
      area.setAttribute('fill', variable('--markdown-chart-kpi-accent-soft', 'rgba(74, 99, 241, 0.14)'));
      svg.append(area);
    }
    if (points.length >= 2) {
      const line = document.createElementNS(namespace, 'polyline');
      line.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));
      line.setAttribute('fill', 'none');
      line.setAttribute('stroke', variable('--markdown-chart-kpi-accent', '#4a63f1'));
      line.setAttribute('stroke-width', '2.2');
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('stroke-linejoin', 'round');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(line);
    }
  }
  return svg;
}

function createCard(
  item: MaterializedKpiItem,
  context: ChartMountContext,
  referenceIcon: KpiReferenceIconFactory | undefined,
): { readonly element: HTMLElement; readonly controls: readonly ReferenceControl[] } {
  const card = document.createElement('section');
  card.className = 'markdown-chart-kpi-item';
  card.dataset.markdownChartKpiId = item.id;
  card.setAttribute('role', 'listitem');
  setStyles(card, {
    display: 'flex', minWidth: '0', minHeight: item.trend ? '172px' : '128px', boxSizing: 'border-box',
    flexDirection: 'column', padding: '16px 16px 14px',
    background: variable('--markdown-chart-kpi-background', themeFallback(context.theme, '#ffffff', '#17191f')),
  });
  const heading = document.createElement('div');
  setStyles(heading, { display: 'flex', alignItems: 'flex-start', gap: '8px', minWidth: '0' });
  const title = document.createElement('div');
  title.className = 'markdown-chart-kpi-title';
  title.textContent = item.title;
  setStyles(title, {
    minWidth: '0', overflowWrap: 'anywhere',
    color: variable('--markdown-chart-kpi-muted', themeFallback(context.theme, '#596273', '#aeb5c2')),
    fontSize: '13px', fontWeight: '550', lineHeight: '1.45',
  });
  heading.append(title);
  const referenceControls = createReferenceControls(item.references, context, referenceIcon);
  if (referenceControls) heading.append(referenceControls.element);

  const value = document.createElement('div');
  value.className = 'markdown-chart-kpi-value';
  value.dataset.markdownChartKpiValue = item.displayValue;
  value.textContent = item.displayValue;
  setStyles(value, {
    marginTop: '8px', overflowWrap: 'anywhere',
    color: variable('--markdown-chart-kpi-foreground', themeFallback(context.theme, '#20242c', '#f4f6fa')),
    fontSize: '28px', fontWeight: '650', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: '1.16',
  });
  card.append(heading, value);

  if (item.status) {
    const status = document.createElement('div');
    status.className = 'markdown-chart-kpi-status';
    status.dataset.markdownChartKpiTone = item.status.tone;
    status.textContent = item.status.text;
    setStyles(status, {
      alignSelf: 'flex-start', marginTop: '8px', padding: '2px 7px', borderRadius: '4px',
      background: 'color-mix(in srgb, currentColor 10%, transparent)', color: toneColor(item.status.tone),
      fontSize: '11px', fontWeight: '550', lineHeight: '1.5',
    });
    card.append(status);
  }
  if (item.trend) {
    const trend = document.createElement('div');
    trend.className = 'markdown-chart-kpi-trend';
    setStyles(trend, { display: 'grid', gap: '4px', marginTop: 'auto', paddingTop: '10px' });
    trend.append(createSparkline(item.trend));
    if (item.trend.comparison) {
      const comparison = document.createElement('div');
      comparison.className = 'markdown-chart-kpi-compare';
      comparison.dataset.markdownChartKpiTone = item.trend.comparison.tone;
      comparison.textContent = item.trend.comparison.text;
      setStyles(comparison, {
        color: toneColor(item.trend.comparison.tone), fontSize: '11px', fontWeight: '550', lineHeight: '1.35',
      });
      trend.append(comparison);
    }
    card.append(trend);
  }
  return { element: card, controls: referenceControls?.controls ?? [] };
}

export function createKpiRenderer(options: CreateKpiRendererOptions = {}): ChartRenderer<ParsedKpiChart> {
  const limits: KpiLimits = { ...DEFAULT_KPI_LIMITS, ...options.limits };
  return {
    id: KPI_RENDERER_ID,
    parse(spec, context) {
      if (!context.data) return schemaError('markdown-chart.data is required for the kpi renderer');
      return { spec: parseKpiSpec(spec), data: context.data };
    },
    async materialize(parsed, context) {
      const data = await materializeChartData(parsed.data, {
        signal: context.signal,
        limits: { maxRows: limits.maxRows, maxCells: limits.maxCells },
        ...(options.resolveDataRef ? { resolveDataRef: options.resolveDataRef } : {}),
        ...(options.validateDataRef ? { validateDataRef: options.validateDataRef } : {}),
      });
      if (!data) return { parsed, data: context.data };
      return {
        parsed: { ...parsed, data, items: materializeItems(data, parsed.spec, limits) },
        data,
      };
    },
    mount(container, parsed, context) {
      if (!parsed.items) return schemaError('KPI data must be materialized before mounting');
      const hostContainer = context.hostContainer ?? container;
      const previousMinHeight = container.style.minHeight;
      const previousOverflow = container.style.overflow;
      const previousHostMinHeight = hostContainer.style.minHeight;
      const previousIntrinsicHeight = hostContainer.dataset.markdownChartIntrinsicHeight;
      container.style.minHeight = '0';
      container.style.overflow = 'hidden';
      hostContainer.style.minHeight = '0';
      hostContainer.dataset.markdownChartIntrinsicHeight = 'true';
      const grid = document.createElement('div');
      grid.className = 'markdown-chart-kpi-grid';
      grid.dataset.markdownChartKpi = 'true';
      grid.setAttribute('role', 'list');
      setStyles(grid, {
        display: 'grid', width: '100%', minWidth: '0', overflow: 'hidden', boxSizing: 'border-box',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: '1px',
        padding: '1px', borderRadius: '8px',
        background: variable('--markdown-chart-kpi-border', themeFallback(context.theme, '#d9deea', '#343943')),
      });
      const controls: ReferenceControl[] = [];
      parsed.items.forEach((item) => {
        const card = createCard(item, context, options.referenceIcon);
        controls.push(...card.controls);
        grid.append(card.element);
      });
      container.replaceChildren(grid);
      let disposed = false;
      const handle: ChartHandle = {
        dispose() {
          if (disposed) return;
          disposed = true;
          controls.forEach(({ button, onClick }) => button.removeEventListener('click', onClick));
          if (grid.parentNode === container) container.replaceChildren();
          container.style.minHeight = previousMinHeight;
          container.style.overflow = previousOverflow;
          hostContainer.style.minHeight = previousHostMinHeight;
          if (previousIntrinsicHeight === undefined) {
            delete hostContainer.dataset.markdownChartIntrinsicHeight;
          } else {
            hostContainer.dataset.markdownChartIntrinsicHeight = previousIntrinsicHeight;
          }
        },
      };
      return handle;
    },
  };
}
