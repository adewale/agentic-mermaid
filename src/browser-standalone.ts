// One embedded module is parsed in both realms; engine modules initialize only
// inside the worker. The public synchronous browser.ts entry stays independent.
import { createBrowserEditorAdapter } from './browser-editor-adapter.ts'
import { PreviewWorkerClient, createPreviewWorker } from './browser-preview-client.ts'

if (typeof window === 'undefined') {
  await import('./browser-preview-worker.ts')
} else {
  const script = document.getElementById('editor-runtime')
  if (!script?.textContent) throw new Error('Standalone editor runtime script is missing')
  const runtime = new Blob([script.textContent], { type: 'text/javascript' })
  const client = new PreviewWorkerClient(() => createPreviewWorker(URL.createObjectURL(runtime)))
  ;(window as unknown as { __mermaid: unknown }).__mermaid = createBrowserEditorAdapter(() => client)
  window.addEventListener('pagehide', () => client.dispose())
}
