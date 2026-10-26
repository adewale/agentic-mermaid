/** Browser transport for already prepared, documented public distributions.
 * No timing, bundling, acquisition, parser facade or inferred native model. */
export async function communityFidelityBrowserAction(input: any): Promise<any> {
  const host = globalThis as any
  if (input.type === 'initialize-module') {
    const api = await import(input.url)
    if (input.kind === 'franken') await api.default({ module_or_path: await (await fetch(input.wasm)).arrayBuffer() })
    else await api.initMerman()
    host.__fidelityCommunity = { kind: input.kind, render: (source: string) => api.renderSvg(source), fontOptions: false }
    return { fontOptions: false }
  }
  if (input.type === 'initialize-global') {
    const api = host[input.engine.global], kind = input.engine.kind
    if (!api) throw Error('Prepared public global is unavailable: ' + input.engine.global)
    let render: (source: string, id: string, options?: any) => any, fontOptions = false
    if (kind === 'mermaid') {
      api.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' })
      const owner = typeof api.render === 'function' ? api : api.mermaidAPI
      if (!owner || typeof owner.render !== 'function') throw Error('Published Mermaid render API unavailable')
      fontOptions = !input.engine.legacyMermaid
      render = input.engine.legacyMermaid ? (source, id) => new Promise((resolve, reject) => {
        try {
          let callback = false
          const returned = owner.render(id, source, (svg: string) => { callback = true; resolve(svg) })
          if (typeof returned === 'string') resolve(returned)
          else if (returned && typeof returned.then === 'function') returned.then(resolve, reject)
          else if (input.engine.synchronousLegacyRender && !callback) reject(Error('Synchronous public Mermaid render returned no SVG and did not invoke its SVG callback'))
        } catch (error) { reject(error) }
      }) : (source, id) => owner.render(id, source)
    } else if (kind === 'extra') { const publicRender = await api.createRenderer(); render = (source, id) => publicRender(source, id, 'svg') }
    else if (kind === 'ondine') { const compiler = await api(); render = source => compiler.render(source).svg }
    else if (kind === 'function') render = source => api(source)
    else if (kind === 'pele') render = source => api.render(source).svg
    else {
      const publicRender = api.renderMermaidSVG ?? api.renderMermaidSVGAsync ?? api.renderMermaidSync ?? api.renderMermaid
      if (typeof publicRender !== 'function') throw Error('Published Beautiful SVG API unavailable')
      // The modern documented renderMermaidSVG options include fontSize. Older
      // similarly named sync/async facades do not establish that capability.
      fontOptions = typeof api.renderMermaidSVG === 'function' || typeof api.renderMermaidSVGAsync === 'function'
      render = (source, _id, options) => publicRender.call(api, source, options)
    }
    host.__fidelityCommunity = { kind, api, render, fontOptions }
    return { fontOptions }
  }
  const state = host.__fidelityCommunity
  if (!state) throw Error('Community public API was not initialized')
  if (input.type === 'configure') { if (state.kind === 'mermaid') state.api.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal' }); return { configured: true } }
  if (input.type === 'render') {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      if (state.kind === 'mermaid' && input.options && state.fontOptions) state.api.initialize({ startOnLoad: false, securityLevel: 'strict', logLevel: 'fatal', ...input.options, ...(input.options.fontSize !== undefined ? { themeVariables: { fontSize: String(input.options.fontSize) + 'px' } } : {}) })
      const value = await Promise.race([Promise.resolve().then(() => state.render(input.source, input.id, state.fontOptions ? input.options : undefined)), new Promise((_, reject) => { timer = setTimeout(() => { const error = Error('Public render did not settle within the declared15s collection deadline'); error.name = 'TimeoutError'; reject(error) }, 15_000) })])
      const svg = typeof value === 'string' ? value : (value as any)?.svg
      return typeof svg === 'string' ? { kind: 'returned', svg } : { kind: 'invalid-return', error: 'Actual public render did not return an SVG string', actualType: typeof value }
    } catch (error: any) { return { kind: 'exception', error: String(error), errorName: error?.name ?? 'Error', errorCode: error?.code ?? null } }
    finally { if (timer) clearTimeout(timer); host.__communityAfterCall?.(); for (const node of document.querySelectorAll('body > div:not([data-community-host])')) node.remove() }
  }
  throw Error('Unknown community fidelity browser action')
}
