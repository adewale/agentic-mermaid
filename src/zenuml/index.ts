/** Optional browser-only backend. No ZenUML dependency enters the default graph. */
export class ZenUMLBackendError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_RUNTIME' | 'BACKEND_UNAVAILABLE' | 'INVALID_SOURCE' | 'RENDER_FAILED',
    message: string,
  ) {
    super(message)
    this.name = 'ZenUMLBackendError'
  }
}
export const ZENUML_CAPABILITIES = Object.freeze({
  maturity: 'experimental',
  sourcePreservation: true,
  nativeParse: false,
  typedEditing: false,
  rendering: 'optional-browser-iframe',
  asynchronous: true,
  terminal: false,
  node: false,
  cli: false,
  mcp: false,
  backend: '@zenuml/core@3.47.9',
})
export interface ZenUMLOptions {
  /** URL of the shipped zenuml-frame.global.js, served by the consumer. */
  backendURL: string | URL
  timeoutMs?: number
}
/** Render in a disposable iframe: the upstream module injects page-wide CSS
 * during import. That import must never run against the caller's document. */
export async function renderZenUMLSVG(source: string, options: ZenUMLOptions): Promise<string> {
  if (typeof document === 'undefined' || typeof MessageChannel === 'undefined') throw new ZenUMLBackendError('UNSUPPORTED_RUNTIME', 'ZenUML rendering requires a browser document; use the optional browser backend.')
  if (!/^\s*zenuml\b/.test(source) || !source.replace(/^\s*zenuml\b/, '').trim()) throw new ZenUMLBackendError('INVALID_SOURCE', 'Expected a nonempty ZenUML document.')
  const url = new URL(options.backendURL, document.baseURI)
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(document.baseURI).origin) throw new ZenUMLBackendError('BACKEND_UNAVAILABLE', 'The ZenUML frame script must be served from the same HTTP(S) origin.')
  const timeout = options.timeoutMs ?? 30_000
  if (!Number.isFinite(timeout) || timeout <= 0) throw new ZenUMLBackendError('BACKEND_UNAVAILABLE', 'timeoutMs must be positive and finite.')
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe'),
      channel = new MessageChannel()
    frame.hidden = true
    frame.setAttribute('aria-hidden', 'true')
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    const cleanup = () => {
      clearTimeout(timer)
      channel.port1.close()
      channel.port2.close()
      frame.remove()
    }
    const fail = (code: ZenUMLBackendError['code'], message: string) => {
      cleanup()
      reject(new ZenUMLBackendError(code, message))
    }
    const timer = setTimeout(() => fail('BACKEND_UNAVAILABLE', 'ZenUML backend did not complete before its deadline.'), timeout)
    channel.port1.onmessage = event => {
      const value = event.data
      if (value?.ok === true && typeof value.svg === 'string') {
        cleanup()
        resolve(value.svg)
      } else fail(value?.code === 'INVALID_SOURCE' ? 'INVALID_SOURCE' : 'RENDER_FAILED', String(value?.message ?? 'ZenUML rendering failed.'))
    }
    frame.onload = () => frame.contentWindow?.postMessage({ type: 'agentic-zenuml', source }, '*', [channel.port2])
    // JSON quoting is insufficient for HTML attributes. Escape every delimiter.
    const attribute = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    frame.srcdoc = `<!doctype html><html><head><script src="${attribute}"></script></head><body></body></html>`
    ;(document.body ?? document.documentElement).append(frame)
  })
}
