#!/usr/bin/env bash
# End-to-end probe for the hosted MCP endpoint against a running server:
#
#   cd website && WRANGLER_SEND_METRICS=false npx --yes wrangler@latest dev --port 9095 --ip 127.0.0.1
#   bash website/e2e-mcp.sh http://127.0.0.1:9095/mcp
#
# Exercises the full surface, including Code Mode `execute` through a real
# dynamic-worker isolate. Known local-dev limitation (kept out of this script):
# wrangler dev does not enforce dynamic-worker cpuMs limits, so an unbounded
# sync loop (`for(;;){}`) starves the local workerd event loop and wedges the
# dev server. Production enforces cpuMs at the runtime; the parent also races
# a wall-clock backstop (execute-loader.ts).
set -euo pipefail

MCP="${1:-http://127.0.0.1:9095/mcp}"
pass=0

j() { curl -sS --max-time 30 -X POST "$MCP" -H 'content-type: application/json' -d "$1"; }

check() { # label expected actual
  if [[ "$3" == *"$2"* ]]; then
    echo "ok   $1"
    pass=$((pass + 1))
  else
    echo "FAIL $1"
    echo "  expected substring: $2"
    echo "  got: ${3:0:400}"
    exit 1
  fi
}

check 'initialize negotiates 2025-03-26' '"protocolVersion":"2025-03-26"' \
  "$(j '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}')"

check 'tools/list has the six-tool surface' '"render_svg"' \
  "$(j '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"

check 'render_svg renders' '<svg' \
  "$(j '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_svg","arguments":{"source":"flowchart TD\n  A[Start] --> B{OK?}"}}}')"

check 'render_ascii renders unicode' '─' \
  "$(j '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"render_ascii","arguments":{"source":"flowchart LR\n  A --> B"}}}')"

check 'verify returns a layout summary' '\"nodes\":3' \
  "$(j '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  A --> B\n  B --> C"}}}')"

check 'describe summarizes' 'flowchart' \
  "$(j '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"describe","arguments":{"source":"flowchart TD\n  A --> B"}}}')"

check 'render_png returns base64 PNG (wasm)' '\"png_base64\":\"iVBOR' \
  "$(j '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"render_png","arguments":{"source":"flowchart LR\n  A --> B"}}}')"

check 'execute: statement-form SDK mutate workflow' 'C[New]' \
  "$(j '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"execute","arguments":{"code":"const r = mermaid.parseMermaid(\"flowchart TD\\n  A --> B\"); const m = mermaid.mutate(r.value, { kind: \"add_node\", id: \"C\", label: \"New\" }); return { ok: m.ok, source: mermaid.serializeMermaid(m.value) }"}}}')"

check 'execute: expression form' '\"value\":42' \
  "$(j '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"execute","arguments":{"code":"1 + 41"}}}')"

check 'execute: bare object literal stays an expression' '\"answer\":42' \
  "$(j '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"execute","arguments":{"code":"{ answer: 42 }"}}}')"

check 'execute: user errors surface their message' '\"error\":\"boom\"' \
  "$(j '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"execute","arguments":{"code":"throw new Error(\"boom\")"}}}')"

check 'execute: isolate has no fetch' '\"value\":\"undefined\"' \
  "$(j '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return typeof fetch"}}}')"

check 'execute: double syntax error reports cleanly' 'Unexpected token' \
  "$(j '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return ) === ("}}}')"

check 'async code is screened before any isolate' 'Code Mode is synchronous' \
  "$(j '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"execute","arguments":{"code":"await fetch(\"https://x\")"}}}')"

check 'batch answers per request' '"id":"b"' \
  "$(j '[{"jsonrpc":"2.0","id":"a","method":"ping"},{"jsonrpc":"2.0","id":"b","method":"tools/list"}]')"

check 'GET is 405' '405' \
  "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' "$MCP")"

check 'OPTIONS preflight is 204' '204' \
  "$(curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X OPTIONS "$MCP")"

check 'oversized bodies are 413' '413' \
  "$(python3 -c "import json; print(json.dumps({'jsonrpc':'2.0','id':1,'method':'tools/call','params':{'name':'describe','arguments':{'source':'x'*200000}}}))" | curl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X POST "$MCP" -H 'content-type: application/json' --data @-)"

echo "e2e-mcp: $pass checks passed"
