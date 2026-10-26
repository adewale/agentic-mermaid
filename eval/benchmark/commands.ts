import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertBenchmarkExecutionAllowed } from './ci-policy.ts'

const directory = dirname(fileURLToPath(import.meta.url))
const help = `Trident — local Mermaid artifact benchmarks and retained evidence

node commands.ts build [--out FRESH_DIRECTORY]
node commands.ts run --project OWNER/TOOL --artifact-root INSTALLED_PACKAGE [options]
node commands.ts fidelity:report --core REPORT [--community REPORT] --out DIRECTORY
node commands.ts export --input FILE [--out FRESH_FILE]

build defaults to portable/dist. run requires that compiled kit and uses Node 24;
set NODE_BIN to its executable. A custom --out kit runs via node KIT/run.mjs.
These commands need no Agentic checkout. Build accepts Node 24 or Bun 1.4+.

Optional Agentic Mermaid source adapter (Bun):
  bun commands.ts agentic --list --profile full
  bun commands.ts community [options]
  bun commands.ts community:update [options]
  bun commands.ts prs [options]
Set TRIDENT_AGENTIC_ROOT to an Agentic Mermaid checkout. Its owning protocols run
there. The containing checkout is detected only when its package name is
agentic-mermaid. AM_BENCH_REPOSITORY_ROOT remains a compatibility alias.

Aliases: bench=agentic, portable:build=build. portable keeps legacy source-mode
execution with its committed-source identity; run uses compiled measurement bytes.
Maintainer checks: test, typecheck, lint. Full tests/typechecking include optional
Agentic source adapters; run them in the Agentic checkout.
All measurement commands reject CI. --help does not start a benchmark.
`

function sourceCheckout(): string {
  const explicit = process.env.TRIDENT_AGENTIC_ROOT ?? process.env.AM_BENCH_REPOSITORY_ROOT
  const candidate = resolve(explicit ?? resolve(directory, '../..'))
  let agentic = false
  try {
    agentic = JSON.parse(readFileSync(resolve(candidate, 'package.json'), 'utf8')).name === 'agentic-mermaid'
  } catch {}
  if (!agentic) throw Error('Optional Agentic source adapter unavailable. Set TRIDENT_AGENTIC_ROOT to an Agentic Mermaid checkout; standalone run/build/fidelity:report do not require it.')
  return candidate
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === '--help' || command === 'help') {
    console.log(help)
    return
  }
  const aliases: Record<string, string> = { 'portable:build': 'build', bench: 'agentic' }
  const selected = Object.hasOwn(aliases, command) ? aliases[command]! : command
  const neutral: Record<string, string> = { build: 'portable/build.ts', portable: 'portable/run.ts', 'fidelity:report': 'fidelity/report.ts' }
  const source: Record<string, string> = { agentic: 'unified/run.ts', community: 'unified/community-campaign.ts', 'community:update': 'unified/project-update.ts', prs: 'unified/pr-campaign.ts' }
  const checks: Record<string, string[]> = {
    test: ['test', '--timeout', '30000', '--parallel=2', resolve(directory, 'tests')],
    typecheck: ['x', '--no-install', 'tsc', '--noEmit', '-p', resolve(directory, 'tsconfig.json')],
    lint: ['x', '--no-install', 'biome', 'lint', '--config-path', resolve(directory, 'biome.json'), directory],
  }
  if (selected === 'export') {
    const usage = 'export --input FILE [--out FRESH_FILE]'
    if (args.length === 1 && args[0] === '--help') {
      console.log('node commands.ts ' + usage)
      return
    }
    const paths = new Map<string, string>()
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index]!,
        value = args[index + 1]
      if (!['--input', '--out'].includes(flag) || paths.has(flag) || !value || value.startsWith('--')) throw Error('Use ' + usage)
      paths.set(flag, resolve(directory, value))
    }
    if (!paths.has('--input')) throw Error('Use ' + usage)
    const { readBenchmarkDocument } = await import('./portable/project-records.ts')
    const output = JSON.stringify(readBenchmarkDocument(paths.get('--input')!), null, 2) + '\n'
    if (paths.has('--out')) writeFileSync(paths.get('--out')!, output, { flag: 'wx' })
    else process.stdout.write(output)
    return
  }
  if (selected !== 'run' && !Object.hasOwn(neutral, selected) && !Object.hasOwn(source, selected) && !Object.hasOwn(checks, selected)) throw Error(`Unknown Trident command ${command}; use --help`)
  if (selected === 'build' && args.length === 1 && args[0] === '--help') {
    console.log('node commands.ts build [--out FRESH_DIRECTORY]\nDefault: portable/dist. Copy the complete generated kit and its manifest; execute run.mjs with plain Node 24.')
    return
  }
  let cwd = directory,
    executable = process.execPath,
    argv: string[]
  if (selected === 'run') {
    const compiled = resolve(directory, 'portable/dist/run.mjs')
    if (!existsSync(compiled) || !existsSync(resolve(directory, 'portable/dist/harness-artifact.json'))) throw Error('Trident compiled kit is missing. Run node commands.ts build first; a custom --out kit runs via node KIT/run.mjs.')
    executable = process.env.NODE_BIN ?? (process.versions.bun ? 'node' : process.execPath)
    argv = [compiled]
  } else if (source[selected] || selected === 'test') {
    cwd = sourceCheckout()
    if (!process.versions.bun) throw Error('The optional Agentic source adapter and maintainer tests require Bun 1.4 or later. Neutral build/run/fidelity:report accept Node 24.')
    const script = source[selected] && resolve(cwd, 'eval/benchmark', source[selected]!)
    if (script && !existsSync(script)) throw Error('The selected Agentic checkout does not contain its owning protocol: ' + script)
    argv = script ? ['run', script] : checks.test!
  } else if (neutral[selected]) {
    const script = resolve(directory, neutral[selected]!)
    argv = process.versions.bun ? ['run', script] : [script]
  } else if (checks[selected]) {
    if (!process.versions.bun) throw Error('Maintainer checks require Bun 1.4 or later')
    argv = checks[selected]!
  } else throw Error(`Unknown Trident command ${command}; use --help`)
  assertBenchmarkExecutionAllowed()
  const result = spawnSync(executable, [...argv, ...args], { cwd, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
await main()
