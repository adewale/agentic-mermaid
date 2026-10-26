import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import pins from '../tool-versions.json' with { type: 'json' }

/** The one pinned Mermaid every run consults: which sources are valid Mermaid, which
 * families exist, Dave's comparator and the tests. It is an installed npm reference
 * (mermaid, its parser and jsdom), never the artifact under measurement. */
export const MERMAID_ORACLE_PIN = {
  version: pins.tools[pins.mermaidOracle.tool as 'mermaid-js/mermaid'].version,
  parser: pins.mermaidOracle.dependencies['@mermaid-js/parser'],
  dom: pins.mermaidOracle.dependencies.jsdom,
}
export interface MermaidOracle {
  directory: string
  version: string
  parserVersion: string
  domVersion: string
  integrity: string | null
}
export interface MermaidVerdict {
  accepted: boolean
  diagramType: string | null
  error: string | null
}

const here = dirname(fileURLToPath(import.meta.url))
const packageName = (directory: string) => {
  try {
    return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name as string
  } catch {
    return undefined
  }
}
/** The Agentic checkout this harness runs from or for, if any. */
function agenticCheckout(environment: NodeJS.ProcessEnv): string | undefined {
  const configured = environment.TRIDENT_AGENTIC_ROOT ?? environment.AM_BENCH_REPOSITORY_ROOT
  if (configured) return resolve(configured)
  for (let directory = here, depth = 0; depth < 5; depth++, directory = dirname(directory)) if (packageName(directory) === 'agentic-mermaid') return directory
}
/** Beside the Agentic checkout, else beside the Trident package or compiled kit. Sibling
 * checkouts therefore share one ../mermaid-reference, as `bun run reference:mermaid` installs. */
function harnessRoot(environment: NodeJS.ProcessEnv): string {
  const agentic = agenticCheckout(environment)
  if (agentic) return agentic
  for (let directory = here, depth = 0; depth < 3; depth++, directory = dirname(directory)) if (packageName(directory) === 'trident') return directory
  return here
}
export const mermaidOracleDirectory = (environment: NodeJS.ProcessEnv = process.env) => resolve(environment.MERMAID_REFERENCE_DIR ?? join(harnessRoot(environment), '../mermaid-reference'))
/** The pinned Mermaid source checkout that upstream-test and Dave corpora read. */
export const mermaidUpstreamDirectory = (environment: NodeJS.ProcessEnv = process.env) => resolve(environment.MERMAID_UPSTREAM_DIR ?? join(harnessRoot(environment), '../mermaid'))

function installHint(environment: NodeJS.ProcessEnv) {
  const agentic = agenticCheckout(environment)
  return `Install it with \`node commands.ts mermaid:install\`${agentic ? ' or `bun run reference:mermaid` in the Agentic checkout' : ''}, or set MERMAID_REFERENCE_DIR to an existing install.`
}

/** Verify the installed oracle is exactly the pin; throw an actionable refusal otherwise. */
export function admitMermaidOracle(directory: string, environment: NodeJS.ProcessEnv = process.env): MermaidOracle {
  const pin = MERMAID_ORACLE_PIN
  const refuse = (problem: string): never => {
    throw Error(`Trident needs the pinned Mermaid oracle (mermaid ${pin.version}, @mermaid-js/parser ${pin.parser}, jsdom ${pin.dom}) at ${directory}: ${problem}. ${installHint(environment)}`)
  }
  // Node honours package exports, which need not expose package.json; find the directory instead.
  const manifest = (require: NodeJS.Require, name: string) => require.resolve.paths(name)?.map(directory => join(directory, name, 'package.json')).find(path => existsSync(path)) ?? refuse(`${name} is not installed`)
  const version = (require: NodeJS.Require, name: string) => JSON.parse(readFileSync(manifest(require, name), 'utf8')).version as string
  if (!existsSync(join(directory, 'package.json'))) refuse('no install exists')
  const require = createRequire(join(directory, 'package.json'))
  const installed = { version: version(require, 'mermaid'), parserVersion: version(createRequire(manifest(require, 'mermaid')), '@mermaid-js/parser'), domVersion: version(require, 'jsdom') }
  if (installed.version !== pin.version || installed.parserVersion !== pin.parser || installed.domVersion !== pin.dom) refuse(`found mermaid ${installed.version}, @mermaid-js/parser ${installed.parserVersion}, jsdom ${installed.domVersion}`)
  const agentic = agenticCheckout(environment)
  const policy = agentic && join(agentic, 'docs/project/upstream-mermaid-policy.json')
  if (policy && existsSync(policy)) {
    const product = JSON.parse(readFileSync(policy, 'utf8')).pin?.version
    if (product !== pin.version) throw Error(`Trident's Mermaid oracle pin ${pin.version} differs from ${policy} (${product}); one pinned Mermaid must serve both`)
  }
  let integrity: string | null = null
  try {
    integrity = JSON.parse(readFileSync(join(directory, 'package-lock.json'), 'utf8')).packages?.['node_modules/mermaid']?.integrity ?? null
  } catch {}
  return { directory, ...installed, integrity }
}

/** Every benchmark run and test run refuses to start without the oracle. Children inherit
 * the admitted directory, so a worker trusts its controller's admission. */
export function assertMermaidOracle(environment: NodeJS.ProcessEnv = process.env): MermaidOracle {
  const directory = mermaidOracleDirectory(environment)
  if (environment.TRIDENT_MERMAID_ORACLE === `${MERMAID_ORACLE_PIN.version} ${directory}` && existsSync(directory)) return { directory, version: MERMAID_ORACLE_PIN.version, parserVersion: MERMAID_ORACLE_PIN.parser, domVersion: MERMAID_ORACLE_PIN.dom, integrity: null }
  const oracle = admitMermaidOracle(directory, environment)
  environment.MERMAID_REFERENCE_DIR = directory
  environment.TRIDENT_MERMAID_ORACLE = `${oracle.version} ${directory}`
  return oracle
}

/** Install the pin with npm, as Agentic's setup-mermaid-reference.sh does. */
export function installMermaidOracle(directory = mermaidOracleDirectory()): MermaidOracle {
  const pin = MERMAID_ORACLE_PIN
  const result = spawnSync('npm', ['install', '--prefix', directory, '--save-exact', '--no-audit', '--no-fund', '--ignore-scripts', `mermaid@${pin.version}`, `@mermaid-js/parser@${pin.parser}`, `jsdom@${pin.dom}`], { stdio: 'inherit' })
  if (result.status !== 0) throw Error(`npm could not install the Mermaid oracle into ${directory}`)
  return admitMermaidOracle(directory)
}

/** Ask the oracle whether each source is valid Mermaid, in one Node/jsdom process. */
export async function mermaidVerdicts(oracle: MermaidOracle, sources: readonly string[]): Promise<MermaidVerdict[]> {
  if (!sources.length) return []
  const child = spawn(process.env.NODE_BIN ?? 'node', [join(here, 'mermaid-oracle-worker.mjs'), oracle.directory], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', data => (stderr = (stderr + String(data)).slice(-2000)))
  const replies: MermaidVerdict[] = []
  const lines = createInterface({ input: child.stdout })
  const done = new Promise<void>((resolveDone, reject) => {
    lines.on('line', line => {
      replies.push(JSON.parse(line))
      if (replies.length === sources.length) child.stdin.end()
    })
    child.once('error', reject)
    child.once('close', code => (replies.length === sources.length ? resolveDone() : reject(Error(`Mermaid oracle stopped after ${replies.length}/${sources.length} verdicts (exit ${code}): ${stderr}`))))
  })
  for (const source of sources) child.stdin.write(JSON.stringify(source).replace(/[\u2028\u2029]/g, c => `\\u${c.charCodeAt(0).toString(16)}`) + '\n')
  await done
  return replies
}

export interface OracleExpectation {
  id: string
  source: string
  accept: boolean
}
/** Refuse a run whose authored accept/reject expectations the pinned Mermaid contradicts;
 * return the oracle's diagram type for each accepted source. */
export async function assertOracleAgrees(oracle: MermaidOracle, expectations: readonly OracleExpectation[]): Promise<Record<string, string | null>> {
  const verdicts = await mermaidVerdicts(oracle, expectations.map(expectation => expectation.source))
  const disagreements = expectations.flatMap((expectation, index) => (verdicts[index]!.accepted === expectation.accept ? [] : [`${expectation.id} (${expectation.accept ? `rejected: ${verdicts[index]!.error}` : 'accepted'})`]))
  if (disagreements.length) throw Error(`Pinned Mermaid ${oracle.version} contradicts authored expectations; fix these sources before measuring: ${disagreements.join('; ')}`)
  return Object.fromEntries(expectations.flatMap((expectation, index) => (verdicts[index]!.accepted ? [[expectation.id, verdicts[index]!.diagramType]] : [])))
}
