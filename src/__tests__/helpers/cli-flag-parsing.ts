// Move 4: shared flag-doc parsers, extracted from cli-flags-help-sync so the
// global-block and per-command-usage parsers (and any future MCP-help sync) use
// one implementation.

export interface FlagDoc { name: string; takesArg: boolean }

/** Parse the aligned `Flags:` block of GLOBAL_USAGE. */
export function parseFlagsBlock(usage: string): FlagDoc[] {
  const lines = usage.split('\n')
  const start = lines.findIndex(l => /^Flags:/.test(l))
  if (start < 0) return []
  const out: FlagDoc[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!
    if (line.trim() === '' || /^\S/.test(line)) break  // block ends at a blank/unindented line
    // `  --flag <ARG>   desc`  or  `  --flag   desc`. The \b must sit right after
    // the name; an <ARG> ends in `>` (non-word) so a \b after it would mask the arg.
    const m = line.match(/^\s+--([A-Za-z][\w-]*)\b(\s+<[^>]+>)?/)
    if (m) out.push({ name: m[1]!, takesArg: Boolean(m[2]) })
  }
  return out
}

/**
 * Flag names read from CLI source in an unambiguously BOOLEAN context
 * (`flags.x ?`, `flags['x'] ?`, `=== true`, `Boolean(flags.x)`, `if (flags.x)`).
 * Used to assert every boolean-used flag is registered (Move 2).
 */
export function booleanFlagReads(source: string): Set<string> {
  const names = new Set<string>()
  const accessor = String.raw`flags(?:\.([A-Za-z][\w]*)|\['([A-Za-z][\w-]*)'\])`
  const patterns = [
    new RegExp(`${accessor}\\s*\\?`, 'g'),            // flags.x ? …
    new RegExp(`${accessor}\\s*===\\s*true`, 'g'),    // flags.x === true
    new RegExp(`Boolean\\(\\s*args\\.${accessor}`, 'g'), // Boolean(args.flags.x)
    new RegExp(`if\\s*\\(\\s*args\\.${accessor}\\s*\\)`, 'g'), // if (args.flags.x)
  ]
  for (const re of patterns) {
    for (const m of source.matchAll(re)) {
      const name = m[1] ?? m[2]
      if (name) names.add(name)
    }
  }
  return names
}
