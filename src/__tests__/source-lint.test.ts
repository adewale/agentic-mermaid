// Source lint: rules over production code that have no cheap behavioural
// oracle. Runs in the unit suite and as `bun run lint:contracts`.
//
// - Locale collation: sorting by the host locale makes output bytes depend on
//   the machine. Order with compareCodePointStrings
//   (shared/deterministic-order.ts); agent-determinism.test.ts proves that
//   authority behaves the same under English and Swedish locales.
// - Single-sourcing (the 2026-07 consolidation audit): the same primitives
//   had been re-implemented across families and several copies had diverged
//   (two luminance formulas disagreed; facade.ts's two copies of the family
//   union had drifted in member order). Re-adding a local copy fails here with
//   a pointer to the shared home. Where the shared behaviour is observable it
//   is checked on rendered output instead (consolidation-gate.test.ts).
//
// Each rule has a planted violation in the teeth test, and an allow-list
// entry that no longer matches anything fails, so the list cannot rot.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { type AllowEntry, type LintRule, lintSource, REPO_ROOT, staleEntries, unexcused, walkFiles } from './helpers/source-scan.ts'

// Build output and generated trees: not source anyone edits (all gitignored).
const GENERATED_DIRS = new Set(['dist', 'coverage', 'reports', 'site', 'website/public', 'website/src/generated'])

/** Every TypeScript and JavaScript file in the repository. */
function executableFiles(): string[] {
  return walkFiles(
    REPO_ROOT,
    path => /\.(?:ts|js|mjs|cjs)$/.test(path),
    path => GENERATED_DIRS.has(path.slice(REPO_ROOT.length + 1)),
  )
}

const HEX_MATH = 'hex colour math outside shared/color-math.ts'
const LUMA = 'BT.601 luma weights outside shared/color-math.ts'
const FAMILY_UNION = 'family union re-enumerated outside agent/types.ts'

// Production source: src/ without its tests and declaration files.
const PRODUCTION = /^src\/(?!__tests__\/)(?!.*\.d\.ts$).*\.ts$/

const RULES: readonly LintRule[] = [
  // The bracket keeps this rule's own source from matching it.
  { name: 'ambient locale collation', re: /\blocale[C]ompare\b/ },
  // New code imports parseHex/toHex/mixHex/luma255 from shared/color-math.ts.
  { name: HEX_MATH, files: PRODUCTION, re: /function (?:parseHex|hexToRgb|parseHexToRgb|rgbToHex|mixHex|mixHexColors|mixColors)\s*\(/ },
  // The weights in their string form, so inline copies are caught too.
  { name: LUMA, files: PRODUCTION, re: /0\.299\s*\*|\*\s*299\b/ },
  // Written out longhand, the union is another copy of DiagramKind waiting to drift.
  { name: FAMILY_UNION, files: PRODUCTION, re: /'flowchart'\s*\|\s*'state'\s*\|\s*'sequence'/ },
]

const ALLOWED: readonly AllowEntry[] = [
  { file: 'src/shared/color-math.ts', rule: HEX_MATH, reason: 'the shared home of hex parsing and mixing' },
  { file: 'src/shared/color-math.ts', rule: LUMA, reason: 'the shared home of the luma weights' },
  { file: 'src/color-resolver.ts', rule: HEX_MATH, fragment: 'parseHexToRgb', reason: 'a one-line delegate over tryParseHex that keeps the resolver\'s {r,g,b} shape' },
  { file: 'src/xychart/colors.ts', rule: HEX_MATH, fragment: 'mixHexColors', reason: 'a one-line delegate over mixHex that keeps the exported xychart name' },
  { file: 'src/agent/types.ts', rule: FAMILY_UNION, reason: 'DiagramKind itself' },
]

function findings() {
  return executableFiles().flatMap(file => lintSource(file.slice(REPO_ROOT.length + 1), readFileSync(file, 'utf8'), RULES))
}

describe('source lint', () => {
  test('no locale collation, and shared primitives stay single-sourced', () => {
    expect(unexcused(findings(), ALLOWED)).toEqual([])
  })

  test('every allow-list entry still matches a finding', () => {
    expect(staleEntries(findings(), ALLOWED).map(entry => `${entry.file}: ${entry.rule}`)).toEqual([])
  })

  test('the scan covers every tracked TS/JS root and skips generated trees', () => {
    const scanned = new Set(executableFiles().map(file => file.slice(REPO_ROOT.length + 1)))
    for (const file of ['bin/am.ts', 'src/index.ts', 'src/__tests__/source-lint.test.ts', 'scripts/ci/golden-drift.ts', 'website/build.ts', 'shared/browser/copy-feedback.js', 'stryker.config.mjs', 'tsup.config.ts']) {
      expect({ file, scanned: scanned.has(file) }).toEqual({ file, scanned: true })
    }
    expect([...scanned].filter(file => /^(?:website\/public|website\/src\/generated|dist|node_modules)\//.test(file))).toEqual([])
  })

  test('the lint has teeth for each rule', () => {
    const examples: ReadonlyArray<readonly [string, string, readonly string[]]> = [
      ['editor/js/x.js', "names.sort((a, b) => a.locale" + "Compare(b))", ['ambient locale collation']],
      ['src/x.ts', "// never call locale" + 'Compare here\nconst t = 0', []],
      ['src/pie/colors.ts', 'function parse' + 'Hex(hex: string) {}', [HEX_MATH]],
      ['src/pie/colors.ts', 'const y = 0.2' + '99 * r + 0.587 * g', [LUMA]],
      ['src/pie/colors.ts', 'const y = (r * 2' + '99 + g * 587) / 1000', [LUMA]],
      ['src/agent/facade.ts', "type Kind =\n  | 'flowchart'\n  | 'st" + "ate'\n  | 'sequence'", [FAMILY_UNION]],
      // Tests may keep an independent oracle (theme-contrast-wcag has its own parseHex).
      ['src/__tests__/x.test.ts', 'function parse' + 'Hex(hex: string) {}', []],
    ]
    for (const [file, example, rules] of examples) {
      expect({ file, example, rules: lintSource(file, example, RULES).map(f => f.rule) }).toEqual({ file, example, rules: [...rules] })
    }
    expect(new Set(examples.flatMap(([, , rules]) => rules))).toEqual(new Set(RULES.map(rule => rule.name)))
  })
})
