import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { collectFailedChecks, EVIDENCE_CHECKS, QUALITY_CHECKS } from '../../scripts/ci/quality-gates.ts'

const ROOT = join(import.meta.dir, '..', '..')

describe('local/CI quality aggregate', () => {
  test('continues after failures and returns every failed check', () => {
    const visited: string[] = []
    const failures = collectFailedChecks(EVIDENCE_CHECKS.slice(0, 4), check => {
      visited.push(check.id)
      return check.id === EVIDENCE_CHECKS[1]!.id || check.id === EVIDENCE_CHECKS[3]!.id ? 1 : 0
    })
    expect(visited).toEqual(EVIDENCE_CHECKS.slice(0, 4).map(check => check.id))
    expect(failures.map(check => check.id)).toEqual([EVIDENCE_CHECKS[1]!.id, EVIDENCE_CHECKS[3]!.id])
  })

  test('enrolls every package-script check backed by a generated receipt', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const receiptScripts = Object.entries(pkg.scripts).flatMap(([name, command]) => {
      if (!name.endsWith(':check')) return []
      const scriptPath = command.match(/(?:^|\s)(scripts\/pr-assets\/[^\s]+\.ts)(?:\s|$)/)?.[1]
      if (!scriptPath) return []
      const source = readFileSync(join(ROOT, scriptPath), 'utf8')
      return source.includes('evidence-receipt.json') || source.includes('gallery-receipt.json') ? [name] : []
    })
    receiptScripts.push('benchmark:palette:check')
    expect(EVIDENCE_CHECKS.map(check => check.command[2]).sort()).toEqual(receiptScripts.sort())
  })

  test('GitHub quality runs the same aggregate developers run locally', () => {
    const workflow = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
    const qualityJob = workflow.match(/\n  quality:\n([\s\S]*?)\n  route-sabotage:/)?.[1]
    expect(qualityJob).toBeDefined()
    expect(qualityJob!.split('\n').filter(line => line.trimStart().startsWith('run:')))
      .toEqual(['        run: bun run quality:check'])
    expect(QUALITY_CHECKS[0]?.command).toEqual(['bun', 'install', '--frozen-lockfile'])
    expect(QUALITY_CHECKS.at(-1)?.id).toBe('golden-drift')
  })
})
