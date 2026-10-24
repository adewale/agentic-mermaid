import { resolve } from 'node:path'
import { isRenderedSourceEcho } from './qualification-visible-source.ts'
export { isRenderedSourceEcho } from './qualification-visible-source.ts'
import { decodeHTML } from 'entities'
import type { UnifiedWorkload } from './types.ts'

export interface Qualification {
  ok: boolean
  findings: string[]
  scope: 'format-and-authored-labels' | 'format-only' | 'binary-envelope' | 'source-envelope' | 'structured-envelope'
}

const displayText = (markup: string): string =>
  decodeHTML(markup.replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
const wholeTerminalLabel = (label: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`, 'u')

/** Inspect rendered text nodes, never metadata, comments, ids or JSON sidecars.
 * Separate line positions may insert whitespace; sibling text elements are
 * never joined to invent a label that no individual reader-facing run held. */
export function missingAuthoredSvgLabels(svg: string, expected: readonly string[] = []): string[] {
  const seen = new Set<string>()
  const visible = svg.replace(/<!--[\s\S]*?-->/g, '').replace(/<(metadata|defs|desc|title|style|script)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  for (const match of visible.matchAll(/<(text|tspan|foreignObject)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
    const tag = match[1]!,
      inner = match[2]!
    seen.add(displayText(inner))
    let previousY: number | undefined
    const lines = inner.replace(/<tspan\b([^>]*)>/g, (token, attributes: string) => {
      const attr = (name: string): string | undefined => new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`).exec(attributes)?.[1]
      const absolute = Number.parseFloat(attr('y') ?? ''),
        dy = Number.parseFloat(attr('dy') ?? '0') || 0
      const currentY = Number.isFinite(absolute) ? absolute : previousY === undefined ? undefined : previousY + dy
      const nextLine = attr('x') !== undefined && (dy !== 0 || (previousY !== undefined && currentY !== undefined && currentY !== previousY))
      previousY = currentY
      return (nextLine ? ' ' : '') + token
    })
    seen.add(displayText(lines))
    for (const child of inner.matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)) seen.add(displayText(child[1]!))
    if (tag === 'foreignObject') for (const run of inner.split(/<[^>]+>/)) seen.add(displayText(run))
  }
  return expected.filter(label => ![...seen].some(run => wholeTerminalLabel(label.replace(/\s+/g, ' ').trim()).test(run)))
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
    if (isRenderedSourceEcho(workload.source, output, 'svg')) findings.push('Visible output echoes Mermaid source instead of an admitted diagram')
    if (!/^\s*(?:<\?xml[^>]*\?>\s*)?<svg\b/i.test(output) || !/(?:<\/svg>|<svg\b[^>]*\/>)\s*$/.test(output)) findings.push('Invalid SVG root envelope')
    const missing = missingAuthoredSvgLabels(output, workload.expectedLabels)
    findings.push(...missing.map(label => `Missing authored label: ${label}`))
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
 * A missing reference stays a visible gap rather than a fabricated oracle. */
export async function withReferenceLabels(workloads: readonly UnifiedWorkload[], options: { root: string; referenceDir?: string; upstreamDir?: string }): Promise<ReferenceLabelEnrichment> {
  const gaps: string[] = []
  const { admitCurrentReference, startModernReference } = await import('../../mermaid-modern-compat/reference.ts')
  const upstream = options.upstreamDir ?? process.env.MERMAID_UPSTREAM_DIR ?? resolve(options.root, '../mermaid')
  const referenceDir = options.referenceDir ?? process.env.MERMAID_REFERENCE_DIR ?? resolve(options.root, '../mermaid-reference')
  let provenance: unknown
  try {
    provenance = admitCurrentReference(upstream, referenceDir)
  } catch (error) {
    return { workloads: workloads.map(workload => ({ ...workload })), gaps: [`Independent label admission unavailable: ${String(error)}`] }
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
