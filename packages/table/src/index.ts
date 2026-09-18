import {
  MarkdownChartError,
  isJsonObject,
  materializeChartData,
  type ChartData,
  type ChartDataRow,
  type ChartDataViewProvider,
  type ChartHandle,
  type ChartMountContext,
  type ChartRenderer,
  type InlineChartData,
  type JsonPrimitive,
  type JsonValue,
  type ResolveChartDataRef,
} from '@datafe-open/markdown-chart';
import type {
  ColDef,
  GridApi,
  GridOptions,
  ICellRendererParams,
  Theme,
  ValueFormatterParams,
  ValueGetterParams,
} from 'ag-grid-community';

export const TABLE_RENDERER_ID = 'table' as const;

export interface TableLimits {
  readonly maxRows: number;
  readonly maxCells: number;
}

export const DEFAULT_TABLE_LIMITS: Readonly<TableLimits> = Object.freeze({
  maxRows: 10_000,
  maxCells: 200_000,
});

export type TableColumnType = 'string' | 'number' | 'date' | 'boolean';
export type TablePolarity = 'higher-is-better' | 'lower-is-better' | 'neutral';

export interface TableNumberFormat {
  readonly style: 'decimal' | 'percent' | 'currency' | 'unit';
  readonly currency?: string;
  readonly unit?: string;
  readonly notation?: 'standard' | 'compact' | 'scientific' | 'engineering';
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly nullDisplay?: string;
}

export interface TableDateFormat {
  readonly dateStyle: 'short' | 'medium' | 'long';
}

export type TableFormat = TableNumberFormat | TableDateFormat;

export type TableCell =
  | { readonly kind: 'change'; readonly polarity: TablePolarity }
  | { readonly kind: 'bar' | 'progress'; readonly min?: number; readonly max?: number; readonly clamp: boolean }
  | {
      readonly kind: 'sparkline';
      readonly fields: readonly string[];
      readonly labels?: readonly string[];
      readonly scale: 'column' | 'row';
    };

export interface TableColumn {
  readonly field?: string;
  readonly id?: string;
  readonly title?: string;
  readonly type?: TableColumnType;
  readonly width?: number;
  readonly pinned?: 'left' | 'right';
  readonly sortable?: boolean;
  readonly filter?: boolean;
  readonly format?: TableFormat;
  readonly cell?: TableCell;
}

export interface TableInitialSort {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

export interface TableSpec {
  readonly title?: string;
  readonly height: number;
  readonly columns?: readonly TableColumn[];
  readonly initialSort?: readonly TableInitialSort[];
}

export interface TableLabels {
  readonly searchPlaceholder: string;
  readonly exportCsv: string;
  readonly rowCount: (visible: number, total: number) => string;
}

export const DEFAULT_TABLE_LABELS: Readonly<TableLabels> = Object.freeze({
  searchPlaceholder: 'Search data',
  exportCsv: 'Export CSV',
  rowCount: (visible: number, total: number) => `${visible} of ${total} rows`,
});

type TableRow = Record<string, JsonPrimitive | undefined>;

export interface TableGridRuntime {
  readonly themeQuartz: {
    withParams(params: Readonly<Record<string, unknown>>): unknown;
  };
  createGrid(container: HTMLElement, options: unknown): unknown;
}

export interface CreateTableRendererOptions {
  readonly resolveDataRef?: ResolveChartDataRef;
  readonly validateDataRef?: (ref: string) => boolean;
  readonly limits?: Partial<TableLimits>;
  readonly loadGrid?: () => TableGridRuntime | Promise<TableGridRuntime>;
  readonly downloadCsv?: (csv: string, filename: string) => void;
  readonly labels?: Partial<TableLabels>;
}

interface MaterializedColumn extends TableColumn {
  readonly effectiveId: string;
  readonly resolvedType: TableColumnType;
  readonly resolvedMin?: number;
  readonly resolvedMax?: number;
  readonly numberFormatter?: Intl.NumberFormat;
  readonly dateFormatter?: Intl.DateTimeFormat;
  readonly sparklineExtent?: readonly [number, number];
}

interface MaterializedTable {
  readonly spec: TableSpec;
  readonly data: InlineChartData;
  readonly fields: readonly string[];
  readonly rows: readonly TableRow[];
  readonly columns: readonly MaterializedColumn[];
}

interface ParsedTableChart {
  readonly spec: TableSpec;
  readonly data: ChartData;
  readonly table?: MaterializedTable;
}

const TABLE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DISPLAY_CONTROL_CHARACTER = /[\p{Cc}\p{Cf}\u2028\u2029]/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIMESTAMP_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

function schemaError(message: string): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message);
}

function assertOwnKeys(value: Record<string, JsonValue>, allowed: ReadonlySet<string>, path: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) schemaError(`${path}.${key} is not allowed`);
  }
}

function readDisplayString(value: JsonValue | undefined, path: string, maxCodePoints = 120): string {
  if (
    typeof value !== 'string'
    || value.trim() !== value
    || value.length === 0
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
  maxCodePoints = 120,
): string | undefined {
  return value === undefined ? undefined : readDisplayString(value, path, maxCodePoints);
}

function readInteger(
  value: JsonValue | undefined,
  path: string,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return schemaError(`${path} must be an integer between ${minimum} and ${maximum}`);
  }
  return value as number;
}

function readOptionalFiniteNumber(value: JsonValue | undefined, path: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return schemaError(`${path} must be a finite number`);
  }
  return value;
}

function parseNumberFormat(value: Record<string, JsonValue>, path: string): TableNumberFormat {
  assertOwnKeys(value, new Set([
    'style', 'currency', 'unit', 'notation', 'minimumFractionDigits',
    'maximumFractionDigits', 'prefix', 'suffix', 'nullDisplay',
  ]), path);
  if (!['decimal', 'percent', 'currency', 'unit'].includes(String(value.style))) {
    return schemaError(`${path}.style must be decimal, percent, currency, or unit`);
  }
  const style = value.style as TableNumberFormat['style'];
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
  if (value.notation !== undefined && !['standard', 'compact', 'scientific', 'engineering'].includes(String(value.notation))) {
    return schemaError(`${path}.notation is not supported`);
  }
  const minimumFractionDigits = readInteger(value.minimumFractionDigits, `${path}.minimumFractionDigits`, 0, 20);
  const maximumFractionDigits = readInteger(value.maximumFractionDigits, `${path}.maximumFractionDigits`, 0, 20);
  if (minimumFractionDigits !== undefined && maximumFractionDigits !== undefined && minimumFractionDigits > maximumFractionDigits) {
    return schemaError(`${path}.minimumFractionDigits must not exceed maximumFractionDigits`);
  }
  const format: TableNumberFormat = {
    style,
    ...(typeof value.currency === 'string' ? { currency: value.currency } : {}),
    ...(typeof value.unit === 'string' ? { unit: value.unit } : {}),
    ...(typeof value.notation === 'string'
      ? { notation: value.notation as NonNullable<TableNumberFormat['notation']> }
      : {}),
    ...(minimumFractionDigits !== undefined ? { minimumFractionDigits } : {}),
    ...(maximumFractionDigits !== undefined ? { maximumFractionDigits } : {}),
    ...(value.prefix !== undefined ? { prefix: readDisplayString(value.prefix, `${path}.prefix`, 32) } : {}),
    ...(value.suffix !== undefined ? { suffix: readDisplayString(value.suffix, `${path}.suffix`, 32) } : {}),
    ...(value.nullDisplay !== undefined
      ? { nullDisplay: readDisplayString(value.nullDisplay, `${path}.nullDisplay`, 80) }
      : {}),
  };
  try {
    createNumberFormatter(format);
  } catch {
    return schemaError(`${path} is not a supported Intl.NumberFormat configuration`);
  }
  return format;
}

function parseFormat(value: JsonValue | undefined, path: string): TableFormat | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  if (Object.hasOwn(value, 'dateStyle')) {
    assertOwnKeys(value, new Set(['dateStyle']), path);
    if (!['short', 'medium', 'long'].includes(String(value.dateStyle))) {
      return schemaError(`${path}.dateStyle must be short, medium, or long`);
    }
    return { dateStyle: value.dateStyle as TableDateFormat['dateStyle'] };
  }
  return parseNumberFormat(value, path);
}

function parseCell(value: JsonValue | undefined, path: string): TableCell | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  if (value.kind === 'change') {
    assertOwnKeys(value, new Set(['kind', 'polarity']), path);
    if (value.polarity !== undefined && !['higher-is-better', 'lower-is-better', 'neutral'].includes(String(value.polarity))) {
      return schemaError(`${path}.polarity is not supported`);
    }
    return { kind: 'change', polarity: (value.polarity as TablePolarity | undefined) ?? 'neutral' };
  }
  if (value.kind === 'bar' || value.kind === 'progress') {
    assertOwnKeys(value, new Set(['kind', 'min', 'max', 'clamp']), path);
    if (value.clamp !== undefined && typeof value.clamp !== 'boolean') {
      return schemaError(`${path}.clamp must be a boolean`);
    }
    const min = readOptionalFiniteNumber(value.min, `${path}.min`);
    const max = readOptionalFiniteNumber(value.max, `${path}.max`);
    if (min !== undefined && max !== undefined && max <= min) {
      return schemaError(`${path}.max must be greater than min`);
    }
    return {
      kind: value.kind,
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      clamp: value.clamp !== false,
    };
  }
  if (value.kind === 'sparkline') {
    assertOwnKeys(value, new Set(['kind', 'fields', 'labels', 'scale']), path);
    if (!Array.isArray(value.fields) || value.fields.length < 2 || value.fields.length > 50) {
      return schemaError(`${path}.fields must contain 2-50 fields`);
    }
    const fields = value.fields.map((field, index) => readDisplayString(field, `${path}.fields[${index}]`));
    if (new Set(fields).size !== fields.length) return schemaError(`${path}.fields must be unique`);
    let labels: string[] | undefined;
    if (value.labels !== undefined) {
      if (!Array.isArray(value.labels) || value.labels.length !== fields.length) {
        return schemaError(`${path}.labels must match fields length`);
      }
      labels = value.labels.map((label, index) => readDisplayString(label, `${path}.labels[${index}]`));
    }
    if (value.scale !== undefined && value.scale !== 'column' && value.scale !== 'row') {
      return schemaError(`${path}.scale must be column or row`);
    }
    return { kind: 'sparkline', fields, ...(labels ? { labels } : {}), scale: value.scale ?? 'column' };
  }
  return schemaError(`${path}.kind must be change, bar, progress, or sparkline`);
}

function parseColumn(value: JsonValue, path: string): TableColumn {
  if (!isJsonObject(value)) return schemaError(`${path} must be an object`);
  assertOwnKeys(value, new Set([
    'field', 'id', 'title', 'type', 'width', 'pinned', 'sortable', 'filter', 'format', 'cell',
  ]), path);
  const field = readOptionalDisplayString(value.field, `${path}.field`);
  if (value.id !== undefined && (typeof value.id !== 'string' || !TABLE_ID.test(value.id))) {
    return schemaError(`${path}.id must match ${TABLE_ID.source}`);
  }
  const id = value.id as string | undefined;
  const cell = parseCell(value.cell, `${path}.cell`);
  if (!field && !(cell?.kind === 'sparkline' && id)) {
    return schemaError(`${path} requires field, or id for a derived sparkline`);
  }
  if (value.type !== undefined && !['string', 'number', 'date', 'boolean'].includes(String(value.type))) {
    return schemaError(`${path}.type is not supported`);
  }
  if (value.pinned !== undefined && value.pinned !== 'left' && value.pinned !== 'right') {
    return schemaError(`${path}.pinned must be left or right`);
  }
  if (value.sortable !== undefined && typeof value.sortable !== 'boolean') {
    return schemaError(`${path}.sortable must be a boolean`);
  }
  if (value.filter !== undefined && typeof value.filter !== 'boolean') {
    return schemaError(`${path}.filter must be a boolean`);
  }
  return {
    ...(field ? { field } : {}),
    ...(id ? { id } : {}),
    ...(value.title !== undefined ? { title: readDisplayString(value.title, `${path}.title`) } : {}),
    ...(typeof value.type === 'string' ? { type: value.type as TableColumnType } : {}),
    ...(value.width !== undefined ? { width: readInteger(value.width, `${path}.width`, 72, 600) as number } : {}),
    ...(value.pinned === 'left' || value.pinned === 'right' ? { pinned: value.pinned } : {}),
    ...(typeof value.sortable === 'boolean' ? { sortable: value.sortable } : {}),
    ...(typeof value.filter === 'boolean' ? { filter: value.filter } : {}),
    ...(value.format !== undefined ? { format: parseFormat(value.format, `${path}.format`) as TableFormat } : {}),
    ...(cell ? { cell } : {}),
  };
}

export function parseTableSpec(value: JsonValue): TableSpec {
  if (!isJsonObject(value)) return schemaError('markdown-chart.spec for table must be an object');
  assertOwnKeys(value, new Set(['title', 'height', 'columns', 'initialSort']), 'markdown-chart.spec');
  let columns: TableColumn[] | undefined;
  if (value.columns !== undefined) {
    if (!Array.isArray(value.columns) || value.columns.length === 0 || value.columns.length > 50) {
      return schemaError('markdown-chart.spec.columns must contain 1-50 columns');
    }
    columns = value.columns.map((column, index) => parseColumn(column, `markdown-chart.spec.columns[${index}]`));
    const effectiveIds = columns.map((column) => column.id ?? column.field as string);
    if (new Set(effectiveIds).size !== effectiveIds.length) {
      return schemaError('markdown-chart.spec.columns must use unique effective ids');
    }
  }
  let initialSort: TableInitialSort[] | undefined;
  if (value.initialSort !== undefined) {
    if (!Array.isArray(value.initialSort) || value.initialSort.length === 0 || value.initialSort.length > 3) {
      return schemaError('markdown-chart.spec.initialSort must contain 1-3 entries');
    }
    initialSort = value.initialSort.map((sort, index) => {
      const path = `markdown-chart.spec.initialSort[${index}]`;
      if (!isJsonObject(sort)) return schemaError(`${path} must be an object`);
      assertOwnKeys(sort, new Set(['field', 'direction']), path);
      if (sort.direction !== 'asc' && sort.direction !== 'desc') {
        return schemaError(`${path}.direction must be asc or desc`);
      }
      return { field: readDisplayString(sort.field, `${path}.field`), direction: sort.direction };
    });
    if (new Set(initialSort.map((sort) => sort.field)).size !== initialSort.length) {
      return schemaError('markdown-chart.spec.initialSort must not repeat fields');
    }
  }
  return {
    ...(value.title !== undefined ? { title: readDisplayString(value.title, 'markdown-chart.spec.title') } : {}),
    height: readInteger(value.height, 'markdown-chart.spec.height', 240, 720) ?? 420,
    ...(columns ? { columns } : {}),
    ...(initialSort ? { initialSort } : {}),
  };
}

function tableFields(data: InlineChartData): string[] {
  const fields = [...(data.dimensions ?? [])];
  const seen = new Set(fields);
  for (const row of data.source) {
    if (Array.isArray(row)) {
      for (let index = 0; index < row.length; index += 1) {
        if (data.dimensions && index >= data.dimensions.length) {
          return schemaError(`table array row has more cells than markdown-chart.data.dimensions`);
        }
        const field = data.dimensions?.[index] ?? String(index + 1);
        if (!seen.has(field)) {
          seen.add(field);
          fields.push(field);
        }
      }
    } else {
      for (const field of Object.keys(row)) {
        if (!seen.has(field)) {
          seen.add(field);
          fields.push(field);
        }
      }
    }
  }
  fields.forEach((field, index) => readDisplayString(field, `table field[${index}]`));
  return fields;
}

function tableRows(data: InlineChartData, fields: readonly string[]): TableRow[] {
  return data.source.map((sourceRow): TableRow => {
    const row: TableRow = {};
    fields.forEach((field, index) => {
      const value = Array.isArray(sourceRow) ? sourceRow[index] : sourceRow[field];
      Object.defineProperty(row, field, { value, enumerable: true, configurable: true, writable: true });
    });
    return row;
  });
}

function inferType(rows: readonly TableRow[], field: string): TableColumnType {
  const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined);
  if (values.length > 0 && values.every((value) => typeof value === 'number')) return 'number';
  if (values.length > 0 && values.every((value) => typeof value === 'boolean')) return 'boolean';
  return 'string';
}

function parseDateValue(value: JsonPrimitive | undefined, path: string): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || (!ISO_DATE.test(value) && !ISO_TIMESTAMP_WITH_ZONE.test(value))) {
    return schemaError(`${path} must be an ISO-8601 date or timestamp with an explicit timezone`);
  }
  const timestamp = Date.parse(ISO_DATE.test(value) ? `${value}T00:00:00Z` : value);
  if (!Number.isFinite(timestamp)) return schemaError(`${path} must be a valid ISO-8601 date`);
  return timestamp;
}

function createNumberFormatter(format: TableNumberFormat): Intl.NumberFormat {
  return new Intl.NumberFormat('en-US', {
    style: format.style,
    ...(format.currency ? { currency: format.currency, currencyDisplay: 'narrowSymbol' as const } : {}),
    ...(format.unit ? { unit: format.unit, unitDisplay: 'short' as const } : {}),
    ...(format.notation ? { notation: format.notation } : {}),
    ...(format.minimumFractionDigits !== undefined ? { minimumFractionDigits: format.minimumFractionDigits } : {}),
    ...(format.maximumFractionDigits !== undefined ? { maximumFractionDigits: format.maximumFractionDigits } : {}),
  });
}

function validateColumnValues(
  rows: readonly TableRow[],
  column: TableColumn,
  resolvedType: TableColumnType,
  path: string,
): void {
  if (column.field) {
    rows.forEach((row, rowIndex) => {
      const value = row[column.field as string];
      if (value === null || value === undefined) return;
      if (resolvedType === 'date') {
        parseDateValue(value, `${path} row ${rowIndex}`);
      } else if (resolvedType !== 'string' && typeof value !== resolvedType) {
        schemaError(`${path} contains a ${typeof value} value but is declared ${resolvedType}`);
      }
    });
  }
  if (column.cell?.kind === 'sparkline') {
    column.cell.fields.forEach((field) => {
      rows.forEach((row, rowIndex) => {
        const value = row[field];
        if (value !== null && value !== undefined && typeof value !== 'number') {
          schemaError(`${path}.cell sparkline field ${field} row ${rowIndex} must be a number or null`);
        }
      });
    });
  }
}

function numericExtent(values: readonly number[]): readonly [number, number] {
  if (values.length === 0) return [0, 1];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return minimum === maximum ? [minimum - 0.5, maximum + 0.5] : [minimum, maximum];
}

function materializeColumn(
  column: TableColumn,
  rows: readonly TableRow[],
  fields: ReadonlySet<string>,
  path: string,
): MaterializedColumn {
  if (column.field && !fields.has(column.field)) return schemaError(`${path}.field references missing field ${column.field}`);
  if (column.cell?.kind === 'sparkline') {
    column.cell.fields.forEach((field) => {
      if (!fields.has(field)) schemaError(`${path}.cell.fields references missing field ${field}`);
    });
  }
  const resolvedType = column.type ?? (column.field ? inferType(rows, column.field) : 'string');
  if (column.format && 'dateStyle' in column.format && resolvedType !== 'date') {
    return schemaError(`${path}.format dateStyle requires type date`);
  }
  if (column.format && 'style' in column.format && resolvedType !== 'number') {
    return schemaError(`${path}.format numeric style requires type number`);
  }
  if (column.cell && column.cell.kind !== 'sparkline' && resolvedType !== 'number') {
    return schemaError(`${path}.cell ${column.cell.kind} requires type number`);
  }
  validateColumnValues(rows, column, resolvedType, path);
  let resolvedMin: number | undefined;
  let resolvedMax: number | undefined;
  if (column.cell?.kind === 'bar' || column.cell?.kind === 'progress') {
    const values = rows
      .map((row) => column.field ? row[column.field] : undefined)
      .filter((value): value is number => typeof value === 'number');
    resolvedMin = column.cell.min ?? 0;
    resolvedMax = column.cell.max ?? (values.length > 0 ? Math.max(...values) : 1);
    if (resolvedMax <= resolvedMin) return schemaError(`${path}.cell max must be greater than min`);
    if (!column.cell.clamp && values.some((value) => value < resolvedMin! || value > resolvedMax!)) {
      return schemaError(`${path}.cell contains a value outside min/max while clamp is false`);
    }
  }
  let sparklineExtent: readonly [number, number] | undefined;
  if (column.cell?.kind === 'sparkline' && column.cell.scale === 'column') {
    const values = rows.flatMap((row) => column.cell?.kind === 'sparkline'
      ? column.cell.fields.map((field) => row[field]).filter((value): value is number => typeof value === 'number')
      : []);
    sparklineExtent = numericExtent(values);
  }
  const numberFormatter = column.format && 'style' in column.format
    ? createNumberFormatter(column.format)
    : undefined;
  const dateFormatter = column.format && 'dateStyle' in column.format
    ? new Intl.DateTimeFormat('en-US', { dateStyle: column.format.dateStyle, timeZone: 'UTC' })
    : resolvedType === 'date'
      ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' })
      : undefined;
  return {
    ...column,
    effectiveId: column.id ?? column.field as string,
    resolvedType,
    ...(resolvedMin !== undefined ? { resolvedMin } : {}),
    ...(resolvedMax !== undefined ? { resolvedMax } : {}),
    ...(numberFormatter ? { numberFormatter } : {}),
    ...(dateFormatter ? { dateFormatter } : {}),
    ...(sparklineExtent ? { sparklineExtent } : {}),
  };
}

function materializeTable(spec: TableSpec, data: InlineChartData): MaterializedTable {
  const fields = tableFields(data);
  const rows = tableRows(data, fields);
  const sourceColumns = spec.columns ?? fields.map((field): TableColumn => ({ field }));
  const fieldSet = new Set(fields);
  const columns = sourceColumns.map((column, index) => materializeColumn(
    column,
    rows,
    fieldSet,
    `markdown-chart.spec.columns[${index}]`,
  ));
  for (const sort of spec.initialSort ?? []) {
    const column = columns.find((candidate) => candidate.field === sort.field);
    if (!column || column.sortable === false || column.cell?.kind === 'sparkline') {
      schemaError(`markdown-chart.spec.initialSort references unsortable field ${sort.field}`);
    }
  }
  return { spec, data, fields, rows, columns };
}

function formatColumnValue(value: JsonPrimitive | undefined, column: MaterializedColumn): string {
  if (value === null || value === undefined) {
    return column.format && 'style' in column.format ? column.format.nullDisplay ?? '—' : '—';
  }
  if (column.resolvedType === 'number') {
    const body = column.numberFormatter ? column.numberFormatter.format(value as number) : String(value);
    const format = column.format && 'style' in column.format ? column.format : undefined;
    return `${format?.prefix ?? ''}${body}${format?.suffix ?? ''}`;
  }
  if (column.resolvedType === 'date') {
    const timestamp = parseDateValue(value, `table column ${column.effectiveId}`) as number;
    return column.dateFormatter?.format(new Date(timestamp)) ?? String(value);
  }
  return String(value);
}

function setStyles(element: HTMLElement | SVGElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

function createChangeCell(value: JsonPrimitive | undefined, column: MaterializedColumn): HTMLElement {
  const element = document.createElement('span');
  const numeric = typeof value === 'number' ? value : undefined;
  element.textContent = numeric === undefined
    ? formatColumnValue(value, column)
    : `${numeric > 0 ? '↑ ' : numeric < 0 ? '↓ ' : ''}${formatColumnValue(value, column)}`;
  let tone: 'positive' | 'negative' | 'neutral' = 'neutral';
  if (numeric && column.cell?.kind === 'change' && column.cell.polarity !== 'neutral') {
    const beneficial = column.cell.polarity === 'higher-is-better' ? numeric > 0 : numeric < 0;
    tone = beneficial ? 'positive' : 'negative';
  }
  element.dataset.markdownChartTableTone = tone;
  setStyles(element, {
    color: tone === 'positive'
      ? 'var(--markdown-chart-positive, #15803d)'
      : tone === 'negative'
        ? 'var(--markdown-chart-negative, #b91c1c)'
        : 'inherit',
    fontVariantNumeric: 'tabular-nums',
  });
  return element;
}

function createBarCell(value: JsonPrimitive | undefined, column: MaterializedColumn): HTMLElement {
  const wrapper = document.createElement('div');
  setStyles(wrapper, { position: 'relative', minWidth: '96px', height: '100%', display: 'flex', alignItems: 'center' });
  if (typeof value !== 'number') {
    wrapper.textContent = formatColumnValue(value, column);
    return wrapper;
  }
  const minimum = column.resolvedMin as number;
  const maximum = column.resolvedMax as number;
  const ratio = Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const bar = document.createElement('span');
  setStyles(bar, {
    position: 'absolute', inset: '5px auto 5px 0', width: `${ratio * 100}%`, borderRadius: '3px',
    background: 'var(--markdown-chart-accent, #2563eb)', opacity: '0.18',
  });
  const label = document.createElement('span');
  label.textContent = formatColumnValue(value, column);
  setStyles(label, { position: 'relative', zIndex: '1', fontVariantNumeric: 'tabular-nums' });
  wrapper.append(bar, label);
  return wrapper;
}

function createSparkline(row: TableRow | undefined, column: MaterializedColumn): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.classList.add('markdown-chart-table-sparkline');
  svg.dataset.markdownChartTableSparkline = column.effectiveId;
  svg.setAttribute('viewBox', '0 0 120 30');
  svg.setAttribute('width', '120');
  svg.setAttribute('height', '30');
  svg.setAttribute('role', 'img');
  const cell = column.cell?.kind === 'sparkline' ? column.cell : undefined;
  const values = cell?.fields.map((field) => row?.[field]) ?? [];
  const numericValues = values.filter((value): value is number => typeof value === 'number');
  const extent = cell?.scale === 'row' ? numericExtent(numericValues) : column.sparklineExtent ?? [0, 1];
  const [minimum, maximum] = extent;
  const step = values.length > 1 ? 112 / (values.length - 1) : 0;
  let pathData = '';
  values.forEach((value, index) => {
    if (typeof value !== 'number') return;
    const x = 4 + (index * step);
    const y = 26 - (((value - minimum) / (maximum - minimum)) * 22);
    const previous = index > 0 ? values[index - 1] : undefined;
    pathData += `${typeof previous === 'number' ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
  });
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', pathData.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'var(--markdown-chart-accent, #2563eb)');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  const title = document.createElementNS(namespace, 'title');
  title.textContent = values.map((value, index) => `${cell?.labels?.[index] ?? cell?.fields[index]}: ${value ?? '—'}`).join(', ');
  svg.append(title, path);
  return svg;
}

function nullLastComparator(
  left: unknown,
  right: unknown,
  _leftNode: unknown,
  _rightNode: unknown,
  descending: boolean,
): number {
  const leftEmpty = left === null || left === undefined;
  const rightEmpty = right === null || right === undefined;
  if (leftEmpty || rightEmpty) {
    if (leftEmpty && rightEmpty) return 0;
    const ascendingResult = leftEmpty ? 1 : -1;
    return descending ? -ascendingResult : ascendingResult;
  }
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (typeof left === 'boolean' && typeof right === 'boolean') return Number(left) - Number(right);
  return String(left).localeCompare(String(right));
}

function gridColumnDefs(table: MaterializedTable): ColDef<TableRow>[] {
  return table.columns.map((column): ColDef<TableRow> => {
    const sortIndex = table.spec.initialSort?.findIndex((sort) => sort.field === column.field) ?? -1;
    const sort = sortIndex >= 0 ? table.spec.initialSort?.[sortIndex]?.direction : undefined;
    const valueGetter = column.cell?.kind === 'sparkline'
      ? undefined
      : ({ data }: ValueGetterParams<TableRow>) => {
          const value = column.field && data ? data[column.field] : undefined;
          return column.resolvedType === 'date'
            ? value === null || value === undefined ? null : new Date(parseDateValue(value, `table column ${column.effectiveId}`) as number)
            : value;
        };
    const valueFormatter = (params: ValueFormatterParams<TableRow>): string => {
      const rawValue = column.field && params.data ? params.data[column.field] : undefined;
      return formatColumnValue(rawValue, column);
    };
    let cellRenderer: ((params: ICellRendererParams<TableRow>) => HTMLElement | SVGElement) | undefined;
    if (column.cell?.kind === 'change') {
      cellRenderer = (params) => createChangeCell(column.field && params.data ? params.data[column.field] : undefined, column);
    } else if (column.cell?.kind === 'bar' || column.cell?.kind === 'progress') {
      cellRenderer = (params) => createBarCell(column.field && params.data ? params.data[column.field] : undefined, column);
    } else if (column.cell?.kind === 'sparkline') {
      cellRenderer = (params) => createSparkline(params.data, column);
    }
    return {
      colId: column.effectiveId,
      headerName: column.title ?? column.field ?? column.id ?? column.effectiveId,
      ...(valueGetter ? { valueGetter } : {}),
      ...(column.width ? { width: column.width } : { minWidth: column.cell?.kind === 'sparkline' ? 150 : 110, flex: 1 }),
      ...(column.pinned ? { pinned: column.pinned, lockPinned: true } : {}),
      sortable: column.cell?.kind === 'sparkline' ? false : column.sortable ?? true,
      filter: column.cell?.kind === 'sparkline' || column.filter === false
        ? false
        : column.resolvedType === 'number'
          ? 'agNumberColumnFilter'
          : column.resolvedType === 'date'
            ? 'agDateColumnFilter'
            : 'agTextColumnFilter',
      floatingFilter: column.cell?.kind !== 'sparkline' && column.filter !== false,
      comparator: nullLastComparator,
      ...(column.cell?.kind !== 'sparkline' ? { valueFormatter } : {}),
      ...(cellRenderer ? { cellRenderer } : {}),
      ...(sort ? { sort, sortIndex } : {}),
      suppressHeaderMenuButton: true,
    };
  });
}

function csvCell(value: JsonPrimitive | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^\s*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeTableCsv(rows: readonly TableRow[], fields: readonly string[]): string {
  return [
    fields.map(csvCell).join(','),
    ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(',')),
  ].join('\r\n');
}

function defaultDownloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

let defaultRuntimePromise: Promise<TableGridRuntime> | undefined;

async function loadDefaultGridRuntime(): Promise<TableGridRuntime> {
  defaultRuntimePromise ??= import('ag-grid-community').then((runtime) => {
    runtime.ModuleRegistry.registerModules([runtime.AllCommunityModule]);
    return {
      createGrid: (container, options) => runtime.createGrid(
        container,
        options as GridOptions<TableRow>,
      ),
      themeQuartz: runtime.themeQuartz,
    };
  });
  return defaultRuntimePromise;
}

function resolvedLabels(overrides: Partial<TableLabels> | undefined): Readonly<TableLabels> {
  return Object.freeze({ ...DEFAULT_TABLE_LABELS, ...overrides });
}

function safeFilename(title: string | undefined): string {
  const base = title?.trim().replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${base || 'data'}.csv`;
}

async function mountTable(
  container: HTMLElement,
  table: MaterializedTable,
  context: Pick<ChartMountContext, 'signal' | 'theme'>,
  options: CreateTableRendererOptions,
  mode: 'standalone' | 'data-view',
): Promise<ChartHandle | undefined> {
  const runtime = await (options.loadGrid?.() ?? loadDefaultGridRuntime());
  if (context.signal.aborted) return undefined;
  const labels = resolvedLabels(options.labels);
  const root = document.createElement('div');
  root.className = `markdown-chart-table markdown-chart-table-${mode}`;
  root.dataset.markdownChartTable = mode;
  setStyles(root, {
    display: 'grid', width: '100%', minWidth: '0', overflow: 'hidden', boxSizing: 'border-box',
    border: mode === 'standalone' ? '1px solid color-mix(in srgb, currentColor 14%, transparent)' : '0',
    borderRadius: mode === 'standalone' ? '8px' : '0',
    background: `var(--markdown-chart-background, ${context.theme === 'dark' ? '#0d0d0d' : '#ffffff'})`,
    color: `var(--markdown-chart-foreground, ${context.theme === 'dark' ? '#e5e7eb' : '#111827'})`,
  });
  const toolbar = document.createElement('div');
  toolbar.className = 'markdown-chart-table-toolbar';
  setStyles(toolbar, {
    display: 'flex', minWidth: '0', flexWrap: 'wrap', alignItems: 'center', gap: '8px', padding: '8px 10px',
    borderBottom: '1px solid color-mix(in srgb, currentColor 14%, transparent)',
    background: `var(--markdown-chart-subtle-background, ${context.theme === 'dark' ? '#161616' : '#f7f8fa'})`,
  });
  if (table.spec.title && mode === 'standalone') {
    const title = document.createElement('div');
    title.className = 'markdown-chart-table-title';
    title.textContent = table.spec.title;
    setStyles(title, { minWidth: '120px', flex: '1 1 auto', fontSize: '13px', fontWeight: '600' });
    toolbar.append(title);
  }
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'markdown-chart-table-search';
  search.placeholder = labels.searchPlaceholder;
  search.setAttribute('aria-label', labels.searchPlaceholder);
  setStyles(search, {
    width: 'min(220px, 100%)', height: '30px', padding: '0 9px', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
    borderRadius: '6px', background: 'var(--markdown-chart-background, white)', color: 'inherit', font: 'inherit', fontSize: '12px',
  });
  const count = document.createElement('span');
  count.className = 'markdown-chart-table-row-count';
  setStyles(count, { marginLeft: 'auto', fontSize: '11px', opacity: '0.68', whiteSpace: 'nowrap' });
  const exportButton = document.createElement('button');
  exportButton.type = 'button';
  exportButton.className = 'markdown-chart-table-export';
  exportButton.textContent = labels.exportCsv;
  setStyles(exportButton, {
    height: '30px', padding: '0 10px', border: '1px solid color-mix(in srgb, currentColor 20%, transparent)',
    borderRadius: '6px', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '12px',
  });
  toolbar.append(search, count, exportButton);
  const grid = document.createElement('div');
  grid.className = 'markdown-chart-table-grid';
  setStyles(grid, { width: '100%', height: `${table.spec.height}px`, minWidth: '0' });
  root.append(toolbar, grid);
  container.replaceChildren(root);

  const dark = context.theme === 'dark';
  const theme = runtime.themeQuartz.withParams({
    browserColorScheme: dark ? 'dark' : 'light',
    backgroundColor: dark ? '#0d0d0d' : '#ffffff',
    foregroundColor: dark ? '#e5e7eb' : '#111827',
    headerBackgroundColor: dark ? '#161616' : '#f7f8fa',
    borderColor: dark ? '#343943' : '#d9deea',
    accentColor: '#2563eb',
    fontSize: 13,
    rowHeight: 34,
    headerHeight: 38,
  });
  const gridOptions: GridOptions<TableRow> = {
    theme: theme as Theme,
    rowData: [...table.rows],
    columnDefs: gridColumnDefs(table),
    defaultColDef: { resizable: true },
    suppressFieldDotNotation: true,
    animateRows: false,
    ensureDomOrder: true,
    enableCellTextSelection: true,
    rowHeight: 34,
    headerHeight: 38,
    onModelUpdated: ({ api: eventApi }) => {
      count.textContent = labels.rowCount(eventApi.getDisplayedRowCount(), table.rows.length);
    },
    onGridReady: ({ api: eventApi }) => {
      count.textContent = labels.rowCount(eventApi.getDisplayedRowCount(), table.rows.length);
    },
  };
  const api = runtime.createGrid(grid, gridOptions) as GridApi<TableRow>;
  count.textContent = labels.rowCount(api.getDisplayedRowCount(), table.rows.length);
  const onSearch = (): void => api.setGridOption('quickFilterText', search.value);
  const onExport = (): void => {
    const rows: TableRow[] = [];
    api.forEachNodeAfterFilterAndSort((node) => { if (node.data) rows.push(node.data); });
    (options.downloadCsv ?? defaultDownloadCsv)(serializeTableCsv(rows, table.fields), safeFilename(table.spec.title));
  };
  search.addEventListener('input', onSearch);
  exportButton.addEventListener('click', onExport);
  return {
    dispose() {
      search.removeEventListener('input', onSearch);
      exportButton.removeEventListener('click', onExport);
      api.destroy();
    },
    resize() {
      api.sizeColumnsToFit();
    },
  };
}

function countTableCells(data: InlineChartData): number {
  return data.source.reduce(
    (total, row) => total + (Array.isArray(row) ? row.length : Object.keys(row).length),
    0,
  );
}

export function createTableDataViewProvider(
  options: CreateTableRendererOptions = {},
): ChartDataViewProvider {
  const limits = { ...DEFAULT_TABLE_LIMITS, ...options.limits };
  return {
    supports(data) {
      if ((data.shape ?? 'table') !== 'table') return false;
      const tableData = data as InlineChartData;
      return tableData.source.length <= limits.maxRows
        && countTableCells(tableData) <= limits.maxCells;
    },
    async mount(container, data, context) {
      if ((data.shape ?? 'table') !== 'table') return undefined;
      const tableData = data as InlineChartData;
      const table = materializeTable(parseTableSpec({}), tableData);
      return mountTable(container, table, context, options, 'data-view');
    },
  };
}

export function createTableRenderer(
  options: CreateTableRendererOptions = {},
): ChartRenderer<ParsedTableChart> {
  const limits = { ...DEFAULT_TABLE_LIMITS, ...options.limits };
  return {
    id: TABLE_RENDERER_ID,
    presentation: 'data',
    parse(spec, context) {
      if (!context.data) return schemaError('markdown-chart.data is required for the table renderer');
      if ((context.data.shape ?? 'table') !== 'table') return schemaError('The table renderer accepts only table data');
      return { spec: parseTableSpec(spec), data: context.data };
    },
    getTitle(parsed) {
      return parsed.spec.title;
    },
    async materialize(parsed, context) {
      const data = await materializeChartData(parsed.data, {
        signal: context.signal,
        limits,
        ...(options.resolveDataRef ? { resolveDataRef: options.resolveDataRef } : {}),
        ...(options.validateDataRef ? { validateDataRef: options.validateDataRef } : {}),
      });
      if (!data) return { parsed, data: context.data };
      if ((data.shape ?? 'table') !== 'table') return schemaError('The table renderer accepts only table data');
      const tableData = data as InlineChartData;
      return { parsed: { ...parsed, data: tableData, table: materializeTable(parsed.spec, tableData) }, data: tableData };
    },
    async mount(container, parsed, context) {
      if (!parsed.table) return schemaError('Table data must be materialized before mounting');
      return mountTable(container, parsed.table, context, options, 'standalone');
    },
  };
}
