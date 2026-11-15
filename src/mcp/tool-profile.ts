// The MCP tool profiles a server can advertise. Dependency-free, so the CLI
// can validate `--tool-profile` before (and without) loading the tool surface,
// which keeps `--help` working in a checkout without installed dependencies.

export const MCP_TOOL_PROFILES = Object.freeze(['full', 'slim'] as const)
export type McpToolProfile = typeof MCP_TOOL_PROFILES[number]

export function isMcpToolProfile(value: unknown): value is McpToolProfile {
  return typeof value === 'string' && (MCP_TOOL_PROFILES as readonly string[]).includes(value)
}
