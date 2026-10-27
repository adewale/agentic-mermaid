import { captureRenderOptions } from '../render-contract.ts'
import type { RenderOptions } from '../types.ts'
import { ZenUMLBackendError } from './upstream.ts'
export { ZenUMLBackendError, UPSTREAM_ZENUML_CAPABILITIES, createUpstreamZenUMLRenderer, renderUpstreamZenUMLSVG } from './upstream.ts'
export type { UpstreamZenUMLOptions, UpstreamZenUMLRenderOptions, UpstreamZenUMLRenderer } from './upstream.ts'

export const ZENUML_CAPABILITIES = Object.freeze({
  maturity: 'experimental', sourcePreservation: true, nativeParse: true,
  typedEditing: true, rendering: 'native-scene', asynchronous: true,
  terminal: true, node: true, cli: true, mcp: true,
  backend: 'native-sequence-scene', nativeScene: true, styles: true,
  palettes: true, rolePaints: true, reusableSession: true,
})

export interface ZenUMLRenderOptions extends RenderOptions {
  /** Deadline for asynchronous dependency loading. Synchronous layout cannot
   * be interrupted while the JavaScript event loop is executing it. */
  timeoutMs?: number
}
export type ZenUMLOptions = ZenUMLRenderOptions
export interface ZenUMLRenderer {
  render(source: string, options?: ZenUMLRenderOptions): Promise<string>
  dispose(): void
}

function captureOptions(input: ZenUMLRenderOptions, defaults: Readonly<RenderOptions> = {}, defaultTimeout = 30_000) {
  if (!input || (typeof input !== 'object' && typeof input !== 'function')) throw new TypeError('ZenUML render options must be an object.')
  if ('backendURL' in input) throw new TypeError('backendURL belongs to createUpstreamZenUMLRenderer/renderUpstreamZenUMLSVG; native ZenUML needs no backend URL.')
  // Reading accessors belongs to synchronous admission, after queue reservation.
  const { timeoutMs = defaultTimeout, ...options } = input
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('timeoutMs must be positive and finite.')
  return { timeout: timeoutMs, options: captureRenderOptions({ ...defaults, ...options }) }
}

/** Native Zen sessions serialize rendering and retain no source/SVG results.
 * Named defaults resolve at each request's synchronous admission boundary. */
export function createZenUMLRenderer(options: ZenUMLOptions = {}): ZenUMLRenderer {
  const defaults = captureOptions(options)
  const queue: Array<() => Promise<void>> = []
  const cancelPending = new Set<(error: Error) => void>()
  let disposed = false, pending = 0, draining = false
  const unavailable = (message: string) => new ZenUMLBackendError('BACKEND_UNAVAILABLE', message)
  const drain = () => {
    if (draining) return
    draining = true
    queueMicrotask(async () => {
      try { while (queue.length) await queue.shift()!() }
      finally { draining = false }
    })
  }
  return {
    async render(source, options = {}) {
      if (disposed) throw unavailable('The ZenUML renderer has been disposed.')
      if (typeof source !== 'string' || !source.trim()) throw new ZenUMLBackendError('INVALID_SOURCE', 'Expected a nonempty ZenUML document.')
      if (pending >= 32) throw unavailable('The ZenUML renderer already has 32 pending requests.')
      pending++
      let captured: ReturnType<typeof captureOptions>
      let resolve!: (svg: string) => void, reject!: (error: unknown) => void
      const result = new Promise<string>((yes, no) => { resolve = yes; reject = no })
      let rejectCancelled!: (error: unknown) => void
      const cancelled = new Promise<never>((_, no) => { rejectCancelled = no })
      void cancelled.catch(() => {})
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const release = () => {
        settled = true
        clearTimeout(timer)
        pending--
        cancelPending.delete(fail)
        const index = queue.indexOf(job)
        if (index >= 0) queue.splice(index, 1)
      }
      const fail = (error: unknown) => { if (!settled) { rejectCancelled(error); release(); reject(error) } }
      const job = async () => {
        if (settled) return
        timer = setTimeout(() => fail(unavailable('ZenUML rendering did not complete before its deadline.')), captured.timeout)
        try {
          const render = async () => {
            const [{ default: family }, { renderLoadedFamilySvg }] = await Promise.all([
              import('../browser-lazy/families/zenuml.ts'),
              import('../browser-lazy/render-core.ts'),
            ])
            if (settled) throw unavailable('The ZenUML request is no longer active.')
            return renderLoadedFamilySvg(source, captured.options, family)
          }
          const svg = await Promise.race([render(), cancelled])
          if (!settled) { release(); resolve(svg) }
        } catch (error) { fail(error) }
      }
      cancelPending.add(fail)
      queue.push(job)
      try { captured = captureOptions(options, defaults.options, defaults.timeout) }
      catch (error) { fail(error) }
      drain()
      return result
    },
    dispose() {
      disposed = true
      const error = unavailable('The ZenUML renderer has been disposed.')
      for (const fail of cancelPending) fail(error)
    },
  }
}

export async function renderZenUMLSVG(source: string, options: ZenUMLOptions = {}): Promise<string> {
  const renderer = createZenUMLRenderer(options)
  try { return await renderer.render(source) } finally { renderer.dispose() }
}
