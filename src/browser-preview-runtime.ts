// Hosted bootstrap; the standalone editor reuses its own script as the worker.
import { PreviewWorkerClient, createPreviewWorker } from './browser-preview-client.ts'
export { PreviewSupersededError } from './browser-preview-errors.ts'

declare const AM_PREVIEW_WORKER_URL: string
export const client = new PreviewWorkerClient(() => createPreviewWorker(AM_PREVIEW_WORKER_URL))
window.addEventListener('pagehide', () => client.dispose())
