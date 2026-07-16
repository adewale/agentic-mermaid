// Flag/registry consistency. BOOLEAN_FLAGS is derived from FLAG_SPECS; the
// guards below keep that classification consistent with how flags are actually
// READ in the CLI source (the direct guard the `--canonical-wrapper` bug needed)
// and with the global help text. (The per-command usage-bracket cross-check was
// dropped as redundant belt-and-suspenders.)

import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BOOLEAN_FLAGS, COMMAND_FLAGS, COMMAND_POSITIONALS, FLAG_SPECS, GLOBAL_USAGE, parseArgs, runCli } from '../cli/index.ts'
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

describe('command-specific flag validity', () => {
  const capture = (argv: string[]): { code: number; output: string } => {
    let output = ''
    const stdout = process.stdout.write
    const stderr = process.stderr.write
    process.stdout.write = ((chunk: unknown) => { output += String(chunk); return true }) as typeof process.stdout.write
    process.stderr.write = ((chunk: unknown) => { output += String(chunk); return true }) as typeof process.stderr.write
    try { return { code: runCli(argv), output } } finally {
      process.stdout.write = stdout
      process.stderr.write = stderr
    }
  }

  test('batch keeps its documented --jsonl mode under command ownership checks', () => {
    const parsed = parseArgs(['batch', '--jsonl'])
    expect(parsed.flags.jsonl).toBe(true)
    expect(capture(['batch', '--jsonl']).code).toBe(0)
  })

  test('boolean values and duplicate flags fail closed instead of changing meaning', () => {
    for (const argv of [
      ['capabilities', '--json=false'],
      ['render', '--style', 'crisp', '--style', 'rough', 'ignored.mmd'],
      ['render', '--json', '--json', 'ignored.mmd'],
    ]) {
      const result = capture(argv)
      expect(result.code, argv.join(' ')).toBe(2)
      expect(result.output, argv.join(' ')).toMatch(/does not accept a value|only once/)
    }
  })

  test('known but inapplicable flags and missing values fail with ARG exit 2', () => {
    for (const argv of [
      ['verify', '--scale', '2', 'ignored.mmd'],
      ['describe', '--gantt-today', '2024-01-01', 'ignored.mmd'],
      ['verify', '--label-cap'],
    ]) {
      const result = capture(argv)
      expect(result.code).toBe(2)
      expect(result.output).toMatch(/not valid|require.*value/)
    }
  })
})

describe('command positional arity', () => {
  test('the positional and flag authorities cover the same commands', () => {
    expect(Object.keys(COMMAND_POSITIONALS).sort()).toEqual(Object.keys(COMMAND_FLAGS).sort())
  })

  test('single-input and zero-input commands reject ignored extra positionals', () => {
    const capture = (argv: string[]): { code: number; output: string } => {
      let output = ''
      const stdout = process.stdout.write
      const stderr = process.stderr.write
      process.stdout.write = ((chunk: unknown) => { output += String(chunk); return true }) as typeof process.stdout.write
      process.stderr.write = ((chunk: unknown) => { output += String(chunk); return true }) as typeof process.stderr.write
      try { return { code: runCli(argv), output } } finally {
        process.stdout.write = stdout
        process.stderr.write = stderr
      }
    }
    for (const [command, contract] of Object.entries(COMMAND_POSITIONALS)) {
      if (!Number.isFinite(contract.max)) continue
      const args = Array.from({ length: contract.max + 1 }, (_, index) => `extra-${index}`)
      const result = capture([command, ...args])
      expect(result.code, command).toBe(2)
      expect(result.output, command).toContain('positional')
    }
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
