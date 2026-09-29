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
// Every .ts file under these roots (tests and their helpers)...
const TEST_ROOTS = ['src/__tests__', 'e2e']
// ...and every *.test.ts under these, which mix tests with ordinary scripts.
const TEST_FILE_ROOTS = ['scripts', 'eval']

type Finding = {
  file: string
  line: number
  rule: string
  text: string
}

// Focused and skipped tests are enforced repository-wide by Biome's
// suspicious/noFocusedTests and suspicious/noSkippedTests (biome.json).
const RULES = [
  {
    name: 'truthy/falsy assertion',
    re: /\.toBe(?:Truthy|Falsy)\s*\(/,
  },
  {
    name: 'fixed browser timeout wait',
    re: /\bwaitForTimeout\s*\(/,
  },
  {
    // An ad-hoc sleep: a Promise resolved by a timer with a non-zero delay, or
    // Bun.sleep. Wait on a state predicate (waitForFunction, a bounded poll of
    // the observed condition) or drive a fake clock instead. A zero-delay
    // timer is an event-loop yield, not a sleep, and is allowed.
    name: 'ad-hoc sleep',
    re: /new Promise\b.*\bsetTimeout\s*\(\s*[\w$]+\s*,\s*(?!\s)(?!0\s*\))[^)]|\bBun\.sleep(?:Sync)?\s*\(/,
  },
] as const

// Deliberate exceptions to a rule, each with its reason. An entry matches a
// finding by file, rule and a fragment of the offending line, and an entry that
// no longer matches anything fails the lint, so the list cannot rot.
const ALLOWED: ReadonlyArray<{ file: string; rule: string; fragment: string; reason: string }> = [
  {
    file: 'src/__tests__/website-browser-a11y.test.ts',
    rule: 'ad-hoc sleep',
    fragment: 'setTimeout(resolve, 5_000)',
    reason: 'an upper bound raced against browser.close() in afterAll cleanup, not a wait for state',
  },
  {
    file: 'src/__tests__/agent-mcp-http.test.ts',
    rule: 'ad-hoc sleep',
    fragment: 'setTimeout(resolve, 5)',
    reason: 'poll interval inside the bounded eventually(observe, settled) predicate loop: the wait ends on state, not on the timer',
  },
  {
    file: 'src/__tests__/mcp-client-interop.test.ts',
    rule: 'ad-hoc sleep',
    fragment: 'setTimeout(resolve, 10)',
    reason: 'poll interval inside the waitFor(condition) predicate loop: the wait ends on state, not on the timer',
  },
  {
    file: 'src/__tests__/cli-multi-input.test.ts',
    rule: 'ad-hoc sleep',
    fragment: 'setTimeout(resolve, 100)',
    reason: 'fs.watch exposes no readiness signal, so the watcher gets 100 ms to register before the save; priming it with writes would leak late events into the assertions',
  },
]

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
  return [
    ...TEST_ROOTS.flatMap(root => walk(join(REPO, root))),
    ...TEST_FILE_ROOTS.flatMap(root => walk(join(REPO, root)).filter(path => path.endsWith('.test.ts'))),
  ]
}

function isAllowed(finding: Finding): boolean {
  return ALLOWED.some(entry => entry.file === finding.file && entry.rule === finding.rule && finding.text.includes(entry.fragment))
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
  test('tests do not carry truthy assertions, fixed waits or ad-hoc sleeps', () => {
    expect(findTestQualitySmells().filter(finding => !isAllowed(finding))).toEqual([])
  })

  test('scans test files under scripts/ and eval/ too', () => {
    const scanned = new Set(testFiles().map(file => file.slice(REPO.length + 1)))
    expect(scanned.has('scripts/sketch-prototype/styles.test.ts')).toBe(true)
    expect(scanned.has('eval/family-usage/count.test.ts')).toBe(true)
    // Only test files there, not the scripts they sit beside.
    expect(scanned.has('eval/family-usage/count.ts')).toBe(false)
  })

  test('every allow-list entry still matches a finding', () => {
    const findings = findTestQualitySmells()
    const stale = ALLOWED.filter(entry => !findings.some(finding => entry.file === finding.file && entry.rule === finding.rule && finding.text.includes(entry.fragment)))
    expect(stale.map(entry => `${entry.file}: ${entry.fragment}`)).toEqual([])
  })

  test('the lint has teeth for each guarded anti-pattern', () => {
    const examples: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['expect(result).toBe' + 'Truthy()', ['truthy/falsy assertion']],
      ['await page.waitFor' + 'Timeout(500)', ['fixed browser timeout wait']],
      ['await new Promise(r => set' + 'Timeout(r, 250))', ['ad-hoc sleep']],
      ['await new Promise((resolve) => set' + 'Timeout(resolve, delayMs))', ['ad-hoc sleep']],
      ['await Bun.sl' + 'eep(50)', ['ad-hoc sleep']],
      // A zero-delay timer only yields the event loop.
      ['await new Promise(resolve => set' + 'Timeout(resolve, 0))', []],
    ]
    for (const [idx, [example, rules]] of examples.entries()) {
      const file = join(REPO, `virtual-${idx}.test.ts`)
      const findings = findTestQualitySmells([fileFromText(file, example)])
      expect({ example, rules: findings.map(f => f.rule) }).toEqual({ example, rules: [...rules] })
    }
    expect(new Set(examples.flatMap(([, rules]) => rules))).toEqual(new Set(RULES.map(rule => rule.name)))
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
