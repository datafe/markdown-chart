import {
  MarkdownChartError,
  isJsonObject,
  type ChartHandle,
  type ChartMountContext,
  type ChartReferenceActions,
  type ChartReferenceEvent,
  type ChartRenderer,
  type JsonValue,
} from '@datafe-open/markdown-chart';

export type KpiTone = 'neutral' | 'positive' | 'warning' | 'negative';

export interface KpiReference {
  readonly ref: string;
  readonly label: string;
}

export interface KpiStatus {
  readonly text: string;
  readonly tone: KpiTone;
}

export interface KpiItem {
  readonly id: string;
  readonly title: string;
  readonly value: string;
  readonly prefix?: string;
  readonly suffix?: string;
  readonly status?: KpiStatus;
  readonly references?: readonly KpiReference[];
}

export interface KpiSpec {
  readonly items: readonly KpiItem[];
}

export const KPI_RENDERER_ID = 'kpi' as const;

const MAX_ITEMS = 12;
const MAX_REFERENCES_PER_ITEM = 3;
const MAX_TITLE_CODE_POINTS = 120;
const MAX_VALUE_CODE_POINTS = 80;
const MAX_AFFIX_CODE_POINTS = 16;
const MAX_STATUS_CODE_POINTS = 120;
const MAX_REFERENCE_CODE_UNITS = 16_384;
const MAX_REFERENCE_LABEL_CODE_POINTS = 120;
const KPI_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const DISPLAY_CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;
const TONES = new Set<KpiTone>(['neutral', 'positive', 'warning', 'negative']);

function schemaError(message: string): never {
  throw new MarkdownChartError('SCHEMA_INVALID', message);
}

function assertOwnKeys(
  value: Record<string, JsonValue>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      schemaError(`${path}.${key} is not allowed`);
    }
  }
}

function codePointLength(value: string): number {
  return [...value].length;
}

function readDisplayString(
  value: JsonValue | undefined,
  path: string,
  maxCodePoints: number,
): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || codePointLength(value) > maxCodePoints
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

function parseStatus(value: JsonValue | undefined, path: string): KpiStatus | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    return schemaError(`${path} must be an object`);
  }
  assertOwnKeys(value, new Set(['text', 'tone']), path);
  const text = readDisplayString(value.text, `${path}.text`, MAX_STATUS_CODE_POINTS);
  if (value.tone !== undefined && (typeof value.tone !== 'string' || !TONES.has(value.tone as KpiTone))) {
    return schemaError(`${path}.tone must be neutral, positive, warning, or negative`);
  }
  return { text, tone: (value.tone as KpiTone | undefined) ?? 'neutral' };
}

function parseReference(value: JsonValue, path: string): KpiReference {
  if (!isJsonObject(value)) {
    return schemaError(`${path} must be an object`);
  }
  assertOwnKeys(value, new Set(['ref', 'label']), path);
  if (
    typeof value.ref !== 'string'
    || value.ref.length === 0
    || value.ref.trim() !== value.ref
    || value.ref.length > MAX_REFERENCE_CODE_UNITS
  ) {
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
  if (!isJsonObject(value)) {
    return schemaError(`${path} must be an object`);
  }
  assertOwnKeys(
    value,
    new Set(['id', 'title', 'value', 'prefix', 'suffix', 'status', 'references']),
    path,
  );
  if (typeof value.id !== 'string' || !KPI_ID.test(value.id)) {
    return schemaError(`${path}.id must match ${KPI_ID.source}`);
  }
  const prefix = readOptionalDisplayString(value.prefix, `${path}.prefix`, MAX_AFFIX_CODE_POINTS);
  const suffix = readOptionalDisplayString(value.suffix, `${path}.suffix`, MAX_AFFIX_CODE_POINTS);
  const status = parseStatus(value.status, `${path}.status`);
  const references = parseReferences(value.references, `${path}.references`);
  return {
    id: value.id,
    title: readDisplayString(value.title, `${path}.title`, MAX_TITLE_CODE_POINTS),
    value: readDisplayString(value.value, `${path}.value`, MAX_VALUE_CODE_POINTS),
    ...(prefix !== undefined ? { prefix } : {}),
    ...(suffix !== undefined ? { suffix } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(references !== undefined ? { references } : {}),
  };
}

export function parseKpiSpec(value: JsonValue, hasCanonicalData = false): KpiSpec {
  if (hasCanonicalData) {
    return schemaError('markdown-chart.data is not allowed for the kpi renderer');
  }
  if (!isJsonObject(value)) {
    return schemaError('markdown-chart.spec for kpi must be an object');
  }
  assertOwnKeys(value, new Set(['items']), 'markdown-chart.spec');
  if (!Array.isArray(value.items) || value.items.length === 0 || value.items.length > MAX_ITEMS) {
    return schemaError(`markdown-chart.spec.items must contain 1-${MAX_ITEMS} KPI items`);
  }
  const items = value.items.map((item, index) => parseItem(item, `markdown-chart.spec.items[${index}]`));
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    return schemaError('markdown-chart.spec.items must use unique ids');
  }
  return { items };
}

function setStyles(element: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(element.style, styles);
}

function themeFallback(theme: unknown, light: string, dark: string): string {
  return theme === 'dark' ? dark : light;
}

function variable(name: string, fallback: string): string {
  return `var(${name}, ${fallback})`;
}

function createReferenceIcon(): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('width', '13');
  icon.setAttribute('height', '13');
  icon.setAttribute('fill', 'none');
  icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.8');
  icon.setAttribute('stroke-linecap', 'round');
  icon.setAttribute('stroke-linejoin', 'round');
  icon.setAttribute('aria-hidden', 'true');
  const first = document.createElementNS(namespace, 'path');
  first.setAttribute('d', 'M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15');
  const second = document.createElementNS(namespace, 'path');
  second.setAttribute('d', 'M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.15-1.15');
  icon.append(first, second);
  return icon;
}

function canOpenReference(
  actions: ChartReferenceActions | undefined,
  event: ChartReferenceEvent,
): boolean {
  if (!actions) return false;
  try {
    return actions.canOpen?.(event) ?? true;
  } catch {
    return false;
  }
}

function openReference(
  actions: ChartReferenceActions,
  event: ChartReferenceEvent,
): void {
  try {
    void Promise.resolve(actions.open(event)).catch(() => undefined);
  } catch {
    // Host interactions are isolated from the mounted KPI surface.
  }
}

function createReferenceEvent(reference: KpiReference): ChartReferenceEvent {
  return Object.freeze({
    rendererId: KPI_RENDERER_ID,
    reference: Object.freeze({ ref: reference.ref, label: reference.label }),
  });
}

interface ReferenceControl {
  readonly button: HTMLButtonElement;
  readonly onClick: () => void;
}

function createReferenceControls(
  references: readonly KpiReference[] | undefined,
  context: ChartMountContext,
): { readonly element: HTMLElement; readonly controls: readonly ReferenceControl[] } | undefined {
  const available = (references ?? [])
    .map((reference) => ({ reference, event: createReferenceEvent(reference) }))
    .filter(({ event }) => canOpenReference(context.referenceActions, event));
  const actions = context.referenceActions;
  if (available.length === 0 || !actions) return undefined;

  const element = document.createElement('div');
  element.className = 'markdown-chart-kpi-references';
  element.setAttribute('role', 'group');
  setStyles(element, {
    display: 'flex',
    flex: '0 0 auto',
    alignItems: 'center',
    gap: '4px',
    marginLeft: 'auto',
  });
  const controls = available.map(({ event }, index): ReferenceControl => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'markdown-chart-kpi-reference';
    button.dataset.markdownChartKpiReference = String(index + 1);
    button.title = event.reference.label;
    button.setAttribute('aria-label', event.reference.label);
    setStyles(button, {
      display: 'inline-flex',
      minWidth: '28px',
      height: '24px',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '2px',
      padding: '0 5px',
      border: `1px solid ${variable('--markdown-chart-kpi-reference-border', 'color-mix(in srgb, currentColor 18%, transparent)')}`,
      borderRadius: '5px',
      background: variable('--markdown-chart-kpi-reference-background', 'transparent'),
      color: variable('--markdown-chart-kpi-reference-color', 'color-mix(in srgb, currentColor 68%, transparent)'),
      cursor: 'pointer',
      font: '500 11px/1 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    const ordinal = document.createElement('span');
    ordinal.textContent = String(index + 1);
    button.append(createReferenceIcon(), ordinal);
    const onClick = (): void => {
      if (context.signal.aborted || !canOpenReference(actions, event)) return;
      openReference(actions, event);
    };
    button.addEventListener('click', onClick);
    element.append(button);
    return { button, onClick };
  });
  return { element, controls };
}

function statusColors(tone: KpiTone, theme: unknown): { background: string; foreground: string } {
  const fallbacks: Record<KpiTone, { light: [string, string]; dark: [string, string] }> = {
    neutral: { light: ['#f3f4f6', '#4b5563'], dark: ['#27272a', '#d4d4d8'] },
    positive: { light: ['#ecfdf3', '#067647'], dark: ['#052e24', '#6ce9a6'] },
    warning: { light: ['#fffaeb', '#b54708'], dark: ['#3b2600', '#fec84b'] },
    negative: { light: ['#fef3f2', '#b42318'], dark: ['#3f1214', '#fda29b'] },
  };
  const fallback = fallbacks[tone];
  const [background, foreground] = theme === 'dark' ? fallback.dark : fallback.light;
  return {
    background: variable(`--markdown-chart-kpi-${tone}-background`, background),
    foreground: variable(`--markdown-chart-kpi-${tone}-color`, foreground),
  };
}

function createKpiCard(
  item: KpiItem,
  context: ChartMountContext,
  listeners: ReferenceControl[],
): HTMLElement {
  const card = document.createElement('article');
  card.className = 'markdown-chart-kpi-item';
  card.dataset.markdownChartKpiId = item.id;
  card.setAttribute('role', 'listitem');
  setStyles(card, {
    display: 'flex',
    minWidth: '0',
    minHeight: '120px',
    boxSizing: 'border-box',
    flexDirection: 'column',
    gap: '10px',
    padding: '14px 15px 13px',
    background: variable(
      '--markdown-chart-kpi-background',
      themeFallback(context.theme, '#ffffff', '#111113'),
    ),
    color: variable(
      '--markdown-chart-kpi-color',
      themeFallback(context.theme, '#18181b', '#fafafa'),
    ),
  });

  const header = document.createElement('div');
  header.className = 'markdown-chart-kpi-header';
  setStyles(header, {
    display: 'flex',
    minWidth: '0',
    alignItems: 'flex-start',
    gap: '8px',
  });
  const title = document.createElement('div');
  title.className = 'markdown-chart-kpi-title';
  title.textContent = item.title;
  setStyles(title, {
    minWidth: '0',
    overflowWrap: 'anywhere',
    color: variable(
      '--markdown-chart-kpi-title-color',
      themeFallback(context.theme, '#52525b', '#d4d4d8'),
    ),
    font: '500 14px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  });
  header.append(title);
  const referenceControls = createReferenceControls(item.references, context);
  if (referenceControls) {
    listeners.push(...referenceControls.controls);
    header.append(referenceControls.element);
  }

  const value = document.createElement('div');
  value.className = 'markdown-chart-kpi-value';
  setStyles(value, {
    display: 'flex',
    minWidth: '0',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: '3px',
    overflowWrap: 'anywhere',
    color: variable(
      '--markdown-chart-kpi-value-color',
      themeFallback(context.theme, '#18181b', '#fafafa'),
    ),
    font: '600 28px/1.15 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontVariantNumeric: 'tabular-nums',
  });
  if (item.prefix) {
    const prefix = document.createElement('span');
    prefix.className = 'markdown-chart-kpi-prefix';
    prefix.textContent = item.prefix;
    value.append(prefix);
  }
  const mainValue = document.createElement('span');
  mainValue.className = 'markdown-chart-kpi-main-value';
  mainValue.textContent = item.value;
  value.append(mainValue);
  if (item.suffix) {
    const suffix = document.createElement('span');
    suffix.className = 'markdown-chart-kpi-suffix';
    suffix.textContent = item.suffix;
    setStyles(suffix, { fontSize: '.72em', fontWeight: '500' });
    value.append(suffix);
  }

  card.append(header, value);
  if (item.status) {
    const colors = statusColors(item.status.tone, context.theme);
    const status = document.createElement('div');
    status.className = 'markdown-chart-kpi-status';
    status.dataset.tone = item.status.tone;
    status.textContent = item.status.text;
    setStyles(status, {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      marginTop: 'auto',
      padding: '3px 7px',
      overflowWrap: 'anywhere',
      borderRadius: '4px',
      background: colors.background,
      color: colors.foreground,
      font: '500 12px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });
    card.append(status);
  }
  return card;
}

function mountKpi(
  container: HTMLElement,
  spec: KpiSpec,
  context: ChartMountContext,
): ChartHandle | void {
  if (context.signal.aborted) return undefined;
  const previousMinHeight = container.style.minHeight;
  const hadContainerClass = container.classList.contains('markdown-chart-kpi-container');
  container.classList.add('markdown-chart-kpi-container');
  container.style.minHeight = '0';

  const grid = document.createElement('div');
  grid.className = 'markdown-chart-kpi-grid';
  grid.setAttribute('role', 'list');
  setStyles(grid, {
    display: 'grid',
    width: '100%',
    minWidth: '0',
    boxSizing: 'border-box',
    gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))',
    gap: '1px',
    margin: '10px 0',
    padding: '1px',
    overflow: 'hidden',
    borderRadius: '9px',
    background: variable(
      '--markdown-chart-kpi-border-color',
      themeFallback(context.theme, '#dbe3ff', '#3f465c'),
    ),
  });
  const listeners: ReferenceControl[] = [];
  spec.items.forEach((item) => grid.append(createKpiCard(item, context, listeners)));
  container.replaceChildren(grid);

  return {
    dispose() {
      listeners.forEach(({ button, onClick }) => button.removeEventListener('click', onClick));
      if (grid.parentElement === container) grid.remove();
      container.style.minHeight = previousMinHeight;
      if (!hadContainerClass) container.classList.remove('markdown-chart-kpi-container');
    },
  };
}

export function createKpiRenderer(): ChartRenderer<KpiSpec> {
  return {
    id: KPI_RENDERER_ID,
    parse(spec, context) {
      return parseKpiSpec(spec, context.data !== undefined);
    },
    mount: mountKpi,
  };
}
