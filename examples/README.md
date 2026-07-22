# Examples

Each example is an independent Vite workspace with its own dependency manifest:

| Framework | Simple | Advanced |
| --- | --- | --- |
| React | [`react/simple/`](./react/simple/) | [`react/advanced/`](./react/advanced/) |
| Vue | [`vue/simple/`](./vue/simple/) | [`vue/advanced/`](./vue/advanced/) |

Simple examples use the all-in-one framework component. Advanced examples show
host-owned Markdown parsing and renderer registration. Canonical examples use
inline data, so both modes also demonstrate the built-in Chart/Data switch.

The [`react/chatbi-openapi/`](./react/chatbi-openapi/) and
[`vue/chatbi-openapi/`](./vue/chatbi-openapi/) integrations show a third-party
frontend adapting two same-origin DataWorks OpenAPI routes into a
`LegacySandboxTransport`. The shared client owns file matching, retries,
request-to-session fallback, caching, and live waiting. Each host keeps one
`createLegacySandboxHostAdapter` per component lifecycle and uses its
`identity`/`bind` pair with session/request/phase context and an explicit
non-secret `cacheScopeKey`.
