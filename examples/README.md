# Examples

Each example is an independent Vite workspace with its own dependency manifest:

| Framework | Simple | Advanced |
| --- | --- | --- |
| React | [`react/simple/`](./react/simple/) | [`react/advanced/`](./react/advanced/) |
| Vue | [`vue/simple/`](./vue/simple/) | [`vue/advanced/`](./vue/advanced/) |

Simple examples use the all-in-one framework component. Advanced examples show
host-owned Markdown parsing and renderer registration. Canonical examples use
inline data, so both modes also demonstrate the built-in Chart/Data switch.

The [`react/chatbi-openapi/`](./react/chatbi-openapi/) integration example
shows a third-party frontend resolving ChatBI artifact CSV data through its own
same-origin DataWorks OpenAPI proxy while the component handles CSV parsing and
temporary chart conversion. The [`vue/chatbi-openapi/`](./vue/chatbi-openapi/)
example demonstrates the same data contract with a host-created markdown-it
instance, plugin, and renderer registry.
