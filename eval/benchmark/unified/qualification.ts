import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { isRenderedSourceEcho } from './qualification-visible-source.ts'

export { isRenderedSourceEcho } from './qualification-visible-source.ts'

import { inspectSvgText, SVG_NAMESPACE, type SvgInspectionElement } from './svg-text-inspection.ts'
import type { UnifiedWorkload } from './types.ts'
import { mermaidOracleDirectory, mermaidUpstreamDirectory } from '../portable/mermaid-oracle.ts'

export const SVG_QUALIFICATION_PROTOCOL = 'svg-xml-namespaced-authored-text-v3'

export interface Qualification {
  ok: boolean
  findings: string[]
  scope: 'format-and-authored-labels' | 'format-only' | 'binary-envelope' | 'source-envelope' | 'structured-envelope'
}

interface SvgXmlTag {
  local: string
  uri: string
  attributes: Record<string, { value: string }>
}
interface SvgXmlParser {
  on(event: 'opentag', handler: (tag: SvgXmlTag) => void): SvgXmlParser
  on(event: 'closetag', handler: (tag: SvgXmlTag) => void): SvgXmlParser
  on(event: 'text' | 'cdata', handler: (value: string) => void): SvgXmlParser
  on(event: 'error', handler: (error: Error) => void): SvgXmlParser
  write(source: string): SvgXmlParser
  close(): SvgXmlParser
}
let SvgXmlParserConstructor: (new (options: { xmlns: true }) => SvgXmlParser) | undefined
let observedSvgXmlParser: { name: string; version: string; module: string; packageJson: string } | undefined
function svgXmlParser(): SvgXmlParser {
  if (!SvgXmlParserConstructor) {
    const require = createRequire(import.meta.url)
    let module: { SaxesParser: new (options: { xmlns: true }) => SvgXmlParser }
    try {
      module = require('saxes')
    } catch {
      throw new Error('Strict SVG XML qualification requires the saxes benchmark dependency; install development dependencies before benchmarking')
    }
    SvgXmlParserConstructor = module.SaxesParser
    observedSvgXmlParser = { name: 'saxes', version: String(require('saxes/package.json').version), module: require.resolve('saxes'), packageJson: require.resolve('saxes/package.json') }
  }
  return new SvgXmlParserConstructor({ xmlns: true })
}
/** Read after performance clocks; records the real resolved lightweight parser. */
export function svgQualificationProvenance() {
  svgXmlParser()
  return {
    protocol: SVG_QUALIFICATION_PROTOCOL,
    nodeXmlParser: observedSvgXmlParser!,
    browserXmlParser: 'native DOMParser',
    canvasPolicy: 'SVG namespace/root and positive finite viewBox or explicit finite width/height; percentage-only dimensions need a positive viewBox',
    textPolicy: 'namespace-aware authored text retention excluding inert containers; CSS/paint visibility, referenced use/text paths and owned-label correspondence unmeasured',
  }
}
function explicitSvgLength(value: string | undefined): number {
  const text = value?.trim() ?? ''
  return /^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px|pt|pc|cm|mm|in|q)?$/i.test(text) ? Number.parseFloat(text) : NaN
}
/** Independent XML syntax/namespace/canvas admission. The light parser loads
 * lazily here, after the caller has stopped its public API clock. */
function svgXmlInspection(output: string): { findings: string[]; root?: SvgInspectionElement } {
  const parser = svgXmlParser(),
    errors: string[] = [],
    stack: SvgInspectionElement[] = []
  let root: SvgInspectionElement | undefined
  parser.on('opentag', tag => {
    const element: SvgInspectionElement = { kind: 'element', localName: tag.local, namespaceURI: tag.uri, attributes: Object.fromEntries(Object.entries(tag.attributes).map(([name, attribute]) => [name, attribute.value])), children: [] }
    if (stack.length) stack.at(-1)!.children.push(element)
    root ??= element
    stack.push(element)
  })
  parser.on('closetag', () => {
    stack.pop()
  })
  const text = (value: string): void => {
    stack.at(-1)?.children.push({ kind: 'text', value })
  }
  parser.on('text', text)
  parser.on('cdata', text)
  parser.on('error', error => {
    if (errors.length < 3) errors.push(error.message)
  })
  try {
    parser.write(output).close()
  } catch (error) {
    errors.push(String(error))
  }
  if (errors.length) return { findings: ['Malformed SVG XML: ' + errors.join('; ')] }
  if (!root || root.localName !== 'svg' || root.namespaceURI !== SVG_NAMESPACE) return { findings: ['Expected an SVG root in the SVG namespace'] }
  const viewBox = root.attributes.viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  const width = explicitSvgLength(root.attributes.width),
    height = explicitSvgLength(root.attributes.height)
  if (!(viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0) && !(width > 0 && Number.isFinite(width) && height > 0 && Number.isFinite(height))) return { findings: ['SVG has no positive finite viewBox or explicit canvas'] }
  return { findings: [], root }
}

const wholeTerminalLabel = (label: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u')

/** Inspect rendered text nodes, never metadata, comments, ids or JSON sidecars.
 * Separate line positions may insert whitespace; sibling text elements are
 * never joined to invent a label that no individual reader-facing run held. */
export function missingAuthoredSvgLabels(svg: string, expected: readonly string[] = []): string[] {
  const parsed = svgXmlInspection(svg)
  return parsed.root ? inspectSvgText(parsed.root, expected).missingLabels : [...expected]
}

/** Outside the measured call. Expectations come from authored fixtures or the
 * independent pinned reference, never from Agentic's parser/renderer output. */
export function qualifyOutput(workload: UnifiedWorkload, output: unknown, format: string): Qualification {
  const findings: string[] = []
  if (format === 'layout' || format === 'json' || format === 'ir' || format === 'receipt') {
    if (output === null || typeof output !== 'object') return { ok: false, findings: ['Expected a structured object envelope'], scope: 'structured-envelope' }
    const record = output as Record<string, unknown>
    if (format === 'layout') {
      if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) findings.push('Layout envelope requires nodes and edges arrays')
      for (const value of Array.isArray(record.nodes) ? record.nodes : []) {
        if (!value || typeof value !== 'object') {
          findings.push('Layout node is not an object')
          continue
        }
        const node = value as Record<string, unknown>
        for (const key of ['x', 'y', 'w', 'h', 'width', 'height']) {
          if (!(key in node)) continue
          if (typeof node[key] !== 'number' || !Number.isFinite(node[key])) findings.push(`Layout node has non-finite ${key}`)
          else if (!['x', 'y'].includes(key) && node[key] < 0) findings.push(`Layout node has negative ${key}`)
        }
      }
      if (record.bounds && typeof record.bounds === 'object') for (const value of Object.values(record.bounds)) if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) findings.push('Layout bounds are non-finite or negative')
    }
    return { ok: !findings.length, findings, scope: 'structured-envelope' }
  }
  if (format === 'png') {
    const bytes = output instanceof Uint8Array ? output : undefined
    const signature = [137, 80, 78, 71, 13, 10, 26, 10]
    if (!bytes || bytes.length < 33 || signature.some((value, index) => bytes[index] !== value)) findings.push('Invalid PNG signature or truncated PNG')
    else {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (!view.getUint32(16) || !view.getUint32(20)) findings.push('PNG has empty dimensions')
      if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') findings.push('PNG has no leading IHDR')
    }
    return { ok: !findings.length, findings, scope: 'binary-envelope' }
  }
  if (typeof output !== 'string' || !output.trim()) return { ok: false, findings: ['Expected a nonempty output string'], scope: 'format-only' }
  if (format === 'svg') {
    const xml = svgXmlInspection(output)
    if (xml.findings.length || !xml.root) return { ok: false, findings: xml.findings, scope: 'format-only' }
    const inspected = inspectSvgText(xml.root, workload.expectedLabels)
    if (isRenderedSourceEcho(workload.source, output, 'svg', inspected.primaryRuns)) findings.push('Visible output echoes Mermaid source instead of an admitted diagram')
    findings.push(...inspected.missingLabels.map(label => `Missing authored label: ${label}`))
    return { ok: !findings.length, findings, scope: workload.expectedLabels?.length ? 'format-and-authored-labels' : 'format-only' }
  }
  if (format === 'ascii' || format === 'unicode' || format === 'terminal') {
    if (isRenderedSourceEcho(workload.source, output, 'terminal')) findings.push('Visible output echoes Mermaid source instead of an admitted diagram')
    const plain = output.replace(/\u001b\[[0-9;]*m/g, '').replace(/\s+/g, ' ')
    // Terminal wrapping is geometry-dependent. A contiguous single-line label
    // can be asserted; wrapped labels require the terminal owner/region oracle.
    for (const label of workload.expectedLabels ?? []) {
      const normalized = label.replace(/\s+/g, ' ').trim()
      if (normalized && !wholeTerminalLabel(normalized).test(plain)) findings.push(`Missing authored label: ${label}`)
    }
    return { ok: !findings.length, findings, scope: workload.expectedLabels?.length ? 'format-and-authored-labels' : 'format-only' }
  }
  return { ok: true, findings, scope: 'source-envelope' }
}

export interface ReferenceLabelEnrichment {
  workloads: UnifiedWorkload[]
  gaps: string[]
  provenance?: unknown
}

/** Acquire label expectations before any performance clock starts. Reference
 * getter projections preserve their paths in the companion admission evidence.
 * Without the pinned reference this refuses, rather than passing cases unchecked. */
export async function withReferenceLabels(workloads: readonly UnifiedWorkload[], options: { root: string; referenceDir?: string; upstreamDir?: string }): Promise<ReferenceLabelEnrichment> {
  const gaps: string[] = []
  const { admitCurrentReference, startModernReference } = await import('../../mermaid-modern-compat/reference.ts')
  const upstream = options.upstreamDir ?? mermaidUpstreamDirectory()
  const referenceDir = options.referenceDir ?? mermaidOracleDirectory()
  let provenance: unknown
  try {
    provenance = admitCurrentReference(upstream, referenceDir)
  } catch (error) {
    // Measuring without the pinned labels would pass cases unchecked; refuse instead.
    throw Error(`Reference labels need the pinned Mermaid source checkout at ${upstream} and oracle at ${referenceDir}; run \`bun run reference:mermaid\` in the Agentic checkout. ${String(error)}`)
  }
  const { referenceLabels, censusDisplayText } = await import('../../mermaid-modern-compat/label-census.ts')
  const reference = startModernReference(referenceDir)
  const enriched: UnifiedWorkload[] = []
  try {
    for (const workload of workloads) {
      try {
        const reply = await reference.parse(workload.source)
        const labels = referenceLabels(workload.family, reply)
        if (!reply.ok || !labels) {
          gaps.push(`${workload.id}: independent reference ${reply.ok ? 'has no label getter projection' : `rejected source (${reply.error})`}`)
          enriched.push({ ...workload })
          continue
        }
        const expectedLabels = [...new Set([...(workload.expectedLabels ?? []), ...labels.map(label => censusDisplayText(label.text)).filter(Boolean)])]
        if (!expectedLabels.length) gaps.push(`${workload.id}: reference returned no nonempty authored label expectations`)
        enriched.push({ ...workload, expectedLabels, provenance: `${workload.provenance}; independent Mermaid DB getters @${(provenance as { commit: string }).commit}` })
      } catch (error) {
        gaps.push(`${workload.id}: independent label acquisition failed: ${String(error)}`)
        enriched.push({ ...workload })
      }
    }
  } finally {
    reference.close()
  }
  return { workloads: enriched, gaps, provenance }
}
