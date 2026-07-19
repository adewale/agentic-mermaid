import { BUILTIN_FAMILY_METADATA, getFamily } from '../../agent/families.ts'
import type { DiagramKind } from '../../agent/types.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'
import { getStyle, inferBackend, knownStyleDescriptors, resolveStyleStack } from '../../scene/style-registry.ts'
import type { RenderOptions } from '../../types.ts'
import {
  COMPLEXITY_STRATA,
  FAMILY_CONFORMANCE_PROFILES,
  conformanceSourceFor,
  type ComplexityStratum,
} from './family-conformance-profiles.ts'

export const SECURITY_MODES = ['default', 'strict'] as const
export type SecurityMode = typeof SECURITY_MODES[number]
export const BACKGROUND_POLARITIES = ['opaque-dark', 'opaque-light', 'transparent'] as const
export type BackgroundPolarity = typeof BACKGROUND_POLARITIES[number]
export const CONTACT_SHEET_WITNESSES: ReadonlyArray<{
  backend: BackendClass
  palettePolarity: 'dark' | 'light'
  background: BackgroundPolarity
}> = [
  { backend: 'default', palettePolarity: 'light', background: 'opaque-light' },
  { backend: 'rough', palettePolarity: 'light', background: 'opaque-light' },
  { backend: 'hybrid', palettePolarity: 'dark', background: 'opaque-dark' },
  { backend: 'default', palettePolarity: 'dark', background: 'transparent' },
]
export const OUTPUT_FORMATS = ['ascii', 'png', 'svg', 'unicode'] as const
export type ConformanceOutputFormat = typeof OUTPUT_FORMATS[number]
export type BackendClass = 'default' | 'hybrid' | 'rough'

export interface FactorDomains {
  readonly [factor: string]: readonly string[]
}
export type FactorAssignment = Record<string, string>

const factorTuple = (assignment: FactorAssignment, factors: readonly string[]): string =>
  factors.map(factor => `${factor}=${assignment[factor]}`).join('|')

const pairKey = (a: string, av: string, b: string, bv: string): string =>
  compareCodePointStrings(a, b) < 0 ? `${a}=${av}\0${b}=${bv}` : `${b}=${bv}\0${a}=${av}`

function allPairKeys(domains: FactorDomains): Set<string> {
  const factors = Object.keys(domains).sort(compareCodePointStrings)
  const pairs = new Set<string>()
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i]!, b = factors[j]!
      for (const av of domains[a]!) for (const bv of domains[b]!) pairs.add(pairKey(a, av, b, bv))
    }
  }
  return pairs
}

function coveredPairKeys(row: FactorAssignment): string[] {
  const factors = Object.keys(row).sort(compareCodePointStrings)
  const keys: string[] = []
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i]!, b = factors[j]!
      keys.push(pairKey(a, row[a]!, b, row[b]!))
    }
  }
  return keys
}

/** Deterministic pairwise constructor. Verification lives in a separate module. */
export function buildPairwiseAssignments(domains: FactorDomains, seeds: readonly FactorAssignment[] = []): FactorAssignment[] {
  const factors = Object.keys(domains).sort(compareCodePointStrings)
  for (const factor of factors) {
    if (domains[factor]!.length === 0) throw new Error(`Factor ${factor} has no values`)
  }
  const uncovered = allPairKeys(domains)
  const rows: FactorAssignment[] = []
  const complete = (partial: FactorAssignment): FactorAssignment => {
    const row = { ...partial }
    for (const factor of factors) {
      if (row[factor] !== undefined) continue
      row[factor] = [...domains[factor]!].sort(compareCodePointStrings)
        .map(candidate => {
          const trial = { ...row, [factor]: candidate }
          const score = coveredPairKeys(trial).filter(key => uncovered.has(key)).length
          return { candidate, score }
        })
        .sort((x, y) => y.score - x.score || compareCodePointStrings(x.candidate, y.candidate))[0]!.candidate
    }
    return row
  }
  const add = (row: FactorAssignment): void => {
    for (const factor of factors) {
      if (!domains[factor]!.includes(row[factor]!)) throw new Error(`Invalid ${factor}=${row[factor]}`)
    }
    rows.push(row)
    for (const key of coveredPairKeys(row)) uncovered.delete(key)
  }
  for (const seed of seeds) add(complete(seed))

  while (uncovered.size > 0) {
    const target = [...uncovered].sort(compareCodePointStrings)[0]!
    const [left, right] = target.split('\0') as [string, string]
    const [a, av] = left.split('=') as [string, string]
    const [b, bv] = right.split('=') as [string, string]
    add(complete({ [a]: av, [b]: bv }))
  }

  const unique = new Map<string, FactorAssignment>()
  for (const row of rows) unique.set(factorTuple(row, factors), row)
  return [...unique.values()].sort((a, b) => compareCodePointStrings(factorTuple(a, factors), factorTuple(b, factors)))
}

export function registeredLooks(): string[] {
  return knownStyleDescriptors()
    .filter(descriptor => descriptor.kind === 'look' && !descriptor.isDefault)
    .map(descriptor => descriptor.inputName)
    .sort(compareCodePointStrings)
}

export function registeredPalettes(): string[] {
  return knownStyleDescriptors()
    .filter(descriptor => descriptor.kind === 'palette')
    .map(descriptor => descriptor.inputName)
    .sort(compareCodePointStrings)
}

export function backendClassForLook(look: string): BackendClass {
  const spec = getStyle(look)
  if (!spec) throw new Error(`Unknown Look ${look}`)
  return inferBackend(spec)
}

function cssHexLuminance(value: string): number {
  const match = /^#([0-9a-f]{6})$/iu.exec(value)
  if (!match) throw new Error(`Built-in palette background must be six-digit hex for conformance polarity: ${value}`)
  const channels = [0, 2, 4].map(index => Number.parseInt(match[1]!.slice(index, index + 2), 16) / 255)
  return channels.reduce((sum, channel, index) => {
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    return sum + linear * [0.2126, 0.7152, 0.0722][index]!
  }, 0)
}

export function palettePolarity(palette: string): 'dark' | 'light' {
  const background = getStyle(palette)?.colors?.bg
  if (!background) throw new Error(`Palette ${palette} has no concrete background`)
  return cssHexLuminance(background) < 0.35 ? 'dark' : 'light'
}

export function roleSignatureForFamily(family: DiagramKind): string {
  const descriptor = getFamily(family)
  if (!descriptor) throw new Error(`Missing descriptor for ${family}`)
  return [...descriptor.semanticRoles].sort(compareCodePointStrings).join('+') || 'role-free'
}

export interface CoreConformanceRow {
  readonly id: string
  readonly family: DiagramKind
  readonly look: string
  readonly palette: string
  readonly security: SecurityMode
  readonly background: BackgroundPolarity
  readonly complexity: ComplexityStratum
  readonly backend: BackendClass
  readonly palettePolarity: 'dark' | 'light'
  readonly roleSignature: string
  readonly externalReference: 'none' | 'authored'
  readonly sourceId: string
  readonly source: string
  readonly options: RenderOptions
}

function coreDomains(): FactorDomains {
  return {
    background: BACKGROUND_POLARITIES,
    complexity: COMPLEXITY_STRATA,
    family: BUILTIN_FAMILY_METADATA.map(entry => entry.id),
    look: registeredLooks(),
    palette: registeredPalettes(),
    security: SECURITY_MODES,
  }
}

function baseTripleSeeds(): FactorAssignment[] {
  return registeredLooks().flatMap(look => registeredPalettes().flatMap(palette =>
    BACKGROUND_POLARITIES.map(background => ({ look, palette, background }))))
}

function assignmentKey(row: FactorAssignment): string {
  return factorTuple(row, ['background', 'complexity', 'family', 'look', 'palette', 'security'])
}

function ensureDerivedRows(rows: FactorAssignment[]): FactorAssignment[] {
  const looksByBackend = new Map<BackendClass, string>()
  for (const look of registeredLooks()) {
    const backend = backendClassForLook(look)
    if (!looksByBackend.has(backend)) looksByBackend.set(backend, look)
  }
  const palettesByPolarity = new Map<'dark' | 'light', string>()
  for (const palette of registeredPalettes()) {
    const polarity = palettePolarity(palette)
    if (!palettesByPolarity.has(polarity)) palettesByPolarity.set(polarity, palette)
  }
  const has = (predicate: (row: FactorAssignment) => boolean): boolean => rows.some(predicate)
  const add = (row: FactorAssignment): void => {
    if (!has(existing => assignmentKey(existing) === assignmentKey(row))) rows.push(row)
  }

  let ordinal = 0
  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    for (const backend of ['default', 'hybrid', 'rough'] as const) {
      for (const complexity of COMPLEXITY_STRATA) {
        if (has(row => row.family === family && backendClassForLook(row.look!) === backend && row.complexity === complexity)) continue
        add({
          family, look: looksByBackend.get(backend)!, complexity,
          palette: registeredPalettes()[ordinal % registeredPalettes().length]!,
          background: BACKGROUND_POLARITIES[ordinal % BACKGROUND_POLARITIES.length]!,
          security: SECURITY_MODES[ordinal % SECURITY_MODES.length]!,
        })
        ordinal++
      }
    }
  }

  const familiesBySignature = new Map<string, DiagramKind>()
  for (const { id } of BUILTIN_FAMILY_METADATA) {
    const signature = roleSignatureForFamily(id)
    if (!familiesBySignature.has(signature)) familiesBySignature.set(signature, id)
  }
  for (const [signature, family] of [...familiesBySignature].sort(([a], [b]) => compareCodePointStrings(a, b))) {
    for (const backend of ['default', 'hybrid', 'rough'] as const) {
      for (const polarity of ['dark', 'light'] as const) {
        if (has(row => roleSignatureForFamily(row.family as DiagramKind) === signature
          && backendClassForLook(row.look!) === backend && palettePolarity(row.palette!) === polarity)) continue
        add({
          family, look: looksByBackend.get(backend)!, palette: palettesByPolarity.get(polarity)!,
          complexity: COMPLEXITY_STRATA[ordinal % COMPLEXITY_STRATA.length]!,
          background: BACKGROUND_POLARITIES[ordinal % BACKGROUND_POLARITIES.length]!,
          security: SECURITY_MODES[ordinal % SECURITY_MODES.length]!,
        })
        ordinal++
      }
    }
  }

  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    for (const witness of CONTACT_SHEET_WITNESSES) {
      if (has(row => row.family === family && backendClassForLook(row.look!) === witness.backend
        && palettePolarity(row.palette!) === witness.palettePolarity && row.background === witness.background)) continue
      add({
        family,
        look: looksByBackend.get(witness.backend)!,
        palette: palettesByPolarity.get(witness.palettePolarity)!,
        complexity: family.length % 2 === 0 ? 'representative' : 'family-risk',
        background: witness.background,
        security: SECURITY_MODES[ordinal % SECURITY_MODES.length]!,
      })
      ordinal++
    }
  }

  return rows
}

function backgroundOptions(background: BackgroundPolarity): Pick<RenderOptions, 'bg' | 'transparent'> {
  switch (background) {
    case 'opaque-dark': return { bg: '#111827', transparent: false }
    case 'opaque-light': return { bg: '#ffffff', transparent: false }
    case 'transparent': return { transparent: true }
  }
}

let cachedCorePlan: CoreConformanceRow[] | undefined

export function buildRenderConformancePlan(): CoreConformanceRow[] {
  if (cachedCorePlan) return cachedCorePlan
  const assignments = ensureDerivedRows(buildPairwiseAssignments(coreDomains(), baseTripleSeeds()))
  const rows: Omit<CoreConformanceRow, 'id'>[] = assignments.map(assignment => {
    const family = assignment.family as DiagramKind
    const complexity = assignment.complexity as ComplexityStratum
    const conformance = conformanceSourceFor(family, complexity)
    const look = assignment.look!, palette = assignment.palette!
    resolveStyleStack([look, palette]) // fail eagerly if registry composition is invalid
    return {
      family, look, palette, complexity,
      security: assignment.security as SecurityMode,
      background: assignment.background as BackgroundPolarity,
      backend: backendClassForLook(look),
      palettePolarity: palettePolarity(palette),
      roleSignature: roleSignatureForFamily(family),
      externalReference: 'none',
      sourceId: conformance.id,
      source: conformance.source,
      options: {
        ...conformance.options,
        ...backgroundOptions(assignment.background as BackgroundPolarity),
        style: [look, palette], seed: 19,
        security: assignment.security as SecurityMode,
        embedFontImport: false,
      },
    }
  })

  let externalOrdinal = 0
  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    const source = FAMILY_CONFORMANCE_PROFILES[family].externalReferenceSource
    if (!source) continue
    for (const security of SECURITY_MODES) {
      const look = registeredLooks()[externalOrdinal % registeredLooks().length]!
      const palette = registeredPalettes()[externalOrdinal % registeredPalettes().length]!
      rows.push({
        family, look, palette, security,
        background: 'opaque-light', complexity: 'family-risk',
        backend: backendClassForLook(look), palettePolarity: palettePolarity(palette),
        roleSignature: roleSignatureForFamily(family), externalReference: 'authored',
        sourceId: `${family}:external-reference`, source,
        options: { style: [look, palette], seed: 19, security, embedFontImport: false, bg: '#ffffff' },
      })
      externalOrdinal++
    }
  }

  cachedCorePlan = rows
    .sort((a, b) => compareCodePointStrings(
      [a.family, a.look, a.palette, a.security, a.background, a.complexity, a.externalReference].join('|'),
      [b.family, b.look, b.palette, b.security, b.background, b.complexity, b.externalReference].join('|'),
    ))
    .map((row, index) => Object.freeze({ id: `core-${String(index + 1).padStart(4, '0')}`, ...row }))
  return cachedCorePlan
}

export type ContactSheetKind = 'change' | 'citizenship' | 'interaction' | 'outlier'

function selectDiverseRows(rows: readonly CoreConformanceRow[], limit: number): CoreConformanceRow[] {
  const remaining = [...rows]
  const selected: CoreConformanceRow[] = []
  const covered = new Set<string>()
  const features = (row: CoreConformanceRow): string[] => [
    `family=${row.family}`, `look=${row.look}`, `palette=${row.palette}`, `backend=${row.backend}`,
    `background=${row.background}`, `complexity=${row.complexity}`, `security=${row.security}`,
    `family=${row.family}|backend=${row.backend}`, `look=${row.look}|palette=${row.palette}`,
    `backend=${row.backend}|complexity=${row.complexity}`,
  ]
  while (selected.length < limit && remaining.length > 0) {
    const best = remaining
      .map(row => ({ row, gain: features(row).filter(feature => !covered.has(feature)).length }))
      .sort((a, b) => b.gain - a.gain || compareCodePointStrings(a.row.id, b.row.id))[0]!
    selected.push(best.row)
    for (const feature of features(best.row)) covered.add(feature)
    remaining.splice(remaining.findIndex(row => row.id === best.row.id), 1)
  }
  return selected
}

export function buildContactSheetPlan(
  kind: ContactSheetKind,
  changedRowIds: readonly string[] = [],
): CoreConformanceRow[] {
  const rows = buildRenderConformancePlan().filter(row => row.externalReference === 'none')
  if (kind === 'interaction') return selectDiverseRows(rows, 120)
  if (kind === 'outlier') {
    return BUILTIN_FAMILY_METADATA.flatMap(({ id }) => {
      const candidates = rows.filter(row => row.family === id && row.complexity === 'corpus-outlier')
      return ['default', 'hybrid', 'rough'].flatMap(backend => {
        const backendRows = candidates.filter(row => row.backend === backend)
        const light = backendRows.find(row => row.palettePolarity === 'light')
        const dark = backendRows.find(row => row.palettePolarity === 'dark')
        return [light, dark].filter((row): row is CoreConformanceRow => row !== undefined)
      })
    }).slice(0, 120)
  }
  if (kind === 'change') {
    if (changedRowIds.length === 0) throw new Error('A change contact sheet requires at least one --row-id')
    const changed = changedRowIds.map(id => {
      const row = rows.find(candidate => candidate.id === id)
      if (!row) throw new Error(`Unknown conformance row ${id}`)
      return row
    })
    const controls = changed.flatMap(row => rows.filter(candidate => candidate.family === row.family
      && candidate.complexity === row.complexity && candidate.id !== row.id).slice(0, 2))
    return [...new Map([...changed, ...controls].map(row => [row.id, row])).values()].slice(0, 24)
  }

  return BUILTIN_FAMILY_METADATA.flatMap(({ id }, familyIndex) => CONTACT_SHEET_WITNESSES.map((target, targetIndex) => {
    const preferred = familyIndex % 2 === 0 ? 'representative' : 'family-risk'
    const candidates = rows.filter(row => row.family === id && row.backend === target.backend
      && row.palettePolarity === target.palettePolarity && row.background === target.background)
    return candidates.find(row => row.complexity === preferred)
      ?? candidates[targetIndex % candidates.length]
      ?? (() => { throw new Error(`No citizenship contact-sheet row for ${id} ${JSON.stringify(target)}`) })()
  }))
}

export interface MixedFormatConformanceRow {
  readonly id: string
  readonly family: DiagramKind
  readonly backend: BackendClass
  readonly look: string
  readonly format: ConformanceOutputFormat
  readonly complexity: ComplexityStratum
  readonly sourceId: string
  readonly source: string
  readonly options: RenderOptions
}

export function representativeLookByBackend(): Record<BackendClass, string> {
  const result = {} as Record<BackendClass, string>
  for (const look of registeredLooks()) {
    const backend = backendClassForLook(look)
    result[backend] ??= look
  }
  for (const backend of ['default', 'hybrid', 'rough'] as const) {
    if (!result[backend]) throw new Error(`No registered Look exercises backend ${backend}`)
  }
  return result
}

let cachedMixedFormatPlan: MixedFormatConformanceRow[] | undefined

export function buildMixedFormatConformancePlan(): MixedFormatConformanceRow[] {
  if (cachedMixedFormatPlan) return cachedMixedFormatPlan
  const domains: FactorDomains = {
    backend: ['default', 'hybrid', 'rough'],
    complexity: COMPLEXITY_STRATA,
    family: BUILTIN_FAMILY_METADATA.map(entry => entry.id),
    format: OUTPUT_FORMATS,
  }
  const assignments = buildPairwiseAssignments(domains)
  const hasText = (family: string, format: string): boolean => assignments.some(row =>
    row.family === family && row.format === format && row.complexity === 'text-stress')
  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    for (const format of OUTPUT_FORMATS) {
      if (!hasText(family, format)) assignments.push({
        family, format, complexity: 'text-stress',
        backend: ['default', 'hybrid', 'rough'][(assignments.length + format.length) % 3]!,
      })
    }
  }
  const looks = representativeLookByBackend()
  const unique = new Map<string, FactorAssignment>()
  for (const row of assignments) unique.set(factorTuple(row, ['backend', 'complexity', 'family', 'format']), row)
  cachedMixedFormatPlan = [...unique.values()]
    .sort((a, b) => compareCodePointStrings(factorTuple(a, Object.keys(domains).sort()), factorTuple(b, Object.keys(domains).sort())))
    .map((assignment, index) => {
      const family = assignment.family as DiagramKind
      const complexity = assignment.complexity as ComplexityStratum
      const source = conformanceSourceFor(family, complexity)
      const backend = assignment.backend as BackendClass
      return Object.freeze({
        id: `mixed-${String(index + 1).padStart(3, '0')}`,
        family, backend, look: looks[backend], format: assignment.format as ConformanceOutputFormat,
        complexity, sourceId: source.id, source: source.source,
        options: { ...source.options, style: looks[backend], seed: 23, security: 'strict' as const, embedFontImport: false },
      })
    })
  return cachedMixedFormatPlan!
}
