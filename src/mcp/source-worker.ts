import { parentPort } from 'node:worker_threads'
import { getHeapStatistics } from 'node:v8'
import { SOURCE_TOOL_MEMORY_BYTES, SOURCE_TOOL_RESULT_BYTES } from './source-worker-limits.ts'
import { sourceToolMessage, SourceToolMessageLimitError, type SourceToolRequest } from './source-tool-message.ts'
import { runSourceTool } from './source-tools.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

const heapLimitBytes = process.versions.bun ? undefined : getHeapStatistics().heap_size_limit
if (heapLimitBytes !== undefined && heapLimitBytes > SOURCE_TOOL_MEMORY_BYTES) {
  parentPort!.postMessage({ type: 'unavailable' })
  parentPort!.close()
} else {
  parentPort!.on('message', ({ id, json }: SourceToolRequest) => {
    let result: unknown
    try {
      const { name, args } = JSON.parse(json)
      result = runSourceTool(name, args)
    } catch (error) { result = { ok: false, error: projectRenderErrorDiagnostic(error) } }
    let encoded: string
    try { encoded = sourceToolMessage(result, SOURCE_TOOL_RESULT_BYTES) }
    catch (error) {
      encoded = JSON.stringify({ ok: false, error: { code: error instanceof SourceToolMessageLimitError ? 'RENDER_OUTPUT_LIMIT' : 'RENDER_WORKER_FAILED', message: error instanceof SourceToolMessageLimitError ? 'Rendering result exceeds the process message budget' : 'Could not encode rendering result' } })
    }
    parentPort!.postMessage({ type: 'result', id, json: encoded })
  })
  parentPort!.postMessage({ type: 'ready', ...(heapLimitBytes === undefined ? {} : { heapLimitBytes }) })
}
