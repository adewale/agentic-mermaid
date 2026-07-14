import { describeMermaid, describeMermaidSource } from '../agent/describe.ts'
import { describeMermaidFacts } from '../agent/facts.ts'
import { parseRegisteredMermaid } from '../agent/parse.ts'
import type { ExtensionValidDiagram, ParsedDiagram, PreservedValidDiagram } from '../agent/types.ts'
import { verifyMermaid } from '../agent/verify.ts'

export type McpDescribeFormat = 'text' | 'json' | 'facts'

export const EXTERNAL_FAMILY_DESCRIBE_UNAVAILABLE_CODE = 'EXTERNAL_FAMILY_DESCRIBE_UNAVAILABLE' as const

export function externalFamilyDescribeUnavailable(family: string) {
  return Object.freeze({
    code: EXTERNAL_FAMILY_DESCRIBE_UNAVAILABLE_CODE,
    capability: 'describe' as const,
    family,
    message: `Registered external family "${family}" has no semantic describe contract in FamilyDescriptor v1.`,
  })
}

export function externalFamilyVerificationSummary(family: string): string {
  return `Registered external Mermaid family "${family}"; semantic description is unavailable.`
}

function isExtensionDiagram(diagram: ParsedDiagram): diagram is ExtensionValidDiagram {
  return diagram.body.kind === 'extension'
}

function isPreservedDiagram(diagram: ParsedDiagram): diagram is PreservedValidDiagram {
  return diagram.body.kind === 'preserved'
}

export function mcpVerificationSummary(diagram: ParsedDiagram): string {
  if (isExtensionDiagram(diagram)) return externalFamilyVerificationSummary(diagram.kind)
  if (isPreservedDiagram(diagram)) {
    return `${diagram.body.diagnostic.code}: ${diagram.body.diagnostic.message}`
  }
  return describeMermaid(diagram)
}

export function mcpDescribeFormat(args: Readonly<Record<string, unknown>>): McpDescribeFormat {
  const format = args.format ?? 'text'
  if (format === 'text' || format === 'json' || format === 'facts') return format
  throw new Error('describe format must be one of: text, json, facts')
}

/**
 * Shared local/hosted MCP description boundary.
 *
 * Transport envelopes use the open parser so an installed extension is
 * identified truthfully. Built-in descriptions are gated by the same complete
 * verification contract as the verify tool, so a source that cannot render can
 * never be reported as successfully described. FamilyDescriptor v1
 * intentionally has no semantic description hook, however, so external bodies
 * receive one stable unavailable diagnostic instead of being misreported as a
 * parse failure or guessed from opaque source.
 */
export function mcpDescribePayload(
  source: string,
  args: Readonly<Record<string, unknown>>,
): { ok: boolean } & Record<string, unknown> {
  const format = mcpDescribeFormat(args)
  const parsed = parseRegisteredMermaid(source)
  if (!parsed.ok) {
    // Preserve the established prose parse-error projection for text callers;
    // JSON/facts already expose the structured parser diagnostics.
    if (format === 'text') return { ok: true as const, text: describeMermaidSource(source) }
    return { ok: false as const, errors: parsed.error }
  }
  const diagram = parsed.value
  if (isPreservedDiagram(diagram)) {
    return {
      ok: false as const,
      family: diagram.body.preservation.upstreamFamilyId ?? diagram.kind,
      error: {
        ...diagram.body.diagnostic,
        preservation: diagram.body.preservation,
      },
    }
  }
  if (isExtensionDiagram(diagram)) {
    return {
      ok: false as const,
      family: diagram.kind,
      error: externalFamilyDescribeUnavailable(diagram.kind),
    }
  }
  const verification = verifyMermaid(diagram)
  if (!verification.ok) {
    return {
      ok: false as const,
      family: diagram.kind,
      warnings: verification.warnings,
    }
  }
  if (format === 'text') return { ok: true as const, text: describeMermaid(diagram), warnings: verification.warnings }
  if (format === 'facts') return { ok: true as const, facts: describeMermaidFacts(diagram), warnings: verification.warnings }
  return { ok: true as const, tree: JSON.parse(describeMermaid(diagram, { format: 'json' })), warnings: verification.warnings }
}
