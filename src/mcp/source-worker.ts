import { parentPort, workerData } from 'node:worker_threads'
import { getHeapStatistics } from 'node:v8'
import { SOURCE_TOOL_MEMORY_BYTES, SOURCE_TOOL_RESULT_BYTES } from './source-worker-limits.ts'
import { sourceToolMessage, SourceToolMessageLimitError, type LocalSourceToolName, type SourceToolRequest } from './source-tool-message.ts'
import { runSourceTool } from './source-tools.ts'
import { runLocalPngTool } from './png-tool.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'
import { registerEmbeddedFontResourceFiles } from '../agent/embedded-font-registry.ts'

if (workerData?.embeddedFonts) registerEmbeddedFontResourceFiles(workerData.embeddedFonts)

const heapLimitBytes = process.versions.bun ? undefined : getHeapStatistics().heap_size_limit
if (heapLimitBytes !== undefined && heapLimitBytes > SOURCE_TOOL_MEMORY_BYTES) {
  parentPort!.postMessage({ type: 'unavailable' })
  parentPort!.close()
} else {
  parentPort!.on('message', ({ id, json }: SourceToolRequest) => {
    let result: unknown
    let source: string | undefined
    let name: LocalSourceToolName | undefined
    try {
      const request = JSON.parse(json)
      name = request.name
      const args = request.args
      if (typeof args?.source === 'string') source = args.source
      result = name === 'render_png' ? runLocalPngTool(args) : runSourceTool(name!, args)
    } catch (error) {
      // describe has always reported its own failure code on the local server.
      result = name === 'describe'
        ? { ok: false, error: { code: 'DESCRIBE_FAILED', message: error instanceof Error ? error.message : String(error) } }
        : { ok: false, error: projectRenderErrorDiagnostic(error, { source }) }
    }
    let encoded: string
    try { encoded = sourceToolMessage(result, SOURCE_TOOL_RESULT_BYTES) }
    catch (error) {
      encoded = JSON.stringify({ ok: false, error: { code: error instanceof SourceToolMessageLimitError ? 'RENDER_OUTPUT_LIMIT' : 'RENDER_WORKER_FAILED', message: error instanceof SourceToolMessageLimitError ? 'Rendering result exceeds the process message budget' : 'Could not encode rendering result' } })
    }
    parentPort!.postMessage({ type: 'result', id, json: encoded })
  })
  parentPort!.postMessage({ type: 'ready', ...(heapLimitBytes === undefined ? {} : { heapLimitBytes }) })
}
