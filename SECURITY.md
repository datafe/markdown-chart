# Security

Markdown Chart is designed for chart JSON that may have been produced by an
untrusted model.

## Guarantees

- Fence bodies are parsed with `JSON.parse`; JavaScript is never evaluated.
- Canonical `data` is validated independently from renderer-owned `spec`;
  inline rows may contain only JSON scalar arrays or scalar-valued objects.
- The ECharts renderer uses a strict top-level option allowlist plus a recursive
  denylist. It rejects functions, non-JSON values, prototype-related keys,
  `formatter`, `tooltip.extraCssText`, `toolbox`/`dataView`, custom series,
  `renderItem`, `graphic`, image options, URL-like strings, CSS `url(...)`, and
  HTML-like markup.
- URL-bearing option keys such as `link`, `sublink`, `href`, `src`, and `url`
  are rejected even when their values are relative or obfuscated. All ASCII C0
  controls are rejected in option strings, preventing split-protocol forms such
  as `java\nscript:` and `java\tscript:`; legacy `vbscript:` is rejected too.
- ECharts dataset transforms are disabled. In particular, untrusted
  `dataset.transform.config.reg` values never reach the ECharts transform
  engine, avoiding attacker-controlled regular-expression execution.
- The ECharts renderer itself performs no `fetch`, XHR, or dynamic URL loading.
- Referenced datasets require an explicit host resolver and an optional host
  reference validator.
- Markdown-it placeholders contain only generated identifiers. Raw chart JSON
  is kept in an environment side channel and is not embedded in HTML.
- Parse depth, JSON size, node count, dataset size, and series count are
  bounded.

## Host responsibilities

- Keep Markdown HTML disabled, or sanitize the complete rendered Markdown when
  enabling raw HTML. This is separate from chart placeholder safety.
- Treat `resolveDataRef` as a privileged boundary. Validate schemes and
  authorization, honor its `AbortSignal`, and avoid returning secrets in errors.
- Apply a Content Security Policy suitable for the surrounding application.
- Use a trusted ECharts runtime and keep it patched.
- Do not add an "unsafe" option that evaluates formatters or `renderItem` code.

The strict profile intentionally supports a conservative subset of top-level
ECharts options. Additions to that allowlist require a security review of every
nested string and callback-like surface reachable from the option.

## Reporting

Please report vulnerabilities privately to the DataFE maintainers. Include a
minimal reproduction, affected package versions, and impact. Do not include
production credentials or private datasets.
