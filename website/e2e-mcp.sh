#!/usr/bin/env bash
# End-to-end probe for the hosted MCP endpoint against a running server:
#
#   bun run website:dev
#   bash website/e2e-mcp.sh http://127.0.0.1:9095/mcp
#
# Also run against the live endpoint by deploy-cloudflare.yml, ordered after the
# retrying smoke test so deploy propagation has settled — this script asserts
# exact error shapes and deliberately does not retry.
#
# Exercises the full surface, including Code Mode `execute` through a real
# dynamic-worker isolate. Known local-dev limitation (kept out of this script):
# wrangler dev does not enforce dynamic-worker cpuMs limits, so an unbounded
# sync loop (`for(;;){}`) starves the local workerd event loop and wedges the
# dev server. Production enforces cpuMs at the runtime; the parent also races
# a wall-clock backstop (execute-loader.ts).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$REPO_ROOT/scripts/ci/mcp-probe.sh"

MCP="${1:-http://127.0.0.1:9095/mcp}"
pass=0

# Read the hosted transport's accepted revisions from the same TypeScript
# authority that builds the Worker and its server card. Keeping this out of the
# shell probe prevents a release from being blocked by a stale copied list.
HOSTED_PROTOCOL_VERSIONS_JSON="$(
  cd "$REPO_ROOT"
  bun -e 'import { SUPPORTED_PROTOCOL_VERSIONS } from "./src/mcp/hosted-server.ts"; process.stdout.write(JSON.stringify(SUPPORTED_PROTOCOL_VERSIONS))'
)"

mcurl() {
  if [[ -n "${MCP_WORKER_VERSION_ID:-}" ]]; then
    local worker_name="${MCP_WORKER_NAME:-agentic-mermaid-website}"
    mcp_curl -H "Cloudflare-Workers-Version-Overrides: ${worker_name}=\"${MCP_WORKER_VERSION_ID}\"" "$@"
  else
    mcp_curl "$@"
  fi
}
j() { mcurl -sS --max-time 30 -X POST "$MCP" -H 'content-type: application/json' -d "$1"; }

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

check_http_exact() { # label expected-status expected-body curl-args...
  local label="$1" expected_status="$2" expected_body="$3"
  shift 3
  local response_file status body
  response_file="$(mktemp)"
  status="$(mcurl -sS --max-time 30 -o "$response_file" -w '%{http_code}' "$@")"
  body="$(<"$response_file")"
  rm -f "$response_file"
  if [[ "$status" == "$expected_status" && "$body" == "$expected_body" ]]; then
    echo "ok   $label"
    pass=$((pass + 1))
  else
    echo "FAIL $label"
    echo "  expected status/body: $expected_status $expected_body"
    echo "  got status/body: $status ${body:0:400}"
    exit 1
  fi
}

check_http_jq() { # label expected-status jq-expression curl-args...
  local label="$1" expected_status="$2" expression="$3"
  shift 3
  local response_file status body
  response_file="$(mktemp)"
  status="$(mcurl -sS --max-time 30 -o "$response_file" -w '%{http_code}' "$@")"
  body="$(<"$response_file")"
  rm -f "$response_file"
  if [[ "$status" == "$expected_status" ]] && jq -e --argjson supported "$HOSTED_PROTOCOL_VERSIONS_JSON" "$expression" <<<"$body" >/dev/null; then
    echo "ok   $label"
    pass=$((pass + 1))
  else
    echo "FAIL $label"
    echo "  expected status/jq: $expected_status $expression"
    echo "  got status/body: $status ${body:0:400}"
    exit 1
  fi
}

check 'initialize negotiates 2025-03-26' '"protocolVersion":"2025-03-26"' \
  "$(j '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"e2e","version":"0"}}}')"

check 'tools/list has the hosted tool surface' '"render_svg"' \
  "$(j '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"

check 'render_svg renders' '<svg' \
  "$(j '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"render_svg","arguments":{"source":"flowchart TD\n  A[Start] --> B{OK?}"}}}')"

check 'render_ascii renders unicode' '─' \
  "$(j '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"render_ascii","arguments":{"source":"flowchart LR\n  A --> B"}}}')"

check 'verify returns a layout summary' '\"nodes\":3' \
  "$(j '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"verify","arguments":{"source":"flowchart TD\n  A --> B\n  B --> C"}}}')"

check 'describe summarizes' 'flowchart' \
  "$(j '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"describe","arguments":{"source":"flowchart TD\n  A --> B"}}}')"

check 'build authors with structured ops' 'class Duck' \
  "$(j '{"jsonrpc":"2.0","id":"build","method":"tools/call","params":{"name":"build","arguments":{"family":"class","ops":[{"kind":"add_class","id":"Duck"},{"kind":"add_member","class":"Duck","text":"+quack()"}]}}}')"

check 'mutate edits with structured ops' 'class Dog' \
  "$(j '{"jsonrpc":"2.0","id":"mutate","method":"tools/call","params":{"name":"mutate","arguments":{"source":"classDiagram\n  class Animal","ops":[{"kind":"add_class","id":"Dog"}]}}}')"

png_response="$(j '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"render_png","arguments":{"source":"flowchart LR\n  A[Start 漢] --> B[Finish]","scale":0.75,"background":"#123456","fitTo":{"width":96},"options":{"padding":19,"security":"strict","style":["watercolor","paper"],"seed":13}}}}')"
check 'render_png returns base64 PNG (wasm)' '\"png_base64\":\"iVBOR' "$png_response"
printf '%s' "$png_response" | bun run scripts/verify-hosted-png-e2e.ts
pass=$((pass + 1))

check 'execute: statement-form SDK mutate workflow' 'C[New]' \
  "$(j '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"execute","arguments":{"code":"const r = mermaid.parseRegisteredMermaid(\"flowchart TD\\n  A --> B\"); const m = mermaid.mutate(r.value, { kind: \"add_node\", id: \"C\", label: \"New\" }); return { ok: m.ok, source: mermaid.serializeMermaid(m.value) }"}}}')"

check 'execute: expression form' '\"value\":42' \
  "$(j '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"execute","arguments":{"code":"1 + 41"}}}')"

check 'execute: bare object literal stays an expression' '\"answer\":42' \
  "$(j '{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"execute","arguments":{"code":"{ answer: 42 }"}}}')"

check 'execute: user errors use the structured envelope' '\"error\":{\"code\":\"EXECUTE_FAILED\",\"message\":\"boom\"}' \
  "$(j '{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"execute","arguments":{"code":"throw new Error(\"boom\")"}}}')"

check 'execute: isolate has no fetch' '\"value\":\"undefined\"' \
  "$(j '{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return typeof fetch"}}}')"

check 'execute: double syntax error reports cleanly' 'Unexpected token' \
  "$(j '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return ) === ("}}}')"

check 'async code is screened before any isolate' 'Code Mode is synchronous' \
  "$(j '{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"execute","arguments":{"code":"await fetch(\"https://x\")"}}}')"

check 'batch answers per request' '"id":"b"' \
  "$(j '[{"jsonrpc":"2.0","id":"a","method":"ping"},{"jsonrpc":"2.0","id":"b","method":"tools/list"}]')"

check_http_exact 'GET is a raw 405 transport refusal' '405' \
  '{"error":"use POST with a JSON-RPC body; this MCP endpoint is stateless and offers no server-initiated stream"}' \
  "$MCP"

check 'OPTIONS preflight is 204' '204' \
  "$(mcurl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X OPTIONS "$MCP")"

check 'eval is unavailable in the isolate' '\"ok\":false' \
  "$(j '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return eval(\"1 + 1\")"}}}')"

check 'Function-constructor codegen is unavailable in the isolate' '\"ok\":false' \
  "$(j '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return ({}).constructor.constructor(\"return 1\")()"}}}')"

check 'log spam is truncated at the cap' 'logs truncated' \
  "$(j '{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"execute","arguments":{"code":"for (let i = 0; i < 2000; i++) console.log(\"x\", i); return 1"}}}')"

# Security: a wrapper-breakout that injects a top-level `import` of a workerd
# built-in must NOT run — the parenthesized wrap makes it a SyntaxError, so the
# isolate fails to start and execute returns an error, not a success.
check 'import-injection breakout is rejected (not executed)' '\"ok\":false' \
  "$(j '{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"execute","arguments":{"code":"return 1 } ; import { connect } from \"cloudflare:sockets\" ; function _p(){ "}}}')"

# The SDK still renders after hardenIsolateGlobals() stripped fetch/crypto/etc.
# from the live isolate — proves the neutralization did not break rendering.
check 'execute renders through the SDK after global hardening' 'C[New]' \
  "$(j '{"jsonrpc":"2.0","id":19,"method":"tools/call","params":{"name":"execute","arguments":{"code":"const r = mermaid.parseRegisteredMermaid(\"flowchart TD\\n  A --> B\"); const m = mermaid.mutate(r.value, { kind: \"add_node\", id: \"C\", label: \"New\" }); return mermaid.serializeMermaid(m.value)"}}}')"

oversized_body="$(mktemp)"
python3 -c 'import json; print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"describe","arguments":{"source":"x"*200000}}}))' >"$oversized_body"
oversized_error='{"error":"request body exceeds 131072 bytes; run the local agentic-mermaid CLI or stdio MCP server instead (see https://agentic-mermaid.dev/docs/mcp/)"}'
check_http_exact 'a declared oversized body is a raw 413 transport refusal' '413' "$oversized_error" \
  -X POST "$MCP" -H 'content-type: application/json' --data-binary "@$oversized_body"
rm -f "$oversized_body"

# A disallowed cross-origin browser Origin is refused (MCP Origin validation).
# A no-Origin client (every default curl above) is unaffected.
check_http_exact 'a disallowed browser Origin is a raw 403 transport refusal' '403' \
  '{"error":"origin not allowed"}' \
  -X POST "$MCP" -H 'content-type: application/json' -H 'origin: https://evil.example' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'

check_http_exact 'a non-JSON body is a raw 415 transport refusal' '415' \
  '{"error":"content-type must be application/json"}' \
  -X POST "$MCP" -H 'content-type: text/plain' -d 'not-json'

# An explicit unsupported protocol version keeps its protocol-defined JSON-RPC
# error: exact code, authority-derived supported list, and original request id.
check_http_jq 'an unsupported MCP-Protocol-Version is exact -32022' '400' \
  '.jsonrpc == "2.0" and .id == 1 and .error.code == -32022 and .error.data.requested == "1999-01-01" and .error.data.supported == $supported' \
  -X POST "$MCP" -H 'content-type: application/json' -H 'mcp-protocol-version: 1999-01-01' -d '{"jsonrpc":"2.0","id":1,"method":"ping"}'

# Body-only claims exercise the admission route that no transport header can
# cover. This is the path that used to fall through to legacy semantics.
check_http_jq 'an unsupported body-only protocol version is exact -32022' '400' \
  '.jsonrpc == "2.0" and .id == "body-version" and .error.code == -32022 and .error.data.requested == "2099-01-01" and .error.data.supported == $supported and (keys | sort == ["error","id","jsonrpc"]) and (.error.data | keys | sort == ["requested","supported"])' \
  -X POST "$MCP" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":"body-version","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}}'

check_http_exact 'an unsupported body-only notification is an empty 400' '400' '' \
  -X POST "$MCP" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2099-01-01","io.modelcontextprotocol/clientCapabilities":{}}}}'

# ---- Dual-era: the 2026-07-28 stateless revision ---------------------------
# Every probe below pins the version EXPLICITLY. An unpinned client negotiates a
# legacy revision and would exercise none of this.

MODERN_META='"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"e2e","version":"0"},"io.modelcontextprotocol/clientCapabilities":{}}'
modern_discover="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"server/discover\",\"params\":{$MODERN_META}}"
modern_tools_list="{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\",\"params\":{$MODERN_META}}"
modern_verify="{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"verify\",\"arguments\":{\"source\":\"flowchart TD\\n  A --> B\"},$MODERN_META}}"
modern_version_mismatch='{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2025-11-25","io.modelcontextprotocol/clientInfo":{"name":"e2e","version":"0"},"io.modelcontextprotocol/clientCapabilities":{}}}}'
modern_missing_method="{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\",\"params\":{$MODERN_META}}"
modern_name_mismatch="{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"verify\",\"arguments\":{\"source\":\"flowchart TD\\n  A --> B\"},$MODERN_META}}"
modern_unknown="{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"no/such/method\",\"params\":{$MODERN_META}}"
modern_initialize="{\"jsonrpc\":\"2.0\",\"id\":8,\"method\":\"initialize\",\"params\":{$MODERN_META}}"
modern_batch="[{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\",\"params\":{$MODERN_META}}]"
jm() { # modern POST: $1 body, $2.. extra headers
  local body="$1"; shift
  mcurl -sS --max-time 30 -X POST "$MCP" -H 'content-type: application/json' \
    -H 'mcp-protocol-version: 2026-07-28' "$@" -d "$body"
}

check 'the current revision 2025-11-25 is accepted' '"tools"' \
  "$(mcurl -sS --max-time 30 -X POST "$MCP" -H 'content-type: application/json' -H 'mcp-protocol-version: 2025-11-25' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"

check 'server/discover advertises the supported versions' '"2026-07-28"' \
  "$(jm "$modern_discover" -H 'mcp-method: server/discover')"

check 'a modern tools/list works with no prior initialize' '"render_svg"' \
  "$(jm "$modern_tools_list" -H 'mcp-method: tools/list')"

check 'a modern tools/call works with no prior initialize' '\"ok\":true' \
  "$(jm "$modern_verify" -H 'mcp-method: tools/call' -H 'mcp-name: verify')"

check_http_jq 'a header/body version mismatch is exact -32020' '400' \
  '.jsonrpc == "2.0" and .id == 4 and .error.code == -32020 and (.error.message | startswith("Header mismatch:")) and (keys | sort == ["error","id","jsonrpc"]) and (.error | keys | sort == ["code","message"])' \
  -X POST "$MCP" -H 'content-type: application/json' -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/list' -d "$modern_version_mismatch"

check_http_jq 'a missing Mcp-Method header is exact -32020' '400' \
  '.jsonrpc == "2.0" and .id == 5 and .error.code == -32020 and .error.message == "Header mismatch: Mcp-Method header is required" and (keys | sort == ["error","id","jsonrpc"]) and (.error | keys | sort == ["code","message"])' \
  -X POST "$MCP" -H 'content-type: application/json' -H 'mcp-protocol-version: 2026-07-28' -d "$modern_missing_method"

check_http_jq 'an Mcp-Name mismatch is exact -32020' '400' \
  '.jsonrpc == "2.0" and .id == 6 and .error.code == -32020 and (.error.message | startswith("Header mismatch: Mcp-Name header value")) and (keys | sort == ["error","id","jsonrpc"]) and (.error | keys | sort == ["code","message"])' \
  -X POST "$MCP" -H 'content-type: application/json' -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/call' -H 'mcp-name: describe' -d "$modern_name_mismatch"

check 'an unknown method is 404 for a modern request' '404' \
  "$(jm "$modern_unknown" -H 'mcp-method: no/such/method' -o /dev/null -w '%{http_code}')"

check 'initialize is 404 under a modern pin' '404' \
  "$(jm "$modern_initialize" -H 'mcp-method: initialize' -o /dev/null -w '%{http_code}')"

check 'a modern batch is refused' '400' \
  "$(jm "$modern_batch" -H 'mcp-method: tools/list' -o /dev/null -w '%{http_code}')"

check 'preflight admits the modern routing headers' 'mcp-method' \
  "$(mcurl -sS --max-time 10 -D - -o /dev/null -X OPTIONS "$MCP" -H 'origin: https://agentic-mermaid.dev' -H 'access-control-request-method: POST')"

# A batch beyond the fan-out cap is refused before any tool runs.
check 'an over-cap batch is 400' '400' \
  "$(python3 -c 'import json; print(json.dumps([{"jsonrpc":"2.0","id":i,"method":"ping"} for i in range(25)]))' | mcurl -sS --max-time 10 -o /dev/null -w '%{http_code}' -X POST "$MCP" -H 'content-type: application/json' --data @-)"

# Keep the chunked over-size probe last. Current local workerd exits after it
# has returned the correct 413, while production isolates remain replaceable;
# ordering it last preserves the exact assertion without masking later checks.
oversized_body="$(mktemp)"
python3 -c 'import json; print(json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"describe","arguments":{"source":"x"*200000}}}))' >"$oversized_body"
check_http_exact 'a streamed oversized body is a raw 413 transport refusal' '413' "$oversized_error" \
  -X POST "$MCP" -H 'content-type: application/json' -H 'content-length:' -H 'transfer-encoding: chunked' --data-binary "@$oversized_body"
rm -f "$oversized_body"

echo "e2e-mcp: $pass checks passed"
