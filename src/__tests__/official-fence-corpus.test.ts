// Every fence of the pinned official Mermaid 12.2.0 syntax pages, observed
// through the public agent API. Families this project renders must parse to a
// structured body without syntax-loss diagnostics, verify, render, and keep
// their structural count across serialize -> parse. Families it does not
// render must be diagnosed as UNSUPPORTED_FAMILY with their bytes preserved.
// Deviations live in one Chromium-TestExpectations-style table below; a new
// deviation and a fixed one ("unexpected pass") both fail with the fence ids.

import { describe, expect, test } from 'bun:test'
import { extractOfficialCorpus, type OfficialFence } from '../../eval/shared/official-fences.ts'
import { isBuiltinFamilyId, MermaidFamilyDetectionError, parseRegisteredMermaid, renderMermaidSVG, serializeMermaid, verifyMermaid } from '../agent/index.ts'
import { countStructuralElements, countsEqual } from '../agent/structural-count.ts'
import { compareCodePointStrings } from '../shared/deterministic-order.ts'

/** Outcomes that deviate from the default rule, named per observation. */
const REGISTERED_DEVIATIONS = [
  'ParseError', // parseRegisteredMermaid returned errors
  'Misdetected', // parsed as another family, or preserved as unsupported
  'Opaque', // fell back to an opaque, byte-preserved body
  'Unsupported', // a syntax-loss diagnostic (UNSUPPORTED_SYNTAX, ...)
  'VerifyError', // verifyMermaid(...).ok === false
  'RenderError', // renderMermaidSVG threw
  'CountDrift', // serialize -> parse fails or changes the structural count
] as const
const UNSUPPORTED_DEVIATIONS = [
  'ParseError',
  'Undiagnosed', // not preserved as UNSUPPORTED_FAMILY for this upstream family
  'RenderLeak', // renderMermaidSVG did not raise the family diagnostic
  'SourceLost', // serialization did not reproduce the authored bytes
] as const
type Deviation = (typeof REGISTERED_DEVIATIONS)[number] | (typeof UNSUPPORTED_DEVIATIONS)[number]

/** Diagnostics that mean the parser did not understand authored syntax. */
const SYNTAX_LOSS = new Set(['UNSUPPORTED_SYNTAX', 'CONTENT_DROPPED_ON_ROUNDTRIP', 'UNKNOWN_SHAPE'])

// `<fence id> [ <deviations> ] # <reason>`. Only deviations are
// listed: registered families default to [ Pass ], unsupported families to a
// diagnosed UNSUPPORTED_FAMILY. Remove a line when its fence starts passing.
const EXPECTATIONS = `
# Class: whole-diagram opaque fallbacks.
class:official-syntax/classDiagram.md#27 [ Opaque Unsupported ] # class-level 'direction RL' statement is not modelled
class:official-syntax/classDiagram.md#30 [ Opaque Unsupported ] # 'callback' / 'click ... call' interaction lines are not modelled (callbacks never run offline)
class:official-syntax/classDiagram.md#31 [ Opaque Unsupported ] # 'callback' / 'click ... call' interaction lines are not modelled (callbacks never run offline)
# Flowchart
flowchart:official-syntax/flowchart.md#3 [ Opaque Unsupported ] # markdown strings render styled runs but stay source-preserved
flowchart:official-syntax/flowchart.md#68 [ Opaque Unsupported ] # '@{ icon: ... }' icon shapes are not modelled
flowchart:official-syntax/flowchart.md#69 [ Opaque Unsupported ] # '@{ img: ... }' renders an offline placeholder instead of fetching the URL
flowchart:official-syntax/flowchart.md#101 [ Opaque Unsupported ] # subgraph '@{ view: collapsed }' is not modelled (diagnosed as edge metadata)
flowchart:official-syntax/flowchart.md#102 [ Opaque Unsupported ] # markdown strings render styled runs but stay source-preserved
flowchart:official-syntax/flowchart.md#103 [ Opaque Unsupported ] # click callbacks/hrefs are preserved but never executable
flowchart:official-syntax/flowchart.md#104 [ Opaque Unsupported ] # click hrefs with link targets are preserved but never executable
# Gantt
gantt:official-syntax/gantt.md#6 [ VerifyError ] # settings-only snippet renders an explicit empty state and remains diagnosed EMPTY_DIAGRAM
gantt:official-syntax/gantt.md#10 [ Unsupported VerifyError RenderError ] # inline task comments are diagnosed and canonicalized onto their own line; the undocumented workaround tag still becomes an invalid date
# Sequence: structured bodies with source-preserved opaque segments.
sequence:official-syntax/sequenceDiagram.md#1 [ Unsupported ] # new order example contains source-preserved activate/deactivate and Note controls
sequence:official-syntax/sequenceDiagram.md#2 [ Unsupported ] # configured order example contains source-preserved activate/deactivate and Note controls
sequence:official-syntax/sequenceDiagram.md#15 [ Unsupported ] # 'create' / 'destroy' participant lifecycle
sequence:official-syntax/sequenceDiagram.md#16 [ Unsupported ] # 'box' participant groups
sequence:official-syntax/sequenceDiagram.md#18 [ Unsupported ] # explicit 'activate' / 'deactivate'
sequence:official-syntax/sequenceDiagram.md#21 [ Unsupported ] # 'Note right of'
sequence:official-syntax/sequenceDiagram.md#22 [ Unsupported ] # 'Note over A,B'
sequence:official-syntax/sequenceDiagram.md#23 [ Unsupported ] # 'Note over A,B' with '<br/>'
sequence:official-syntax/sequenceDiagram.md#24 [ Unsupported ] # 'Note over A,B' with '<br/>'
sequence:official-syntax/sequenceDiagram.md#28 [ Unsupported ] # nested 'par ... and' blocks
sequence:official-syntax/sequenceDiagram.md#29 [ Unsupported ] # 'critical ... option' blocks
sequence:official-syntax/sequenceDiagram.md#30 [ Unsupported ] # 'critical' blocks
sequence:official-syntax/sequenceDiagram.md#31 [ Unsupported ] # 'break' blocks
sequence:official-syntax/sequenceDiagram.md#32 [ Unsupported ] # 'rect' highlight blocks with notes
sequence:official-syntax/sequenceDiagram.md#35 [ Unsupported ] # 'autonumber' and notes
`

interface Expectation {
  deviations: readonly Deviation[]
  reason: string
}

function parseExpectations(text: string): Map<string, Expectation> {
  const known = new Set<string>([...REGISTERED_DEVIATIONS, ...UNSUPPORTED_DEVIATIONS])
  const expectations = new Map<string, Expectation>()
  for (const line of text.split('\n').map(item => item.trim())) {
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^(\S+) \[ ((?:[A-Za-z]+ )+)\] # (.+)$/)
    if (!match) throw new Error(`Malformed official-fence expectation: ${line}`)
    const deviations = match[2]!.trim().split(' ')
    const unknown = deviations.filter(deviation => !known.has(deviation))
    if (unknown.length > 0) throw new Error(`${match[1]}: unknown outcomes ${unknown.join(', ')}`)
    if (expectations.has(match[1]!)) throw new Error(`${match[1]}: duplicate expectation`)
    expectations.set(match[1]!, { deviations: [...new Set(deviations as Deviation[])].sort(), reason: match[3]! })
  }
  return expectations
}

function deviationsOf(fence: OfficialFence): Deviation[] {
  const parsed = parseRegisteredMermaid(fence.source)
  if (!parsed.ok) return ['ParseError']
  const diagram = parsed.value
  const deviations = new Set<Deviation>()
  if (!isBuiltinFamilyId(fence.family)) {
    const body = diagram.body
    if (body.kind !== 'preserved' || body.diagnostic.code !== 'UNSUPPORTED_FAMILY' || body.preservation.upstreamFamilyId !== fence.family) deviations.add('Undiagnosed')
    try {
      renderMermaidSVG(fence.source)
      deviations.add('RenderLeak')
    } catch (error) {
      if (!(error instanceof MermaidFamilyDetectionError) || error.code !== 'UNSUPPORTED_FAMILY') deviations.add('RenderLeak')
    }
    if (serializeMermaid(diagram) !== fence.source) deviations.add('SourceLost')
    return [...deviations].sort()
  }
  const bodyKind: string = diagram.body.kind
  if (diagram.kind !== fence.family || bodyKind === 'preserved') deviations.add('Misdetected')
  if (bodyKind === 'opaque') deviations.add('Opaque')
  const verified = verifyMermaid(diagram)
  if (verified.warnings.some(warning => SYNTAX_LOSS.has(warning.code))) deviations.add('Unsupported')
  if (!verified.ok) deviations.add('VerifyError')
  try {
    renderMermaidSVG(fence.source)
  } catch {
    deviations.add('RenderError')
  }
  const reparsed = parseRegisteredMermaid(serializeMermaid(diagram))
  const before = countStructuralElements(diagram)
  const after = reparsed.ok ? countStructuralElements(reparsed.value) : null
  if (!reparsed.ok || reparsed.value.kind !== diagram.kind || (before === null ? after !== null : after === null || !countsEqual(before, after))) deviations.add('CountDrift')
  return [...deviations].sort()
}

const expectations = parseExpectations(EXPECTATIONS)
const corpus = extractOfficialCorpus()

// Bounded groups keep each test far below the per-test timeout, even when the
// suite runs files in parallel.
const GROUP_SIZE = 40
const groups = [...new Set(corpus.map(fence => fence.family))].sort(compareCodePointStrings).flatMap(family => {
  const fences = corpus.filter(fence => fence.family === family)
  return Array.from({ length: Math.ceil(fences.length / GROUP_SIZE) }, (_, chunk) => ({
    label: fences.length > GROUP_SIZE ? `${family} ${chunk * GROUP_SIZE + 1}-${Math.min(fences.length, (chunk + 1) * GROUP_SIZE)}` : family,
    fences: fences.slice(chunk * GROUP_SIZE, (chunk + 1) * GROUP_SIZE),
  }))
})

describe('official Mermaid syntax fence corpus', () => {
  test('every expectation names a corpus fence with outcomes its family can produce', () => {
    const families = new Map(corpus.map(fence => [fence.id, fence.family]))
    const invalid = [...expectations.entries()].flatMap(([id, expectation]) => {
      const family = families.get(id)
      if (family === undefined) return [`${id}: not an official fence`]
      const allowed: readonly string[] = isBuiltinFamilyId(family) ? REGISTERED_DEVIATIONS : UNSUPPORTED_DEVIATIONS
      const foreign = expectation.deviations.filter(deviation => !allowed.includes(deviation))
      return foreign.length > 0 ? [`${id}: ${foreign.join(', ')} cannot occur for ${family}`] : []
    })
    expect(invalid).toEqual([])
  })

  test.each(groups)('$label official fences match their expectations', ({ fences }) => {
    const mismatches = fences.flatMap(fence => {
      const observed = deviationsOf(fence)
      const expected = expectations.get(fence.id)?.deviations ?? []
      if (observed.join(' ') === expected.join(' ')) return []
      if (observed.length === 0) return [`${fence.id}: unexpected pass; remove its expectation [ ${expected.join(' ')} ]`]
      return [`${fence.id}: expected [ ${expected.join(' ') || 'Pass'} ], observed [ ${observed.join(' ')} ]`]
    })
    expect(mismatches).toEqual([])
  })
})
