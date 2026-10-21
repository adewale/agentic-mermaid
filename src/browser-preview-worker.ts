import type { PreviewWorkerRequest, PreviewWorkerResponse } from './browser-preview-client.ts'
import './scene/builtin-backends.ts'
import { renderAndVerifyMermaid } from './agent/verify.ts'

const host = globalThis as unknown as { onmessage: (event: MessageEvent<PreviewWorkerRequest>) => void; postMessage: (response: PreviewWorkerResponse) => void }
// The standalone editor embeds this module once and runs it in both realms.
if (typeof window === 'undefined') host.onmessage = event => {
  const { id, source, options } = event.data
  try {
    const started = performance.now()
    const result = renderAndVerifyMermaid(source, { ...options, security: 'strict', embedFontImport: false })
    host.postMessage({ id, ok: true, artifact: {
      svg: result.svg, receipt: result.receipt,
      verification: { ok: result.verification.ok, warnings: result.verification.warnings },
      computeMs: performance.now() - started,
    } })
  } catch (error) {
    host.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}
