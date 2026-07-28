import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { applyOps } from '../../src/agent/apply.ts'
import { parseRegisteredMermaid } from '../../src/agent/parse.ts'
import { verifyMermaid } from '../../src/agent/verify.ts'
import { mcpDescribePayload } from '../../src/mcp/describe-payload.ts'
import { HOSTED_TOOLS } from '../../src/mcp/hosted-server.ts'
import { describeSdkPayload } from '../../src/mcp/sdk-discovery.ts'
import { validateMcpToolArguments } from '../../src/mcp/tool-surface.ts'

interface ToolProposal {
  tool: string
  arguments: Record<string, unknown>
}

export interface HostedMcpExpectation {
  tool: string
  source?: string
  family?: string
  format?: 'text' | 'json' | 'facts'
  detail?: 'signatures' | 'fields'
  resultContains?: string[]
  classRelation?: {
    from: string
    to: string
    kind: string
    label?: string
  }
}

export interface HostedMcpOracleResult {
  ok: boolean
  problems: string[]
  proposal?: ToolProposal
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProposal(text: string): { proposal?: ToolProposal; problems: string[] } {
  const trimmed = text.trimEnd()
  const matches = [...trimmed.matchAll(/```json\s*([\s\S]*?)```/giu)]
  if (matches.length !== 1) {
    return { problems: [`expected exactly one fenced JSON request envelope, found ${matches.length}`] }
  }
  const match = matches[0]!
  if ((match.index ?? -1) + match[0].length !== trimmed.length) {
    return { problems: ['the fenced JSON request envelope must be the final answer content'] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(match[1] ?? '')
  } catch {
    return { problems: ['final fenced JSON is not valid JSON'] }
  }
  if (!plainRecord(parsed)) return { problems: ['final JSON request envelope must be an object'] }
  const keys = Object.keys(parsed).sort()
  if (keys.length !== 2 || keys[0] !== 'arguments' || keys[1] !== 'tool') {
    return { problems: ['final JSON request envelope must contain exactly tool and arguments'] }
  }
  if (typeof parsed.tool !== 'string' || !plainRecord(parsed.arguments)) {
    return { problems: ['final JSON request envelope requires a string tool and object arguments'] }
  }
  return { proposal: { tool: parsed.tool, arguments: parsed.arguments }, problems: [] }
}

export function gradeHostedMcpRequest(text: string, expectation: HostedMcpExpectation): HostedMcpOracleResult {
  const parsedProposal = parseProposal(text)
  const problems = [...parsedProposal.problems]
  const proposal = parsedProposal.proposal
  if (!proposal) {
    return { ok: false, problems }
  }
  if (proposal.tool !== expectation.tool) problems.push(`expected tool ${expectation.tool}, received ${proposal.tool}`)

  const definition = HOSTED_TOOLS.find(tool => tool.name === proposal.tool)
  if (!definition) {
    problems.push(`unknown hosted tool ${proposal.tool}`)
    return { ok: false, problems, proposal }
  }
  const schemaProblems = validateMcpToolArguments(definition, proposal.arguments)
  if (schemaProblems.length > 0) problems.push(...schemaProblems.map(problem => `schema: ${problem}`))
  if (expectation.source !== undefined && proposal.arguments.source !== expectation.source) {
    problems.push('request source does not match the supplied fixture')
  }
  if (expectation.format !== undefined && proposal.arguments.format !== expectation.format) {
    problems.push(`expected format ${expectation.format}`)
  }
  if (expectation.detail !== undefined && proposal.arguments.detail !== expectation.detail) {
    problems.push(`expected detail ${expectation.detail}`)
  }

  if (schemaProblems.length === 0 && proposal.tool === expectation.tool) {
    try {
      if (proposal.tool === 'verify') {
        const parsed = parseRegisteredMermaid(proposal.arguments.source as string)
        if (!parsed.ok) problems.push(`verify source does not parse: ${parsed.error.map(error => error.message).join('; ')}`)
        else {
          const verified = verifyMermaid(parsed.value)
          if (!verified.ok) problems.push('verify source is structurally invalid')
          if (expectation.family !== undefined && parsed.value.kind !== expectation.family) {
            problems.push(`expected family ${expectation.family}, detected ${parsed.value.kind}`)
          }
        }
      } else if (proposal.tool === 'describe') {
        const described = mcpDescribePayload(proposal.arguments.source as string, proposal.arguments)
        if (!described.ok) problems.push('describe request does not produce a successful payload')
      } else if (proposal.tool === 'mutate' || proposal.tool === 'build') {
        const applied = applyOps(proposal.tool === 'mutate' ? { source: proposal.arguments.source as string, ops: proposal.arguments.ops } : { family: proposal.arguments.family as string, ops: proposal.arguments.ops })
        if (!applied.ok) problems.push(`production mutation core rejected request: ${applied.error.message}`)
        else {
          if (!applied.verify.ok) problems.push('production mutation core returned verify.ok false')
          if (expectation.family !== undefined && applied.family !== expectation.family) {
            problems.push(`expected family ${expectation.family}, produced ${applied.family}`)
          }
          for (const token of expectation.resultContains ?? []) {
            if (!applied.source.includes(token)) problems.push(`result source does not contain ${JSON.stringify(token)}`)
          }
          if (expectation.classRelation) {
            const parsed = parseRegisteredMermaid(applied.source)
            if (!parsed.ok || parsed.value.body.kind !== 'class') {
              problems.push('result source does not parse as a class diagram')
            } else {
              const expected = expectation.classRelation
              const relation = parsed.value.body.relations.find(value => value.from === expected.from && value.to === expected.to && value.kind === expected.kind && (expected.label === undefined || value.label === expected.label))
              if (!relation) {
                problems.push(`result class diagram lacks ${expected.from} -> ${expected.to} ${expected.kind} relation`)
              }
            }
          }
        }
      } else if (proposal.tool === 'describe_sdk') {
        if (expectation.family !== undefined && proposal.arguments.family !== expectation.family) {
          problems.push(`expected family ${expectation.family}`)
        }
        describeSdkPayload(proposal.arguments)
      }
    } catch (error) {
      problems.push(`production execution threw: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { ok: problems.length === 0, problems, proposal }
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

if (import.meta.main) {
  const outputDir = process.argv[2]
  const tool = process.argv[3]
  if (!outputDir || !tool) throw new Error('usage: hosted-mcp-request.ts OUTPUT_DIR TOOL [--source TEXT | --source-file PATH] [--family ID] [--format text|json|facts] [--detail signatures|fields] [--result-contains text,text] [--class-relation from,to,kind[,label]]')
  const sourceFile = option('--source-file')
  const sourceLiteral = option('--source')
  if (sourceFile && sourceLiteral !== undefined) throw new Error('use either --source or --source-file, not both')
  const sourcePath = sourceFile ? (isAbsolute(sourceFile) ? sourceFile : join(import.meta.dir, '..', sourceFile)) : undefined
  const format = option('--format')
  if (format !== undefined && format !== 'text' && format !== 'json' && format !== 'facts') throw new Error(`invalid --format ${format}`)
  const detail = option('--detail')
  if (detail !== undefined && detail !== 'signatures' && detail !== 'fields') throw new Error(`invalid --detail ${detail}`)
  const classRelationParts = (option('--class-relation') ?? '').split(',').filter(Boolean)
  if (classRelationParts.length !== 0 && (classRelationParts.length < 3 || classRelationParts.length > 4)) {
    throw new Error('--class-relation requires from,to,kind[,label]')
  }
  const result = gradeHostedMcpRequest(readFileSync(resolve(outputDir, 'output.md'), 'utf8'), {
    tool,
    ...(sourcePath ? { source: readFileSync(sourcePath, 'utf8') } : sourceLiteral !== undefined ? { source: sourceLiteral } : {}),
    ...(option('--family') ? { family: option('--family') } : {}),
    ...(format ? { format } : {}),
    ...(detail ? { detail } : {}),
    resultContains: (option('--result-contains') ?? '').split(',').filter(Boolean),
    ...(classRelationParts.length > 0
      ? {
          classRelation: {
            from: classRelationParts[0]!,
            to: classRelationParts[1]!,
            kind: classRelationParts[2]!,
            ...(classRelationParts[3] ? { label: classRelationParts[3] } : {}),
          },
        }
      : {}),
  })
  console.log(JSON.stringify({ score: result.ok ? 1 : 0, max_score: 1, problems: result.problems }))
  if (!result.ok) process.exitCode = 1
}
