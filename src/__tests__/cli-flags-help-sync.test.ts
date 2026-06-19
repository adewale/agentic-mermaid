// Flag/registry consistency (Moves 4, 1, 2, 10).
//
// The CLI parser's boolean classification (BOOLEAN_FLAGS, derived from
// FLAG_SPECS) must stay consistent with three things: the help text, the
// per-command usage, and how flags are actually READ in the CLI source. A
// mismatch is the bug class that let `am format --canonical-wrapper file`
// consume the filename.

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOLEAN_FLAGS, FLAG_SPECS, GLOBAL_USAGE, COMMAND_HELP, parseArgs } from '../cli/index.ts'
import { parseFlagsBlock, parseUsageFlags, booleanFlagReads } from './helpers/cli-flag-parsing.ts'

describe('BOOLEAN_FLAGS ↔ global help Flags block (Move 4 helper)', () => {
  const flags = parseFlagsBlock(GLOBAL_USAGE)

  test('the Flags block parses into several documented flags', () => {
    expect(flags.length).toBeGreaterThanOrEqual(6)
    expect(flags.map(f => f.name)).toContain('no-faithfulness-check')
  })

  test('every value-less documented flag is registered as boolean', () => {
    expect(flags.filter(f => !f.takesArg && !BOOLEAN_FLAGS.has(f.name)).map(f => f.name)).toEqual([])
  })

  test('every flag documented with a <ARG> is NOT boolean', () => {
    expect(flags.filter(f => f.takesArg && BOOLEAN_FLAGS.has(f.name)).map(f => f.name)).toEqual([])
  })
})

describe('BOOLEAN_FLAGS ↔ per-command usage (COMMAND_HELP)', () => {
  const perCommand = Object.entries(COMMAND_HELP).map(([cmd, help]) => ({ cmd, flags: parseUsageFlags(help.split('\n')[0]!) }))

  test('several commands document bracketed flags', () => {
    expect(perCommand.reduce((n, c) => n + c.flags.length, 0)).toBeGreaterThanOrEqual(6)
  })

  test('value-less bracket flags are registered boolean; valued ones are not', () => {
    const bad: string[] = []
    for (const { cmd, flags } of perCommand) for (const f of flags) {
      if (!f.takesArg && !BOOLEAN_FLAGS.has(f.name)) bad.push(`${cmd}: [--${f.name}] value-less but not boolean`)
      if (f.takesArg && BOOLEAN_FLAGS.has(f.name)) bad.push(`${cmd}: [--${f.name} …] valued but boolean`)
    }
    expect(bad).toEqual([])
  })
})

describe('FLAG_SPECS is the single source (Move 10)', () => {
  test('BOOLEAN_FLAGS is exactly the arg-less specs', () => {
    const derived = Object.keys(FLAG_SPECS).filter(n => !FLAG_SPECS[n]!.arg).sort()
    expect([...BOOLEAN_FLAGS].sort()).toEqual(derived)
  })

  test('every flag in the global Flags block has a matching FLAG_SPEC', () => {
    for (const f of parseFlagsBlock(GLOBAL_USAGE)) {
      expect({ name: f.name, known: f.name in FLAG_SPECS }).toEqual({ name: f.name, known: true })
      expect({ name: f.name, takesArg: f.takesArg }).toEqual({ name: f.name, takesArg: Boolean(FLAG_SPECS[f.name]!.arg) })
    }
  })
})

describe('code reads ↔ BOOLEAN_FLAGS (Move 2)', () => {
  const cliSource = readFileSync(join(import.meta.dir, '..', 'cli', 'index.ts'), 'utf8')

  test('every flag read in a boolean context is registered boolean', () => {
    // Closes the loop from the OTHER direction: a flag used as `flags.x ?` /
    // `=== true` / `Boolean(...)` / `if (flags.x)` MUST be in BOOLEAN_FLAGS,
    // regardless of whether it was documented. This is the direct guard the
    // --canonical-wrapper bug needed.
    const used = booleanFlagReads(cliSource)
    const unregistered = [...used].filter(n => !BOOLEAN_FLAGS.has(n))
    expect(unregistered).toEqual([])
  })

  test('the detector actually finds the known boolean reads', () => {
    const used = booleanFlagReads(cliSource)
    expect(used.has('canonical-wrapper')).toBe(true)  // flags['canonical-wrapper'] ?
    expect(used.has('ascii')).toBe(true)              // flags.ascii ?
  })
})

describe('parseArgs boolean flags before a positional (Move 1 regression)', () => {
  test('--canonical-wrapper before the file keeps the file as positional', () => {
    // The exact bug: a boolean flag immediately before a positional must not
    // swallow it as the flag value.
    const a = parseArgs(['format', '--canonical-wrapper', 'diagram.mmd'])
    expect(a.flags['canonical-wrapper']).toBe(true)
    expect(a.positional).toContain('diagram.mmd')
  })

  test('every boolean flag preserves a following positional', () => {
    for (const name of BOOLEAN_FLAGS) {
      if (name === 'help' || name === 'agent-instructions') continue  // global, no positional use
      const a = parseArgs(['render', `--${name}`, 'file.mmd'])
      expect({ name, flag: a.flags[name], hasFile: a.positional.includes('file.mmd') })
        .toEqual({ name, flag: true, hasFile: true })
    }
  })
})
