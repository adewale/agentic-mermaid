import type { StyleInput } from '../scene/style-registry.ts'
import type { ZenUMLAppearance } from './appearance.ts'
import { snapshotDeclarativeStyleValue, withStyleAdmission } from '../shared/declarative-style.ts'
import { assertJsonConfigAdmission } from '../shared/json-config-admission.ts'

/** Optional browser-only backend. No ZenUML dependency enters the default graph. */
export class ZenUMLBackendError extends Error {
  constructor(
    readonly code: 'UNSUPPORTED_RUNTIME' | 'BACKEND_UNAVAILABLE' | 'INVALID_SOURCE' | 'RENDER_FAILED' | 'UNSUPPORTED_APPEARANCE',
    message: string,
  ) {
    super(message)
    this.name = 'ZenUMLBackendError'
  }
}
export const UPSTREAM_ZENUML_CAPABILITIES = Object.freeze({
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
  nativeScene: false,
  styles: false,
  palettes: true,
  rolePaints: true,
  reusableSession: true,
})
export interface UpstreamZenUMLRenderOptions {
  timeoutMs?: number
  /** Named palettes or paint-only node/edge/group/label fragments. Native Look
   * geometry, fonts and sketch effects are rejected, never silently ignored. */
  style?: StyleInput | StyleInput[]
}
export interface UpstreamZenUMLOptions extends UpstreamZenUMLRenderOptions {
  /** URL of the shipped zenuml-frame.global.js, served by the consumer. */
  backendURL: string | URL
}
export interface UpstreamZenUMLRenderer {
  /** Requests are serialized; at most 32 calls may be pending per session. */
  render(source: string, options?: UpstreamZenUMLRenderOptions): Promise<string>
  /** Release the isolated backend and reject active and queued requests. */
  dispose(): void
}

function captureStyle(style: StyleInput | StyleInput[]): StyleInput | StyleInput[] {
  try {
    return withStyleAdmission(() => {
      const captured = snapshotDeclarativeStyleValue(style)
      // Native style resolution immediately rejects non-declarative values;
      // this async consumer must do so before caller-owned objects can change.
      assertJsonConfigAdmission(captured, 'ZenUML style', { allowUndefinedObjectProperties: true })
      return captured as StyleInput | StyleInput[]
    })
  }
  catch (error) { throw new ZenUMLBackendError('UNSUPPORTED_APPEARANCE', error instanceof Error ? error.message : String(error)) }
}

/** An explicitly owned session retains one isolated backend. Every render
 * still parses and lays out its input; no source/SVG result cache is used. */
export function createUpstreamZenUMLRenderer(options: UpstreamZenUMLOptions): UpstreamZenUMLRenderer {
  if (typeof document === 'undefined' || typeof MessageChannel === 'undefined') throw new ZenUMLBackendError('UNSUPPORTED_RUNTIME', 'ZenUML rendering requires a browser document; use the optional browser backend.')
  let url: URL
  try {
    url = new URL(options.backendURL, document.baseURI)
  } catch {
    throw new ZenUMLBackendError('BACKEND_UNAVAILABLE', 'The ZenUML backend URL is invalid.')
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== new URL(document.baseURI).origin) throw new ZenUMLBackendError('BACKEND_UNAVAILABLE', 'The ZenUML frame script must be served from the same HTTP(S) origin.')
  const defaultStyle = options.style === undefined ? undefined : captureStyle(options.style)
  const defaultTimeout = options.timeoutMs ?? 30_000
  let disposed = false, pending = 0, frameCalls = 0
  let frame: HTMLIFrameElement | undefined, loaded: Promise<void> | undefined
  let cancelActive: ((error: ZenUMLBackendError) => void) | undefined
  const cancelPending = new Set<(error: ZenUMLBackendError) => void>()
  const queue: Array<() => Promise<void>> = []
  let draining = false
  const drain = () => {
    if (draining) return
    draining = true
    queueMicrotask(async () => {
      try { while (queue.length) await queue.shift()!() }
      finally { draining = false }
    })
  }
  const unavailable = (message: string) => new ZenUMLBackendError('BACKEND_UNAVAILABLE', message)
  const releaseFrame = () => {
    frame?.remove()
    frame = undefined
    loaded = undefined
    frameCalls = 0
  }
  const ensureFrame = () => {
    if (loaded) return loaded
    frame = document.createElement('iframe')
    // display:none suppresses SVG text metrics. An offscreen, invisible frame
    // still measures owned ink without painting into the caller's page.
    frame.style.cssText = 'position:fixed;left:-100000px;top:0;width:1024px;height:768px;visibility:hidden;pointer-events:none;border:0'
    frame.setAttribute('aria-hidden', 'true')
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin')
    loaded = new Promise<void>(resolve => { frame!.onload = () => resolve() })
    // JSON quoting is insufficient for HTML attributes. Escape every delimiter.
    const attribute = url.href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    frame.srcdoc = `<!doctype html><html><head><script src="${attribute}"></script></head><body></body></html>`
    ;(document.body ?? document.documentElement).append(frame)
    return loaded
  }
  const request = (source: string, appearance: ZenUMLAppearance | undefined, timeout: number) => new Promise<string>((resolve, reject) => {
    // Upstream retains text measurements in module state. Rotate a session's
    // frame after bounded work instead of retaining that cache indefinitely.
    if (frameCalls >= 64) releaseFrame()
    frameCalls++
    const channel = new MessageChannel()
    let completed = false
    const cleanup = () => {
      completed = true
      clearTimeout(timer)
      channel.port1.close()
      channel.port2.close()
      if (cancelActive === fail) cancelActive = undefined
    }
    const fail = (error: ZenUMLBackendError) => {
      if (completed) return
      cleanup()
      if (error.code !== 'INVALID_SOURCE') releaseFrame()
      reject(error)
    }
    cancelActive = fail
    const timer = setTimeout(() => fail(unavailable('ZenUML backend did not complete before its deadline.')), timeout)
    channel.port1.onmessage = event => {
      if (completed) return
      const value = event.data
      if (value?.ok === true && typeof value.svg === 'string') {
        cleanup()
        resolve(value.svg)
      } else fail(new ZenUMLBackendError(value?.code === 'INVALID_SOURCE' ? 'INVALID_SOURCE' : 'RENDER_FAILED', String(value?.message ?? 'ZenUML rendering failed.')))
    }
    void Promise.resolve().then(() => completed ? undefined : ensureFrame()).then(() => {
      if (!completed && cancelActive === fail) frame?.contentWindow?.postMessage({ type: 'agentic-zenuml', source, appearance }, url.origin, [channel.port2])
    }).catch(() => fail(unavailable('The ZenUML frame could not be loaded.')))
  })
  return {
    async render(source, renderOptions = {}) {
      if (disposed) throw unavailable('The ZenUML renderer has been disposed.')
      if (typeof source !== 'string' || !/^\s*zenuml\b/.test(source) || !source.replace(/^\s*zenuml\b/, '').trim()) throw new ZenUMLBackendError('INVALID_SOURCE', 'Expected a nonempty ZenUML document.')
      if (pending >= 32) throw unavailable('The ZenUML renderer already has 32 pending requests.')
      // Reserve capacity and FIFO position before reading caller-owned getters.
      pending++
      let timeout: number, style: StyleInput | StyleInput[] | undefined
      let appearance: Promise<ZenUMLAppearance | undefined>
      let resolve!: (svg: string) => void, reject!: (error: unknown) => void
      const result = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      let rejectCancelled!: (error: ZenUMLBackendError) => void
      const cancelled = new Promise<never>((_, no) => { rejectCancelled = no })
      void cancelled.catch(() => {})
      let settled = false
      const release = () => {
        settled = true
        pending--
        cancelPending.delete(cancel)
        const index = queue.indexOf(job)
        if (index >= 0) queue.splice(index, 1)
      }
      const fail = (error: unknown) => {
        if (settled) return
        release()
        reject(error)
      }
      const cancel = (error: ZenUMLBackendError) => {
        rejectCancelled(error)
        fail(error)
      }
      const job = async () => {
        if (settled) return
        try {
          if (disposed) throw unavailable('The ZenUML renderer has been disposed.')
          let svg: string
          if (style === undefined) svg = await request(source, undefined, timeout)
          else {
            const started = performance.now()
            let admissionTimer: ReturnType<typeof setTimeout> | undefined
            const admissionDeadline = new Promise<never>((_, no) => {
              admissionTimer = setTimeout(() => no(unavailable('ZenUML palette admission did not complete before its deadline.')), timeout)
            })
            let admitted: ZenUMLAppearance | undefined
            try { admitted = await Promise.race([appearance, cancelled, admissionDeadline]) }
            finally { clearTimeout(admissionTimer) }
            if (disposed) throw unavailable('The ZenUML renderer has been disposed.')
            svg = await request(source, admitted, Math.max(0, timeout - (performance.now() - started)))
          }
          if (!settled) { release(); resolve(svg) }
        } catch (error) { fail(error) }
      }
      cancelPending.add(cancel)
      queue.push(job)
      try {
        timeout = renderOptions.timeoutMs ?? defaultTimeout
        if (!Number.isFinite(timeout) || timeout <= 0) throw unavailable('timeoutMs must be positive and finite.')
        const input = 'style' in renderOptions ? renderOptions.style : defaultStyle
        style = input === undefined ? undefined : captureStyle(input)
        if (!settled) {
          // The shared style registry is fetched only for a paint request.
          appearance = style === undefined ? Promise.resolve(undefined) : import('./appearance.ts')
            .then(api => {
              try { return api.resolveZenUMLAppearance(style!) }
              catch (error) { throw new ZenUMLBackendError('UNSUPPORTED_APPEARANCE', error instanceof Error ? error.message : String(error)) }
            }, () => { throw unavailable('The ZenUML palette module could not be loaded.') })
          void appearance.catch(() => {})
        }
      } catch (error) { fail(error) }
      drain()
      return result
    },
    dispose() {
      disposed = true
      const error = unavailable('The ZenUML renderer has been disposed.')
      cancelActive?.(error)
      for (const cancel of cancelPending) cancel(error)
      releaseFrame()
    },
  }
}

/** One-shot rendering shares the session implementation and always releases
 * its frame. Use createUpstreamZenUMLRenderer for repeated previews, then dispose it. */
export async function renderUpstreamZenUMLSVG(source: string, options: UpstreamZenUMLOptions): Promise<string> {
  const renderer = createUpstreamZenUMLRenderer(options)
  try { return await renderer.render(source) } finally { renderer.dispose() }
}
