import type MarkdownIt from 'markdown-it';
import {
  MARKDOWN_CHART_LANGUAGE,
  type ChartRendererRegistry,
} from '@datafe/markdown-chart';

export const MARKDOWN_CHART_ENV_KEY = 'markdownChart' as const;

export interface MarkdownChartBlock {
  readonly id: string;
  readonly language: string;
  readonly source: string;
  /** False only for an unterminated fence in an actively streaming document. */
  readonly complete?: boolean;
}

export interface MarkdownChartEnvironmentState {
  readonly blocks: MarkdownChartBlock[];
  readonly streaming?: boolean;
}

export type MarkdownChartEnvironment = Record<string, unknown> & {
  [MARKDOWN_CHART_ENV_KEY]?: MarkdownChartEnvironmentState;
};

export interface MarkdownChartPluginOptions {
  readonly registry?: Pick<ChartRendererRegistry, 'has'>;
  readonly isChartLanguage?: (language: string) => boolean;
  readonly idPrefix?: string;
  readonly placeholderClass?: string;
}

export interface CreateMarkdownChartEnvironmentOptions {
  readonly streaming?: boolean;
}

const SAFE_TOKEN = /^[a-z][a-z0-9_-]*$/i;

function normalizeLanguage(info: string): string {
  return info.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function stateFor(env: unknown): MarkdownChartEnvironmentState {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    throw new TypeError('markdown-it env must be an object when rendering chart fences');
  }
  const environment = env as MarkdownChartEnvironment;
  const current = environment[MARKDOWN_CHART_ENV_KEY];
  if (current && Array.isArray(current.blocks)) {
    return current;
  }
  const created: MarkdownChartEnvironmentState = { blocks: [] };
  environment[MARKDOWN_CHART_ENV_KEY] = created;
  return created;
}

export function getMarkdownChartBlocks(env: unknown): readonly MarkdownChartBlock[] {
  if (!env || typeof env !== 'object' || Array.isArray(env)) {
    return [];
  }
  const state = (env as MarkdownChartEnvironment)[MARKDOWN_CHART_ENV_KEY];
  return state && Array.isArray(state.blocks) ? state.blocks : [];
}

export function createMarkdownChartEnvironment(
  options: CreateMarkdownChartEnvironmentOptions = {},
): MarkdownChartEnvironment {
  return {
    [MARKDOWN_CHART_ENV_KEY]: {
      blocks: [],
      streaming: options.streaming ?? false,
    },
  };
}

function fenceTokenIsClosed(token: { readonly content: string; readonly map: [number, number] | null }): boolean {
  if (!token.map) {
    return false;
  }
  const contentLines = (token.content.match(/\n/g) ?? []).length
    + (token.content.length > 0 && !token.content.endsWith('\n') ? 1 : 0);
  return token.map[1] - token.map[0] >= contentLines + 2;
}

export function markdownChartPlugin(md: MarkdownIt, options: MarkdownChartPluginOptions = {}): void {
  const idPrefix = options.idPrefix ?? 'markdown-chart';
  const placeholderClass = options.placeholderClass ?? 'markdown-chart-placeholder';
  if (!SAFE_TOKEN.test(idPrefix)) {
    throw new TypeError('idPrefix must contain only letters, numbers, underscores, and hyphens');
  }
  if (!SAFE_TOKEN.test(placeholderClass)) {
    throw new TypeError('placeholderClass must be a single safe CSS class name');
  }

  const fallback = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    if (!token) {
      return '';
    }
    const language = normalizeLanguage(token.info);
    const isChartLanguage = language === MARKDOWN_CHART_LANGUAGE
      || options.registry?.has(language) === true
      || options.isChartLanguage?.(language) === true;
    if (!isChartLanguage) {
      return fallback
        ? fallback(tokens, index, renderOptions, env, self)
        : self.renderToken(tokens, index, renderOptions);
    }

    const state = stateFor(env);
    const id = `${idPrefix}-${state.blocks.length}`;
    const onlyContainerClosuresFollow = tokens
      .slice(index + 1)
      .every((following) => following.nesting === -1);
    const incompleteStreamingTail = state.streaming === true
      && !fenceTokenIsClosed(token)
      && onlyContainerClosuresFollow;
    const complete = !incompleteStreamingTail;
    state.blocks.push({ id, language, source: token.content, complete });
    const streamingClass = complete ? '' : ' markdown-chart-streaming';
    const busy = complete ? '' : ' aria-busy="true"';
    return `<div class="${placeholderClass}${streamingClass}" data-markdown-chart-id="${id}" data-markdown-chart-complete="${complete}" aria-label="Chart"${busy}></div>\n`;
  };
}
