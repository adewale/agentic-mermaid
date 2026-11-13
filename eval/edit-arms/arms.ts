// Request text for each arm. Every arm receives the same framing, request,
// diagram and response contract; only the "Tools" section differs.
import type { EditTask } from './score.ts'

export type Arm = 'A' | 'B' | 'C'
export const ARMS: readonly Arm[] = ['A', 'B', 'C']

export const ARM_NAMES: Record<Arm, string> = {
  A: 'text edit + verify',
  B: 'typed parse/mutate/verify/serialize',
  C: 'no tools',
}

export interface RequestContext {
  /** Absolute path of the Agentic Mermaid checkout the agent may use. */
  repo: string
  /** Absolute scratch directory for this request. */
  scratch: string
  /** Absolute AM_TRACE_LOG path for this request. */
  trace: string
}

function toolSection(arm: Arm, ctx: RequestContext): string {
  if (arm === 'A') {
    return `Edit the Mermaid text yourself; patching lines or rewriting the source are both fine. You may check your result, and retry, with Agentic Mermaid's verifier and renderer from the checkout at ${ctx.repo} (run commands from there):

- \`bun run bin/am.ts verify <file>\` parses the diagram and prints structured JSON warnings; exit code 0 means no errors.
- \`bun run bin/am.ts render <file> --format ascii\` (or \`--format svg --output <file>\`) draws it so you can inspect the result.

Do not use Agentic Mermaid's typed editing surfaces for this task: no \`am mutate\`, \`am parse\`, \`am serialize\` or \`am batch\`, and no library \`mutate\`, \`applyOps\`, \`mutatePreservingSource\`, \`serializeMermaid\` or Code Mode.`
  }
  if (arm === 'B') {
    return `Make the edit through Agentic Mermaid's typed editing path — parse, narrow to the diagram family, mutate, verify, serialize — using the checkout at ${ctx.repo} (run commands from there):

- CLI: \`bun run bin/am.ts mutate <file> --ops '<JSON array of operations>'\` applies typed operations, verifies the result and prints the source; add \`--preserve-source\` to keep untouched source text where the operation supports it. \`bun run bin/am.ts capabilities --json\` lists each family's operations and fields, and \`bun run bin/am.ts <command> --help\` explains flags.
- Library, from a Bun script: \`import { parseRegisteredMermaid, mutate, mutatePreservingSource, verifyMermaid, serializeMermaid } from '${ctx.repo}/src/agent/index.ts'\` plus the family narrower (\`asFlowchart\`, \`asSequence\`, \`asClass\`, \`asState\`, \`asEr\`, \`asGantt\`, …).
- Operating guide: \`bun run bin/am.ts --agent-instructions\`.

Do not hand-edit the Mermaid text. If no typed operation can express part of the request, make the smallest source-level edit for that part only, write "source-level fallback" in Notes, and check the result with \`bun run bin/am.ts verify <file>\`.`
  }
  return 'Do not run any tools, commands or scripts, and do not open files. Edit the Mermaid text directly from what is shown here.'
}

export function buildRequest(requestId: string, task: EditTask, before: string, arm: Arm, ctx: RequestContext): string {
  const toolsAllowed = arm !== 'C'
  const harness = [
    `Harness note (not part of the teammate's request): you are a fresh agent and this file is your complete task. Request id: ${requestId}.`,
    toolsAllowed
      ? `Do not read anything under ${ctx.repo}/eval/edit-arms/ and do not search the repository for this diagram. Write scratch files only under ${ctx.scratch}/. Run every Agentic Mermaid command and script with the environment variable AM_TRACE_LOG=${ctx.trace} so the harness can record which tools were used (for example \`AM_TRACE_LOG=${ctx.trace} bun run bin/am.ts verify ${ctx.scratch}/diagram.mmd\`).`
      : 'Answer from this file alone.',
    'Return only the response described under "Response".',
  ].join(' ')
  return `# Diagram edit request

${harness}

## Request

A teammate asked for a change to a diagram in the project's documentation. Apply the change and return the full updated diagram.

> ${task.request}

## Diagram

\`\`\`mermaid
${before.replace(/\n$/, '')}
\`\`\`
${toolsAllowed ? `\nThe same diagram is saved byte-for-byte at ${ctx.scratch}/diagram.mmd.\n` : ''}
## Tools

${toolSection(arm, ctx)}

## Response

Reply with exactly two sections:

Updated Mermaid
: the complete edited diagram in one \`\`\`mermaid fenced block, copied exactly from your final source.

Notes
: one or two sentences on what you changed and how you checked it.
`
}
