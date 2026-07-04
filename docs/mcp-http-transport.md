# MCP HTTP/SSE transport quickstart

`agentic-mermaid-mcp` defaults to stdio for local MCP clients. Use HTTP/SSE only when a client needs a reachable endpoint or when PNG artifacts should be fetched by file/URL instead of returned as large base64 strings.

> Looking for a zero-setup endpoint? A **hosted** MCP already runs at `https://agentic-mermaid.dev/mcp` (`claude mcp add --transport http agentic-mermaid https://agentic-mermaid.dev/mcp`). It is a different implementation — stateless Streamable HTTP, Cloudflare-backed, inputs capped at 64KB, and no file/URL PNG artifacts (base64 only). See [`docs/project/hosted-mcp-cloudflare-plan.md`](./project/hosted-mcp-cloudflare-plan.md). Run the local server below when you need file/URL artifacts, larger inputs, offline use, or your own auth.
>
> **Privacy:** every hosted call (`execute`, `render_*`, `verify`, `describe`) sends your diagram source or code to the agentic-mermaid.dev server, and successful responses are edge-cached for up to a day. For diagrams that must not leave your machine, use the library, the CLI, or the local stdio/HTTP server on this page — the pipeline is fully local and needs no network.

## Which endpoint returns plain JSON?

Two transports, two framings — pick by what your client expects:

| You are… | Use | Response framing |
|---|---|---|
| An MCP client (Claude Code, MCP SDKs) | hosted `/mcp`, or local `/sse` + `/message` | Handled by the client. |
| A script POSTing JSON-RPC yourself | hosted `POST /mcp`, or local `POST /rpc` | Plain `application/json` — `json.loads` the body directly. |

The local `/sse` + `/message` pair is the MCP SSE session transport: `POST /message` returns only `202 {"ok":true}`, and the actual JSON-RPC response arrives on the open `/sse` stream framed as SSE events (`event: message` / `data: {...}` lines). If you find yourself stripping `data:` prefixes before parsing, switch to `POST /rpc` (local) or `POST /mcp` (hosted) — both reply with an unframed JSON body.

## Start the server

Loopback/local development:

```sh
npx -y agentic-mermaid-mcp --transport http --host 127.0.0.1 --port 3000 \
  --artifact-dir .agentic-mermaid-artifacts
```

Remote binding requires a bearer token:

```sh
npx -y agentic-mermaid-mcp --transport http --host 0.0.0.0 --port 3000 \
  --artifact-dir .agentic-mermaid-artifacts \
  --auth-token "$AGENTIC_MERMAID_MCP_TOKEN"
```

HTTP endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Readiness probe, returns `{ "ok": true }`. |
| `GET /sse` | MCP SSE session endpoint. First event contains the `/message?sessionId=...` URL. |
| `POST /message?sessionId=...` | JSON-RPC requests for an SSE session. The HTTP response is just `202 {"ok":true}`; the JSON-RPC response is emitted on the SSE stream as `event: message` / `data:` frames. |
| `POST /rpc` | Direct JSON-RPC endpoint for tests/scripts/simple integrations. Replies with plain `application/json` (no SSE framing). |
| `GET /artifacts/<name>` | Fetch managed artifacts returned by `render_png` `output: "url"`. |

`/rpc` and `/message` require `content-type: application/json`; browser-simple `text/plain` form posts are rejected. Non-loopback hosts require `Authorization: Bearer <token>`.

## Direct JSON-RPC examples: `render_png`

### Base64 output (default)

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "render_png",
    "arguments": {
      "source": "flowchart TD\n  A --> B"
    }
  }
}
```

`curl`:

```sh
curl -sS http://127.0.0.1:3000/rpc \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"render_png","arguments":{"source":"flowchart TD\n  A --> B"}}}'
```

Response shape:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"ok\":true,\"png_base64\":\"iVBORw0KGgo...\"}"
      }
    ],
    "isError": false
  }
}
```

### File output

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "render_png",
    "arguments": {
      "source": "flowchart TD\n  A --> B",
      "output": "file"
    }
  }
}
```

Response shape (`content[0].text` is JSON):

```json
{
  "ok": true,
  "artifact": {
    "path": "/absolute/path/.agentic-mermaid-artifacts/<name>.png",
    "mimeType": "image/png",
    "bytes": 12345,
    "sha256": "64 lowercase hex characters"
  }
}
```

Use `output: "file"` when the MCP host and consumer share a filesystem or when a local orchestrator will move the artifact elsewhere.

### URL output

Request:

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "render_png",
    "arguments": {
      "source": "flowchart TD\n  A --> B",
      "output": "url"
    }
  }
}
```

Response shape (`content[0].text` is JSON):

```json
{
  "ok": true,
  "artifact": {
    "url": "http://127.0.0.1:3000/artifacts/<name>.png",
    "mimeType": "image/png",
    "bytes": 12345,
    "sha256": "64 lowercase hex characters"
  }
}
```

Fetch the artifact:

```sh
curl -L -o diagram.png 'http://127.0.0.1:3000/artifacts/<name>.png'
```

If the server is behind a reverse proxy, set `--public-url https://example.com/artifacts` so returned URLs are externally reachable.

## Sample SSE flow

Open the SSE stream and capture the first event:

```sh
curl -N http://127.0.0.1:3000/sse
```

The server immediately sends an endpoint event:

```text
event: endpoint
data: http://127.0.0.1:3000/message?sessionId=<session-id>
```

Post JSON-RPC to that message URL:

```sh
curl -sS 'http://127.0.0.1:3000/message?sessionId=<session-id>' \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"ping"}'
```

The response is delivered on the open SSE stream:

```text
event: message
data: {"jsonrpc":"2.0","id":4,"result":{}}
```

## Options

| Option | Default | Purpose |
|---|---:|---|
| `--transport stdio\|http` | `stdio` | Select stdio or HTTP/SSE transport. `--http` is an alias for `--transport http`. |
| `--host <host>` | `127.0.0.1` | HTTP bind host. Non-loopback hosts require `--auth-token`. |
| `--port <port>` | `3000` | HTTP bind port. Use `0` for an ephemeral test port. |
| `--artifact-dir <dir>` | OS temp dir | Directory for managed file/URL artifacts. Files use generated safe names. |
| `--public-url <url>` | `http://<host>:<port>/artifacts` | URL prefix returned by `output: "url"`; useful behind reverse proxies. |
| `--auth-token <token>` | unset | Bearer token required for `/rpc` and `/message` when binding non-loopback. Optional on loopback. |
| `--max-artifact-bytes <n>` | `20971520` | Maximum bytes for a single managed artifact. |
| `--artifact-ttl-ms <n>` | `3600000` | How long managed artifacts remain fetchable by this server process. |
| `--max-rpc-body-bytes <n>` | `1048576` | Maximum HTTP JSON-RPC request body size. |
| `--max-sandbox-timeout-ms <n>` | `30000` | Maximum `execute` timeout accepted over any transport. |

## Security defaults

- HTTP binds to loopback by default.
- Non-loopback binding requires `--auth-token`.
- `/rpc` and `/message` reject non-JSON content types and cross-origin browser posts.
- Request bodies and artifact sizes are bounded.
- URL/file artifacts are generated under a managed store, served only if the current process created and still tracks them, and checked against TTL on read.
- `execute(code)` still runs in local `node:vm`, not an OS/container security boundary. Do not expose HTTP/SSE to hostile users without an outer isolation layer.
