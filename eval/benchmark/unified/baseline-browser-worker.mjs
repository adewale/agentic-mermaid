/** A browser consumer, passed directly to Playwright.evaluate. No renderer,
 * qualifier or source imports; its referenced package URL is the actual entry. */
export async function baselineBrowserAction(action) {
  const state = globalThis
  if (action.type === 'initialize') {
    const began = performance.now(), module = await import(action.url), imported = performance.now()
    const api = action.kind === 'mermaid' ? module.default : module
    const method = action.kind === 'mermaid' ? 'render' : action.kind === 'agentic' ? 'renderMermaidSVGAsync' : 'renderAsync'
    if (typeof api?.[method] !== 'function') throw Error('Required public SVG API missing: ' + method)
    if (action.kind === 'mermaid') {
      if (typeof api.initialize !== 'function') throw Error('Pinned Mermaid has no public initialize')
      await api.initialize(action.configuration)
    }
    state.__baselineBrowser = { api, kind: action.kind, method, configuration: action.configuration }
    return { method, moduleImportMs: imported - began, initializationMs: performance.now() - imported, moduleThroughReadyMs: performance.now() - began }
  }
  if (action.type === 'release') {
    state.__baselineBrowserSink = undefined
    document.body.replaceChildren()
    return { released: true }
  }
  if (action.type === 'configure') {
    if (!state.__baselineBrowser) throw Error('Public renderer is not initialized')
    if (state.__baselineBrowser.kind === 'mermaid') await state.__baselineBrowser.api.initialize(state.__baselineBrowser.configuration)
    return { configurationReset: true }
  }
  if (action.type !== 'render' || !state.__baselineBrowser) throw Error('Public renderer is not initialized')
  const current = state.__baselineBrowser, excludedCallbacks = [], unsupportedSidecars = []
  const seen = new WeakSet()
  const normalize = (value, path) => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw Error('Non-finite public result field: ' + path)
      return value
    }
    if (typeof value === 'bigint') return { bigint: value.toString() }
    if (typeof value === 'undefined') return { undefined: true }
    if (typeof value === 'function') { excludedCallbacks.push(path); return { excludedCallback: path } }
    if (typeof value === 'symbol') { unsupportedSidecars.push(path + ':symbol'); return { excludedSymbol: path } }
    if (seen.has(value)) { unsupportedSidecars.push(path + ':cycle'); return { cyclicReference: path } }
    seen.add(value)
    let result
    if (value instanceof Map) result = { map: [...value].map(([key, item], index) => [normalize(key, path + '.mapKey' + index), normalize(item, path + '.mapValue' + index)]) }
    else if (value instanceof Set) result = { set: [...value].map((item, index) => normalize(item, path + '.set' + index)) }
    else if (value instanceof Uint8Array) result = { bytes: Array.from(new Uint8Array(value)) }
    else if (Array.isArray(value)) result = value.map((item, index) => normalize(item, path + '[' + index + ']'))
    else {
      const prototype = Object.getPrototypeOf(value)
      if (prototype !== Object.prototype && prototype !== null) unsupportedSidecars.push(path + ':custom-prototype')
      result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, path + '.' + key)]))
      for (const symbol of Object.getOwnPropertySymbols(value)) unsupportedSidecars.push(path + ':' + String(symbol))
    }
    seen.delete(value)
    return result
  }
  const start = performance.now()
  let called
  try {
    let resolvedRenderOptions = action.renderOptions
    if (current.kind === 'agentic') {
      const { fontSize, ...remaining } = action.renderOptions ?? {}
      resolvedRenderOptions = { security: 'strict', ...remaining, ...(fontSize === undefined ? {} : { style: { roles: { node: { fontSize }, edge: { fontSize }, group: { fontSize } } } }) }
    }
    if (current.kind === 'mermaid' && action.renderOptions && Object.keys(action.renderOptions).length) await current.api.initialize({ ...current.configuration, ...action.renderOptions })
    const value = current.kind === 'mermaid'
      ? await current.api.render(action.renderId, action.source)
      : await current.api[current.method](action.source, resolvedRenderOptions)
    called = performance.now()
    const svg = typeof value === 'string' ? value : value?.svg
    if (typeof svg !== 'string') throw Error('Public SVG operation returned no SVG string')
    const artifactBytes = new TextEncoder().encode(svg)
    const sidecar = typeof value === 'object' && value !== null ? normalize(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'svg')), '$') : null
    const sidecarJson = sidecar === null ? null : JSON.stringify(sidecar)
    const metadataBytes = sidecarJson === null ? null : new TextEncoder().encode(sidecarJson)
    state.__baselineBrowserSink = { value, artifactBytes, metadataBytes }
    return { accepted: true, svg, sidecarJson, excludedCallbacks, unsupportedSidecars, sidecarsComplete: unsupportedSidecars.length === 0, publicApiMs: called - start, consumedMs: performance.now() - start, artifactBytes: artifactBytes.byteLength, totalBytes: artifactBytes.byteLength + (metadataBytes?.byteLength ?? 0), actualApi: current.method, resolvedRenderOptions: current.kind === 'mermaid' ? { ...current.configuration, ...action.renderOptions } : resolvedRenderOptions ?? null, renderOptionApplication: current.kind === 'mermaid' && action.renderOptions ? 'public initialize then render inside measured workflow' : 'public render options; Agentic logical fontSize maps to documented node/edge/group role styles' }
  } catch (error) {
    return { accepted: false, publicApiMs: (called ?? performance.now()) - start, consumedMs: performance.now() - start, error: String(error), errorName: error?.name ?? 'Error', errorPhase: called === undefined ? 'public-call' : 'consumption', actualApi: current.method, excludedCallbacks, unsupportedSidecars }
  }
}
