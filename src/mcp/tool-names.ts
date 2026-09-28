// The tools each MCP surface lists, in `tools/list` order. The CLI's llms.txt
// digest needs these names without importing the servers themselves, so they
// live here; a test checks them against LOCAL_TOOLS and HOSTED_TOOLS.

export const LOCAL_MCP_TOOL_NAMES = ['execute', 'describe_sdk', 'render_png', 'describe'] as const

export const HOSTED_MCP_TOOL_NAMES = ['execute', 'describe_sdk', 'render_svg', 'render_ascii', 'render_png', 'verify', 'describe', 'mutate', 'build'] as const

/** `a`, `b`, and `c` — an inline Markdown list of tool names. */
export function inlineToolList(names: readonly string[]): string {
  const ticked = names.map(name => `\`${name}\``)
  return ticked.length < 2 ? ticked.join('') : `${ticked.slice(0, -1).join(', ')}, and ${ticked.at(-1)}`
}
