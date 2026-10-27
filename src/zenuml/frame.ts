import { scopeSvgStyles } from '../svg-style-scope.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import ZenUml, { renderToSvg } from '@zenuml/core'
import { safeCssColor } from '../shared/css-color.ts'
import type { ZenUMLAppearance } from './appearance.ts'
// This entry is compiled separately as an IIFE and is only loaded in the
// isolated frame. Upstream import-time CSS is confined to that document.
let parser: ZenUml | undefined

function applyAppearance(svg: Element, appearance: ZenUMLAppearance): void {
  for (const value of Object.values(appearance)) if (!safeCssColor(value)) throw Error('ZenUML returned an invalid appearance color.')
  // Map explicit vendor-owned paint classes, preserving geometry, authored
  // direction, dashes and text metrics. This is not native Scene lowering.
  const a = appearance
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = `
    .frame-border-outer { fill:${a.groupBorder} }
    .frame-border-inner,.frame-header-bg { fill:${a.background} }
    .frame-header-line,.lifeline { stroke:${a.groupBorder} }
    .frame-title { fill:${a.foreground} }
    .participant-box,.occurrence { fill:${a.nodeFill};stroke:${a.nodeBorder} }
    .participant-label { fill:${a.nodeText} }
    .participant-icon { color:${a.nodeText} }
    .participant-icon [fill="currentColor"]:not([stroke]) { stroke:${a.nodeBorder} }
    .message-line,.return-line,.return-arrow,.arrow-head,.arrow-head path { stroke:${a.edge} }
    .arrow-head:not(.arrow-open),.arrow-head:not(.arrow-open) path,.return-icon { fill:${a.edge} }
    .message-label,.return-label { fill:${a.edgeText} }
    .fragment-border,.group-outline { stroke:${a.groupBorder} }
    .fragment svg path { stroke:${a.groupText} }
    .fragment-header,.group-title-bg,.divider-bg { fill:${a.groupFill} }
    .fragment-label,.fragment-condition,.fragment-section-label,.group-title-text,.divider-label { fill:${a.groupText} }
    .divider-line,.divider-bg,.fragment-separator { stroke:${a.groupBorder} }
    .comment-text,.seq-number { fill:${a.muted} }
  `
  svg.querySelector('defs')!.append(style)
}

function retainVisibleInk(svg: Element, bounds: number[]): void {
  // Vendor viewports can clip long titles and nested sequence numbers. Measure
  // the actual admitted SVG in its own document, including nested transforms.
  document.body.append(svg)
  try {
    const ink = (svg as SVGSVGElement).getBBox()
    const left = ink.x < bounds[0]! ? Math.floor(ink.x) - 8 : bounds[0]!
    const top = ink.y < bounds[1]! ? Math.floor(ink.y) - 8 : bounds[1]!
    const right = ink.x + ink.width > bounds[0]! + bounds[2]! ? Math.ceil(ink.x + ink.width) + 8 : bounds[0]! + bounds[2]!
    const bottom = ink.y + ink.height > bounds[1]! + bounds[3]! ? Math.ceil(ink.y + ink.height) + 8 : bounds[1]! + bounds[3]!
    if (![left, top, right, bottom].every(Number.isFinite)) throw Error('ZenUML returned invalid painted bounds.')
    if (left === bounds[0] && top === bounds[1] && right === left + bounds[2]! && bottom === top + bounds[3]!) return
    const width = right - left, height = bottom - top
    svg.setAttribute('viewBox', `${left} ${top} ${width} ${height}`)
    svg.setAttribute('width', String(width))
    svg.setAttribute('height', String(height))
    for (const [selector, inset] of [['.frame-border-outer', 0], ['.frame-border-inner', 1]] as const) {
      const frame = svg.querySelector(selector)!
      for (const [key, value] of Object.entries({ x: left + inset, y: top + inset, width: width - 2 * inset, height: height - 2 * inset })) frame.setAttribute(key, String(value))
    }
    svg.querySelector('.frame-header-line')?.setAttribute('x1', String(left + 1))
    svg.querySelector('.frame-header-line')?.setAttribute('x2', String(right - 1))
  } finally { svg.remove() }
}

window.addEventListener('message', async event => {
  if (event.source !== window.parent || event.data?.type !== 'agentic-zenuml' || !event.ports[0]) return
  const port = event.ports[0]
  try {
    const source = String(event.data.source).replace(/^\s*zenuml\b/, '')
    if (!parser) {
      const host = document.createElement('div')
      document.body.append(host)
      parser = new ZenUml(host)
    }
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
    svg.setAttribute('style', `${svg.getAttribute('style') ?? ''};max-width:100%;height:auto`)
    svg.setAttribute('width', String(result.width))
    svg.setAttribute('height', String(result.height))
    svg.setAttribute('viewBox', result.viewBox)
    if (event.data.appearance) applyAppearance(svg, event.data.appearance)
    retainVisibleInk(svg, bounds)
    port.postMessage({ ok: true, svg: scopeSvgStyles(new XMLSerializer().serializeToString(svg)) })
  } catch (error) {
    port.postMessage({ ok: false, code: 'RENDER_FAILED', message: error instanceof Error ? error.message : String(error) })
  } finally {
    port.close()
  }
})
