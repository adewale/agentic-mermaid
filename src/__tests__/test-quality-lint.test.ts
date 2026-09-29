// Test-quality guardrails that actually run in CI.
//
// This is intentionally narrower than a style linter: it catches the
// high-confidence testing anti-patterns that create false confidence while
// leaving room for strong one-assertion property tests and conditional
// runtime-capability checks.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AllowEntry, type LintRule, lintSource, REPO_ROOT, staleEntries, unexcused, walkFiles } from './helpers/source-scan.ts'

// Every .ts file under these roots (tests and their helpers)...
const TEST_ROOTS = ['src/__tests__', 'e2e']
// ...and every *.test.ts under these, which mix tests with ordinary scripts.
const TEST_FILE_ROOTS = ['scripts', 'eval']

/** The local names a file binds with value (not `import type`) imports. */
function staticImportBindings(code: string): string[] {
  const names: string[] = []
  for (const [, clause] of code.matchAll(/^\s*import\s+(?!type\b)([^'"]+?)\s+from\s+['"]/gm)) {
    const named = /\{([^}]*)\}/.exec(clause!)?.[1]
    for (const specifier of named?.split(',') ?? []) {
      const parts = specifier.trim().split(/\s+/)
      if (parts[0] && parts[0] !== 'type') names.push(parts.at(-1)!)
    }
    const rest = clause!.replace(/\{[^}]*\}/, '')
    for (const binding of rest.matchAll(/(?:\*\s*as\s+)?([A-Za-z_$][\w$]*)/g)) names.push(binding[1]!)
  }
  return names
}

// Focused and skipped tests are enforced repository-wide by Biome's
// suspicious/noFocusedTests and suspicious/noSkippedTests (biome.json).
const RULES: readonly LintRule[] = [
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
  {
    // An agent loop once shipped `expect(typeof observedDifference).toBe('boolean')`:
    // the value is typed boolean, so the assertion can never fail. Agent tests
    // assert the value instead.
    name: 'typeof-boolean tautology in an agent test',
    files: /^src\/__tests__\/agent[^/]*\.test\.ts$/,
    re: /expect\(\s*typeof[^)]*\)\s*\.\s*toBe\(\s*['"]boolean['"]\s*\)/,
  },
  {
    // tsc already fixes the type and presence of a static import, so
    // `expect(typeof imported).toBe('function')` or
    // `expect(imported).toBeDefined()` can only pass. Call it instead.
    name: 'assertion on a static import',
    re: code => {
      const names = staticImportBindings(code)
      if (names.length === 0) return null
      const binding = `(?:${names.map(name => name.replace(/\$/g, '\\$')).join('|')})(?:\\.[\\w$]+)*`
      return new RegExp(`expect\\(\\s*(?:typeof\\s+${binding}\\s*\\)\\s*\\.\\s*toBe\\(\\s*['"]\\w+['"]\\s*\\)|${binding}\\s*\\)\\s*\\.\\s*toBeDefined\\(\\s*\\))`)
    },
  },
]

// Deliberate exceptions to a rule, each with its reason. An entry matches a
// finding by file, rule and a fragment of the offending line, and an entry that
// no longer matches anything fails the lint, so the list cannot rot.
const ALLOWED: readonly AllowEntry[] = [
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

function testFiles(): string[] {
  return [
    ...TEST_ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root), path => path.endsWith('.ts'))),
    ...TEST_FILE_ROOTS.flatMap(root => walkFiles(join(REPO_ROOT, root), path => path.endsWith('.test.ts'))),
  ]
}

function findTestQualitySmells() {
  return testFiles().flatMap(file => lintSource(file.slice(REPO_ROOT.length + 1), readFileSync(file, 'utf8'), RULES))
}

describe('test-quality lint (testing-best-practices guardrails)', () => {
  test('tests do not carry truthy assertions, fixed waits, ad-hoc sleeps or type tautologies', () => {
    expect(unexcused(findTestQualitySmells(), ALLOWED)).toEqual([])
  })

  test('scans test files under scripts/ and eval/ too', () => {
    const scanned = new Set(testFiles().map(file => file.slice(REPO_ROOT.length + 1)))
    expect(scanned.has('scripts/sketch-prototype/styles.test.ts')).toBe(true)
    expect(scanned.has('eval/family-usage/count.test.ts')).toBe(true)
    // Only test files there, not the scripts they sit beside.
    expect(scanned.has('eval/family-usage/count.ts')).toBe(false)
  })

  test('every allow-list entry still matches a finding', () => {
    const stale = staleEntries(findTestQualitySmells(), ALLOWED)
    expect(stale.map(entry => `${entry.file}: ${entry.fragment}`)).toEqual([])
  })

  test('the lint has teeth for each guarded anti-pattern', () => {
    const agentTest = 'src/__tests__/agent-virtual.test.ts'
    const otherTest = 'src/__tests__/virtual.test.ts'
    const examples: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      [otherTest, 'expect(result).toBe' + 'Truthy()', ['truthy/falsy assertion']],
      [otherTest, 'await page.waitFor' + 'Timeout(500)', ['fixed browser timeout wait']],
      [otherTest, 'await new Promise(r => set' + 'Timeout(r, 250))', ['ad-hoc sleep']],
      [otherTest, 'await new Promise((resolve) => set' + 'Timeout(resolve, delayMs))', ['ad-hoc sleep']],
      [otherTest, 'await Bun.sl' + 'eep(50)', ['ad-hoc sleep']],
      // A zero-delay timer only yields the event loop.
      [otherTest, 'await new Promise(resolve => set' + 'Timeout(resolve, 0))', []],
      [agentTest, 'expect(typeof observedDifference).toBe' + "('boolean')", ['typeof-boolean tautology in an agent test']],
      // Outside agent tests a typeof check may be probing untyped JSON.
      [otherTest, 'expect(typeof payload.ok).toBe' + "('boolean')", []],
      [otherTest, "import { verify } from '../agent/index.ts'\nexpect(typeof verify).toBe" + "('function')", ['assertion on a static import']],
      [otherTest, "import * as agent from '../agent/index.ts'\nexpect(agent.verify).toBe" + 'Defined()', ['assertion on a static import']],
      [otherTest, "import Default, { a as renamed } from 'x'\nexpect(typeof renamed).toBe" + "('string')\nexpect(Default).toBe" + 'Defined()', ['assertion on a static import', 'assertion on a static import']],
      // A type-only import has no runtime value to assert on; a local does.
      [otherTest, "import type { Verify } from '../agent/index.ts'\nconst verify = load()\nexpect(typeof verify).toBe" + "('function')", []],
      // Prose in a comment is not an assertion.
      [otherTest, "import { verify } from 'x'\n// expect(typeof verify).toBe" + "('function')", []],
    ]
    for (const [file, example, rules] of examples) {
      const findings = lintSource(file, example, RULES)
      expect({ example, rules: findings.map(f => f.rule) }).toEqual({ example, rules: [...rules] })
    }
    expect(new Set(examples.flatMap(([, , rules]) => rules))).toEqual(new Set(RULES.map(rule => rule.name)))
  })
})
