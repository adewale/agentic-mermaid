import { renderContractDigest } from '../render-contract.ts'
import { secureTerminalHtmlOutput, terminalOutputPlainText } from '../terminal-security.ts'
import type { ColorMode } from './types.ts'
import { terminalGlyphForPaint, type TerminalDocument, type TerminalOwner } from './terminal-document.ts'
import { visualWidth, WIDE_CHAR_CONTINUATION } from './width.ts'

export type TerminalCertificationStatus = 'passed' | 'failed' | 'unverified'
export interface TerminalLayoutCertificationIssue {
  readonly code: string
  readonly status: Exclude<TerminalCertificationStatus, 'passed'>
  readonly message: string
  readonly elementId?: string
  readonly cell?: Readonly<{ column: number; row: number }>
}
export interface TerminalLayoutCertification {
  readonly version: 1
  readonly unit: 'cell'
  readonly scope: 'terminal-cells'
  readonly status: TerminalCertificationStatus
  /** Digest of the exact encoded text returned to this caller, not source/model data. */
  readonly outputDigest?: string
  readonly bounds?: Readonly<{ width: number; height: number }>
  readonly coverage: Readonly<{
    cells: number; graphemes: number; ownedCells: number; unownedCells: number; textAllocations: number
    textClusters: number; identities: number; ports: number; markerContracts: number
  }>
  readonly budget: Readonly<{
    operations: number; maxOperations: number; outputCodeUnits: number
    maxOutputCodeUnits: number; exhausted: boolean; issuesTruncated: boolean; projectionsTruncated: boolean
  }>
  readonly issues: readonly TerminalLayoutCertificationIssue[]
  /** Native representation choices are reported separately from cell-layout correctness. */
  readonly projections: readonly Readonly<{ feature: string; message: string }>[]
  readonly limitations: readonly string[]
}

export interface TerminalCertificationLimits { readonly maxOperations: number; readonly maxOutputCodeUnits: number; readonly maxIssues: number }
export const TERMINAL_CERTIFICATION_LIMITS: TerminalCertificationLimits = Object.freeze({ maxOperations: 1_000_000, maxOutputCodeUnits: 2_000_000, maxIssues: 64 })
const limitations = Object.freeze([
  'Checks cover the retained terminal cell projection and its emitted encoding, not pixel geometry, font ink or terminal emulator behavior.',
  'Identity and membership checks use native declarations; they do not establish complete correspondence with every authored family model.',
  'Declared route bundles, perpendicular crossings and numeric marks may share cells; composition diagnostics distinguish rejected content from those intentional overlaps.',
  'Endpoint checks validate retained ports and markers; they do not prove complete authored-route connectivity for every family.',
  'A passing cell contract does not certify aesthetic spacing, contrast or the legibility of a particular display.',
])
const identityKeys = new WeakMap<Pick<TerminalOwner, 'id' | 'kind'>, string>()
const keyOf = (owner: Pick<TerminalOwner, 'id' | 'kind'>) => {
  let key = identityKeys.get(owner)
  if (key === undefined) { key = JSON.stringify([owner.kind ?? 'node', owner.id]); identityKeys.set(owner, key) }
  return key
}
const siteOf = (x: number, y: number) => `${x},${y}`

/** Certify final native cells without rerendering, inferring boxes or lowering a pixel Scene. */
export function certifyTerminalLayout(
  document: TerminalDocument | undefined,
  output: string,
  colorMode: ColorMode,
  limits: TerminalCertificationLimits = TERMINAL_CERTIFICATION_LIMITS,
): TerminalLayoutCertification {
  for (const name of ['maxOperations', 'maxOutputCodeUnits', 'maxIssues'] as const) if (!Number.isSafeInteger(limits[name]) || limits[name] < 0 || limits[name] > TERMINAL_CERTIFICATION_LIMITS[name]) throw new RangeError(`Terminal certification ${name} must be within its bounded default.`)
  const coverage = { cells: 0, graphemes: 0, ownedCells: 0, unownedCells: 0, textAllocations: 0, textClusters: 0, identities: 0, ports: 0, markerContracts: 0 }
  const issues: TerminalLayoutCertificationIssue[] = []
  const projections: Array<Readonly<{ feature: string; message: string }>> = []
  const issueKeys = new Set<string>()
  let operations = 0, exhausted = false, issuesTruncated = false, projectionsTruncated = false, status: TerminalCertificationStatus = 'passed'
  const add = (code: string, issueStatus: Exclude<TerminalCertificationStatus, 'passed'>, message: string, elementId?: string, x?: number, y?: number) => {
    if (issueStatus === 'failed' || status === 'passed') status = issueStatus
    const issueKey = JSON.stringify([code, elementId ?? null])
    if (issueKeys.has(issueKey)) return
    issueKeys.add(issueKey)
    if (issues.length >= limits.maxIssues) { issuesTruncated = true; return }
    issues.push(Object.freeze({ code, status: issueStatus, message, ...(elementId === undefined ? {} : { elementId }), ...(x === undefined || y === undefined ? {} : { cell: Object.freeze({ column: x, row: y }) }) }))
  }
  const budgetExceeded = Symbol('terminal certification budget')
  const visit = () => { if (operations >= limits.maxOperations) { exhausted = true; throw budgetExceeded } operations++ }
  let outputDigest: string | undefined
  if (output.length > limits.maxOutputCodeUnits) {
    exhausted = true
    add('TERMINAL_CERTIFICATION_LIMIT', 'unverified', 'The final encoded output exceeds the bounded certification scan.')
  } else outputDigest = renderContractDigest(output)
  let bounds: TerminalLayoutCertification['bounds']
  if (!document) add('TERMINAL_DOCUMENT_UNAVAILABLE', 'unverified', 'This renderer returned text without a retained native cell document.')
  else if (!exhausted) try {
    const evidence = document.layoutEvidence()
    bounds = Object.freeze({ width: evidence.width, height: evidence.height })
    const widths = evidence.emittedWidths
    if (!widths || evidence.emittedText === undefined || evidence.colorMode === undefined) {
      add('TERMINAL_EMISSION_UNAVAILABLE', 'unverified', 'The native document has no current final serialization evidence.')
    } else {
      const secured = evidence.colorMode === 'html' ? secureTerminalHtmlOutput(evidence.emittedText) : evidence.emittedText
      if (evidence.colorMode !== colorMode || secured !== output) add('TERMINAL_OUTPUT_MISMATCH', 'failed', 'The returned bytes do not match this native document\'s final encoding.')
      const plain = terminalOutputPlainText(output, colorMode)
      const lines = widths.length === 0 && plain === '' ? [] : plain.split('\n')
      if (lines.length !== widths.length) add('TERMINAL_OUTPUT_ROWS', 'failed', 'The emitted row count differs from the native cell projection.')
      for (let y = 0; y < widths.length; y++) {
        visit()
        const width = widths[y]!
        if (!Number.isSafeInteger(width) || width < 0 || width > evidence.width) { add('TERMINAL_OUTPUT_EXTENT', 'failed', 'An emitted row has invalid cell bounds.', undefined, 0, y); continue }
        let expected = ''
        for (let x = 0; x < width; x++) {
          visit()
          const glyph = document.cell(x, y)?.glyph ?? ' '
          if (glyph !== WIDE_CHAR_CONTINUATION) expected += glyph
        }
        if (lines[y] !== expected) add('TERMINAL_OUTPUT_CELLS', 'failed', 'The emitted text differs from the retained final cells.', undefined, 0, y)
      }
    }
    const owners = new Map<string, TerminalOwner>(), byId = new Map<string, TerminalOwner[]>()
    for (const owner of evidence.owners) {
      visit(); coverage.identities++
      owners.set(keyOf(owner), owner)
      const identities = byId.get(owner.id) ?? []; identities.push(owner); byId.set(owner.id, identities)
    }
    for (const owner of owners.values()) {
      visit()
      if (owner.parent) {
        const parent = owners.get(keyOf(owner.parent))
        if (!parent) add('TERMINAL_PARENT_UNAVAILABLE', 'unverified', 'A native parent reference has no retained identity declaration.', owner.id)
        else if (parent.members && !parent.members.some(member => { visit(); return member === owner.id })) add('TERMINAL_MEMBERSHIP_MISMATCH', 'failed', 'The declared native parent does not include its child in its explicit membership.', owner.id)
      }
      if (owner.annotationTarget) {
        visit()
        if (!owners.has(keyOf(owner.annotationTarget))) add('TERMINAL_ANNOTATION_TARGET_UNAVAILABLE', 'unverified', 'A native annotation target reference has no retained identity declaration.', owner.id)
      }
      const members = new Set<string>()
      for (const member of owner.members ?? []) {
        visit()
        if (members.has(member)) add('TERMINAL_MEMBERSHIP_DUPLICATE', 'failed', `Native member ${member} is declared more than once.`, owner.id)
        members.add(member)
        const candidates = byId.get(member)
        if (!candidates?.length) add('TERMINAL_MEMBER_UNAVAILABLE', 'unverified', `Native member ${member} has no retained identity declaration.`, owner.id)
        else if (candidates.every(child => { visit(); return child.parent && keyOf(child.parent) !== keyOf(owner) })) add('TERMINAL_MEMBERSHIP_MISMATCH', 'failed', `Native member ${member} declares a different parent.`, owner.id)
      }
      for (const endpoint of [owner.from, owner.to]) if (endpoint !== undefined) {
        visit()
        if (!byId.has(endpoint)) add('TERMINAL_ENDPOINT_UNAVAILABLE', 'unverified', `Native endpoint ${endpoint} has no retained identity declaration.`, owner.id)
      }
    }
    const frames = new Map<string, { x: number; y: number; width: number; height: number }>()
    for (const [owner, bounds] of evidence.declarations) { visit(); frames.set(keyOf(owner), bounds) }
    const expectedText = new Set<string>()
    for (const allocation of evidence.textAllocations) {
      visit(); coverage.textAllocations++
      const { text } = allocation
      for (const [row, clusters] of text.lines.entries()) for (const cluster of clusters) {
        visit(); coverage.textClusters++
        const x = allocation.x + cluster.x, y = allocation.y + row, cell = document.cell(x, y)
        expectedText.add(siteOf(x, y))
        if (widths && (y >= widths.length || x + cluster.width > widths[y]!)) add('TERMINAL_TEXT_OMITTED', 'failed', 'Retained measured text falls outside the emitted cell extent.', allocation.owners[0]?.id, x, y)
        else if (!cell || cell.kind !== 'text' || cell.glyph !== cluster.glyph || cell.width !== cluster.width || cell.head !== x) add('TERMINAL_TEXT_CHANGED', 'failed', 'Retained measured text does not survive in the final cells.', allocation.owners[0]?.id, x, y)
        else {
          const checkOwners = (expected: readonly TerminalOwner[]) => { for (const owner of expected) {
            visit()
            if (!cell.owners.some(actual => { visit(); return keyOf(actual) === keyOf(owner) })) add('TERMINAL_TEXT_OWNER_CHANGED', 'failed', 'Measured text lost its native owner.', owner.id, x, y)
          } }
          checkOwners(allocation.owners)
          for (const attribution of allocation.attributions ?? []) {
            visit()
            const { bounds } = attribution
            if (x >= bounds.x && x + cluster.width <= bounds.x + bounds.width && y >= bounds.y && y < bounds.y + bounds.height) checkOwners(attribution.owners)
          }
        }
      }
      for (const row of text.emptyRows) {
        visit()
        if (widths && allocation.y + row >= widths.length) add('TERMINAL_EMPTY_TEXT_ROW_OMITTED', 'unverified', 'An authored empty text row is not distinguishable in the emitted extent.', allocation.owners[0]?.id)
      }
    }
    for (const [x, y, cell] of document.entries()) {
      visit(); coverage.cells++
      const visible = cell.kind === 'text' || cell.glyph.trim().length !== 0
      if (visible && widths && (y >= widths.length || x >= widths[y]!)) add('TERMINAL_CELL_OMITTED', 'failed', 'Visible native content lies outside the emitted cell extent.', cell.owners[0]?.id, x, y)
      if (cell.owners.length) coverage.ownedCells++
      else if (visible) { coverage.unownedCells++; add('TERMINAL_CELL_OWNER_UNAVAILABLE', 'unverified', 'A visible cell has no native semantic ownership.', undefined, x, y) }
      for (const owner of cell.owners) {
        visit()
        if (!owners.has(keyOf(owner))) add('TERMINAL_CELL_OWNER_UNKNOWN', 'failed', 'A final cell names an undeclared identity.', owner.id, x, y)
        if (owner.parent && (['group', 'cluster', 'subgraph'].includes(owner.parent.kind) || owner.kind === 'compartment')) {
          const frame = frames.get(keyOf(owner.parent))
          if (frame && (x < frame.x || x >= frame.x + frame.width || y < frame.y || y >= frame.y + frame.height)) add('TERMINAL_PARENT_FRAME_BREACH', 'failed', 'Owned content escapes its independently allocated native container frame.', owner.id, x, y)
        }
      }
      if (cell.glyph === WIDE_CHAR_CONTINUATION) {
        const head = document.cell(cell.head, y)
        if (!head || head.glyph === WIDE_CHAR_CONTINUATION || cell.head >= x || cell.head + cell.width <= x || head.width !== cell.width) add('TERMINAL_GRAPHEME_CONTINUATION', 'failed', 'A wide grapheme continuation has no complete head.', cell.owners[0]?.id, x, y)
        else if (head.kind !== cell.kind || head.owners.length !== cell.owners.length || head.owners.some(owner => { visit(); return !cell.owners.some(candidate => { visit(); return keyOf(candidate) === keyOf(owner) }) })) add('TERMINAL_GRAPHEME_OWNER_SPLIT', 'failed', 'A wide grapheme has inconsistent semantic ownership across its cells.', head.owners[0]?.id, x, y)
        continue
      }
      coverage.graphemes++
      const expectedGlyph = terminalGlyphForPaint(cell)
      if (expectedGlyph !== undefined && cell.glyph !== expectedGlyph) add('TERMINAL_PRIMITIVE_GLYPH_CHANGED', 'failed', 'A final glyph disagrees with its retained typed stroke, marker or numeric mark.', cell.owners[0]?.id, x, y)
      if (cell.head !== x || cell.width !== visualWidth(cell.glyph) || cell.width < 1) add('TERMINAL_GRAPHEME_HEAD', 'failed', 'A final grapheme has inconsistent cell width or head coordinates.', cell.owners[0]?.id, x, y)
      for (let offset = 1; offset < cell.width; offset++) {
        visit()
        const continuation = document.cell(x + offset, y)
        if (continuation?.glyph !== WIDE_CHAR_CONTINUATION || continuation.head !== x || continuation.width !== cell.width) add('TERMINAL_GRAPHEME_SPLIT', 'failed', 'A wide grapheme has lost a protected continuation cell.', cell.owners[0]?.id, x, y)
      }
      if (cell.kind === 'text' && !expectedText.has(siteOf(x, y))) add('TERMINAL_TEXT_MEASUREMENT_UNAVAILABLE', 'unverified', 'A painted text cell has no retained measured allocation.', cell.owners[0]?.id, x, y)
    }
    for (const [owner, port] of evidence.ports) {
      visit(); coverage.ports++
      if (port.markers) coverage.markerContracts++
      else add('TERMINAL_MARKER_CONTRACT_UNAVAILABLE', 'unverified', 'An endpoint has no independent native marker expectation.', owner.id, port.x, port.y)
      const endpoint = port.end === 'start' ? owner.from : owner.to
      if (endpoint !== undefined && endpoint !== port.nodeId) add('TERMINAL_PORT_ENDPOINT_MISMATCH', 'failed', 'The allocated port disagrees with the native endpoint identity.', owner.id, port.x, port.y)
      if (!byId.has(port.nodeId)) add('TERMINAL_PORT_TARGET_UNAVAILABLE', 'unverified', 'A port target has no retained identity declaration.', owner.id, port.x, port.y)
    }
    try { document.assertMarkers(visit) } catch (error) {
      if (error === budgetExceeded) throw error
      add('TERMINAL_MARKER_CONTRACT_FAILED', 'failed', error instanceof Error ? error.message : 'Final native marker admission failed.')
    }
    for (const diagnostic of document.diagnostics) {
      visit()
      if (['TERMINAL_TEXT_COLLISION', 'TERMINAL_ROUTE_OVERLAP', 'TERMINAL_GEOMETRY_COLLISION'].includes(diagnostic.code)) add(diagnostic.code, 'failed', diagnostic.message, diagnostic.feature, diagnostic.cell?.column, diagnostic.cell?.row)
      else if (diagnostic.code === 'TERMINAL_OWNERSHIP_UNAVAILABLE') add(diagnostic.code, 'unverified', diagnostic.message, diagnostic.feature)
      else if (diagnostic.code === 'TERMINAL_FAMILY_PROJECTION') {
        if (projections.length < limits.maxIssues) projections.push(Object.freeze({ feature: diagnostic.feature, message: diagnostic.message }))
        else projectionsTruncated = true
      }
    }
  } catch (error) {
    if (error !== budgetExceeded) throw error
    add('TERMINAL_CERTIFICATION_LIMIT', 'unverified', 'The final native cell inspection exhausted its operation budget.')
  }
  return Object.freeze({ version: 1, unit: 'cell', scope: 'terminal-cells', status, ...(outputDigest === undefined ? {} : { outputDigest }), ...(bounds ? { bounds } : {}), coverage: Object.freeze(coverage), budget: Object.freeze({ operations, maxOperations: limits.maxOperations, outputCodeUnits: output.length, maxOutputCodeUnits: limits.maxOutputCodeUnits, exhausted, issuesTruncated, projectionsTruncated }), issues: Object.freeze(issues), projections: Object.freeze(projections), limitations })
}
