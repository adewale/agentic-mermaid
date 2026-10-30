import type { PngOutputOptionField } from '../png-contract.ts'

export interface ParsedArgs {
  command?: string
  positional: string[]
  flags: Record<string, string | boolean>
  errors: string[]
}

// Single source of truth for CLI flags. A flag with no `arg` is a boolean;
// `arg` is the usage placeholder shown in `[--flag <arg>]`. BOOLEAN_FLAGS is
// DERIVED from this, so the parser's boolean classification cannot drift from
// the documented usage.
const FLAG_SPEC_TABLE = {
  // booleans
  'agent-instructions': {},
  ascii: {},
  certificates: {},
  help: {},
  json: {},
  jsonl: {},
  watch: {},
  open: {},
  force: {},
  'canonical-wrapper': {},
  'preserve-source': {},
  'system-fonts': {},
  version: {},
  // value flags (placeholder = what the usage shows after the flag)
  suppress: { arg: 'CODES' },
  'label-cap': { arg: 'N' },
  op: { arg: 'JSON' },
  style: { arg: 'NAMES|file' },
  seed: { arg: 'N' },
  options: { arg: 'JSON|file' },
  'graph-layout': { arg: 'elk|agentic' },
  'graph-layout-fallback': { arg: 'none|elk' },
  ops: { arg: 'JSON|file' },
  output: { arg: 'FILE' },
  format: { arg: 'fmt' },
  security: { arg: 'mode' },
  dir: { arg: 'DIR' },
  'font-dirs': { arg: 'DIRS' },
  'gantt-today': { arg: 'DATE' },
  'target-width': { arg: 'CELLS' },
  // PNG raster knobs (read by cmdRender's png path since v4; registered so
  // the unknown-flag gate cannot reject them).
  scale: { arg: 'N' },
  bg: { arg: 'COLOR' },
  'fit-width': { arg: 'PX' },
  'fit-height': { arg: 'PX' },
  'min-label-px': { arg: 'PX' },
  o: { arg: 'FILE' },
} as const satisfies Record<string, { readonly arg?: string }>

export const FLAG_SPECS: Readonly<Record<string, { readonly arg?: string }>> = FLAG_SPEC_TABLE

export const BOOLEAN_FLAGS = new Set(Object.keys(FLAG_SPECS).filter(name => !FLAG_SPECS[name]!.arg))

type FlagName = keyof typeof FLAG_SPEC_TABLE
/** A flag that takes no value, so the parser never lets it consume the next argument. */
export type BooleanFlagName = { [Name in FlagName]: (typeof FLAG_SPEC_TABLE)[Name] extends { readonly arg: string } ? never : Name }[FlagName]
/** A flag whose value is the next argument (or follows `=`). */
export type ValueFlagName = Exclude<FlagName, BooleanFlagName>

/**
 * Whether switch `name` was given. Every CLI read of a switch goes through
 * here: the name type admits only arg-less FLAG_SPECS entries, so the code can
 * never treat as a switch a flag the parser lets swallow the next positional
 * (the `--canonical-wrapper` bug), and the runtime check holds the same line
 * for untyped callers.
 */
export function flagEnabled(args: ParsedArgs, name: BooleanFlagName): boolean {
  if (!BOOLEAN_FLAGS.has(name)) throw new Error(`--${name} is not a boolean flag`)
  return Boolean(args.flags[name])
}

/** The value given for value flag `name`, if any. runCli rejects a value
 * flag given without a value before any command reads it. */
export function flagValue(args: ParsedArgs, name: ValueFlagName): string | undefined {
  if (!(name in FLAG_SPECS) || BOOLEAN_FLAGS.has(name)) throw new Error(`--${name} is not a value flag`)
  const value = args.flags[name]
  return typeof value === 'string' ? value : undefined
}

/**
 * Explicit projection from the canonical PNG option authority to CLI syntax.
 * Empty means the field is adapter-owned rather than caller-supplied: the CLI
 * installs `onWarning` itself so warnings can be emitted safely on stderr.
 */
export const PNG_CLI_FLAG_BINDINGS = Object.freeze({
  scale: Object.freeze(['scale']),
  background: Object.freeze(['bg']),
  fitTo: Object.freeze(['fit-width', 'fit-height']),
  minLabelPx: Object.freeze(['min-label-px']),
  fontDirs: Object.freeze(['font-dirs']),
  loadSystemFonts: Object.freeze(['system-fonts']),
  onWarning: Object.freeze([]),
} as const satisfies Readonly<Record<PngOutputOptionField, readonly string[]>>)

export const PNG_RENDER_FLAGS = Object.freeze(Object.values(PNG_CLI_FLAG_BINDINGS).flat())

// Command ownership is the second half of the flag contract: recognizing a
// name globally is not permission to ignore it on an unrelated command.
export const COMMAND_FLAGS = {
  render: ['help', 'json', 'certificates', 'watch', 'style', 'seed', 'options', 'graph-layout', 'graph-layout-fallback', 'output', 'format', 'security', 'gantt-today', 'target-width', ...PNG_RENDER_FLAGS, 'o'],
  verify: ['help', 'json', 'suppress', 'label-cap', 'style'],
  parse: ['help', 'json'],
  serialize: ['help'],
  mutate: ['help', 'json', 'op', 'ops', 'preserve-source'],
  preview: ['help', 'json', 'output', 'open', 'security'],
  format: ['help', 'canonical-wrapper'],
  describe: ['help', 'json', 'format'],
  capabilities: ['help', 'json'],
  styles: ['help', 'json'],
  'llms-txt': ['help'],
  'init-agent': ['help', 'json', 'dir', 'force'],
  batch: ['help', 'jsonl'],
  'render-markdown': ['help', 'ascii'],
} as const satisfies Record<string, readonly string[]>

/** Closed positional contract. Zero source arguments means piped stdin; only
 * render intentionally accepts multiple files. */
export const COMMAND_POSITIONALS = Object.freeze({
  render: { min: 0, max: Number.POSITIVE_INFINITY },
  verify: { min: 0, max: 1 },
  parse: { min: 0, max: 1 },
  serialize: { min: 0, max: 0 },
  mutate: { min: 0, max: 1 },
  preview: { min: 0, max: 1 },
  format: { min: 0, max: 1 },
  describe: { min: 0, max: 1 },
  capabilities: { min: 0, max: 0 },
  styles: { min: 0, max: 0 },
  'llms-txt': { min: 0, max: 0 },
  'init-agent': { min: 0, max: 0 },
  batch: { min: 0, max: 0 },
  'render-markdown': { min: 0, max: 1 },
} as const satisfies Record<keyof typeof COMMAND_FLAGS, { readonly min: number; readonly max: number }>)

export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positional: [], flags: {}, errors: [] }
  const record = (name: string, value: string | boolean) => {
    if (Object.prototype.hasOwnProperty.call(out.flags, name)) {
      out.errors.push(`Flag --${name} may be supplied only once.`)
      return
    }
    out.flags[name] = value
  }
  let i = 0
  while (i < argv.length) {
    const arg = argv[i]!
    if (arg === '--') {
      for (const positional of argv.slice(i + 1)) {
        if (!out.command) out.command = positional
        else out.positional.push(positional)
      }
      break
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = arg.slice(2, eq === -1 ? undefined : eq)
      if (eq !== -1) {
        if (BOOLEAN_FLAGS.has(name)) out.errors.push(`Flag --${name} does not accept a value.`)
        record(name, arg.slice(eq + 1))
      } else {
        const next = argv[i + 1]
        if (BOOLEAN_FLAGS.has(name) || next === undefined || next.startsWith('--')) record(name, true)
        else {
          record(name, next)
          i++
        }
      }
    } else if (arg === '-v') record('version', true) // the only short alias
    else if (!out.command) out.command = arg
    else out.positional.push(arg)
    i++
  }
  return out
}
