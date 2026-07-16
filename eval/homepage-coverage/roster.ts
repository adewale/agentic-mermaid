// Coverage roster — the single source of truth for what a model must span when
// it discovers Agentic Mermaid from the homepage URL alone: every diagram
// family, every built-in Style (look), and every built-in Palette.
//
// Everything here is derived from the shipped SDK registries so the eval can
// never silently drift from the product. When a family, look, or palette is
// added, `coverageRoster()` grows automatically and the CI test forces the
// reference (and any live transcript) to cover the new entry.

import {
  BUILTIN_FAMILY_METADATA,
  knownStyleDescriptors,
  asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney,
  asArchitecture, asXyChart, asPie, asQuadrant, asGantt, asMindmap, asGitGraph, asRadar,
  type DiagramKind, type ParsedDiagram,
} from '../../src/agent/index.ts'

/** A parsed diagram narrowed to its typed body, or `null` when it fell to the
 *  opaque/source-level path (an opaque body renders but is not structured). */
export type Narrower = (d: ParsedDiagram) => unknown

// The `as*` helper each family advertises for structured narrowing. Keyed by the
// exact `narrower` string recorded on the family metadata so a new family that
// forgets to wire a narrower here fails loudly rather than grading as opaque.
const NARROWERS: Readonly<Record<string, Narrower>> = Object.freeze({
  asFlowchart, asState, asSequence, asTimeline, asClass, asEr, asJourney,
  asArchitecture, asXyChart, asPie, asQuadrant, asGantt, asMindmap, asGitGraph, asRadar,
})

export interface FamilyTarget {
  /** DiagramKind the model must produce a structured instance of. */
  readonly id: DiagramKind
  /** The `as*` narrower advertised for this family. */
  readonly narrower: string
  /** Canonical minimal source shipped in the discovery envelope. */
  readonly example: string
}

export interface CoverageRoster {
  readonly families: readonly FamilyTarget[]
  /** Built-in look Styles (hand-drawn, excalidraw, watercolor, …). */
  readonly styles: readonly string[]
  /** Built-in colour Palettes (nord, dracula, tokyo-night, …). */
  readonly palettes: readonly string[]
}

/** Resolve the `as*` narrower for a family target, or throw if it is unwired. */
export function narrowerFor(target: FamilyTarget): Narrower {
  const fn = NARROWERS[target.narrower]
  if (!fn) throw new Error(`No narrower wired for ${target.id} (${target.narrower})`)
  return fn
}

/** The current coverage roster, read live from the shipped registries. */
export function coverageRoster(): CoverageRoster {
  const families = BUILTIN_FAMILY_METADATA.map(family => ({
    id: family.id,
    narrower: family.narrower,
    example: family.example,
  }))
  const descriptors = knownStyleDescriptors()
  const styles = descriptors.filter(d => d.kind === 'look').map(d => d.inputName)
  const palettes = descriptors.filter(d => d.kind === 'palette').map(d => d.inputName)
  return Object.freeze({
    families: Object.freeze(families),
    styles: Object.freeze(styles),
    palettes: Object.freeze(palettes),
  })
}
