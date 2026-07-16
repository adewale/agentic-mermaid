// Deterministic coverage oracle.
//
// A model that discovered Agentic Mermaid from the homepage URL returns a
// `CoverageManifest`: the interface it used, one Mermaid instance per diagram
// family, and a render probe for each Style and Palette it exercised. The oracle
// re-derives every claim against the shipped SDK — it never trusts the model's
// word. A family only counts when its source parses, verifies, AND narrows
// structured (an opaque body renders but is not editable); a Style/Palette only
// counts when the oracle can itself render it into a self-contained SVG.

import {
  parseRegisteredMermaid,
  verifyMermaid,
  renderMermaidSVG,
  verifyNoExternalRefs,
} from '../../src/agent/index.ts'
import { coverageRoster, narrowerFor, type CoverageRoster } from './roster.ts'

/** The agent-facing interfaces the homepage bootstrap (`start.md`) advertises. */
export const AGENT_INTERFACES = ['sdk', 'cli', 'mcp'] as const
export type AgentInterface = (typeof AGENT_INTERFACES)[number]

/** One Style/Palette probe: a source the oracle re-renders under the named look. */
export interface StyleProbe {
  readonly source: string
  readonly family?: string
}

/** What a model under test returns after discovering the tool from the URL. */
export interface CoverageManifest {
  /** Which agentic interface the model used: sdk | cli | mcp. */
  readonly interface: string
  /** familyId → a Mermaid source instance of that family. */
  readonly families: Readonly<Record<string, string>>
  /** styleName → a render probe exercising that look. */
  readonly styles: Readonly<Record<string, StyleProbe>>
  /** paletteName → a render probe exercising that palette. */
  readonly palettes: Readonly<Record<string, StyleProbe>>
}

export interface ItemVerdict {
  readonly id: string
  readonly ok: boolean
  readonly reason?: string
}

export interface CoverageReport {
  readonly ok: boolean
  readonly interface: string
  readonly interfaceOk: boolean
  readonly families: readonly ItemVerdict[]
  readonly styles: readonly ItemVerdict[]
  readonly palettes: readonly ItemVerdict[]
  /** Roster entries the manifest failed to cover, for a fast at-a-glance diff. */
  readonly missing: {
    readonly families: readonly string[]
    readonly styles: readonly string[]
    readonly palettes: readonly string[]
  }
}

function pass(id: string): ItemVerdict {
  return { id, ok: true }
}
function fail(id: string, reason: string): ItemVerdict {
  return { id, ok: false, reason }
}

/** Grade one family instance: parse → verify → narrow structured → right kind. */
function gradeFamily(target: CoverageRoster['families'][number], source: string | undefined): ItemVerdict {
  if (typeof source !== 'string' || source.trim() === '') return fail(target.id, 'no source provided')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) return fail(target.id, `parse failed: ${parsed.error.map(e => e.code).join(',')}`)
  const diagram = parsed.value
  if (diagram.kind !== target.id) return fail(target.id, `wrong family: got ${diagram.kind}`)
  const verify = verifyMermaid(diagram)
  if (!verify.ok) return fail(target.id, `verify failed: ${verify.warnings.map(w => w.code).join(',') || 'not ok'}`)
  const narrowed = narrowerFor(target)(diagram)
  if (!narrowed) return fail(target.id, `opaque: ${target.narrower} returned null (not structured)`)
  return pass(target.id)
}

/** Grade one Style/Palette probe: the oracle must itself render it self-contained. */
function gradeLook(name: string, probe: StyleProbe | undefined): ItemVerdict {
  if (!probe || typeof probe.source !== 'string' || probe.source.trim() === '') return fail(name, 'no probe provided')
  const parsed = parseRegisteredMermaid(probe.source)
  if (!parsed.ok) return fail(name, `probe source parse failed: ${parsed.error.map(e => e.code).join(',')}`)
  let svg: string
  try {
    svg = renderMermaidSVG(probe.source, { style: name })
  } catch (e) {
    return fail(name, `render threw: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (!svg.includes('<svg')) return fail(name, 'render produced no <svg> root')
  const refs = verifyNoExternalRefs(svg)
  if (!refs.ok) return fail(name, `external refs: ${refs.refs.join(',')}`)
  return pass(name)
}

/**
 * Grade a coverage manifest against the live roster. Deterministic and
 * offline: identical manifest + roster always yields the identical report.
 */
export function gradeCoverage(manifest: CoverageManifest, roster: CoverageRoster = coverageRoster()): CoverageReport {
  const interfaceKey = String(manifest.interface ?? '').trim().toLowerCase()
  const interfaceOk = (AGENT_INTERFACES as readonly string[]).includes(interfaceKey)

  const families = roster.families.map(target => gradeFamily(target, manifest.families?.[target.id]))
  const styles = roster.styles.map(name => gradeLook(name, manifest.styles?.[name]))
  const palettes = roster.palettes.map(name => gradeLook(name, manifest.palettes?.[name]))

  const missing = {
    families: families.filter(v => !v.ok).map(v => v.id),
    styles: styles.filter(v => !v.ok).map(v => v.id),
    palettes: palettes.filter(v => !v.ok).map(v => v.id),
  }
  const ok = interfaceOk
    && families.every(v => v.ok)
    && styles.every(v => v.ok)
    && palettes.every(v => v.ok)

  return { ok, interface: interfaceKey, interfaceOk, families, styles, palettes, missing }
}
