// One self-contained module supplies the main-thread adapters and the worker.
// Reusing its script text avoids shipping a second copy of the renderer.
import './browser-preview-worker.ts'
import { BROWSER_EDITOR_ADAPTER } from './browser.ts'
import { PreviewWorkerClient, createPreviewWorker } from './browser-preview-client.ts'
import type { RenderOptions } from './types.ts'

if (typeof window !== 'undefined') {
  const script = document.getElementById('editor-runtime')
  if (!script?.textContent) throw new Error('Standalone editor runtime script is missing')
  const runtime = new Blob([script.textContent], { type: 'text/javascript' })
  const client = new PreviewWorkerClient(() => createPreviewWorker(URL.createObjectURL(runtime)))
  ;(window as unknown as { __mermaid: unknown }).__mermaid = {
    ...BROWSER_EDITOR_ADAPTER,
    renderMermaidSVGWithReceipt: (source: string, options: RenderOptions = {}) => client.render(source, options),
    cancelPendingRender: () => client.cancelPending(),
  }
  window.addEventListener('pagehide', () => client.dispose())
}
