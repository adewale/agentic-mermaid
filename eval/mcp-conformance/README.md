# MCP conformance gate

This gate runs the official `@modelcontextprotocol/conformance` package at the
exact version declared in `scripts/ci/mcp-conformance.ts`. It exercises the
hosted handler on loopback, not the public deployment, so rate limiting or a CDN
cannot hide a protocol regression.

The selected scenarios cover the two real eras and the advertised product
surface:

- `server-initialize` at `2025-11-25` for the stable handshake path;
- `tools-list` for the tools-only surface;
- `http-header-validation`, `caching`, and `server-stateless` at `2026-07-28`.

`expected-failures.yml` contains only checks the upstream harness cannot apply
to this server. Three caching checks probe optional methods even when discovery
does not advertise them. Four stateless checks require specially named
diagnostic tools that are not product capabilities. Adding fake prompt,
resource, streaming, logging, or capability tools merely to satisfy those
fixtures would make discovery less honest.

The baseline is strict: an unlisted failure fails CI, and an expected failure
that unexpectedly passes is treated as stale baseline drift. Re-run with:

```sh
bun run eval:mcp-conformance
```

The production endpoint should remain a separate, paced smoke test. It is not a
replacement for this deterministic protocol gate.
