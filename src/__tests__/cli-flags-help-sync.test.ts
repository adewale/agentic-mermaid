// Flag/registry consistency. BOOLEAN_FLAGS is derived from FLAG_SPECS; the
// guards below keep that classification consistent with how flags are actually
// READ in the CLI source (the direct guard the `--canonical-wrapper` bug needed)
// and with the global help text. (The per-command usage-bracket cross-check was
// dropped as redundant belt-and-suspenders.)

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOLEAN_FLAGS, FLAG_SPECS, GLOBAL_USAGE, parseArgs } from '../cli/index.ts'
import { parseFlagsBlock, booleanFlagReads } from './helpers/cli-flag-parsing.ts'

describe('FLAG_SPECS is the single source for flag classification', () => {
  test('BOOLEAN_FLAGS is exactly the arg-less specs', () => {
    const derived = Object.keys(FLAG_SPECS).filter(n => !FLAG_SPECS[n]!.arg).sort()
    expect([...BOOLEAN_FLAGS].sort()).toEqual(derived)
  })

  test('every flag in the global Flags block matches a FLAG_SPEC (boolean ↔ no <ARG>)', () => {
    const flags = parseFlagsBlock(GLOBAL_USAGE)
    expect(flags.length).toBeGreaterThanOrEqual(6)
    for (const f of flags) {
      expect({ name: f.name, known: f.name in FLAG_SPECS }).toEqual({ name: f.name, known: true })
      expect({ name: f.name, takesArg: f.takesArg }).toEqual({ name: f.name, takesArg: Boolean(FLAG_SPECS[f.name]!.arg) })
    }
  })
})

describe('code reads ↔ BOOLEAN_FLAGS', () => {
  const cliSource = readFileSync(join(import.meta.dir, '..', 'cli', 'index.ts'), 'utf8')

  test('every flag read in a boolean context is registered boolean', () => {
    // A flag used as `flags.x ?` / `=== true` / `Boolean(...)` / `if (flags.x)`
    // MUST be in BOOLEAN_FLAGS regardless of how it was documented — the direct
    // guard for the --canonical-wrapper bug class.
    const used = booleanFlagReads(cliSource)
    expect([...used].filter(n => !BOOLEAN_FLAGS.has(n))).toEqual([])
  })

  test('the detector actually finds the known boolean reads', () => {
    const used = booleanFlagReads(cliSource)
    expect(used.has('canonical-wrapper')).toBe(true)
    expect(used.has('ascii')).toBe(true)
  })
})

describe('parseArgs: a boolean flag before a positional keeps the positional', () => {
  test('--canonical-wrapper before the file does not swallow it', () => {
    const a = parseArgs(['format', '--canonical-wrapper', 'diagram.mmd'])
    expect(a.flags['canonical-wrapper']).toBe(true)
    expect(a.positional).toContain('diagram.mmd')
  })

  test('every boolean flag preserves a following positional', () => {
    for (const name of BOOLEAN_FLAGS) {
      if (name === 'help' || name === 'agent-instructions') continue
      const a = parseArgs(['render', `--${name}`, 'file.mmd'])
      expect({ name, flag: a.flags[name], hasFile: a.positional.includes('file.mmd') })
        .toEqual({ name, flag: true, hasFile: true })
    }
  })
})
