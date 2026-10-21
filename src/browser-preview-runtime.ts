// Hosted bootstrap; the standalone editor reuses its own script as the worker.
import { PreviewWorkerClient, createPreviewWorker } from './browser-preview-client.ts'
export { PreviewSupersededError } from './browser-preview-client.ts'
import type { RenderOptions } from './types.ts'

declare const AM_PREVIEW_WORKER_URL: string
const client = new PreviewWorkerClient(() => createPreviewWorker(AM_PREVIEW_WORKER_URL))
export const renderEditorPreview = (source: string, options: RenderOptions = {}) => client.render(source, options)
export const cancelPendingEditorPreview = () => client.cancelPending()
window.addEventListener('pagehide', () => client.dispose())
