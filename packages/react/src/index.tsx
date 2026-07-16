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
} from 'react';
import type { Components } from 'react-markdown';
import { ChartController, type ChartRendererRegistry } from '@datafe/markdown-chart';

export type MarkdownChartReactErrorHandler = (
  error: unknown,
  context: { readonly language: string; readonly source: string },
) => void;

interface MarkdownChartContextValue {
  readonly registry: ChartRendererRegistry;
  readonly theme: unknown;
  readonly streaming: boolean;
  readonly onError: MarkdownChartReactErrorHandler | undefined;
}

const MarkdownChartContext = createContext<MarkdownChartContextValue | null>(null);

export interface MarkdownChartProviderProps {
  readonly registry: ChartRendererRegistry;
  readonly theme?: unknown;
  readonly streaming?: boolean;
  readonly onError?: MarkdownChartReactErrorHandler;
  readonly children: ReactNode;
}

export function MarkdownChartProvider(props: MarkdownChartProviderProps): ReactElement {
  const value = useMemo<MarkdownChartContextValue>(() => ({
    registry: props.registry,
    theme: props.theme,
    streaming: props.streaming ?? false,
    onError: props.onError,
  }), [props.registry, props.theme, props.streaming, props.onError]);
  return createElement(MarkdownChartContext.Provider, { value }, props.children);
}

export interface MarkdownChartBlockProps {
  readonly language: string;
  readonly source: string;
  readonly className?: string;
}

export function MarkdownChartBlock(props: MarkdownChartBlockProps): ReactElement {
  const configuration = useContext(MarkdownChartContext);
  if (!configuration) {
    throw new Error('MarkdownChartBlock must be rendered inside MarkdownChartProvider');
  }
  const containerRef = useRef<HTMLDivElement>(null);

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
      streaming: configuration.streaming,
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
    configuration.streaming,
    configuration.onError,
    props.language,
    props.source,
  ]);

  const className = ['markdown-chart-placeholder', props.className].filter(Boolean).join(' ');
  return createElement('div', {
    ref: containerRef,
    className,
    'aria-label': 'Chart',
  });
}

export interface CreateMarkdownChartComponentsOptions {
  readonly chartClassName?: string;
}

interface CodeElementProps {
  readonly className?: string;
  readonly children?: ReactNode;
}

export function isRegisteredChartLanguage(
  language: string,
  registry: Pick<ChartRendererRegistry, 'has'> | undefined,
): boolean {
  return language === 'chart' || registry?.has(language) === true;
}

export function createMarkdownChartComponents(
  options: CreateMarkdownChartComponentsOptions = {},
): Components {
  const components: Components = {
    code({ node: _node, ...props }) {
      return createElement('code', props);
    },
    pre: function MarkdownChartPre({ node: _node, children, ...props }) {
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
            ...(options.chartClassName ? { className: options.chartClassName } : {}),
          });
        }
      }
      return createElement('pre', props, children);
    },
  };
  return components;
}
