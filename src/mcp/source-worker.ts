import { getHeapStatistics } from 'node:v8'
import { SOURCE_TOOL_HEAP_MB } from './source-worker-limits.ts'
import { runSourceTool } from './source-tools.ts'
import { projectRenderErrorDiagnostic } from '../render-error-diagnostic.ts'

process.on('disconnect', () => process.exit())
process.on('message', ({ name, args }: { name: Parameters<typeof runSourceTool>[0]; args: Record<string, unknown> }) => {
  if (getHeapStatistics().heap_size_limit > SOURCE_TOOL_HEAP_MB * 1024 * 1024) {
    process.send!({ ok: false, error: { code: 'RENDER_LIMIT_UNAVAILABLE', message: 'The runtime cannot enforce the requested heap limit' } })
    return
  }
  try {
    process.send!(runSourceTool(name, args))
  } catch (error) {
    process.send!({ ok: false, error: projectRenderErrorDiagnostic(error) })
  }
})
