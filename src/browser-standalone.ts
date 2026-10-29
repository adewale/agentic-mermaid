// The main thread retains the engine-free facade. Only the build-owned worker
// payload is decoded; its immutable Blob is reused with a fresh URL per attempt.
import { createBrowserEditorAdapter } from './browser-editor-adapter.ts'
import { PreviewWorkerClient, createPreviewWorker } from './browser-preview-client.ts'
import { PreviewRuntimeLoadError, PreviewSupersededError } from './browser-preview-errors.ts'
import { standaloneWorkerPayload } from './browser-standalone-payload.ts'

const payload = document.getElementById('editor-worker-payload')?.textContent ?? ''
let epoch = 0, suspended = false
let runtime: Blob | undefined, client: PreviewWorkerClient | undefined
let loading: Promise<PreviewWorkerClient> | undefined
let failure: PreviewRuntimeLoadError | undefined

function load(): Promise<PreviewWorkerClient> {
  if (suspended) return Promise.reject(new PreviewSupersededError())
  if (failure) return Promise.reject(failure)
  if (client) return Promise.resolve(client)
  if (loading) return loading
  const requested = epoch
  const cancelled = () => suspended || requested !== epoch
  const pending = Promise.resolve().then(() => {
    if (cancelled()) throw new PreviewSupersededError()
    if (!runtime) {
      try { runtime = standaloneWorkerPayload(payload, cancelled) }
      catch (error) {
        // Decoder/module initialization can have been interrupted. A reload is
        // required rather than retrying a partly initialized codec closure.
        failure = new PreviewRuntimeLoadError('Background renderer could not load; reload the editor to retry', { cause: error })
        throw failure
      }
    }
    if (cancelled()) throw new PreviewSupersededError()
    return client = new PreviewWorkerClient(() => createPreviewWorker(URL.createObjectURL(runtime!)))
  }).catch(error => {
    if (cancelled()) throw new PreviewSupersededError()
    throw error
  }).finally(() => {
    if (loading === pending) loading = undefined
  })
  loading = pending
  return pending
}

const adapter = createBrowserEditorAdapter(load)
;(window as unknown as { __mermaid: typeof adapter }).__mermaid = adapter
window.addEventListener('pagehide', () => {
  suspended = true
  epoch++
  adapter.cancelPendingRender()
  client?.dispose()
  loading = undefined
})
window.addEventListener('pageshow', () => { suspended = false })
