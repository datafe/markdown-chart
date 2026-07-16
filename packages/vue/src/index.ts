import MarkdownIt from 'markdown-it';
import {
  ChartController,
  ChartRendererRegistry,
} from '@datafe/markdown-chart';
import {
  createEChartsRenderer,
  type CreateEChartsRendererOptions,
  type ResolveLegacyArtifactContent,
} from '@datafe/markdown-chart-echarts';
import {
  createMarkdownChartEnvironment,
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

interface MountedMarkdownChartEntry {
  readonly block: MarkdownChartBlock;
  readonly registry: ChartRendererRegistry;
  readonly theme: unknown;
  readonly element: HTMLElement;
  readonly controller: ChartController;
  ready: Promise<void>;
}

function blockIsComplete(
  block: MarkdownChartBlock,
  options: MountMarkdownChartBlocksOptions,
): boolean {
  return block.complete ?? (options.streaming !== true);
}

function applyMinHeight(element: HTMLElement, minHeight: string | number | undefined): void {
  const value = typeof minHeight === 'number' ? `${minHeight}px` : minHeight;
  if (value) {
    element.style.minHeight = value;
  } else {
    element.style.removeProperty('min-height');
  }
}

class MarkdownChartMountManager {
  readonly #entries = new Map<string, MountedMarkdownChartEntry>();

  reconcile(
    container: HTMLElement,
    blocks: readonly MarkdownChartBlock[],
    registry: ChartRendererRegistry,
    options: MountMarkdownChartBlocksOptions,
  ): Promise<void> {
    const placeholders = new Map<string, HTMLElement>();
    container.querySelectorAll<HTMLElement>('[data-markdown-chart-id]').forEach((element) => {
      const id = element.dataset.markdownChartId;
      if (id) {
        applyMinHeight(element, options.minHeight);
        placeholders.set(id, element);
      }
    });

    const activeIds = new Set(blocks.map((block) => block.id));
    for (const [id, entry] of this.#entries) {
      if (!activeIds.has(id)) {
        entry.controller.dispose();
        this.#entries.delete(id);
      }
    }

    const tasks: Promise<void>[] = [];
    for (const block of blocks) {
      const placeholder = placeholders.get(block.id);
      const existing = this.#entries.get(block.id);
      const complete = blockIsComplete(block, options);
      if (!placeholder || !complete) {
        existing?.controller.dispose();
        this.#entries.delete(block.id);
        continue;
      }

      const reusable = existing
        && existing.registry === registry
        && Object.is(existing.theme, options.theme)
        && existing.block.language === block.language
        && existing.block.source === block.source;
      if (reusable) {
        applyMinHeight(existing.element, options.minHeight);
        if (existing.element !== placeholder) {
          placeholder.replaceWith(existing.element);
        }
        tasks.push(existing.ready);
        continue;
      }

      existing?.controller.dispose();
      placeholder.classList.remove('markdown-chart-error');
      placeholder.removeAttribute('role');
      placeholder.replaceChildren();
      const controller = new ChartController(registry);
      const entry: MountedMarkdownChartEntry = {
        block,
        registry,
        theme: options.theme,
        element: placeholder,
        controller,
        ready: Promise.resolve(),
      };
      this.#entries.set(block.id, entry);
      entry.ready = controller.render(placeholder, {
        language: block.language,
        source: block.source,
        theme: options.theme,
        streaming: false,
      }).catch((error: unknown) => {
        if (this.#entries.get(block.id) !== entry) {
          return;
        }
        this.#entries.delete(block.id);
        controller.dispose();
        placeholder.classList.add('markdown-chart-error');
        placeholder.setAttribute('role', 'alert');
        placeholder.textContent = 'Chart unavailable';
        options.onError?.(error, block);
      });
      tasks.push(entry.ready);
    }
    return Promise.all(tasks).then(() => undefined);
  }

  dispose(): void {
    this.#entries.forEach((entry) => entry.controller.dispose());
    this.#entries.clear();
  }
}

export function mountMarkdownChartBlocks(
  container: HTMLElement,
  blocks: readonly MarkdownChartBlock[],
  registry: ChartRendererRegistry,
  options: MountMarkdownChartBlocksOptions = {},
): MountedMarkdownCharts {
  const manager = new MarkdownChartMountManager();
  const ready = manager.reconcile(container, blocks, registry, options);
  let disposed = false;
  return {
    ready,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      manager.dispose();
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
  const manager = new MarkdownChartMountManager();
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
    const source = toValue(options.source);
    const env: MarkdownChartEnvironment = createMarkdownChartEnvironment({
      streaming: currentStreaming(),
    });
    html.value = toValue(options.markdownIt).render(source, env);
    const blocks = getMarkdownChartBlocks(env);
    await nextTick();
    if (localGeneration !== generation || !container.value) {
      return;
    }
    await manager.reconcile(container.value, blocks, toValue(options.registry), {
      theme: currentTheme(),
      minHeight: currentMinHeight(),
      ...(options.onError ? { onError: options.onError } : {}),
    });
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
    manager.dispose();
  });

  return {
    container,
    html: readonly(html),
    refresh,
    dispose() {
      generation += 1;
      stop();
      manager.dispose();
    },
  };
}

export const MarkdownChart = defineComponent({
  name: 'MarkdownChart',
  props: {
    source: { type: String, required: true },
    markdownIt: { type: Object as PropType<MarkdownIt>, required: false },
    registry: { type: Object as PropType<ChartRendererRegistry>, required: false },
    echarts: { type: Object as PropType<CreateEChartsRendererOptions>, required: false },
    /** @deprecated Temporary ChatBI migration hook. Return raw CSV ArtifactContent. */
    resolveLegacyArtifactContent: {
      type: Function as PropType<ResolveLegacyArtifactContent>,
      required: false,
    },
    /** @deprecated Cache context for the temporary ChatBI migration hook. */
    legacyArtifactContextKey: {
      type: [String, Number] as PropType<string | number>,
      required: false,
    },
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
    const latestLegacyArtifactContentResolver = shallowRef(props.resolveLegacyArtifactContent);
    const hasLegacyArtifactContentResolver = ref(
      props.resolveLegacyArtifactContent !== undefined,
    );
    const legacyArtifactContextVersion = shallowRef<object>({});
    watch(
      [
        () => props.resolveLegacyArtifactContent,
        () => props.legacyArtifactContextKey,
      ],
      ([resolver, contextKey], [previousResolver, previousContextKey]) => {
        latestLegacyArtifactContentResolver.value = resolver;
        hasLegacyArtifactContentResolver.value = resolver !== undefined;
        const context = contextKey ?? resolver;
        const previousContext = previousContextKey ?? previousResolver;
        if (!Object.is(context, previousContext)) {
          legacyArtifactContextVersion.value = {};
        }
      },
      { flush: 'sync' },
    );
    const stableResolveLegacyArtifactContent: ResolveLegacyArtifactContent = (request) => {
      const resolver = latestLegacyArtifactContentResolver.value;
      if (!resolver) {
        throw new Error('resolveLegacyArtifactContent is no longer configured');
      }
      return resolver(request);
    };
    const automaticRegistry = computed(() => {
      const hasResolver = hasLegacyArtifactContentResolver.value;
      void legacyArtifactContextVersion.value;
      if (
        hasResolver
        && props.echarts?.resolveLegacyArtifactContent
      ) {
        throw new Error(
          'Configure resolveLegacyArtifactContent either as a MarkdownChart prop or in echarts options, not both',
        );
      }
      return new ChartRendererRegistry().register(createEChartsRenderer({
        ...props.echarts,
        ...(hasResolver
          ? { resolveLegacyArtifactContent: stableResolveLegacyArtifactContent }
          : {}),
      }));
    });
    const registry = computed(() => props.registry ?? automaticRegistry.value);
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
