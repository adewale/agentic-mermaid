// Test-quality guardrails that actually run in CI.
//
// This is intentionally narrower than a style linter: it catches the
// high-confidence testing anti-patterns that create false confidence while
// leaving room for strong one-assertion property tests and conditional
// runtime-capability checks.

import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')
const TEST_ROOTS = ['src/__tests__', 'e2e']

type Finding = {
  file: string
  line: number
  rule: string
  text: string
}

const RULES = [
  {
    name: 'focused test committed',
    re: /\b(?:describe|test|it)\s*\.\s*only\s*\(/,
  },
  {
    name: 'direct skip committed',
    re: /\b(?:describe|test|it)\s*\.\s*skip\s*\(/,
  },
  {
    name: 'truthy/falsy assertion',
    re: /\.toBe(?:Truthy|Falsy)\s*\(/,
  },
  {
    name: 'fixed browser timeout wait',
    re: /\bwaitForTimeout\s*\(/,
  },
] as const

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (path.endsWith('.ts')) out.push(path)
  }
  return out
}

function testFiles(): string[] {
  return TEST_ROOTS.flatMap(root => walk(join(REPO, root)))
}

function stripLineComment(line: string): string {
  return line.replace(/\/\/.*$/, '')
}

function findTestQualitySmells(files = testFiles()): Finding[] {
  const findings: Finding[] = []
  for (const file of files) {
    const rel = file.slice(REPO.length + 1)
    const lines = readVirtualAware(file).split('\n')
    for (let i = 0; i < lines.length; i++) {
      const code = stripLineComment(lines[i]!)
      for (const rule of RULES) {
        if (rule.re.test(code)) {
          findings.push({ file: rel, line: i + 1, rule: rule.name, text: lines[i]!.trim() })
        }
      }
    }
  }
  return findings
}

describe('test-quality lint (testing-best-practices guardrails)', () => {
  test('tests do not carry focused/skipped tests, truthy assertions, or fixed waits', () => {
    expect(findTestQualitySmells()).toEqual([])
  })

  test('the lint has teeth for each guarded anti-pattern', () => {
    const examples = [
      'test' + '.only("debug", () => {})',
      'describe' + '.skip("later", () => {})',
      'expect(result).toBe' + 'Truthy()',
      'await page.waitFor' + 'Timeout(500)',
    ]
    for (const [idx, example] of examples.entries()) {
      const file = join(REPO, `virtual-${idx}.test.ts`)
      const findings = findTestQualitySmells([fileFromText(file, example)])
      expect(findings.map(f => f.rule)).toEqual([RULES[idx]!.name])
    }
  })
})

function fileFromText(path: string, text: string): string {
  virtualFiles.set(path, text)
  return path
}

const realReadFileSync = readFileSync
const virtualFiles = new Map<string, string>()

function readVirtualAware(path: string): string {
  return virtualFiles.get(path) ?? realReadFileSync(path, 'utf8')
}
