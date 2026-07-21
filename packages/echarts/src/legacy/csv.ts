import Papa from 'papaparse';
import {
  MarkdownChartError,
  type ChartDataRow,
  type InlineChartData,
} from '@datafe-open/markdown-chart';
import type { LegacyArtifactLimits } from './types';

const FORBIDDEN_COLUMN_NAMES = new Set(['__proto__', 'prototype', 'constructor']);

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function csvSchemaError(message: string, cause?: unknown): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message, { cause });
}

/** @deprecated CSV parser for the temporary ChatBI migration adapter. */
export function parseLegacyArtifactCsv(
  content: string,
  limits: LegacyArtifactLimits,
): InlineChartData {
  if (utf8ByteLength(content) > limits.maxArtifactContentBytes) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `ArtifactContent exceeds the ${limits.maxArtifactContentBytes} UTF-8 byte limit`,
    );
  }

  let parsed: Papa.ParseResult<Record<string, string>>;
  const transformedHeaders = new Set<string>();
  const transformedHeaderIndexes = new Set<number>();
  let headerError: string | undefined;
  try {
    parsed = Papa.parse<Record<string, string>>(content, {
      dynamicTyping: false,
      header: true,
      preview: limits.maxRows + 1,
      skipEmptyLines: 'greedy',
      transformHeader(header, index) {
        if (transformedHeaderIndexes.has(index)) return header;
        if (header.length === 0) {
          headerError = 'ArtifactContent CSV column names must not be empty';
        } else if (FORBIDDEN_COLUMN_NAMES.has(header.toLowerCase())) {
          headerError = `ArtifactContent CSV column ${header} is not allowed`;
        } else if (transformedHeaders.has(header)) {
          headerError = `ArtifactContent CSV column ${header} is duplicated; column names must be unique`;
        }
        if (headerError) throw new Error(headerError);
        transformedHeaderIndexes.add(index);
        transformedHeaders.add(header);
        return header;
      },
    });
  } catch (cause) {
    return csvSchemaError(headerError ?? 'ArtifactContent is not valid CSV', cause);
  }
  const errors = parsed.errors.filter((error) => error.code !== 'UndetectableDelimiter');
  if (errors.length > 0) {
    const first = errors[0];
    return csvSchemaError(`ArtifactContent is not valid CSV: ${first?.message ?? 'parse error'}`);
  }
  const dimensions = parsed.meta.fields ?? [];
  if (dimensions.length === 0) {
    return csvSchemaError('ArtifactContent CSV must have a header row');
  }
  const seen = new Set<string>();
  for (const dimension of dimensions) {
    if (dimension.length === 0) {
      return csvSchemaError('ArtifactContent CSV column names must not be empty');
    }
    if (FORBIDDEN_COLUMN_NAMES.has(dimension.toLowerCase())) {
      return csvSchemaError(`ArtifactContent CSV column ${dimension} is not allowed`);
    }
    if (seen.has(dimension)) {
      return csvSchemaError(`ArtifactContent CSV column ${dimension} is duplicated`);
    }
    seen.add(dimension);
  }
  if (dimensions.length > limits.maxColumns) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `ArtifactContent CSV exceeds the ${limits.maxColumns} column limit`,
    );
  }
  if (parsed.data.length > limits.maxRows) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `ArtifactContent CSV exceeds the ${limits.maxRows} row limit`,
    );
  }
  const cells = parsed.data.length * dimensions.length;
  if (cells > limits.maxCells) {
    throw new MarkdownChartError(
      'LIMIT_EXCEEDED',
      `ArtifactContent CSV exceeds the ${limits.maxCells} cell limit`,
    );
  }

  const source: ChartDataRow[] = parsed.data.map((row) => {
    const normalized: Record<string, string> = {};
    for (const dimension of dimensions) {
      normalized[dimension] = row[dimension] ?? '';
    }
    return normalized;
  });
  return { kind: 'inline', dimensions, source };
}
