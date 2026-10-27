import { verifyNoExternalRefs } from '../output-security.ts'
import ZenUml, { renderToSvg } from '@zenuml/core'
// This entry is compiled separately as an IIFE and is only loaded in the
// disposable frame. Upstream import-time CSS is confined to that document.
window.addEventListener('message', async event => {
  if (event.source !== window.parent || event.data?.type !== 'agentic-zenuml' || !event.ports[0]) return
  const port = event.ports[0]
  try {
    const source = String(event.data.source).replace(/^\s*zenuml\b/, '')
    const host = document.createElement('div')
    document.body.append(host)
    const parser = new ZenUml(host)
    const parsed = await parser.parse(source)
    if (!parsed.pass) {
      port.postMessage({ ok: false, code: 'INVALID_SOURCE', message: parsed.errorDetails.map(error => `${error.line}:${error.column} ${error.msg}`).join('; ') })
      return
    }
    const result = renderToSvg(source, { theme: 'theme-mermaid' })
    if (!verifyNoExternalRefs(result.svg).ok) throw Error('ZenUML returned external SVG resources.')
    const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement
    const bounds = result.viewBox.split(/[\s,]+/).map(Number)
    if (svg.localName !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg' || bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2]! <= 0 || bounds[3]! <= 0 || !(result.width > 0 && result.height > 0)) throw Error('ZenUML returned invalid SVG bounds.')
    // Only native SVG is supported. External resources and executable content
    // cannot cross the backend boundary even if upstream accepts a new DSL form.
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      if (['script', 'foreignObject', 'iframe', 'image', 'a'].includes(element.localName)) throw Error('ZenUML returned unsupported active or external content.')
      for (const attribute of [...element.attributes]) if (/^on/i.test(attribute.name) || (/^(?:href|xlink:href)$/i.test(attribute.name) && !attribute.value.startsWith('#'))) throw Error('ZenUML returned an unsafe SVG attribute.')
    }
    svg.setAttribute('width', String(result.width))
    svg.setAttribute('height', String(result.height))
    svg.setAttribute('viewBox', result.viewBox)
    port.postMessage({ ok: true, svg: new XMLSerializer().serializeToString(svg) })
  } catch (error) {
    port.postMessage({ ok: false, code: 'RENDER_FAILED', message: error instanceof Error ? error.message : String(error) })
  } finally {
    port.close()
  }
})
