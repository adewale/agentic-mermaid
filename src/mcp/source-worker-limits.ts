export const SOURCE_TOOL_TIMEOUT_MS = 15_000
export const SOURCE_TOOL_HEAP_MB = 512
// V8 reserves three semi-spaces. 480 + 3 * 8 = 504 MiB; the renderer also
// verifies the actual heap limit before accepting work. This is a V8 heap cap,
// not a cap on native allocations or the process's total resident memory.
export const SOURCE_TOOL_NODE_FLAGS = Object.freeze(['--max-old-space-size=480', '--max-semi-space-size=8'])
export const SOURCE_TOOL_QUEUE_LIMIT = 32
