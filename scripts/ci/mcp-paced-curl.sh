#!/usr/bin/env bash

# Shared request primitive for production-domain MCP deployment probes. Every
# deployment phase sources this file so rolling WAF headroom survives phase
# boundaries; sleeping before the first request prevents a new phase from
# bursting immediately after the previous one.
mcp_curl() {
  if [[ -n "${MCP_REQUEST_INTERVAL_SECONDS:-}" ]]; then
    sleep "$MCP_REQUEST_INTERVAL_SECONDS"
  fi
  curl "$@"
}
