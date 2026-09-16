import {
  ChartRendererRegistry,
  type JsonPrimitive,
} from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  type EChartsInstance,
  type EChartsRuntime,
} from '@datafe-open/markdown-chart-echarts';
import * as echarts from 'echarts';

const ROW_COUNT = 100_000;
const requestedRunCount = Number(new URLSearchParams(window.location.search).get('runs') ?? 3);
const RUN_COUNT = Number.isInteger(requestedRunCount) && requestedRunCount > 0
  ? requestedRunCount
  : 3;

const statusNode = document.querySelector<HTMLElement>('#status');
const resultNode = document.querySelector<HTMLElement>('#results');
const chartNode = document.querySelector<HTMLElement>('#chart');

if (!statusNode || !resultNode || !chartNode) {
  throw new Error('Benchmark DOM is incomplete');
}

const readHeap = (): number | null => {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number };
  }).memory;
  return memory?.usedJSHeapSize ?? null;
};

const nextFrame = (): Promise<void> => new Promise((resolve) => {
  requestAnimationFrame(() => resolve());
});

const createRows = (): JsonPrimitive[][] => {
  const rows = new Array<JsonPrimitive[]>(ROW_COUNT);
  const start = Date.UTC(2026, 0, 1);
  for (let index = 0; index < ROW_COUNT; index += 1) {
    rows[index] = [
      new Date(start + index * 60_000).toISOString().slice(0, 16),
      Number((100 + Math.sin(index / 97) * 20 + Math.cos(index / 31) * 5).toFixed(3)),
    ];
  }
  return rows;
};

const canonicalRef = JSON.stringify({
  version: 1,
  renderer: 'echarts',
  data: {
    kind: 'ref',
    ref: 'benchmark:100k-trend',
    dimensions: ['timestamp', 'value'],
  },
  spec: {
    animation: false,
    tooltip: { trigger: 'axis' },
    dataZoom: [
      { type: 'inside', start: 0, end: 100 },
      { type: 'slider', start: 0, end: 100 },
    ],
    xAxis: { type: 'category' },
    yAxis: { type: 'value', scale: true },
    series: [{
      type: 'line',
      encode: { x: 'timestamp', y: 'value' },
      showSymbol: false,
      sampling: 'lttb',
      lineStyle: { width: 1 },
    }],
  },
});

const runOnce = async (rows: readonly JsonPrimitive[][], run: number) => {
  chartNode.replaceChildren();
  const heapBefore = readHeap();
  let instance: echarts.ECharts | undefined;
  let resolveFinished: ((durationMs: number) => void) | undefined;
  let renderStarted = 0;
  const finished = new Promise<number>((resolve) => {
    resolveFinished = resolve;
  });
  const runtime: EChartsRuntime = {
    init(container, theme) {
      instance = echarts.init(container, theme);
      instance.on('finished', () => resolveFinished?.(performance.now() - renderStarted));
      return instance as unknown as EChartsInstance;
    },
  };
  const registry = new ChartRendererRegistry().register(createEChartsRenderer({
    loadECharts: () => runtime,
    resolveDataRef: async () => ({ dimensions: ['timestamp', 'value'], source: rows }),
    resizeObserver: false,
  }));

  const prepareStart = performance.now();
  const prepared = await registry.prepare('markdown-chart', canonicalRef);
  const prepareMs = performance.now() - prepareStart;

  const materializeStart = performance.now();
  const materialized = await prepared.renderer.materialize?.(prepared.parsed, {
    language: 'markdown-chart',
    rawLanguage: 'markdown-chart',
    rendererId: prepared.rendererId,
    data: prepared.data,
    signal: new AbortController().signal,
    theme: undefined,
  });
  const materializeMs = performance.now() - materializeStart;
  if (!materialized?.data || materialized.data.kind !== 'inline') {
    throw new Error('Referenced chart did not materialize inline data');
  }
  const heapAfterMaterialize = readHeap();

  renderStarted = performance.now();
  const handle = await prepared.renderer.mount(chartNode, materialized.parsed, {
    signal: new AbortController().signal,
    theme: undefined,
  });
  const mountReturnMs = performance.now() - renderStarted;
  const finishedMs = await Promise.race([
    finished,
    new Promise<number>((_, reject) => {
      window.setTimeout(() => reject(new Error('ECharts finished timeout')), 30_000);
    }),
  ]);
  await nextFrame();
  await nextFrame();
  const heapAfterRender = readHeap();

  const zoomSamples: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    instance?.dispatchAction({
      type: 'dataZoom',
      start: 10 + index * 5,
      end: 90 - index * 5,
    });
    await nextFrame();
    await nextFrame();
    zoomSamples.push(performance.now() - start);
  }

  const heapAfterZoom = readHeap();
  const canvasCount = chartNode.querySelectorAll('canvas').length;
  handle?.dispose();
  await nextFrame();
  await nextFrame();
  const heapAfterDispose = readHeap();
  return {
    run,
    prepareMs,
    materializeMs,
    mountReturnMs,
    finishedMs,
    zoomTwoFrameMs: zoomSamples,
    heapBeforeBytes: heapBefore,
    heapAfterMaterializeBytes: heapAfterMaterialize,
    heapAfterRenderBytes: heapAfterRender,
    heapAfterZoomBytes: heapAfterZoom,
    heapAfterDisposeBytes: heapAfterDispose,
    heapDeltaThroughZoomBytes: heapBefore === null || heapAfterZoom === null
      ? null
      : heapAfterZoom - heapBefore,
    canvasCount,
  };
};

const runBenchmark = async () => {
  statusNode.textContent = 'Generating 100,000-row dataset…';
  const rows = createRows();
  const results = [];
  for (let run = 1; run <= RUN_COUNT; run += 1) {
    statusNode.textContent = `Running ${run}/${RUN_COUNT}…`;
    results.push(await runOnce(rows, run));
  }
  const report = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    rowCount: ROW_COUNT,
    cellCount: ROW_COUNT * 2,
    echartsVersion: echarts.version,
    results,
  };
  statusNode.textContent = 'Complete';
  resultNode.textContent = JSON.stringify(report, null, 2);
  return report;
};

const runWithFailureState = () => runBenchmark().catch((error: unknown) => {
  statusNode.textContent = 'Failed';
  resultNode.textContent = error instanceof Error ? error.stack ?? error.message : String(error);
  throw error;
});
const autostart = new URLSearchParams(window.location.search).get('autostart') !== '0';
const benchmarkPromise = autostart ? runWithFailureState() : null;
if (!autostart) statusNode.textContent = 'Ready';

Object.assign(window, {
  __markdownChartECharts5Benchmark: benchmarkPromise,
  __runMarkdownChartECharts5Benchmark: runWithFailureState,
});
