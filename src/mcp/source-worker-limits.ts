export const SOURCE_TOOL_TIMEOUT_MS = 15_000
export const SOURCE_TOOL_HEAP_MB = 512
export const SOURCE_TOOL_MEMORY_BYTES = 512 * 1024 * 1024
export const SOURCE_TOOL_MEMORY_POLL_MS = 10
export const SOURCE_TOOL_QUEUE_LIMIT = 32
export const SOURCE_TOOL_REQUEST_BYTES = 4 * 1024 * 1024
export const SOURCE_TOOL_RESULT_BYTES = 16 * 1024 * 1024
// An additional V8 heap guard when running under Node. Bun uses the sampled
// whole-child RSS budget, which includes its renderer worker and native buffers.
export const SOURCE_TOOL_NODE_FLAGS = Object.freeze(['--max-old-space-size=480', '--max-semi-space-size=8'])
export const SOURCE_TOOL_CHILD_ARG = '--am-renderer-child'
export const SOURCE_TOOL_EXIT_MEMORY = 72
export const SOURCE_TOOL_EXIT_FAILED = 73
export const SOURCE_TOOL_EXIT_LIMIT_UNAVAILABLE = 74
