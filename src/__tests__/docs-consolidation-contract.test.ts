import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..')
const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }

function markdownFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return markdownFiles(path)
    return entry.isFile() && entry.name.endsWith('.md') ? [path] : []
  })
}

const docs = markdownFiles(join(ROOT, 'docs'))
const repoPath = (path: string): string => relative(ROOT, path).replaceAll('\\', '/')

describe('maintained documentation is derived from current contracts', () => {
  test('every documented bare `bun run` script exists', () => {
    const missing: string[] = []
    for (const path of docs) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/\bbun run ([^\s`]+)/g)) {
        const script = match[1]!
        if (script.includes('/') || script.includes('.')) continue
        if (!(script in packageJson.scripts)) missing.push(`${repoPath(path)}: bun run ${script}`)
      }
    }
    expect(missing).toEqual([])
  })

  test('active design navigation excludes completed implementation ledgers', () => {
    const index = readFileSync(join(ROOT, 'docs', 'README.md'), 'utf8')
    expect(index).not.toContain('design/family-elevation-plan.md')
    expect(index).not.toContain('design/family-elevation-acceptance.md')
    expect(index).not.toContain('design/system/consolidation-plan.md')
    expect(index).toContain('project/archive/')
    expect(index).toContain('svg-semantic-contract.md')
    expect(index).toContain('mutation-testing.md')
  })

  test('completed family-elevation records are historical, not active design specs', () => {
    const archive = join(ROOT, 'docs', 'project', 'archive', 'pr-149')
    const names = new Set(readdirSync(archive))
    expect(names).toEqual(new Set([
      'README.md',
      'consolidation-plan.md',
      'family-elevation-acceptance.md',
      'family-elevation-evidence.json',
      'family-elevation-plan.md',
    ]))
    const acceptance = readFileSync(join(archive, 'family-elevation-acceptance.md'))
    expect(createHash('sha256').update(acceptance).digest('hex')).toBe('31b4233a2dc2f673ef734960dc3c5af7827910816bd94792ff4b349ae5f3c8ec')
  })

  test('the canonical backlog contains only actionable items', () => {
    const todo = readFileSync(join(ROOT, 'TODO.md'), 'utf8')
    expect(todo).not.toMatch(/^- \[x\]/m)
    expect(existsSync(join(ROOT, 'docs/project/archive/completed-backlog-pre-consolidation.md'))).toBe(false)
  })

  test('archive records are explicitly historical and cannot become shadow backlogs', () => {
    const archive = markdownFiles(join(ROOT, 'docs', 'project', 'archive'))
    const missingStatus: string[] = []
    const uncheckedWork: string[] = []
    for (const path of archive) {
      const text = readFileSync(path, 'utf8')
      if (!/^>? ?(?:\*\*)?Status:/m.test(text)) missingStatus.push(repoPath(path))
      if (/^- \[ \]/m.test(text)) uncheckedWork.push(repoPath(path))
    }
    expect(missingStatus).toEqual([])
    expect(uncheckedWork).toEqual([])
  })

  test('the active brand plan references only exact root-TODO IDs', () => {
    const todo = readFileSync(join(ROOT, 'TODO.md'), 'utf8')
    const plan = readFileSync(join(ROOT, 'docs/project/brand-primitives-plan.md'), 'utf8')
    const todoIds = new Set(Array.from(todo.matchAll(/\*\*([A-Z]+-\d+)\s+—/g), match => match[1]!))
    const planIds = new Set(Array.from(plan.matchAll(/\b[A-Z]+-\d+\b/g), match => match[0]))
    const nonBacklogReferences = new Set(['SHA-256', 'PR-149'])
    expect([...planIds].filter(id => !todoIds.has(id) && !nonBacklogReferences.has(id))).toEqual([])
    expect(plan).not.toMatch(/\b[A-Z]+-\d+(?:\/\d+)+\b/)
  })

  test('prototype research cannot retain a shadow production spec or backlog', () => {
    const prototype = readFileSync(join(ROOT, 'scripts/sketch-prototype/SPEC.md'), 'utf8')
    expect(prototype).toContain('Status: non-authoritative research artifact')
    for (const staleAuthority of ['StyleSpec.backend', 'PARTIALLY IMPLEMENTED', 'candidate backlog', 'This document specifies the production design']) {
      expect({ staleAuthority, present: prototype.includes(staleAuthority) })
        .toEqual({ staleAuthority, present: false })
    }
  })

  test('the refactor characterization index names every contract surface and an existing gate', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'docs/design/system/consolidation-characterization.json'), 'utf8')) as {
      scopeProjection: string
      contracts: Array<{ surface: string; familyScope: string; evidence: string[] }>
    }
    const [projectionPath, projectionSymbol, ...projectionRest] = manifest.scopeProjection.split('#')
    expect({ projectionPath, projectionSymbol, projectionRest }).toEqual({
      projectionPath: 'src/agent/families.ts',
      projectionSymbol: 'knownFamilies',
      projectionRest: [],
    })
    expect(existsSync(join(ROOT, projectionPath!))).toBe(true)
    const projectionSource = readFileSync(join(ROOT, projectionPath!), 'utf8')
    expect(projectionSource).toMatch(new RegExp(`export\\s+function\\s+${projectionSymbol}\\b`))
    expect(projectionSource).toContain('const REGISTRY = buildBuiltinRegistry()')
    expect(projectionSource).not.toContain('function augmentFamily')

    expect(new Set(manifest.contracts.map(contract => contract.surface))).toEqual(new Set([
      'semantic identity', 'geometry', 'terminal cells', 'config diagnostics',
      'security', 'packaging', 'generated artifacts',
    ]))
    for (const contract of manifest.contracts) {
      expect(contract.familyScope).toBe('registry')
      expect(contract.evidence.length).toBeGreaterThan(0)
      for (const path of contract.evidence) expect({ path, exists: existsSync(join(ROOT, path)) }).toEqual({ path, exists: true })
    }
  })

  test('local Markdown links remain closed after archive moves', () => {
    const broken: string[] = []
    for (const path of docs) {
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
        const target = match[1]!.split('#')[0]!.split('?')[0]!
        if (!target || target.startsWith('/') || target.includes('://') || target.startsWith('mailto:')) continue
        if (!existsSync(join(path, '..', target))) broken.push(`${repoPath(path)} -> ${target}`)
      }
    }
    expect(broken).toEqual([])
  })

  test('historical fork narrative is archived behind evergreen lessons', () => {
    const current = readFileSync(join(ROOT, 'docs/project/lessons-learned.md'), 'utf8')
    const historical = readFileSync(join(ROOT, 'docs/project/archive/fork-lessons-through-pr-149.md'), 'utf8')
    expect(current).toContain('## Evergreen engineering lessons')
    expect(current).not.toMatch(/^## Loop \d+/m)
    expect(historical).toContain('## Loop 14 lesson')
  })

  test('current contract docs avoid volatile test and package totals', () => {
    const active = docs.filter(path => !repoPath(path).startsWith('docs/project/archive/'))
    const violations: string[] = []
    const volatile = [
      /\b\d[\d,]*\s+(?:tests?|assertions?)\s+(?:pass|passed|failed|skipped)\b/gi,
      /\bpackage(?: dry run)?\s*[:—-]?\s*\*?\*?\d[\d,]*\*?\*?\s+files\b/gi,
      /\b\d[\d,]*\s+files\s+(?:in|packaged|shipped)\b/gi,
    ]
    for (const path of active) {
      const text = readFileSync(path, 'utf8')
      for (const pattern of volatile) for (const match of text.matchAll(pattern)) {
        violations.push(`${repoPath(path)}: ${match[0]}`)
      }
    }
    expect(violations).toEqual([])
  })
})
