import { ChartRendererRegistry } from '@datafe-open/markdown-chart';
import {
  createEChartsRenderer,
  type LegacySandboxBinding,
  type LegacySandboxHostAdapter,
  type LegacySandboxHostContext,
} from '@datafe-open/markdown-chart-echarts';
import { markdownChartPlugin } from '@datafe-open/markdown-chart-markdown-it';
import MarkdownIt from 'markdown-it';
import { computed, type ComputedRef } from 'vue';

export interface ChatBIChartContextOptions {
  readonly legacySandbox: LegacySandboxBinding;
}

export interface ChatBIChartContext {
  readonly registry: ChartRendererRegistry;
  readonly markdownIt: MarkdownIt;
}

export interface ChatBIChartMessageState {
  readonly sessionId: () => string;
  readonly requestId: () => string;
  readonly streaming: () => boolean;
  readonly cacheScopeKey: () => string;
}

export interface ChatBIChartMessageLifecycle {
  readonly chartContext: ComputedRef<ChatBIChartContext>;
}

/** Builds one parser/renderer context for one bound ChatBI lookup scope. */
export function createChatBIChartContext(
  options: ChatBIChartContextOptions,
): ChatBIChartContext {
  const registry = new ChartRendererRegistry().register(createEChartsRenderer({
    legacySandbox: options.legacySandbox,
  }));
  const markdownIt = new MarkdownIt({ html: false }).use(markdownChartPlugin, {
    registry,
  });
  return { registry, markdownIt };
}

/** Binds the SFC-owned host adapter to an authoritative reactive turn context. */
export function useChatBIChartMessageLifecycle(
  state: ChatBIChartMessageState,
  hostAdapter: LegacySandboxHostAdapter,
): ChatBIChartMessageLifecycle {
  const hostContext = computed<LegacySandboxHostContext>(() => ({
    sessionId: state.sessionId(),
    requestId: state.requestId(),
    phase: state.streaming() ? 'live' : 'final',
    cacheScopeKey: state.cacheScopeKey(),
  }));
  const hostIdentity = computed(() => hostAdapter.identity(hostContext.value));
  const legacySandbox = computed(() => {
    void hostIdentity.value;
    const binding = hostAdapter.bind(hostContext.value);
    if (!binding) throw new Error('sessionId and cacheScopeKey are required');
    return binding;
  });
  const chartContext = computed(() => createChatBIChartContext({
    legacySandbox: legacySandbox.value,
  }));
  return { chartContext };
}
