// Every CLI invocation written in the maintained docs must be one the CLI
// accepts: the verb exists, each --flag belongs to that verb, and each --format
// value is one the verb takes. The oracles are the CLI's own closed tables
// (COMMAND_FLAGS, CLI_RENDER_FORMATS, DESCRIBE_FORMATS, MCP_FLAG_SPECS); for
// flags that work without a verb, which the CLI decides inline, the test asks
// the CLI itself. A doc showing `am render --format json` fails here.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isDescribeFormat } from '../agent/describe.ts'
import { COMMAND_FLAGS, COMMAND_HELP, parseArgs, runCli } from '../cli/index.ts'
import { AGENTS_SNIPPET, INIT_SKILL_MD } from '../cli/init-agent.ts'
import { runAmCli } from '../cli/run-entrypoint.ts'
import { MCP_CLI_HELP, MCP_FLAG_SPECS, parseMcpCliOptions } from '../mcp/mcp-cli.ts'
import { isCliRenderFormat } from '../render-contract.ts'
import { captureCli, captureCliAsync } from './helpers/cli-capture.ts'
import { handMaintainedText, maintainedMarkdownFiles, REPO_ROOT } from './helpers/maintained-docs.ts'

// ---------------------------------------------------------------------------
// Extraction: doc text → shell-ish snippets → words → invocations
// ---------------------------------------------------------------------------

/** Stands in for an unquoted `|` inside a word: usage alternation (`svg|png`). */
const ALT = '\uE000'

/** A shell word. `alts` splits it on unquoted `|`, with usage brackets trimmed. */
interface Word { raw: string; alts: string[] }
type Cli = 'am' | 'mcp'
interface Invocation { cli: Cli; args: Word[]; text: string }

/** An inline span such as `render --format png` is the CLI without its `am`. */
const BARE_VERB = new RegExp(`^(?:${Object.keys(COMMAND_FLAGS).join('|')}) --`)

/** Fences that hold commands; `ts`, `json`, `mermaid`… hold code, whose comments may cite `am parse | am serialize`. */
const SHELL_FENCES = new Set(['', 'bash', 'sh', 'shell', 'zsh', 'console', 'text', 'txt'])

/** Each logical line of every shell fence (`\` continuations joined) and every inline code span. */
function markdownSnippets(markdown: string): string[] {
  const snippets: string[] = []
  const prose: string[] = []
  let fence: { marker: string; shell: boolean } | undefined
  let continued = ''
  for (const line of markdown.split('\n')) {
    const open = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1]
    if (fence === undefined) {
      if (open) fence = { marker: open[1]!, shell: SHELL_FENCES.has(open[2]!.toLowerCase()) }
      else prose.push(line)
    } else if (close && close[0] === fence.marker[0] && close.length >= fence.marker.length) {
      fence = undefined
    } else if (!fence.shell) {
      continue
    } else if (line.trimEnd().endsWith('\\')) {
      continued += `${line.trimEnd().slice(0, -1)} `
    } else {
      snippets.push(continued + line)
      continued = ''
    }
  }
  for (const paragraph of prose.join('\n').split(/\n\s*\n/)) {
    for (const match of paragraph.matchAll(/(`+)([^`][\s\S]*?)\1(?!`)/g)) {
      // GFM tables escape a pipe inside code as `\|`; the reader sees `|`.
      const span = match[2]!.replace(/\s+/g, ' ').replace(/\\\|/g, '|').trim()
      snippets.push(BARE_VERB.test(span) ? `am ${span}` : span)
    }
  }
  return snippets
}

/** Plain help text: every line, plus every '…'-quoted span (help cites commands as 'am serialize'). */
function helpTextSnippets(text: string): string[] {
  return [...text.split('\n'), ...Array.from(text.matchAll(/'([^'\n]+)'/g), match => match[1]!)]
}

/** llms.txt lists verbs as `- render --format svg, ascii … — prose` bullets under `## CLI verbs`. */
function llmsTxtVerbLines(text: string): string[] {
  const section = text.split(/^## /m).find(part => part.startsWith('CLI verbs')) ?? ''
  return section.split('\n')
    .filter(line => line.startsWith('- '))
    .map(line => `am ${line.slice(2).split(' — ')[0]!.replace(/,\s+/g, '|')}`)
}

/** Quote-aware words; `<placeholder>` stays whole, `;` stands alone, `#` starts a comment. */
function shellWords(line: string): Word[] {
  const words: string[] = []
  let word: string | undefined
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!
    if (/\s/.test(c) || c === ';') {
      if (word !== undefined) words.push(word)
      if (c === ';') words.push(';')
      word = undefined
      continue
    }
    if (c === '#' && word === undefined) break
    let chunk = c
    if (c === "'") {
      const end = line.indexOf("'", i + 1)
      chunk = line.slice(i + 1, end < 0 ? undefined : end)
      i = end < 0 ? line.length : end
    } else if (c === '"') {
      chunk = ''
      for (i++; i < line.length && line[i] !== '"'; i++) chunk += line[i] === '\\' ? (line[++i] ?? '') : line[i]
    } else if (c === '\\') {
      chunk = line[++i] ?? ''
    } else if (c === '<' && word === undefined && /[^\s<(]/.test(line[i + 1] ?? ' ') && line.includes('>', i)) {
      const end = line.indexOf('>', i)
      chunk = line.slice(i, end + 1)
      i = end
    } else if (c === '|') {
      chunk = ALT
    }
    word = (word ?? '') + chunk
  }
  if (word !== undefined) words.push(word)
  return words.map(raw => ({ raw, alts: raw.split(ALT).map(alt => alt.replace(/^[[(]+|[\])]+$/g, '')).filter(Boolean) }))
}

/** Drop `> out.svg`, `2>&1`, `< in.mmd`. */
function withoutRedirects(words: Word[]): Word[] {
  const kept: Word[] = []
  for (let i = 0; i < words.length; i++) {
    const redirect = /^(?:\d|&)?>>?|^<$/.exec(words[i]!.raw)
    if (!redirect) kept.push(words[i]!)
    else if (redirect[0] === words[i]!.raw) i++
  }
  return kept
}

const AM_BIN = /^(?:am|agentic-mermaid(?:@\S+)?)$/
const MCP_BIN = /^agentic-mermaid-mcp(?:@\S+)?$/
const AM_SCRIPT = /(?:^|\/)(?:bin\/am\.ts|dist\/am\.js)$/
const MCP_SCRIPT = /(?:^|\/)(?:bin\/agentic-mermaid-mcp\.ts|dist\/agentic-mermaid-mcp\.js)$/

function invocationOf(segment: Word[]): Invocation | undefined {
  const raw = (i: number) => segment[i]?.raw ?? ''
  let i = 0
  while (raw(i) === '$' || /^[A-Z_][A-Z0-9_]*=/.test(raw(i))) i++ // prompt, env assignments
  let program = raw(i)
  if (program === 'npx' || program === 'bunx') {
    for (i++; raw(i).startsWith('-'); i++) if (raw(i) === '-p' || raw(i) === '--package') i++
    program = raw(i)
  } else if (program === 'bun' || program === 'node') {
    i += raw(i + 1) === 'run' ? 2 : 1
    program = AM_SCRIPT.test(raw(i)) ? 'am' : MCP_SCRIPT.test(raw(i)) ? 'agentic-mermaid-mcp' : ''
  }
  let cli: Cli | undefined = AM_BIN.test(program) ? 'am' : MCP_BIN.test(program) ? 'mcp' : undefined
  if (!cli) return undefined
  let args = withoutRedirects(segment.slice(i + 1))
  if (cli === 'am' && args[0]?.raw === 'mcp') {
    cli = 'mcp' // runAmCli's route to the MCP CLI
    args = args.slice(1)
  }
  return { cli, args, text: segment.map(word => word.raw.replaceAll(ALT, '|')).join(' ') }
}

/** Split at pipes, `&&`, `||`, `;`. A spaced `|` before a flag is usage alternation: `(--op X | --ops Y)`. */
function invocations(snippet: string): Invocation[] {
  const words = shellWords(snippet)
  const segments: Word[][] = [[]]
  words.forEach((word, i) => {
    const bar = word.raw === ALT || word.raw === ALT + ALT
    const alternation = bar && (words[i + 1]?.alts[0]?.startsWith('-') ?? false)
    if ((bar && !alternation) || word.raw === '&&' || word.raw === ';') segments.push([])
    else if (!bar) segments.at(-1)!.push(word)
  })
  return segments.flatMap(segment => invocationOf(segment) ?? [])
}

// ---------------------------------------------------------------------------
// Checking against the CLI's own authorities
// ---------------------------------------------------------------------------

const cliVerdicts = new Map<string, boolean>()
function cliAccepts(argv: string[]): boolean {
  const key = argv.join('\0')
  if (!cliVerdicts.has(key)) cliVerdicts.set(key, captureCli(() => runCli(argv)).code === 0)
  return cliVerdicts.get(key)!
}

/** Who decides each verb's --format values. */
const FORMAT_ACCEPTED: Record<string, (value: string) => boolean> = {
  render: isCliRenderFormat,
  describe: isDescribeFormat,
}

const SHORT_OPTION_ACCEPTED: Record<Cli, (option: string) => boolean> = {
  am: option => Object.keys(parseArgs([option]).flags).length > 0,
  mcp: option => {
    try {
      parseMcpCliOptions([option])
      return true
    } catch {
      return false
    }
  },
}

const isPlaceholder = (text: string) => /^(?:<|\.\.\.|…|\$|\{)/.test(text)

/** Every --flag the args show, with the words it is shown taking as a value. */
function flagUses(args: Word[]): { flags: Array<{ name: string; values: string[] }>; shortOptions: string[] } {
  const flags: Array<{ name: string; values: string[] }> = []
  const shortOptions: string[] = []
  args.forEach((word, i) => word.alts.forEach((alt, a) => {
    const flag = /^--([A-Za-z][\w-]*)(=.*)?/.exec(alt)
    const next = args[i + 1]
    if (flag) {
      const values = flag[2] !== undefined ? [flag[2].slice(1), ...word.alts.slice(a + 1)] : next && !next.alts[0]?.startsWith('-') ? next.alts : []
      flags.push({ name: flag[1]!, values })
    } else if (/^-[A-Za-z]/.test(alt)) shortOptions.push(alt)
  }))
  return { flags, shortOptions }
}

function problemsOf(invocation: Invocation): string[] {
  const { cli, args } = invocation
  const { flags, shortOptions } = flagUses(args)
  const problems = shortOptions.filter(option => !SHORT_OPTION_ACCEPTED[cli](option)).map(option => `${option} is not an option ${cli} parses`)
  if (cli === 'mcp') {
    return [...problems, ...flags.filter(flag => !(flag.name in MCP_FLAG_SPECS)).map(flag => `--${flag.name} is not an agentic-mermaid-mcp flag`)]
  }
  const verb = args[0]?.alts[0]
  if (verb === undefined || isPlaceholder(verb)) return problems // `am`, `am <verb>`: a name, not a command
  if (verb.startsWith('-')) {
    return [...problems, ...flags.filter(flag => !cliAccepts([`--${flag.name}`])).map(flag => `--${flag.name} is not accepted without a verb`)]
  }
  const allowed = (COMMAND_FLAGS as Record<string, readonly string[]>)[verb]
  if (!allowed) return [...problems, `unknown verb "${verb}"`]
  for (const flag of flags) {
    if (!allowed.includes(flag.name)) problems.push(`--${flag.name} is not a flag of am ${verb}`)
    else if (flag.name === 'format') {
      const values = flag.values.flatMap(value => value.split(',')).map(value => value.replace(/[.;:]+$/, '')).filter(value => value !== '' && !isPlaceholder(value))
      for (const value of values) if (!FORMAT_ACCEPTED[verb]!(value)) problems.push(`--format ${value} is not accepted by am ${verb}`)
    }
  }
  return problems
}

function docSources(): Array<{ file: string; snippets: string[] }> {
  const read = (file: string) => readFileSync(join(REPO_ROOT, file), 'utf8')
  const llms = read('llms.txt')
  return [
    ...maintainedMarkdownFiles().map(file => ({ file, snippets: markdownSnippets(handMaintainedText(read(file))) })),
    { file: 'llms.txt', snippets: [...markdownSnippets(llms), ...llmsTxtVerbLines(llms)] },
    { file: 'src/cli/init-agent.ts AGENTS_SNIPPET', snippets: markdownSnippets(AGENTS_SNIPPET) },
    { file: 'src/cli/init-agent.ts INIT_SKILL_MD', snippets: markdownSnippets(INIT_SKILL_MD) },
    ...Object.entries(COMMAND_HELP).map(([verb, help]) => ({ file: `src/cli/index.ts COMMAND_HELP.${verb}`, snippets: helpTextSnippets(help) })),
    { file: 'src/mcp/mcp-cli.ts MCP_CLI_HELP', snippets: helpTextSnippets(MCP_CLI_HELP) },
  ]
}

// ---------------------------------------------------------------------------

const summary = (invocation: Invocation) => [invocation.cli, ...invocation.args.map(word => word.alts.join('|'))].join(' ')
const problemsIn = (snippet: string) => invocations(snippet).flatMap(problemsOf)

describe('doc CLI invocation extractor', () => {
  test('reads usage syntax, --x=y, pipes, redirects, continuations, and runners', () => {
    const markdown = [
      'Run `am render <file|-> [--format svg|ascii] [--security strict]`, `render --json`, or `am <verb>`.',
      '| `am render x --format png\\|svg` | table cell |',
      '```bash',
      '$ am parse flow.mmd | am serialize > out.mmd 2>&1',
      'npx -y agentic-mermaid@latest render a.mmd \\',
      '  --format=png --output a.png  # comment --nope',
      "am mutate <file|-> (--op '<JSON>' | --ops '<JSON array|file>') [--fit-width PX|--fit-height PX]",
      'echo x | jq . && bun run bin/am.ts --help',
      'npx -y agentic-mermaid mcp --transport=http --port 3000; agentic-mermaid-mcp',
      '```',
    ].join('\n')
    expect(markdownSnippets(markdown).flatMap(invocations).map(summary)).toEqual([
      'am parse flow.mmd',
      'am serialize',
      'am render a.mmd --format=png --output a.png',
      'am mutate <file|-> --op <JSON> --ops <JSON array|file> --fit-width PX|--fit-height PX',
      'am --help',
      'mcp --transport=http --port 3000',
      'mcp',
      'am render <file|-> --format svg|ascii --security strict',
      'am render --json',
      'am <verb>',
      'am render x --format png|svg',
    ])
  })

  test('llms.txt verb bullets read as am invocations', () => {
    expect(llmsTxtVerbLines('## CLI verbs\n\n- render --format svg, png [--json] — prose, more\n- parse — prose\n\n## Other\n- not a verb')).toEqual([
      'am render --format svg|png [--json]',
      'am parse',
    ])
  })

  test('the checker reports verbs, flags, and format values the CLI rejects', () => {
    expect(problemsIn('am render x --format png|json --bogus -o out.png')).toEqual([
      '-o is not an option am parses',
      '--format json is not accepted by am render',
      '--bogus is not a flag of am render',
    ])
    expect(problemsIn('am describe x --format facts|prose && am frobnicate && am --version && am <cmd> --help')).toEqual([
      '--format prose is not accepted by am describe',
      'unknown verb "frobnicate"',
      '--version is not accepted without a verb',
    ])
    expect(problemsIn('agentic-mermaid-mcp -h --transport http --verbose -p 1')).toEqual([
      '-p is not an option mcp parses',
      '--verbose is not an agentic-mermaid-mcp flag',
    ])
    expect(problemsIn('am --agent-instructions && am render x --format=layout --certificates')).toEqual([])
  })

  test('every verb that owns --format has a value authority', () => {
    const owners = Object.entries(COMMAND_FLAGS).filter(([, flags]) => (flags as readonly string[]).includes('format')).map(([verb]) => verb)
    expect(owners.sort()).toEqual(Object.keys(FORMAT_ACCEPTED).sort())
  })

  test('`am mcp …` reaches the MCP CLI, as the extractor assumes', async () => {
    expect(await captureCliAsync(() => runAmCli(['mcp', '--help']))).toEqual({ code: 0, out: MCP_CLI_HELP, err: '' })
  })
})

describe('documented CLI invocations', () => {
  test('every code-owned source yields invocations to check', () => {
    const empty = docSources()
      .filter(source => !source.file.endsWith('.md') && source.snippets.flatMap(invocations).length === 0)
      .map(source => source.file)
    expect(empty).toEqual([])
    expect(llmsTxtVerbLines(readFileSync(join(REPO_ROOT, 'llms.txt'), 'utf8')).length).toBeGreaterThan(0)
  })

  test('every CLI invocation in the docs is one the CLI accepts', () => {
    const problems = docSources().flatMap(({ file, snippets }) =>
      snippets.flatMap(invocations).flatMap(invocation => problemsOf(invocation).map(problem => ({ file, invocation: invocation.text, problem }))))
    expect(problems).toEqual([])
  })
})
