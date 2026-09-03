# Security

Markdown Chart is designed for chart JSON that may have been produced by an
untrusted model.

## Guarantees

- Canonical and documented renderer bodies are parsed with `JSON.parse`.
  The canonical path never evaluates JavaScript.
- Canonical `data` is validated independently from renderer-owned `spec`;
  inline rows may contain only JSON scalar arrays or scalar-valued objects.
- The ECharts renderer uses a strict top-level option allowlist plus a recursive
  denylist. It rejects functions, non-JSON values, prototype-related keys,
  non-string or unsafe `formatter` values, `tooltip.extraCssText`,
  `toolbox`/`dataView`, custom series,
  `renderItem`, `graphic`, image options, URL-like strings, CSS `url(...)`, and
  HTML-like markup/entities. Safe string formatter templates such as
  `{@conversionRate}%` are allowed; formatter code is not.
- URL-bearing option keys such as `link`, `sublink`, `href`, `src`, and `url`
  are rejected even when their values are relative or obfuscated. Unsafe ASCII
  C0 controls are rejected; permitted line/tab whitespace is removed for the
  protocol check, preventing split-protocol forms such as `java\nscript:` and
  `java\tscript:`. Legacy `vbscript:` is rejected too.
- ECharts dataset transforms are disabled. In particular, untrusted
  `dataset.transform.config.reg` values never reach the ECharts transform
  engine, avoiding attacker-controlled regular-expression execution.
- The ECharts renderer itself performs no `fetch`, XHR, or dynamic URL loading.
- The KPI renderer strictly bounds aggregate selected dataset rows/cells,
  trend points, items,
  strings, status, and reference counts. It permits only field/constant
  bindings, `lastNonNull`, and a structured `Intl.NumberFormat` subset; it
  rejects functions, arbitrary expressions, invalid units/currencies, and
  nonnumeric trend values. It inserts all display content with DOM text APIs
  and performs no fetch or navigation. Data refs and KPI references remain
  opaque to the package.
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
- Treat `ChartReferenceActions` as a privileged UI boundary. `canOpen` and
  `open` must validate the reference scheme and current principal authorization
  before opening host content. Do not place secrets in `ref` or `label`.
- Treat renderer icon factories as trusted host code. Return newly created,
  decorative DOM only; do not attach navigation, authorization, or data access
  to the icon. Reference activation remains owned by `ChartReferenceActions`.
- Prefer the shared `createLegacySandboxClient` for new legacy integrations.
  Its host-owned `LegacySandboxTransport` is a privileged authenticated data
  boundary: preserve `AbortSignal`, authorize every list/read operation, bound
  responses, and classify HTTP/network/envelope failures without exposing
  credentials. Matching, retry, request-to-session fallback, and caching stay
  in the shared client rather than being reimplemented in the transport.
- Supply a stable non-secret `cacheScopeKey` for the current principal (for
  example, `tenantId:userId`) and create a new client when authentication
  identity changes. Never use bearer tokens, cookies, session secrets, or
  hashes of those values as cache identity, and never fall back to sessionId.
- Apply a Content Security Policy suitable for the surrounding application.
- Use a trusted ECharts runtime and keep it patched.
- Do not add an "unsafe" option that evaluates formatters or `renderItem` code.

The strict profile intentionally supports a conservative subset of top-level
ECharts options. Additions to that allowlist require a security review of every
nested string and callback-like surface reachable from the option.

## Temporary legacy isolation

The deprecated ChatBI migration adapter is deliberately separate from the
canonical parser. It parses CSV with UTF-8 byte, row, column, and cell limits,
then creates a hidden outer iframe with only `sandbox="allow-scripts"`.
Omitting `allow-same-origin` gives that iframe a unique origin. The iframe runs
only a trusted bootstrap: legacy source and CSV rows are sent to a Blob-backed
dedicated Worker and are never embedded in `srcdoc` or evaluated in the iframe
Window. Its inline CSP starts with `default-src 'none'`, permits only the inline
bootstrap and `worker-src blob:`, and sets `connect-src 'none'` while also
disabling images, objects, media, forms, and child frames.

The Worker has no DOM or iframe navigation surface. Before evaluating source it
shadows known network and worker-expansion APIs, including `fetch`, XHR,
WebSocket, EventSource, `importScripts`, `Worker`, and `SharedWorker`. This is a
defense-in-depth restriction in addition to the iframe CSP, not a source-regex
security boundary. The compatibility sanitizer is not treated as isolation.

The host transfers a fresh `MessagePort` to the created iframe for each
execution. Before iframe navigation, the host pre-binds its unpredictable
per-execution request id into the trusted bootstrap (but never embeds source or
input data). The bootstrap accepts only one request carrying that exact id, the
dedicated port, the expected channel, and string source. A mismatched request
closes its transferred port without consuming the legitimate request. Results
and fixed errors return only through the dedicated port. This avoids depending
on the iframe's DOM `parent` being the same Window that runs the host JavaScript,
while keeping responses off the global Window message channel. The host also
checks the request id on every response.
Abort, result, error, load failure, and timeout paths close ports, remove
listeners and timers, and remove the iframe; the bootstrap also terminates the
Worker on result or error. Removing the iframe terminates a still-running
dedicated Worker, so the timeout can stop a synchronous loop without blocking
the host Window. Worker and iframe errors cross the boundary only as fixed
categories without exception messages or stacks. The Worker serializes only
the generated `option` through JSON; the host then applies the normal JSON and
ECharts safety validation.

This is defense in depth for a temporary browser compatibility path, not a
proof that arbitrary JavaScript is safe. Termination does not prevent transient
CPU or memory pressure before the timeout, and large allocations can still
exhaust browser resources. Hosts should enable this deprecated path only for
trusted ChatBI streams and remove it when that format is retired. Canonical
`markdown-chart` remains JSON-only and does not depend on the legacy directory.

## Reporting

Please report vulnerabilities privately to the DataFE maintainers. Include a
minimal reproduction, affected package versions, and impact. Do not include
production credentials or private datasets.
