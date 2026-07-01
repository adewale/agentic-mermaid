import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..', '..')

function decodeHtml(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

export function extractHomepageAgentPrompt(html = readFileSync(join(REPO, 'mockups/home.html'), 'utf8')): string {
  const match = html.match(/<code id="home-agent-prompt">([\s\S]*?)<\/code>/)
  if (!match) throw new Error('home-agent-prompt not found')
  return decodeHtml(match[1]!).trim()
}

export function buildHomepageAgentPromptTask(task: string, context: string, source?: string): string {
  const prompt = extractHomepageAgentPrompt()
  return prompt
    .replace('<replace with the requested diagram goal or edit>', task)
    .replace('<include the facts, labels, relationships, and constraints the diagram should express>', context)
    .replace('<paste existing Mermaid source here, or leave blank for a new diagram>', source?.trim() ?? '')
}

export function homepagePromptChecklist(prompt = extractHomepageAgentPrompt()): string[] {
  const required = [
    'Create or edit a Mermaid diagram',
    'Task:',
    'Context:',
    'Mermaid source (for edits; leave blank for a new diagram):',
    'Environment:',
    'Do not assume this repository is checked out',
    'one local channel available to you',
    'installed `agentic-mermaid/agent`',
    'CLI (`am` or `bun run bin/am.ts`)',
    'Do not call the website as a render API',
    'do not fabricate verification',
    'Library imports, when available',
    'parseMermaid',
    'verifyMermaid',
    'serializeMermaid',
    'mutate',
    'For a new diagram, author Mermaid source directly',
    'For an existing diagram, parse it',
    'narrow with the matching `as*` helper',
    'smallest `mutate(...)` operation',
    'Mutation ops use a `kind` discriminator',
    'am capabilities --json',
    'source-level fallback',
    'Run `verifyMermaid`',
    'Return mode:',
    'In chat, return exactly these sections',
    'In MCP/Code Mode `execute(code)`',
    'return an object with `{ source }`',
    'Updated Mermaid',
    'Verification',
    'Trace',
    'final Mermaid source in a ```mermaid fence',
    'In Trace, name the local channel and exact calls/ops used',
    'mutate({ kind: ... })',
    'for new diagrams say `no mutate`',
    'Do not modify project files',
  ]
  return required.filter(piece => !prompt.includes(piece))
}
