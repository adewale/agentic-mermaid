#!/usr/bin/env bash

# Shared primitives for production-domain MCP deployment probes. Every
# deployment phase sources this file so request cadence and response decoding
# cannot diverge between candidate smoke tests and production verification.
mcp_curl() {
  if [[ -n "${MCP_REQUEST_INTERVAL_SECONDS:-}" ]]; then
    sleep "$MCP_REQUEST_INTERVAL_SECONDS"
  fi
  curl "$@"
}

mcp_result_json() {
  local response="$1"
  jq -e -c '
    [
      (if type == "array" then .[] else . end)
      | .result.content[]?
      | select(.type == "text")
      | .text
      | fromjson
    ] as $results
    | if ($results | length) == 1
      then $results[0]
      else error("expected exactly one JSON text result")
      end
  ' <<<"$response"
}
