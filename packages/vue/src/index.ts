import MarkdownIt from 'markdown-it';
import {
  ChartController,
  ChartRendererRegistry,
} from '@datafe/markdown-chart';
import { createEChartsRenderer } from '@datafe/markdown-chart-echarts';
import {
  getMarkdownChartBlocks,
  markdownChartPlugin,
  type MarkdownChartBlock,
  type MarkdownChartEnvironment,
} from '@datafe/markdown-chart-markdown-it';
import {
  defineComponent,
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  readonly,
  ref,
  shallowRef,
  toRef,
  toValue,
  watch,
  type MaybeRef,
  type PropType,
  type Ref,
} from 'vue';

export type MarkdownChartVueErrorHandler = (
  error: unknown,
  block: MarkdownChartBlock,
) => void;

export interface MountMarkdownChartBlocksOptions {
  readonly theme?: unknown;
  readonly streaming?: boolean;
  readonly minHeight?: string | number | undefined;
  readonly onError?: MarkdownChartVueErrorHandler;
}

export interface MountedMarkdownCharts {
  readonly ready: Promise<void>;
  dispose(): void;
}

export function mountMarkdownChartBlocks(
  container: HTMLElement,
  blocks: readonly MarkdownChartBlock[],
  registry: ChartRendererRegistry,
  options: MountMarkdownChartBlocksOptions = {},
): MountedMarkdownCharts {
  const minHeight = typeof options.minHeight === 'number'
    ? `${options.minHeight}px`
    : options.minHeight;
  const placeholders = new Map<string, HTMLElement>();
  container.querySelectorAll<HTMLElement>('[data-markdown-chart-id]').forEach((element) => {
    const id = element.dataset.markdownChartId;
    if (id) {
      if (minHeight) {
        element.style.minHeight = minHeight;
      }
      placeholders.set(id, element);
    }
  });

  const controllers: ChartController[] = [];
  const tasks = blocks.map(async (block) => {
    const placeholder = placeholders.get(block.id);
    if (!placeholder) {
      return;
    }
    const controller = new ChartController(registry);
    controllers.push(controller);
    try {
      await controller.render(placeholder, {
        language: block.language,
        source: block.source,
        theme: options.theme,
        streaming: options.streaming ?? false,
      });
    } catch (error) {
      placeholder.classList.add('markdown-chart-error');
      placeholder.setAttribute('role', 'alert');
      placeholder.textContent = 'Chart unavailable';
      options.onError?.(error, block);
    }
  });

  let disposed = false;
  return {
    ready: Promise.all(tasks).then(() => undefined),
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      controllers.forEach((controller) => controller.dispose());
    },
  };
}

export interface UseMarkdownChartOptions {
  readonly source: MaybeRef<string>;
  readonly markdownIt: MaybeRef<MarkdownIt>;
  readonly registry: MaybeRef<ChartRendererRegistry>;
  readonly theme?: MaybeRef<unknown>;
  readonly streaming?: MaybeRef<boolean>;
  readonly minHeight?: MaybeRef<string | number | undefined>;
  readonly onError?: MarkdownChartVueErrorHandler;
}

export interface UseMarkdownChartResult {
  readonly container: Ref<HTMLElement | null>;
  readonly html: Readonly<Ref<string>>;
  refresh(): Promise<void>;
  dispose(): void;
}

export function useMarkdownChart(options: UseMarkdownChartOptions): UseMarkdownChartResult {
  const container = shallowRef<HTMLElement | null>(null);
  const html = ref('');
  let mounted: MountedMarkdownCharts | undefined;
  let generation = 0;

  const currentTheme = (): unknown => options.theme === undefined ? undefined : toValue(options.theme);
  const currentStreaming = (): boolean => options.streaming === undefined
    ? false
    : Boolean(toValue(options.streaming));
  const currentMinHeight = (): string | number | undefined => options.minHeight === undefined
    ? undefined
    : toValue(options.minHeight);

  const refresh = async (): Promise<void> => {
    const localGeneration = ++generation;
    mounted?.dispose();
    mounted = undefined;

    const env: MarkdownChartEnvironment = {};
    html.value = toValue(options.markdownIt).render(toValue(options.source), env);
    const blocks = getMarkdownChartBlocks(env);
    await nextTick();
    if (localGeneration !== generation || !container.value) {
      return;
    }
    mounted = mountMarkdownChartBlocks(container.value, blocks, toValue(options.registry), {
      theme: currentTheme(),
      streaming: currentStreaming(),
      minHeight: currentMinHeight(),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    await mounted.ready;
  };

  const stop = watch(
    [
      () => toValue(options.source),
      () => toValue(options.markdownIt),
      () => toValue(options.registry),
      currentTheme,
      currentStreaming,
      currentMinHeight,
    ],
    () => { void refresh(); },
    { flush: 'post' },
  );
  onMounted(() => { void refresh(); });
  onBeforeUnmount(() => {
    generation += 1;
    stop();
    mounted?.dispose();
    mounted = undefined;
  });

  return {
    container,
    html: readonly(html),
    refresh,
    dispose() {
      generation += 1;
      stop();
      mounted?.dispose();
      mounted = undefined;
    },
  };
}

export const MarkdownChart = defineComponent({
  name: 'MarkdownChart',
  props: {
    source: { type: String, required: true },
    markdownIt: { type: Object as PropType<MarkdownIt>, required: false },
    registry: { type: Object as PropType<ChartRendererRegistry>, required: false },
    theme: { type: null as unknown as PropType<unknown>, required: false },
    streaming: { type: Boolean, default: false },
    minHeight: {
      type: [String, Number] as PropType<string | number>,
      default: 360,
    },
    onError: {
      type: Function as PropType<MarkdownChartVueErrorHandler>,
      required: false,
    },
  },
  setup(props) {
    const automaticRegistry = new ChartRendererRegistry().register(createEChartsRenderer());
    const registry = computed(() => props.registry ?? automaticRegistry);
    const automaticMarkdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
      registry: { has: (language) => registry.value.has(language) },
    });
    const markdownIt = computed(() => props.markdownIt ?? automaticMarkdownIt);
    const state = useMarkdownChart({
      source: toRef(props, 'source'),
      markdownIt,
      registry,
      theme: toRef(props, 'theme'),
      streaming: toRef(props, 'streaming'),
      minHeight: toRef(props, 'minHeight'),
      onError: (error, block) => props.onError?.(error, block),
    });
    return () => h('div', {
      ref: state.container,
      class: 'markdown-chart',
      innerHTML: state.html.value,
    });
  },
});
