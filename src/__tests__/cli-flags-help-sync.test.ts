// Move 5: keep BOOLEAN_FLAGS in sync with the help text, so a new flag can't be
// documented as a boolean (no `<ARG>`) without being registered as boolean in
// the parser — the exact footgun avoided by hand when adding
// --no-faithfulness-check. The global "Flags:" block is the source: a flag
// documented WITHOUT a `<ARG>` placeholder takes no value and MUST be in
// BOOLEAN_FLAGS; a flag documented WITH one must NOT be.

import { describe, test, expect } from 'bun:test'
import { BOOLEAN_FLAGS, GLOBAL_USAGE, COMMAND_HELP } from '../cli/index.ts'

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

// Move 4: the same boolean/value contract over the per-command usage lines.
// Usage syntax marks booleans as `[--flag]` and value flags as `[--flag VAL]`
// or `[--flag a|b]`, so a flag's value-ness is read from the bracket content.
function parseUsageFlags(usageLine: string): FlagDoc[] {
  const out: FlagDoc[] = []
  for (const m of usageLine.matchAll(/\[--([A-Za-z][\w-]*)([^\]]*)\]/g)) {
    out.push({ name: m[1]!, takesArg: m[2]!.trim().length > 0 })
  }
  return out
}

describe('BOOLEAN_FLAGS ↔ per-command usage (COMMAND_HELP)', () => {
  const perCommand = Object.entries(COMMAND_HELP).map(([cmd, help]) => ({ cmd, flags: parseUsageFlags(help.split('\n')[0]!) }))

  test('several commands document bracketed flags', () => {
    const total = perCommand.reduce((n, c) => n + c.flags.length, 0)
    expect(total).toBeGreaterThanOrEqual(6)
  })

  test('value-less bracket flags are registered boolean; valued ones are not', () => {
    const bad: string[] = []
    for (const { cmd, flags } of perCommand) {
      for (const f of flags) {
        if (!f.takesArg && !BOOLEAN_FLAGS.has(f.name)) bad.push(`${cmd}: [--${f.name}] value-less but not in BOOLEAN_FLAGS`)
        if (f.takesArg && BOOLEAN_FLAGS.has(f.name)) bad.push(`${cmd}: [--${f.name} …] valued but in BOOLEAN_FLAGS`)
      }
    }
    expect(bad).toEqual([])
  })
})
