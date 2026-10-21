// Architecture experiment for SERIAL adapter calls only. It intentionally does
// not implement the production bounded-preview queue, cancellation, crash/retry
// policy or arbitrary callback admission. Never use as a shipping editor entry.
import '../../src/browser-hosted.ts'

type Message = { id: number; kind: string; operation?: string; source?: string; options?: any; output?: any; value?: any; error?: string; svg?: string; context?: any }
if (typeof window === 'undefined') {
  const [{ renderAndVerifyMermaid }, { renderMermaidASCIIWithReceipt }, { renderMermaidPNGInBrowserWithReceipt }] = await Promise.all([
    import('../../src/agent/verify.ts'), import('../../src/ascii/index.ts'), import('../../src/browser-png.ts'), import('../../src/scene/builtin-backends.ts'),
  ])
  const host = globalThis as unknown as { onmessage: (e: MessageEvent<Message>) => void; postMessage: (m: Message, transfer?: Transferable[]) => void }
  const rasterizers = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
  host.onmessage = async ({ data: m }) => {
    if (m.kind === 'rasterized') {
      const pending = rasterizers.get(m.id); rasterizers.delete(m.id)
      if (m.error) pending?.reject(new Error(m.error)); else pending?.resolve(m.value)
      return
    }
    try {
      let value: any
      if (m.operation === 'preview') {
        const started = performance.now(), result = renderAndVerifyMermaid(m.source!, { ...m.options, security: 'strict', embedFontImport: false })
        value = { svg: result.svg, receipt: result.receipt, verification: { ok: result.verification.ok, warnings: result.verification.warnings }, computeMs: performance.now() - started }
      } else if (m.operation === 'ascii' || m.operation === 'unicode') {
        const artifact = renderMermaidASCIIWithReceipt(m.source!, { ...m.options, useAscii: m.operation === 'ascii' })
        // Native evidence has callable helpers; transfer only the editor contract.
        value = { text: artifact.text, receipt: artifact.receipt }
      } else if (m.operation === 'png') {
        value = await renderMermaidPNGInBrowserWithReceipt(m.source!, m.options, m.output, (svg, context) => new Promise((resolve, reject) => {
          rasterizers.set(m.id, { resolve, reject }); host.postMessage({ id: m.id, kind: 'rasterize', svg, context })
        }))
      } else throw new Error('Unknown probe operation')
      host.postMessage({ id: m.id, kind: 'result', value }, m.operation === 'png' ? [value.png.buffer] : [])
    } catch (error) { host.postMessage({ id: m.id, kind: 'result', error: String(error) }) }
  }
} else {
  const script = document.getElementById('editor-runtime')
  if (!script?.textContent) throw new Error('Runtime source missing')
  const blob = new Blob([script.textContent], { type: 'text/javascript' })
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; rasterize?: (svg: string, context: any) => Promise<any>; timer: ReturnType<typeof setTimeout> }>()
  let worker: Worker | undefined, nextId = 0
  const rpc = (operation: string, source: string, options: any, output?: any, rasterize?: (svg: string, context: any) => Promise<any>) => new Promise<any>((resolve, reject) => {
    if (!worker) {
      const url = URL.createObjectURL(blob)
      worker = new Worker(url, { type: 'module', name: 'ownership-probe' })
      const release = () => URL.revokeObjectURL(url)
      worker.addEventListener('message', release, { once: true }); worker.addEventListener('error', release, { once: true })
      worker.onmessage = async ({ data: m }: MessageEvent<Message>) => {
        const call = pending.get(m.id)
        if (!call) return
        if (m.kind === 'rasterize') {
          try {
            const value = await call.rasterize!(m.svg!, m.context)
            worker!.postMessage({ id: m.id, kind: 'rasterized', value }, [value.png.buffer])
          } catch (error) { worker!.postMessage({ id: m.id, kind: 'rasterized', error: String(error) }) }
        } else {
          pending.delete(m.id); clearTimeout(call.timer)
          if (m.error) call.reject(new Error(m.error)); else call.resolve(m.value)
        }
      }
      worker.onerror = () => { for (const call of pending.values()) { clearTimeout(call.timer); call.reject(new Error('Ownership probe worker failed')) } pending.clear() }
    }
    const id = ++nextId, timer = setTimeout(() => { pending.delete(id); reject(new Error('Ownership probe timed out')) }, 30_000)
    pending.set(id, { resolve, reject, rasterize, timer }); worker.postMessage({ id, kind: 'request', operation, source, options, output })
  })
  const global = globalThis as any
  global.__mermaid = { ...global.__mermaid,
    renderMermaidSVGWithReceipt: (source: string, options = {}) => rpc('preview', source, options),
    renderMermaidASCIIWithReceipt: (source: string, options = {}) => rpc('ascii', source, options),
    renderMermaidUnicodeWithReceipt: (source: string, options = {}) => rpc('unicode', source, options),
    renderMermaidPNGInBrowserWithReceipt: (source: string, options: any, output: any, rasterize: any) => rpc('png', source, options, output, rasterize),
  }
  window.addEventListener('pagehide', () => worker?.terminate())
}
