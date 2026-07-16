const END_SENTINEL = '//#end';
const HOST_RENDERER_LINE_PATTERNS = [
  /^\s*(?:(?:const|let|var)\s+)?[\w$]*\s*=?\s*echarts\.init\([^;]*\);?\s*$/,
  /^\s*[\w$]+\.setOption\([^;]*\);?\s*$/,
];

/** @deprecated Source sanitizer for the temporary ChatBI migration adapter. */
export function sanitizeLegacyEChartSource(source: string): string {
  return source
    .split('\n')
    .map((line) => line.split(END_SENTINEL).join(''))
    .filter((line) => !HOST_RENDERER_LINE_PATTERNS.some((pattern) => pattern.test(line.trim())))
    .join('\n')
    .trim();
}

