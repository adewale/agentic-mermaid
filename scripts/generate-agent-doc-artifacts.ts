import { join } from 'node:path'
import { buildLlmsTxt } from '../src/cli/index.ts'

const ROOT = join(import.meta.dir, '..')
const CHECK = process.argv.includes('--check')
const guidePath = join(ROOT, 'Instructions_for_agents.md')
const modulePath = join(ROOT, 'src', 'cli', 'agent-instructions.ts')
const llmsPath = join(ROOT, 'llms.txt')

const guide = await Bun.file(guidePath).text()
const artifacts = [
  [modulePath, `// Generated from Instructions_for_agents.md by scripts/generate-agent-doc-artifacts.ts.\nexport const AGENT_INSTRUCTIONS = ${JSON.stringify(guide)}\n`],
  [llmsPath, buildLlmsTxt()],
] as const

if (CHECK) {
  const stale: string[] = []
  for (const [path, expected] of artifacts) {
    if (!await Bun.file(path).exists() || await Bun.file(path).text() !== expected) stale.push(path.slice(ROOT.length + 1))
  }
  if (stale.length > 0) {
    console.error(`Stale generated agent docs: ${stale.join(', ')}`)
    process.exit(1)
  }
  console.log('Generated agent docs are current.')
} else {
  for (const [path, content] of artifacts) await Bun.write(path, content)
  console.log('Generated agent docs.')
}
