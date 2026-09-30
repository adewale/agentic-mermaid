// Flag/registry consistency. BOOLEAN_FLAGS is derived from FLAG_SPECS, and the
// CLI reads every flag through flagEnabled/flagValue, whose name types admit
// only switches or only value flags. The guards below prove those accessors
// hold the classification (the direct guard the `--canonical-wrapper` bug
// needed: a flag read as a switch but parsed as taking a value swallowed the
// file) and keep the help text in step with it.

import { describe, test, expect } from 'bun:test'
import { BOOLEAN_FLAGS, COMMAND_FLAGS, COMMAND_HELP, COMMAND_POSITIONALS, FLAG_SPECS, flagEnabled, flagValue, GLOBAL_USAGE, parseArgs, runCli } from '../cli/index.ts'
import { parseFlagsBlock } from './helpers/cli-flag-parsing.ts'
import { captureCli } from './helpers/cli-capture.ts'
import { useTempDirs } from './helpers/temp-dir.ts'

const temp = useTempDirs('am-flags-')

/** runCli with stdout and stderr captured together (diagnostics go to either). */
function capture(argv: string[]): { code: number; output: string } {
  const result = captureCli(() => runCli(argv))
  return { code: result.code, output: result.out + result.err }
}

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

  test('every switch a command accepts is documented in its help or the global Flags block', () => {
    const globalSwitches = new Set(parseFlagsBlock(GLOBAL_USAGE).filter(flag => !flag.takesArg).map(flag => flag.name))
    const undocumented = Object.entries(COMMAND_FLAGS).flatMap(([command, flags]) => flags
      .filter(name => BOOLEAN_FLAGS.has(name) && !globalSwitches.has(name))
      .filter(name => !new RegExp(`--${name}(?![\\w-])`).test(COMMAND_HELP[command] ?? ''))
      .map(name => `am ${command} --${name}`))
    expect(undocumented).toEqual([])
  })
})

describe('flags are read through typed accessors', () => {
  test('flagEnabled reads a switch given before a positional; flagValue reads a value', () => {
    const format = parseArgs(['format', '--canonical-wrapper', 'diagram.mmd'])
    expect({ wrapper: flagEnabled(format, 'canonical-wrapper'), positional: format.positional })
      .toEqual({ wrapper: true, positional: ['diagram.mmd'] })
    expect(flagEnabled(parseArgs(['format', 'diagram.mmd']), 'canonical-wrapper')).toBe(false)
    const render = parseArgs(['render', '--style', 'hand-drawn', 'diagram.mmd'])
    expect({ style: flagValue(render, 'style'), seed: flagValue(render, 'seed') }).toEqual({ style: 'hand-drawn', seed: undefined })
  })

  test('a value flag cannot be read as a switch, nor a switch as a value', () => {
    const args = parseArgs(['render', '--style', 'hand-drawn', '--json', 'diagram.mmd'])
    // @ts-expect-error --style takes a value: reading it as a switch is the --canonical-wrapper bug
    expect(() => flagEnabled(args, 'style')).toThrow('--style is not a boolean flag')
    // @ts-expect-error --json takes no value
    expect(() => flagValue(args, 'json')).toThrow('--json is not a value flag')
    // @ts-expect-error an unregistered flag has no accessor
    expect(() => flagValue(args, 'gantt-toady')).toThrow('--gantt-toady is not a value flag')
  })

  test('am format --canonical-wrapper <file> reads the file and canonicalizes its wrapper', () => {
    const file = temp.file('wrapped.mmd', '%%{init: {"theme": "dark"}}%%\nflowchart TD\n  A --> B\n')
    expect(captureCli(() => runCli(['format', '--canonical-wrapper', file]))).toEqual({
      code: 0,
      out: '---\nconfig:\n  theme: dark\n---\nflowchart TD\n  A --> B\n',
      err: '',
    })
  })
})

describe('command-specific flag validity', () => {

  test('batch keeps its documented --jsonl mode under command ownership checks', () => {
    const parsed = parseArgs(['batch', '--jsonl'])
    expect(parsed.flags.jsonl).toBe(true)
    expect(COMMAND_FLAGS.batch).toContain('jsonl')
    // Stop at positional validation instead of entering cmdBatch, whose stdin
    // is necessarily process-global and may be under the TTY guard test in a
    // concurrently executing file. Reaching this error proves --jsonl passed
    // command ownership validation without coupling this registry test to fd 0.
    const result = capture(['batch', '--jsonl', 'unexpected'])
    expect(result.code).toBe(2)
    expect(result.output).toContain('accepts no positional arguments')
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
  test('every boolean flag preserves a following positional', () => {
    for (const name of BOOLEAN_FLAGS) {
      if (name === 'help' || name === 'agent-instructions') continue
      const a = parseArgs(['render', `--${name}`, 'file.mmd'])
      expect({ name, flag: a.flags[name], hasFile: a.positional.includes('file.mmd') })
        .toEqual({ name, flag: true, hasFile: true })
    }
  })
})

describe('command help', () => {
  test('every command answers --help with its own usage', () => {
    for (const command of Object.keys(COMMAND_FLAGS)) {
      const result = captureCli(() => runCli([command, '--help']))
      expect({ command, code: result.code, err: result.err }).toEqual({ command, code: 0, err: '' })
      expect(result.out, command).toContain(`am ${command}`)
    }
  })

  test('help names the preview, batch-mutation, edit-policy, and skill-bundle affordances', () => {
    const help = (command: string) => captureCli(() => runCli([command, '--help'])).out
    expect(help('mutate')).toContain('--ops')
    expect(help('preview')).toContain('--open')
    expect(help('batch')).toContain('"mutate"')
    expect(help('capabilities')).toContain('editPolicy')
    expect(help('init-agent')).toContain('skills/agentic-mermaid-diagram-workflow/SKILL.md')
  })
})
