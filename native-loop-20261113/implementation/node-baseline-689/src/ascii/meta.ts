import { executeTerminalRender, type AsciiRenderOptions } from './index.ts'
import { terminalDocumentOf, type TerminalCellSpan, type TerminalRegion } from './terminal-document.ts'
import { prepareRenderInput } from '../agent/render-input.ts'
import { collectActionRecords } from '../agent/analyze.ts'
import type { DiagramActionRecord, ParsedDiagram, RenderedRegionKind } from '../agent/types.ts'
import { ParsedDiagramFamilyMismatchError } from '../render-contract.ts'
import { sanitizeTerminalText } from '../terminal-security.ts'
import type { TerminalProjectionDiagnostic, TerminalProjectionDiagnosticCode } from '../terminal-style.ts'

export type RegionKind = Exclude<RenderedRegionKind, 'canvas'> | 'subgraph'
export type AsciiWarningCode = 'ASCII_RENDER_FAILED' | 'ASCII_EDGE_REGION_UNMAPPED' | TerminalProjectionDiagnosticCode
export interface AsciiWarning { code: AsciiWarningCode; message: string; severity: 'degraded'; cell?: TerminalProjectionDiagnostic['cell'] }
export interface AsciiRegion extends Omit<TerminalRegion, 'ownedCellSpans'> {
  /** Exact occupied geometry, including spaces, continuations and repeated occurrences. */
  ownedCellSpans?: TerminalCellSpan[]
}

export const ASCII_ROUTE_PARITY_CONTRACT = {
  version: 1,
  routeIntent: 'shared-route-classes',
  svgSource: 'route-contract classifyRoutes() + certificates',
  asciiSource: 'family terminal geometry with owned cells, route classes, markers and intentional bundles',
  degradationWarnings: ['ASCII_RENDER_FAILED', 'ASCII_EDGE_REGION_UNMAPPED', 'TERMINAL_OWNERSHIP_UNAVAILABLE'],
} as const

export interface AsciiWithMeta {
  ascii: string
  regions: AsciiRegion[]
  actions: DiagramActionRecord[]
  warnings: AsciiWarning[]
  routeParity: typeof ASCII_ROUTE_PARITY_CONTRACT
}

/** Metadata is emitted by the same execution as the text. No label search or rerender. */
export function renderMermaidASCIIWithMeta(input: ParsedDiagram | string, options: AsciiRenderOptions = {}): AsciiWithMeta {
  const preparedInput = prepareRenderInput(input)
  try {
    const { rendered, model } = executeTerminalRender(preparedInput, options)
    const document = terminalDocumentOf(rendered)
    const warnings: AsciiWarning[] = rendered.terminalStyle.diagnostics.map(diagnostic => ({ code: diagnostic.code, severity: 'degraded', message: diagnostic.message, ...(diagnostic.cell ? { cell: diagnostic.cell } : {}) }))
    if (!document) warnings.push({ code: 'TERMINAL_OWNERSHIP_UNAVAILABLE', severity: 'degraded', message: 'This family returns terminal text without owned geometry; element regions cannot be established from its string output.' })
    const parsed = model.parsed()
    const regions: AsciiRegion[] = document?.regions() ?? []
    if (parsed.ok) for (const region of regions) {
      const declaration = region.kind === 'node' ? parsed.value.source.nodes.get(region.id) : parsed.value.source.groups.get(region.id)
      if (region.sourceLine === undefined && declaration) region.sourceLine = declaration.line
    }
    const actions = parsed.ok ? collectActionRecords(parsed.value).map(sanitizeAction) : []
    return { ascii: rendered.text, regions, actions, warnings, routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  } catch (error) {
    if (error instanceof ParsedDiagramFamilyMismatchError) throw error
    return { ascii: '', regions: [], actions: [], warnings: [{ code: 'ASCII_RENDER_FAILED', severity: 'degraded', message: 'ASCII/Unicode renderer failed; no route parity evidence is available.' }], routeParity: ASCII_ROUTE_PARITY_CONTRACT }
  }
}

function sanitizeAction(action: DiagramActionRecord): DiagramActionRecord {
  const safe = (value: string | undefined): string | undefined => value === undefined ? undefined : sanitizeTerminalText(value)
  return { ...action, raw: safe(action.raw)!, href: safe(action.href), tooltip: safe(action.tooltip), message: safe(action.message) }
}
