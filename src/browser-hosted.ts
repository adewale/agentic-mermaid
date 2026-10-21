import { createBrowserEditorAdapter } from './browser-editor-adapter.ts'
import type { PreviewWorkerClient } from './browser-preview-client.ts'

let loading: Promise<PreviewWorkerClient> | undefined
const adapter = createBrowserEditorAdapter(() => loading ??= import('./browser-preview-runtime.ts').then(module => module.client).catch(error => {
  throw new Error('Background renderer could not load; reload the page to retry', { cause: error })
}))
;(globalThis as unknown as { __mermaid: typeof adapter }).__mermaid = adapter
