import { join } from 'node:path'
import { buildCapabilities, buildLlmsTxt } from '../src/cli/index.ts'

const ROOT = join(import.meta.dir, '..')
const CHECK = process.argv.includes('--check')
const guidePath = join(ROOT, 'Instructions_for_agents.md')
const modulePath = join(ROOT, 'src', 'cli', 'agent-instructions.ts')
const llmsPath = join(ROOT, 'llms.txt')
const skillPath = join(ROOT, 'skills', 'agentic-mermaid-diagram-workflow', 'SKILL.md')
const skillModulePath = join(ROOT, 'src', 'mcp', 'generated', 'skill-markdown.ts')
const capabilitiesModulePath = join(ROOT, 'src', 'mcp', 'generated', 'capabilities-resource.ts')

const guide = await Bun.file(guidePath).text()
const skill = await Bun.file(skillPath).text()
const artifacts = [
  [modulePath, `// Generated from Instructions_for_agents.md by scripts/generate-agent-doc-artifacts.ts.\nexport const AGENT_INSTRUCTIONS = ${JSON.stringify(guide)}\n`],
  [llmsPath, buildLlmsTxt()],
  // Embedded so the MCP servers (including the fs-less hosted Worker) can
  // serve the skill and capability registry as MCP resources.
  [skillModulePath, `// Generated from skills/agentic-mermaid-diagram-workflow/SKILL.md by scripts/generate-agent-doc-artifacts.ts.\nexport const SKILL_MARKDOWN = ${JSON.stringify(skill)}\n`],
  [capabilitiesModulePath, `// Generated from buildCapabilities() by scripts/generate-agent-doc-artifacts.ts.\nexport const CAPABILITIES_RESOURCE_JSON = ${JSON.stringify(JSON.stringify(buildCapabilities()))}\n`],
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
