// Reference "ideal agent" — the deterministic full-coverage manifest.
//
// This is what a model that correctly discovered the SDK and read the discovery
// envelope would return: one canonical instance per family (each family's own
// shipped `example`) plus a render probe for every Style and Palette. It proves
// the capability surface is fully coverable and gives CI a deterministic green
// baseline. It is NOT a stand-in for a live model result — live Haiku / GPT-5
// transcripts are captured separately (see live.ts / README).

import { coverageRoster, type CoverageRoster } from './roster.ts'
import type { CoverageManifest, StyleProbe } from './oracle.ts'

/** A universally renderable probe source (the flowchart family's own example). */
function probeSource(roster: CoverageRoster): string {
  const flowchart = roster.families.find(f => f.id === 'flowchart') ?? roster.families[0]
  if (!flowchart) throw new Error('coverage roster has no families')
  return flowchart.example
}

/** Build the deterministic reference manifest from the live roster. */
export function referenceCoverageManifest(roster: CoverageRoster = coverageRoster()): CoverageManifest {
  const source = probeSource(roster)
  const families: Record<string, string> = {}
  for (const family of roster.families) families[family.id] = family.example
  const styles: Record<string, StyleProbe> = {}
  for (const name of roster.styles) styles[name] = { source, family: 'flowchart' }
  const palettes: Record<string, StyleProbe> = {}
  for (const name of roster.palettes) palettes[name] = { source, family: 'flowchart' }
  return { interface: 'sdk', families, styles, palettes }
}
