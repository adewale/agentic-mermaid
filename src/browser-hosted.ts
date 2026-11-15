import { createBrowserEditorAdapter } from './browser-editor-adapter.ts'
import type { PreviewWorkerClient } from './browser-preview-client.ts'
import { PreviewRuntimeLoadError } from './browser-preview-errors.ts'

let loading: Promise<PreviewWorkerClient> | undefined
const adapter = createBrowserEditorAdapter(() => loading ??= import('./browser-preview-runtime.ts').then(module => module.client).catch(error => {
  throw new PreviewRuntimeLoadError('Background renderer could not load; reload the editor to retry', { cause: error })
}), available => window.dispatchEvent(new CustomEvent('mermaid-runtime-status', { detail: available })))
;(globalThis as unknown as { __mermaid: typeof adapter }).__mermaid = adapter
