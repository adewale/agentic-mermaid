// Move 5: keep BOOLEAN_FLAGS in sync with the help text, so a new flag can't be
// documented as a boolean (no `<ARG>`) without being registered as boolean in
// the parser — the exact footgun avoided by hand when adding
// --no-faithfulness-check. The global "Flags:" block is the source: a flag
// documented WITHOUT a `<ARG>` placeholder takes no value and MUST be in
// BOOLEAN_FLAGS; a flag documented WITH one must NOT be.

import { describe, test, expect } from 'bun:test'
import { BOOLEAN_FLAGS, GLOBAL_USAGE } from '../cli/index.ts'

interface FlagDoc { name: string; takesArg: boolean }

function parseFlagsBlock(usage: string): FlagDoc[] {
  const lines = usage.split('\n')
  const start = lines.findIndex(l => /^Flags:/.test(l))
  expect(start).toBeGreaterThan(-1)
  const out: FlagDoc[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '' || /^\S/.test(line)) break  // block ends at a blank or unindented line
    // `  --flag <ARG>   desc`  or  `  --flag   desc`. The \b must sit right after
    // the flag name; an <ARG> ends in `>` (non-word) so a \b after it would fail
    // and mask the arg — keep the optional <ARG> group AFTER the word boundary.
    const m = line.match(/^\s+--([A-Za-z][\w-]*)\b(\s+<[^>]+>)?/)
    if (m) out.push({ name: m[1]!, takesArg: Boolean(m[2]) })
  }
  return out
}

describe('BOOLEAN_FLAGS ↔ help text', () => {
  const flags = parseFlagsBlock(GLOBAL_USAGE)

  test('the Flags block parses into several documented flags', () => {
    expect(flags.length).toBeGreaterThanOrEqual(6)
    expect(flags.map(f => f.name)).toContain('no-faithfulness-check')
  })

  test('every value-less documented flag is registered as boolean', () => {
    const unregistered = flags.filter(f => !f.takesArg && !BOOLEAN_FLAGS.has(f.name)).map(f => f.name)
    expect(unregistered).toEqual([])
  })

  test('every flag documented with a <ARG> is NOT boolean', () => {
    const misregistered = flags.filter(f => f.takesArg && BOOLEAN_FLAGS.has(f.name)).map(f => f.name)
    expect(misregistered).toEqual([])
  })
})
