import {
  Children,
  createContext,
  createElement,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
} from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import {
  ChartController,
  ChartRendererRegistry,
  isMarkdownFenceClosed,
  MARKDOWN_CHART_LANGUAGE,
} from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  type CreateEChartsRendererOptions,
  type ResolveLegacyArtifactContent,
} from '@datafe-open/markdown-chart-echarts';

export type MarkdownChartReactErrorHandler = (
  error: unknown,
  context: { readonly language: string; readonly source: string },
) => void;

interface MarkdownChartContextValue {
  readonly registry: ChartRendererRegistry;
  readonly theme: unknown;
  readonly streaming: boolean;
  readonly source: string | undefined;
  readonly onError: MarkdownChartReactErrorHandler | undefined;
}

const MarkdownChartContext = createContext<MarkdownChartContextValue | null>(null);

export interface MarkdownChartProviderProps {
  readonly registry: ChartRendererRegistry;
  readonly theme?: unknown;
  readonly streaming?: boolean;
  /** Optional when the direct child already receives the Markdown as children. */
  readonly source?: string;
  readonly onError?: MarkdownChartReactErrorHandler;
  readonly children: ReactNode;
}

function markdownSourceFromChildren(children: ReactNode): string | undefined {
  if (!isValidElement<{ children?: ReactNode }>(children)) {
    return undefined;
  }
  return typeof children.props.children === 'string' ? children.props.children : undefined;
}

export function MarkdownChartProvider(props: MarkdownChartProviderProps): ReactElement {
  const source = props.source ?? markdownSourceFromChildren(props.children);
  const value = useMemo<MarkdownChartContextValue>(() => ({
    registry: props.registry,
    theme: props.theme,
    streaming: props.streaming ?? false,
    source,
    onError: props.onError,
  }), [props.registry, props.theme, props.streaming, source, props.onError]);
  return createElement(MarkdownChartContext.Provider, { value }, props.children);
}

export interface MarkdownChartBlockProps {
  readonly language: string;
  readonly source: string;
  readonly streaming?: boolean;
  readonly className?: string;
  readonly style?: CSSProperties;
}

export function MarkdownChartBlock(props: MarkdownChartBlockProps): ReactElement {
  const configuration = useContext(MarkdownChartContext);
  if (!configuration) {
    throw new Error('MarkdownChartBlock must be rendered inside MarkdownChartProvider');
  }
  const containerRef = useRef<HTMLDivElement>(null);
  const streaming = props.streaming ?? configuration.streaming;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }
    const controller = new ChartController(configuration.registry);
    let disposed = false;
    void controller.render(container, {
      language: props.language,
      source: props.source,
      theme: configuration.theme,
      streaming,
    }).catch((error: unknown) => {
      if (disposed) {
        return;
      }
      container.classList.add('markdown-chart-error');
      container.setAttribute('role', 'alert');
      container.textContent = 'Chart unavailable';
      configuration.onError?.(error, {
        language: props.language,
        source: props.source,
      });
    });
    return () => {
      disposed = true;
      controller.dispose();
    };
  }, [
    configuration.registry,
    configuration.theme,
    configuration.onError,
    props.language,
    props.source,
    streaming,
  ]);

  const className = [
    'markdown-chart-placeholder',
    streaming ? 'markdown-chart-streaming' : undefined,
    props.className,
  ].filter(Boolean).join(' ');
  return createElement('div', {
    ref: containerRef,
    className,
    style: props.style,
    'aria-label': 'Chart',
    'aria-busy': streaming || undefined,
    'data-markdown-chart-complete': String(!streaming),
  });
}

export interface CreateMarkdownChartComponentsOptions {
  readonly chartClassName?: string;
  readonly chartStyle?: CSSProperties;
}

interface CodeElementProps {
  readonly className?: string;
  readonly children?: ReactNode;
}

interface PositionedNode {
  readonly position?: {
    readonly start: { readonly offset?: number | undefined };
    readonly end: { readonly offset?: number | undefined };
  } | undefined;
}

function isCompleteChartNode(source: string | undefined, node: PositionedNode | undefined): boolean {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (source === undefined || start === undefined || end === undefined) {
    return false;
  }
  return isMarkdownFenceClosed(source.slice(start, end))
    || source.slice(end).trim().length > 0;
}

export function isRegisteredChartLanguage(
  language: string,
  registry: Pick<ChartRendererRegistry, 'has'> | undefined,
): boolean {
  return language === MARKDOWN_CHART_LANGUAGE || registry?.has(language) === true;
}

export function createMarkdownChartComponents(
  options: CreateMarkdownChartComponentsOptions = {},
): Components {
  const components: Components = {
    code({ node: _node, ...props }) {
      return createElement('code', props);
    },
    pre: function MarkdownChartPre({ node, children, ...props }) {
      const configuration = useContext(MarkdownChartContext);
      if (isValidElement(children)) {
        const code = children as ReactElement<CodeElementProps>;
        const match = /(?:^|\s)language-([^\s]+)/.exec(code.props.className ?? '');
        const language = match?.[1]?.toLowerCase();
        if (language && isRegisteredChartLanguage(language, configuration?.registry)) {
          const source = Children.toArray(code.props.children)
            .map((child) => typeof child === 'string' || typeof child === 'number' ? String(child) : '')
            .join('');
          return createElement(MarkdownChartBlock, {
            language,
            source,
            streaming: configuration?.streaming === true
              && !isCompleteChartNode(configuration.source, node),
            ...(options.chartClassName ? { className: options.chartClassName } : {}),
            ...(options.chartStyle ? { style: options.chartStyle } : {}),
          });
        }
      }
      return createElement('pre', props, children);
    },
  };
  return components;
}

export interface MarkdownChartProps {
  readonly source: string;
  readonly registry?: ChartRendererRegistry;
  readonly echarts?: CreateEChartsRendererOptions;
  /** @deprecated Temporary ChatBI migration hook. Return raw CSV ArtifactContent. */
  readonly resolveLegacyArtifactContent?: ResolveLegacyArtifactContent;
  /**
   * @deprecated Cache context for the temporary ChatBI migration hook.
   * Keep this stable across equivalent callback instances and change it when
   * the callback's authorization/session context changes.
   */
  readonly legacyArtifactContextKey?: string | number;
  readonly theme?: unknown;
  readonly streaming?: boolean;
  readonly onError?: MarkdownChartReactErrorHandler;
  readonly chartClassName?: string;
  readonly chartStyle?: CSSProperties;
}

export function MarkdownChart(props: MarkdownChartProps): ReactElement {
  const legacyArtifactContentRef = useRef(props.resolveLegacyArtifactContent);
  legacyArtifactContentRef.current = props.resolveLegacyArtifactContent;
  const stableResolveLegacyArtifactContent = useMemo<ResolveLegacyArtifactContent>(() => (
    (request) => {
      const resolver = legacyArtifactContentRef.current;
      if (!resolver) {
        throw new Error('resolveLegacyArtifactContent is no longer configured');
      }
      return resolver(request);
    }
  ), []);
  const hasLegacyArtifactContentResolver = props.resolveLegacyArtifactContent !== undefined;
  const legacyArtifactContext = props.legacyArtifactContextKey
    ?? props.resolveLegacyArtifactContent;
  const automaticRegistry = useMemo(() => {
    if (
      hasLegacyArtifactContentResolver
      && props.echarts?.resolveLegacyArtifactContent
    ) {
      throw new Error(
        'Configure resolveLegacyArtifactContent either as a MarkdownChart prop or in echarts options, not both',
      );
    }
    return new ChartRendererRegistry().register(createEChartsRenderer({
      ...props.echarts,
      ...(hasLegacyArtifactContentResolver
        ? { resolveLegacyArtifactContent: stableResolveLegacyArtifactContent }
        : {}),
    }));
  }, [
    props.echarts,
    hasLegacyArtifactContentResolver,
    legacyArtifactContext,
    stableResolveLegacyArtifactContent,
  ]);
  const registry = props.registry ?? automaticRegistry;
  const components = useMemo(() => createMarkdownChartComponents({
    ...(props.chartClassName ? { chartClassName: props.chartClassName } : {}),
    chartStyle: { minHeight: 360, ...props.chartStyle },
  }), [props.chartClassName, props.chartStyle]);

  return createElement(
    MarkdownChartProvider,
    {
      registry,
      source: props.source,
      children: createElement(ReactMarkdown, { components }, props.source),
      ...(props.theme !== undefined ? { theme: props.theme } : {}),
      ...(props.streaming !== undefined ? { streaming: props.streaming } : {}),
      ...(props.onError ? { onError: props.onError } : {}),
    },
  );
}
