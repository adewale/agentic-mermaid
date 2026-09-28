// Hand-written copies of a registry fall behind: someone adds a family, a tool,
// or a warning code, and the lists that named every member now name all but one.
// This check finds those lists in every maintained doc. A paragraph, list item
// run, table, or code block that names nearly all of a registry (n−k of n
// members, 1 ≤ k ≤ n/8) is almost certainly a stale copy; a complete list and a
// deliberate subset both pass. Fix a finding with a generated block
// (scripts/docs/doc-blocks.ts), a pointer to the registry, or the missing name.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { WARNING_TIER, type WarningTier } from '../agent/types.ts'
import { COMMAND_FLAGS } from '../cli/index.ts'
import { HOSTED_TOOLS } from '../mcp/hosted-server.ts'
import { handMaintainedText, maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

interface Registry { name: string; members: { id: string; aliases: string[] }[] }

const ticked = (name: string): string => `\`${name}\``
const warningsIn = (tier?: WarningTier): Registry['members'] =>
  Object.entries(WARNING_TIER)
    .filter(([, codeTier]) => tier === undefined || codeTier === tier)
    .map(([code]) => ({ id: code, aliases: [code] }))

const REGISTRIES: Registry[] = [
  {
    name: 'families',
    members: BUILTIN_FAMILY_METADATA.map(family => ({
      id: family.id,
      aliases: [family.id, family.label, `${family.label}s`, family.narrower, ...family.headers],
    })),
  },
  { name: 'hosted MCP tools', members: HOSTED_TOOLS.map(tool => ({ id: tool.name, aliases: [ticked(tool.name)] })) },
  { name: 'CLI verbs', members: Object.keys(COMMAND_FLAGS).map(verb => ({ id: verb, aliases: [ticked(verb), `am ${verb}`] })) },
  { name: 'warning codes', members: warningsIn() },
  { name: 'structural warning codes', members: warningsIn('structural') },
  { name: 'geometric warning codes', members: warningsIn('geometric') },
  { name: 'lint warning codes', members: warningsIn('lint') },
]

const FENCE = '```'
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s/

/** Paragraphs, list runs, tables, and code blocks, each with its first line number. */
function markdownUnits(text: string): { line: number; body: string }[] {
  const lines = text.split('\n')
  const units: { line: number; body: string }[] = []
  const take = (start: number, end: number): void => { units.push({ line: start + 1, body: lines.slice(start, end).join('\n') }) }
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const start = index
    if (line.startsWith(FENCE)) {
      index++
      while (index < lines.length && !lines[index]!.startsWith(FENCE)) index++
      take(start, index++)
    } else if (line.trimStart().startsWith('|')) {
      while (index < lines.length && lines[index]!.trimStart().startsWith('|')) index++
      take(start, index)
    } else if (LIST_ITEM.test(line)) {
      while (index < lines.length && (LIST_ITEM.test(lines[index]!) || /^\s{2,}\S/.test(lines[index]!))) index++
      take(start, index)
    } else if (line.trim() === '' || line.startsWith('#')) {
      index++
    } else {
      const paragraphLine = (text: string): boolean =>
        text.trim() !== '' && !text.startsWith('#') && !text.startsWith(FENCE) && !text.trimStart().startsWith('|') && !LIST_ITEM.test(text)
      while (index < lines.length && paragraphLine(lines[index]!)) index++
      take(start, index)
    }
  }
  return units
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const aliasPattern = (alias: string): RegExp =>
  new RegExp(`(?<![\\w-])${escapeRegExp(alias)}(?![\\w-])`, /^[a-z]/.test(alias) ? 'i' : '')

/** Every unit in the doc that names all but a few members of a registry. */
export function nearCompleteLists(file: string, markdown: string, registries: readonly Registry[] = REGISTRIES): string[] {
  const findings: string[] = []
  for (const unit of markdownUnits(handMaintainedText(markdown))) {
    for (const registry of registries) {
      const allowedGap = Math.floor(registry.members.length / 6)
      const missing = registry.members.filter(member => !member.aliases.some(alias => aliasPattern(alias).test(unit.body)))
      if (missing.length >= 1 && missing.length <= allowedGap) {
        findings.push(`${file}:${unit.line} names ${registry.members.length - missing.length} of ${registry.members.length} ${registry.name}; missing ${missing.map(member => member.id).join(', ')}`)
      }
    }
  }
  return findings
}

/**
 * Units that name most of a registry without being a copy of it, keyed by the
 * finding with its line number removed. An entry that stops matching fails too.
 */
const NOT_A_COPY: Readonly<Record<string, string>> = {
  'docs/computational-aesthetics-prototype-plan.md names 14 of 16 families; missing sequence, sankey':
    'scope bullets name families for unrelated reasons; no bullet is a roster',
  'eval/section-b-brand-evidence/production-comparison.md names 15 of 16 families; missing sankey':
    'a dated manual-review record of the families audited before Sankey shipped',
  'skills/agentic-mermaid-diagram-workflow/references/flowchart.md names 7 of 8 structural warning codes; missing UNRESOLVABLE_SCHEDULE':
    'the Tier 1 codes a flowchart can raise; UNRESOLVABLE_SCHEDULE is Gantt-only',
}

describe('hand-written registry lists', () => {
  test('no maintained doc has a list that names nearly all of a registry', () => {
    const findings = maintainedMarkdownFiles().flatMap(file => nearCompleteLists(file, readFileSync(join(REPO_ROOT, file), 'utf8')))
    const key = (finding: string): string => finding.replace(/:\d+ names /, ' names ')
    expect(findings.filter(finding => !(key(finding) in NOT_A_COPY))).toEqual([])
    expect(Object.keys(NOT_A_COPY).filter(entry => !findings.some(finding => key(finding) === entry))).toEqual([])
  })

  test('flags a list one member short, and passes complete lists, subsets, and generated blocks', () => {
    const families = BUILTIN_FAMILY_METADATA.map(family => family.id)
    const list = (ids: readonly string[]): string => ids.map(ticked).join(', ')
    expect(nearCompleteLists('doc.md', `Families: ${list(families.slice(0, -1))}.`)).toEqual([
      `doc.md:1 names ${families.length - 1} of ${families.length} families; missing ${families.at(-1)}`,
    ])
    expect(nearCompleteLists('doc.md', `Families: ${list(families)}.`)).toEqual([])
    expect(nearCompleteLists('doc.md', `Some families: ${list(families.slice(0, 5))}.`)).toEqual([])
    expect(nearCompleteLists('doc.md', `Families: <!-- BEGIN GENERATED: family-ids -->${list(families.slice(0, -1))}<!-- END GENERATED: family-ids -->.`)).toEqual([])
  })
})
