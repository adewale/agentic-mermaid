// Enforces the "product source is DOM-free" invariant.
//
// The renderer is synchronous and browser-free by design. tsconfig ships the DOM
// lib because the test program legitimately spans browser/worker-context files
// (the editor-*-switch and website-browser-a11y tests, and website/src/worker.ts
// pulled in transitively via website-build.test), so `bun x tsc --noEmit` no
// longer flags accidental DOM globals in product code. This lint restores that
// signal at the source level: no product file under src/ may reference a
// DOM/browser global except the few that do deliberate, guarded environment
// detection (allowlisted below).
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Glob } from 'bun'

const SRC = join(import.meta.dir, '..')

// Files permitted to name browser globals. Each does so via `typeof` guards or
// an explicit local `declare`, for runtime environment detection — not real DOM
// rendering. If you add a file here, it must keep that discipline.
const ALLOWLIST = new Set<string>([
  'browser.ts',       // the deliberate browser bundle entry (declare const window)
  'elk-instance.ts',  // ELK worker shim: toggles a global `document` so elk-worker takes the worker path
  'ascii/ansi.ts',    // declares `document` locally for a `typeof` color-support check
])

const GLOBALS = [
  'document', 'window', 'getComputedStyle', 'customElements',
  'HTMLElement', 'HTMLTextAreaElement', 'HTMLInputElement', 'HTMLDivElement',
  'localStorage', 'sessionStorage', 'navigator', 'alert', 'requestAnimationFrame',
]
const pattern = new RegExp(`\\b(?:${GLOBALS.join('|')})\\b`)

/** Blank out comments and string/template literals (newline-preserving) so only real code is scanned. */
function stripNonCode(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)     // block comments
    .replace(/`(?:\\.|[^`\\])*`/g, blank)    // template literals (can span lines)
    .replace(/'(?:\\.|[^'\\\n])*'/g, ' ')   // single-quoted strings
    .replace(/"(?:\\.|[^"\\\n])*"/g, ' ')   // double-quoted strings
    .replace(/\/\/[^\n]*/g, blank)           // line comments
}

describe('product source stays DOM-free', () => {
  test('no product src/ file names a browser global outside the guarded allowlist', () => {
    const offenders: string[] = []
    for (const rel of new Glob('**/*.ts').scanSync(SRC)) {
      if (rel.includes('__tests__/') || rel.endsWith('.d.ts') || ALLOWLIST.has(rel)) continue
      const code = stripNonCode(readFileSync(join(SRC, rel), 'utf8'))
      code.split('\n').forEach((line, i) => {
        if (pattern.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`)
      })
    }
    expect(offenders).toEqual([])
  })
})
