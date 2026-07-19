import { BUILTIN_FAMILY_METADATA, getFamily } from '../../agent/families.ts'
import type { DiagramKind } from '../../agent/types.ts'
import { compareCodePointStrings } from '../../shared/deterministic-order.ts'
import { getStyle, inferBackend, knownStyleDescriptors } from '../../scene/style-registry.ts'
import {
  BACKGROUND_POLARITIES,
  CONTACT_SHEET_WITNESSES,
  OUTPUT_FORMATS,
  SECURITY_MODES,
  type CoreConformanceRow,
  type FactorAssignment,
  type FactorDomains,
  type MixedFormatConformanceRow,
} from './render-conformance-plan.ts'
import { COMPLEXITY_STRATA, FAMILY_CONFORMANCE_PROFILES } from './family-conformance-profiles.ts'

const registeredLooks = (): string[] => knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'look' && !descriptor.isDefault)
  .map(descriptor => descriptor.inputName)
  .sort(compareCodePointStrings)
const registeredPalettes = (): string[] => knownStyleDescriptors()
  .filter(descriptor => descriptor.kind === 'palette')
  .map(descriptor => descriptor.inputName)
  .sort(compareCodePointStrings)
const backendClassForLook = (look: string): 'default' | 'hybrid' | 'rough' => {
  const style = getStyle(look)
  if (!style) throw new Error(`Verifier cannot resolve Look ${look}`)
  return inferBackend(style)
}
const palettePolarity = (palette: string): 'dark' | 'light' => {
  const value = getStyle(palette)?.colors?.bg
  const match = value && /^#([0-9a-f]{6})$/iu.exec(value)
  if (!match) throw new Error(`Verifier requires a concrete six-digit palette background: ${palette}`)
  const channels = [0, 2, 4].map(index => Number.parseInt(match[1]!.slice(index, index + 2), 16) / 255)
  const luminance = channels.reduce((sum, channel, index) => sum
    + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      * [0.2126, 0.7152, 0.0722][index]!, 0)
  return luminance < 0.35 ? 'dark' : 'light'
}
const roleSignatureForFamily = (family: DiagramKind): string => {
  const descriptor = getFamily(family)
  if (!descriptor) throw new Error(`Verifier cannot resolve family ${family}`)
  return [...descriptor.semanticRoles].sort(compareCodePointStrings).join('+') || 'role-free'
}

export interface CoverageVerification {
  readonly required: number
  readonly covered: number
  readonly missing: readonly string[]
}

function pairId(a: string, av: string, b: string, bv: string): string {
  return compareCodePointStrings(a, b) < 0 ? `pair:${a}=${av}|${b}=${bv}` : `pair:${b}=${bv}|${a}=${av}`
}

/** Independent tuple enumerator: it does not call the planner's uncovered-set implementation. */
export function verifyPairwiseAssignments(domains: FactorDomains, rows: readonly FactorAssignment[]): CoverageVerification {
  const factors = Object.keys(domains).sort(compareCodePointStrings)
  const missing: string[] = []
  let required = 0
  for (let i = 0; i < factors.length; i++) {
    for (let j = i + 1; j < factors.length; j++) {
      const a = factors[i]!, b = factors[j]!
      for (const av of domains[a]!) {
        for (const bv of domains[b]!) {
          required++
          if (!rows.some(row => row[a] === av && row[b] === bv)) missing.push(pairId(a, av, b, bv))
        }
      }
    }
  }
  return { required, covered: required - missing.length, missing: missing.sort(compareCodePointStrings) }
}

export function verifyCoreConformancePlan(rows: readonly CoreConformanceRow[]): CoverageVerification {
  const required = new Set<string>()
  const covered = new Set<string>()
  const domains: FactorDomains = {
    background: BACKGROUND_POLARITIES,
    complexity: COMPLEXITY_STRATA,
    family: BUILTIN_FAMILY_METADATA.map(entry => entry.id),
    look: registeredLooks(),
    palette: registeredPalettes(),
    security: SECURITY_MODES,
  }
  const assignments = rows.filter(row => row.externalReference === 'none').map(row => ({
    background: row.background, complexity: row.complexity, family: row.family,
    look: row.look, palette: row.palette, security: row.security,
  }))
  const pairwise = verifyPairwiseAssignments(domains, assignments)
  for (const id of pairwise.missing) required.add(id)
  // Count covered pair obligations independently as synthetic IDs so the final
  // totals remain meaningful without sharing planner internals.
  const allPairs = pairwise.required

  for (const look of registeredLooks()) for (const palette of registeredPalettes()) for (const background of BACKGROUND_POLARITIES) {
    const id = `triple:look=${look}|palette=${palette}|background=${background}`
    required.add(id)
    if (rows.some(row => row.look === look && row.palette === palette && row.background === background)) covered.add(id)
  }
  for (const { id: family } of BUILTIN_FAMILY_METADATA) for (const backend of ['default', 'hybrid', 'rough'] as const) for (const complexity of COMPLEXITY_STRATA) {
    const id = `triple:family=${family}|backend=${backend}|complexity=${complexity}`
    required.add(id)
    if (rows.some(row => row.family === family && row.backend === backend && row.complexity === complexity)) covered.add(id)
  }
  const signatures = [...new Set(BUILTIN_FAMILY_METADATA.map(({ id }) => roleSignatureForFamily(id)))].sort(compareCodePointStrings)
  for (const signature of signatures) for (const backend of ['default', 'hybrid', 'rough'] as const) for (const polarity of ['dark', 'light'] as const) {
    const id = `triple:role-signature=${signature}|backend=${backend}|palette-polarity=${polarity}`
    required.add(id)
    if (rows.some(row => row.roleSignature === signature && row.backend === backend && row.palettePolarity === polarity)) covered.add(id)
  }
  for (const { id: family } of BUILTIN_FAMILY_METADATA) for (const witness of CONTACT_SHEET_WITNESSES) {
    const id = `contact:family=${family}|backend=${witness.backend}|palette-polarity=${witness.palettePolarity}|background=${witness.background}`
    required.add(id)
    if (rows.some(row => row.family === family && row.backend === witness.backend
      && row.palettePolarity === witness.palettePolarity && row.background === witness.background)) covered.add(id)
  }
  for (const { id: family } of BUILTIN_FAMILY_METADATA) {
    if (!FAMILY_CONFORMANCE_PROFILES[family].externalReferenceSource) continue
    for (const security of SECURITY_MODES) {
      const id = `triple:family=${family}|security=${security}|external-reference=authored`
      required.add(id)
      if (rows.some(row => row.family === family && row.security === security && row.externalReference === 'authored')) covered.add(id)
    }
  }

  const missing = [
    ...pairwise.missing,
    ...[...required].filter(id => (id.startsWith('triple:') || id.startsWith('contact:')) && !covered.has(id)),
  ].sort(compareCodePointStrings)
  const total = allPairs + [...required].filter(id => id.startsWith('triple:') || id.startsWith('contact:')).length
  return { required: total, covered: total - missing.length, missing }
}

export function verifyMixedFormatConformancePlan(rows: readonly MixedFormatConformanceRow[]): CoverageVerification {
  const domains: FactorDomains = {
    backend: ['default', 'hybrid', 'rough'],
    complexity: COMPLEXITY_STRATA,
    family: BUILTIN_FAMILY_METADATA.map(entry => entry.id),
    format: OUTPUT_FORMATS,
  }
  const pairwise = verifyPairwiseAssignments(domains, rows.map(row => ({
    backend: row.backend, complexity: row.complexity, family: row.family, format: row.format,
  })))
  const missing = [...pairwise.missing]
  let textRequirements = 0
  for (const { id: family } of BUILTIN_FAMILY_METADATA) for (const format of OUTPUT_FORMATS) {
    textRequirements++
    if (!rows.some(row => row.family === family && row.format === format && row.complexity === 'text-stress')) {
      missing.push(`triple:family=${family}|format=${format}|complexity=text-stress`)
    }
  }
  return {
    required: pairwise.required + textRequirements,
    covered: pairwise.required + textRequirements - missing.length,
    missing: missing.sort(compareCodePointStrings),
  }
}

export function independentlyDerivedCoreAuthorities(): {
  looks: string[]; palettes: string[]; backends: string[]; palettePolarities: string[]
} {
  return {
    looks: registeredLooks(),
    palettes: registeredPalettes(),
    backends: [...new Set(registeredLooks().map(backendClassForLook))].sort(compareCodePointStrings),
    palettePolarities: [...new Set(registeredPalettes().map(palettePolarity))].sort(compareCodePointStrings),
  }
}
