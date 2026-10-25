import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkMermaid, describeMermaidFacts, parseRegisteredMermaid, verifyMermaid } from '../../src/agent/index.ts'
import type { ParsedDiagram, RenderedLayout, VerifyResult } from '../../src/agent/types.ts'
import data from '../artifact-expectations.json'

interface Expectation {
  family: string
  directory: string
  requiredFacts: string[]
  preserveExcept: string[]
  forbiddenFacts: string[]
  renameFacts?: Record<string, string>
}
const expectations: Record<string, Expectation> = data.cases

function parse(source: string, family: string): ParsedDiagram {
  if (!source.trim()) throw new Error('source artifact is empty')
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) throw new Error(`source does not parse: ${parsed.error.map(error => error.message).join('; ')}`)
  if (parsed.value.kind !== family || parsed.value.body.kind !== family) throw new Error(`expected structured ${family}, got ${parsed.value.kind}/${parsed.value.body.kind}`)
  return parsed.value
}

/** Public semantic layout fields bind submitted verification to this saved
 * source. Public deterministic placement also detects a stale verification
 * after a coordinate-only edit; debug/timing/private evidence is excluded. */
function layoutMeaning(layout: RenderedLayout) {
  return {
    kind: layout.kind,
    nodes: layout.nodes.map(node => [node.id, node.label, node.x, node.y, node.w, node.h]),
    edges: layout.edges.map(edge => [edge.from, edge.to, edge.label ?? null]),
    groups: layout.groups.map(group => [group.id, group.label, group.parentId ?? null, group.members]),
  }
}
function verificationMeaning(verification: VerifyResult) {
  if (typeof verification.ok !== 'boolean' || !Array.isArray(verification.warnings)) throw new Error('verify.json must contain boolean ok and warnings[]')
  const codes = verification.warnings.map(warning => {
    if (typeof warning?.code !== 'string') throw new Error('every reported warning needs a code')
    return warning.code
  }).sort()
  return { ok: verification.ok, warningCodes: codes, layout: layoutMeaning(verification.layout) }
}

function preservedFacts(original: ParsedDiagram, expectation: Expectation): string[] {
  const exclusions = expectation.preserveExcept.map(pattern => new RegExp(pattern))
  return describeMermaidFacts(original).filter(fact => !exclusions.some(pattern => pattern.test(fact))).map(fact => {
    for (const [from, to] of Object.entries(expectation.renameFacts ?? {})) {
      // Rename only identities in these frozen fixtures, not display labels.
      fact = from.startsWith('"') ? fact.split(from).join(to) : fact.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
    }
    return fact
  })
}

function checkDomainEdit(actual: ParsedDiagram, original: ParsedDiagram): string[] {
  const body = actual.body, before = original.body
  if (body.kind === 'c4') {
    const audit = body.elements.find(element => element.id === 'audit')
    if (!audit || audit.kind !== 'system' || !audit.external || audit.label !== 'Audit service') return ['audit must be the requested external System']
    const expected = [['customer', 'shop', 'Orders', 'HTTPS'], ['shop', 'provider', 'Authorizes', 'HTTPS'], ['shop', 'provider', 'Checks status', 'HTTPS'], ['shop', 'audit', 'Records purchase', undefined]]
    const actual = body.relationships.map(relation => [relation.from, relation.to, relation.label, relation.technology])
    // Technology on the new interaction is optional; original HTTPS must survive.
    if (actual.length !== expected.length || expected.some((row, i) => row.some((value, j) => value !== undefined && actual[i]?.[j] !== value))) return ['the four distinct C4 interactions or original HTTPS technology changed']
  } else if (body.kind === 'gitgraph') {
    const selected = body.statements.filter(statement => statement.kind === 'branch' || statement.kind === 'checkout').at(-1)
    if (selected?.kind !== 'checkout' || selected.branch !== 'main') return ['GitGraph must return to main']
  } else if (body.kind === 'requirement' && before.kind === 'requirement') {
    const original = before.requirements.find(node => node.name === 'reliable')!
    const changed = body.requirements.find(node => node.name === 'reliable')
    if (!changed || changed.verifyMethod !== 'Analysis' || ['type', 'requirementId', 'text', 'risk'].some(key => changed[key as keyof typeof changed] !== original[key as keyof typeof original])) return ['reliable must retain its fields and use Analysis verification']
  } else if (body.kind === 'treemap') {
    const design = body.nodes.find(node => node.label === 'Design')
    const parent = body.nodes.find(node => node.id === design?.parentId)
    if (!design || design.value !== 50 || parent?.label !== 'Build') return ['Design must remain under Build with value 50']
  } else if (body.kind === 'ishikawa') {
    const cause = body.nodes.find(node => node.label === 'Cold caches')
    const parent = body.nodes.find(node => node.id === cause?.parentId)
    if (!cause || parent?.label !== 'Tooling') return ['Cold caches must be a cause under Tooling']
  }
  return []
}

/** Grade artifacts, never the model's claim that it ran a particular process. */
export function gradeDiagramArtifact(outputDir: string, caseId: string): { ok: boolean; problems: string[] } {
  try {
    const expectation = expectations[caseId]
    if (!expectation) throw new Error(`unknown artifact case ${caseId}`)
    const originalSource = readFileSync(join(import.meta.dir, '..', 'fixtures', expectation.directory, 'input.mmd'), 'utf8')
    const finalSource = readFileSync(resolve(outputDir, 'outputs', expectation.directory, 'final.mmd'), 'utf8')
    const reported = JSON.parse(readFileSync(resolve(outputDir, 'outputs', expectation.directory, 'verify.json'), 'utf8')) as VerifyResult
    const original = parse(originalSource, expectation.family)
    const actual = parse(finalSource, expectation.family)
    const semantic = checkMermaid(actual, {
      include: [...preservedFacts(original, expectation), ...expectation.requiredFacts],
      exclude: expectation.forbiddenFacts,
    })
    const problems = [...semantic.missing.map(fact => `missing fact: ${fact}`), ...semantic.unexpected.map(fact => `forbidden fact: ${fact}`), ...checkDomainEdit(actual, original)]
    if (JSON.stringify(describeMermaidFacts(actual)) === JSON.stringify(describeMermaidFacts(original))) problems.push('saved diagram is semantically unchanged')
    const fresh = verifyMermaid(finalSource)
    if (!fresh.ok) problems.push('saved diagram fails fresh verification')
    if (JSON.stringify(verificationMeaning(reported)) !== JSON.stringify(verificationMeaning(fresh))) problems.push('submitted verification decisions, warning codes or semantic layout do not match saved source')
    return { ok: problems.length === 0, problems }
  } catch (error) {
    return { ok: false, problems: [error instanceof Error ? error.message : String(error)] }
  }
}

if (import.meta.main) {
  // Grading SDK calls are evaluator work, outside the observed agent run.
  delete process.env.AM_TRACE_LOG
  const [outputDir, caseId] = process.argv.slice(2)
  const result = outputDir && caseId ? gradeDiagramArtifact(outputDir, caseId) : { ok: false, problems: ['usage: diagram-artifact.ts OUTPUT_DIR CASE_ID'] }
  console.log(JSON.stringify({ score: result.ok ? 1 : 0, max_score: 1, problems: result.problems }))
  if (!result.ok) process.exitCode = 1
}
