// Hand-written copies of a registry fall behind: someone adds a family, a tool,
// or a warning code, and the lists that named every member now name all but
// some. This check reads every maintained doc as paragraphs, list item runs,
// tables, and code blocks, and holds each one to two rules:
//
// - Complete lists declare themselves. A unit that names every member of a
//   registry is either generated (scripts/docs/doc-blocks.ts) or marked
//   `<!-- complete: <registry id> -->`, inside the unit or alone on the line
//   directly above it. A marked unit must name every member, so a list that
//   falls any number of members behind fails.
// - An unmarked unit that names nearly all of a registry (n−k of n members,
//   1 ≤ k ≤ n/6) is almost certainly a copy that fell behind.
//
// Fix a finding with a generated block, a marker, a pointer to the registry,
// or the missing name. A file whose header says "Do not edit by hand" is
// generated as a whole and is not checked.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DOC_BLOCKS } from '../../scripts/docs/doc-blocks.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { WARNING_TIER, type WarningTier } from '../agent/types.ts'
import { COMMAND_FLAGS } from '../cli/index.ts'
import { HOSTED_MCP_TOOL_NAMES, LOCAL_MCP_TOOL_NAMES } from '../mcp/tool-names.ts'
import { CLI_RENDER_FORMATS } from '../render-contract.ts'
import { handMaintainedText, maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

/** `bareInCode`: a code block names members without backticks. */
interface Registry { id: string; name: string; members: { id: string; aliases: string[] }[]; bareInCode?: boolean }

const ticked = (name: string): string => `\`${name}\``
const warningsIn = (tier?: WarningTier): Registry['members'] =>
  Object.entries(WARNING_TIER)
    .filter(([, codeTier]) => tier === undefined || codeTier === tier)
    .map(([code]) => ({ id: code, aliases: [code] }))
/** Prose names a tool as `name` or `name(…)`. */
const tools = (names: readonly string[]): Registry['members'] => names.map(name => ({ id: name, aliases: [ticked(name), `\`${name}(`] }))

/** A registry's id is the doc-block id that generates its list, where one exists. */
const REGISTRIES: Registry[] = [
  {
    id: 'family-ids',
    name: 'families',
    members: BUILTIN_FAMILY_METADATA.map(family => ({
      id: family.id,
      aliases: [family.id, family.label, `${family.label}s`, family.narrower, ...family.headers],
    })),
  },
  { id: 'hosted-mcp-tools', name: 'hosted MCP tools', members: tools(HOSTED_MCP_TOOL_NAMES), bareInCode: true },
  { id: 'local-mcp-tools', name: 'local MCP tools', members: tools(LOCAL_MCP_TOOL_NAMES), bareInCode: true },
  { id: 'cli-verbs', name: 'CLI verbs', members: Object.keys(COMMAND_FLAGS).map(verb => ({ id: verb, aliases: [ticked(verb), `am ${verb}`] })) },
  { id: 'render-formats', name: 'render formats', members: CLI_RENDER_FORMATS.map(format => ({ id: format, aliases: [ticked(format), `--format ${format}`, `--format=${format}`] })) },
  { id: 'warning-codes', name: 'warning codes', members: warningsIn() },
  { id: 'warning-codes:structural', name: 'structural warning codes', members: warningsIn('structural') },
  { id: 'warning-codes:geometric', name: 'geometric warning codes', members: warningsIn('geometric') },
  { id: 'warning-codes:lint', name: 'lint warning codes', members: warningsIn('lint') },
]

const FENCE = '```'
const LIST_ITEM = /^\s*(?:[-*]|\d+\.)\s/
const MARKER = /<!-- complete: ([\w:-]+) -->/g
const MARKER_LINE = /^\s*<!-- complete: [\w:-]+ -->\s*$/
const GENERATED_FILE = /\bDo not edit by hand\b/i

/** `marks`: the registry ids of the unit's markers; a code block's come from the lines above its fence. */
interface Unit { line: number; body: string; code: boolean; marks: string[] }

/** Paragraphs, list runs, tables, and code blocks, each with its first line number. */
function markdownUnits(text: string): Unit[] {
  const lines = text.split('\n')
  const units: Unit[] = []
  const take = (start: number, end: number, markEnd = end): void => {
    const marks = Array.from(lines.slice(start, markEnd).join('\n').matchAll(MARKER), match => match[1]!)
    units.push({ line: start + 1, body: lines.slice(start, end).join('\n'), code: markEnd !== end, marks })
  }
  let index = 0
  while (index < lines.length) {
    const start = index
    // A marker alone on its line belongs to the unit directly below it.
    while (MARKER_LINE.test(lines[index]!) && /^\s*[^\s#]/.test(lines[index + 1] ?? '')) index++
    const line = lines[index]!
    if (line.trimStart().startsWith(FENCE)) {
      const fence = index++
      while (index < lines.length && !lines[index]!.trimStart().startsWith(FENCE)) index++
      take(start, ++index, fence)
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
        text.trim() !== '' && !text.startsWith('#') && !text.trimStart().startsWith(FENCE) && !text.trimStart().startsWith('|') && !LIST_ITEM.test(text)
      while (index < lines.length && paragraphLine(lines[index]!)) index++
      take(start, index)
    }
  }
  return units
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const patterns = new Map<string, RegExp>()
function aliasPattern(alias: string): RegExp {
  const word = (char: string): boolean => /[\w-]/.test(char)
  if (!patterns.has(alias)) {
    const source = `${word(alias[0]!) ? '(?<![\\w-])' : ''}${escapeRegExp(alias)}${word(alias.at(-1)!) ? '(?![\\w-])' : ''}`
    patterns.set(alias, new RegExp(source, /^[a-z]/.test(alias) ? 'i' : ''))
  }
  return patterns.get(alias)!
}

const covers = (outer: Registry, inner: Registry): boolean => inner.members.every(member => outer.members.some(other => other.id === member.id))

/** Every unit in the doc that breaks a rule. */
export function registryListFindings(file: string, markdown: string, registries: readonly Registry[] = REGISTRIES): string[] {
  if (GENERATED_FILE.test(markdown.split('\n', 6).join('\n'))) return []
  const findings: string[] = []
  for (const unit of markdownUnits(handMaintainedText(markdown))) {
    const where = `${file}:${unit.line}`
    const { marks: marked } = unit
    const text = unit.body.replace(MARKER, '')
    const missing = new Map(registries.map(registry => [registry, registry.members.filter(member =>
      ![...member.aliases, ...(unit.code && registry.bareInCode ? [member.id] : [])].some(alias => aliasPattern(alias).test(text)),
    ).map(member => member.id)]))
    for (const id of marked) {
      const registry = registries.find(candidate => candidate.id === id)
      if (!registry) findings.push(`${where} is marked complete: ${id}, which is not a registry`)
      else if (missing.get(registry)!.length > 0) findings.push(`${where} is marked complete: ${id} but misses ${missing.get(registry)!.join(', ')}`)
    }
    const complete = registries.filter(registry => missing.get(registry)!.length === 0)
    for (const registry of registries) {
      const gap = missing.get(registry)!
      const total = registry.members.length
      if (marked.includes(registry.id)) continue
      if (gap.length === 0) {
        // A list of every warning code also names every structural code; a marked or larger complete registry speaks for it.
        const subsumed = registries.some(other => other !== registry && covers(other, registry) &&
          (marked.includes(other.id) || (complete.includes(other) && other.members.length > total)))
        if (!subsumed) findings.push(`${where} names all ${total} ${registry.name} but is neither generated nor marked <!-- complete: ${registry.id} -->`)
      } else if (gap.length <= Math.floor(total / 6)) {
        findings.push(`${where} names ${total - gap.length} of ${total} ${registry.name}; missing ${gap.join(', ')}`)
      }
    }
  }
  return findings
}

/**
 * Findings that are not a stale copy to fix, keyed by the finding with its line
 * number removed: deliberate subsets, status notes that happen to name every
 * member, and lists another test pins. An entry that stops matching fails too.
 */
const NOT_A_COPY: Readonly<Record<string, string>> = {
  'docs/computational-aesthetics-prototype-plan.md names 14 of 16 families; missing sequence, sankey':
    'scope bullets name families for unrelated reasons; no bullet is a roster',
  'eval/section-b-brand-evidence/production-comparison.md names 15 of 16 families; missing sankey':
    'a dated manual-review record of the families audited before Sankey shipped',
  'TODO.md names all 16 families but is neither generated nor marked <!-- complete: family-ids -->':
    'CONS-26 reports grammar convergence family by family; a new family starts converged, as Sankey did, so it is a status note, not a roster',
  'website/source/start.md names all 9 hosted MCP tools but is neither generated nor marked <!-- complete: hosted-mcp-tools -->':
    'hand-written by policy (the agent-usage evals measure its wording); agent-doc-sync pins its Tools: sentence to the server',
}

describe('hand-written registry lists', () => {
  test('every complete list in a maintained doc is generated or marked, and none is nearly complete', () => {
    const findings = maintainedMarkdownFiles().flatMap(file => registryListFindings(file, readFileSync(join(REPO_ROOT, file), 'utf8')))
    const key = (finding: string): string => finding.replace(/:\d+ /, ' ')
    expect(findings.filter(finding => !(key(finding) in NOT_A_COPY))).toEqual([])
    expect(Object.keys(NOT_A_COPY).filter(entry => !findings.some(finding => key(finding) === entry))).toEqual([])
  })

  test('flags a list one member short and an unmarked complete list; passes marked lists, subsets, and generated text', () => {
    const families = BUILTIN_FAMILY_METADATA.map(family => family.id)
    const list = (ids: readonly string[]): string => ids.map(ticked).join(', ')
    const findings = (markdown: string): string[] => registryListFindings('doc.md', markdown)
    expect(findings(`Families: ${list(families.slice(0, -1))}.`)).toEqual([
      `doc.md:1 names ${families.length - 1} of ${families.length} families; missing ${families.at(-1)}`,
    ])
    expect(findings(`Families: ${list(families)}.`)).toEqual([
      `doc.md:1 names all ${families.length} families but is neither generated nor marked <!-- complete: family-ids -->`,
    ])
    expect(findings(`Families: ${list(families)}. <!-- complete: family-ids -->`)).toEqual([])
    expect(findings(`Intro.\n\n<!-- complete: family-ids -->\n${families.map(id => `- ${id}`).join('\n')}`)).toEqual([])
    expect(findings(`Some families: ${list(families.slice(0, 5))}.`)).toEqual([])
    expect(findings(`Families: <!-- BEGIN GENERATED: family-ids -->${list(families.slice(0, -1))}<!-- END GENERATED: family-ids -->.`)).toEqual([])
    expect(findings(`> Generated by a script. Do not edit by hand.\n\nFamilies: ${list(families)}.`)).toEqual([])
  })

  test('a marked list must name every member, however many are missing', () => {
    const families = BUILTIN_FAMILY_METADATA.map(family => family.id)
    const findings = (markdown: string): string[] => registryListFindings('doc.md', markdown)
    expect(findings(`<!-- complete: family-ids -->\nFamilies: ${families.slice(3).map(ticked).join(', ')}.`)).toEqual([
      `doc.md:1 is marked complete: family-ids but misses ${families.slice(0, 3).join(', ')}`,
    ])
    expect(findings('<!-- complete: family-ids -->\n\nA marker above a blank line marks nothing.')[0]).toStartWith('doc.md:1 is marked complete: family-ids but misses ')
    expect(findings('Tools: `execute`. <!-- complete: mcp-tools -->')).toEqual(['doc.md:1 is marked complete: mcp-tools, which is not a registry'])
  })

  test('a marker for a registry covers the registries inside it; code blocks name tools bare', () => {
    const findings = (markdown: string): string[] => registryListFindings('doc.md', markdown)
    const hosted = HOSTED_MCP_TOOL_NAMES.map(ticked).join(', ')
    expect(findings(`Hosted tools: ${hosted}.`)).toEqual([
      `doc.md:1 names all ${HOSTED_MCP_TOOL_NAMES.length} hosted MCP tools but is neither generated nor marked <!-- complete: hosted-mcp-tools -->`,
    ])
    expect(findings(`Hosted tools: ${hosted}. <!-- complete: hosted-mcp-tools -->`)).toEqual([])
    const withoutEdits = HOSTED_MCP_TOOL_NAMES.filter(name => name !== 'mutate' && name !== 'build').map(ticked).join(', ')
    expect(findings(`Hosted tools: ${withoutEdits}. <!-- complete: hosted-mcp-tools -->`)).toEqual(['doc.md:1 is marked complete: hosted-mcp-tools but misses mutate, build'])
    const stale = HOSTED_MCP_TOOL_NAMES.filter(name => name !== 'describe_sdk').join(', ')
    expect(findings(`\`\`\`text\ntools: ${stale}\n\`\`\``)).toEqual([
      `doc.md:1 names ${HOSTED_MCP_TOOL_NAMES.length - 1} of ${HOSTED_MCP_TOOL_NAMES.length} hosted MCP tools; missing describe_sdk`,
    ])
  })

  test('each registry that shares an id with a doc block is exactly what that block prints', () => {
    for (const registry of REGISTRIES.filter(candidate => candidate.id in DOC_BLOCKS)) {
      const block = DOC_BLOCKS[registry.id]!()
      expect({ registry: registry.id, findings: registryListFindings('doc.md', `${block} <!-- complete: ${registry.id} -->`) }).toEqual({ registry: registry.id, findings: [] })
    }
    expect(REGISTRIES.filter(registry => registry.id in DOC_BLOCKS).length).toBeGreaterThanOrEqual(7)
  })
})
