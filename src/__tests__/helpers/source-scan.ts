// The one scanner behind the grep-lints (test-quality-lint, source-lint,
// agent-substrate-lint). Each lint owns its rule table, its allow-list and a
// "teeth" test that plants a violation per rule; this module only walks the
// tree, removes comments and reports where each rule matched.

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const REPO_ROOT = join(import.meta.dir, '..', '..', '..')

/** Every file under `dir` that `accept` keeps. Dependency trees and dot
 *  directories are never walked; `skipDir` prunes more (build output, say). */
export function walkFiles(dir: string, accept: (path: string) => boolean, skipDir: (path: string) => boolean = () => false): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      if (entry === 'node_modules' || entry.startsWith('.') || skipDir(path)) continue
      out.push(...walkFiles(path, accept, skipDir))
    } else if (accept(path)) {
      out.push(path)
    }
  }
  return out
}

// A `/` after one of these (or at the start) opens a regex literal, not a division.
const BEFORE_REGEX = /(?:^|[(,=:[!&|?{};+\-*%<>~^]|\breturn|\btypeof)\s*$/

/** Remove // and /* *\/ comments, leaving string literals, regex literals and
 *  line breaks intact, so a banned token in prose does not trip a lint, a `//`
 *  inside a string (a URL) does not hide the code after it, a quote inside a
 *  regex does not open a string, and line numbers hold. */
export function stripComments(source: string): string {
  let out = ''
  let quote: string | null = null
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (quote) {
      out += ch
      if (ch === '\\') out += source[++i] ?? ''
      else if (ch === quote) quote = null
    } else if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      out += '\n'
    } else if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end < 0 ? source.length : end + 2
      out += source.slice(i, stop).replace(/[^\n]/g, '')
      i = stop - 1
    } else if (ch === '/' && BEFORE_REGEX.test(out.slice(-16))) {
      let inClass = false
      let j = i + 1
      for (; j < source.length && source[j] !== '\n'; j++) {
        const c = source[j]
        if (c === '\\') j++
        else if (c === '[') inClass = true
        else if (c === ']') inClass = false
        else if (c === '/' && !inClass) break
      }
      out += source.slice(i, j + 1)
      i = j
    } else {
      if (ch === "'" || ch === '"' || ch === '`') quote = ch
      out += ch
    }
  }
  return out
}

export interface LintRule {
  readonly name: string
  /** What an offence looks like in comment-free code. A function builds the
   *  pattern from the file itself (its imports, say); null skips the file. */
  readonly re: RegExp | ((code: string) => RegExp | null)
  /** Repo-relative paths the rule applies to; every scanned file when absent. */
  readonly files?: RegExp
}

export interface LintFinding {
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly text: string
}

/** Every match of every rule in `source` (comments removed). `file` is the
 *  repo-relative path; a match reports its first line and that line's text. */
export function lintSource(file: string, source: string, rules: readonly LintRule[]): LintFinding[] {
  const code = stripComments(source)
  const lines = source.split('\n')
  const findings: LintFinding[] = []
  for (const rule of rules) {
    if (rule.files && !rule.files.test(file)) continue
    const re = typeof rule.re === 'function' ? rule.re(code) : rule.re
    if (!re) continue
    for (const match of code.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`))) {
      const line = code.slice(0, match.index).split('\n').length
      findings.push({ file, line, rule: rule.name, text: lines[line - 1]!.trim() })
    }
  }
  return findings
}

/** A deliberate exception: a finding of `rule` in `file` whose line contains
 *  `fragment` (any line when absent), with the reason it is allowed. */
export interface AllowEntry {
  readonly file: string
  readonly rule: string
  readonly fragment?: string
  readonly reason: string
}

function allows(entry: AllowEntry, finding: LintFinding): boolean {
  return entry.file === finding.file && entry.rule === finding.rule && (entry.fragment === undefined || finding.text.includes(entry.fragment))
}

/** The findings no allow-list entry excuses. */
export function unexcused(findings: readonly LintFinding[], allowed: readonly AllowEntry[]): LintFinding[] {
  return findings.filter(finding => !allowed.some(entry => allows(entry, finding)))
}

/** Allow-list entries that match no finding: the exception they excused is
 *  gone, so the entry must go too or the list rots. */
export function staleEntries(findings: readonly LintFinding[], allowed: readonly AllowEntry[]): AllowEntry[] {
  return allowed.filter(entry => !findings.some(finding => allows(entry, finding)))
}
