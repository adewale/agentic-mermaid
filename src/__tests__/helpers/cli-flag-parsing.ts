// Move 4: the shared flag-doc parser, extracted from cli-flags-help-sync so the
// global-block parser (and any future MCP-help sync) has one implementation.

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
