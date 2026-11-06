import { parseRegisteredMermaid } from '../agent/parse.ts'
import { configWarningsForMermaid, verifyMermaid } from '../agent/verify.ts'
import { renderMermaidSVGWithReceipt, renderMermaidASCIIWithReceipt } from '../agent/core.ts'
import { BUILTIN_FAMILY_METADATA } from '../agent/families.ts'
import { verifyNoExternalRefs } from '../output-security.ts'
import { projectMcpRenderOptions } from './tool-surface.ts'
import { mcpVerificationSummary } from './describe-payload.ts'
import { HOSTED_RENDER_OPTIONS } from '../render-host-policy.ts'
import { familyDetectionDiagnosticFromPreservedBody, MermaidFamilyDetectionError } from '../family-detection.ts'
import type { RenderOptions } from '../types.ts'

export type SourceToolName = 'render_svg' | 'render_ascii' | 'verify'

/** Shared structured results for the hosted tools and the local worker. */
export function runSourceTool(name: SourceToolName, args: Record<string, unknown>): { ok: boolean } & Record<string, unknown> {
  const source = args.source as string
  switch (name) {
    case 'render_svg': {
      const rendered = renderMermaidSVGWithReceipt(source, svgOptions(args))
      const safety = verifyNoExternalRefs(rendered.svg)
      if (!safety.ok) throw new Error(`strict SVG safety invariant failed: ${safety.refs.join(', ')}`)
      return {
        ok: true as const,
        svg: rendered.svg,
        receipt: rendered.receipt,
        warnings: sourceConfigWarnings(source),
      }
    }
    case 'render_ascii': {
      const projectionWarnings: unknown[] = []
      const rendered = renderMermaidASCIIWithReceipt(source, {
        ...projectMcpRenderOptions(args),
        ...HOSTED_RENDER_OPTIONS,
        useAscii: args.useAscii === true,
        targetWidth: args.targetWidth as number | undefined,
        colorMode: 'none',
        onProjectionDiagnostic: diagnostic => projectionWarnings.push(diagnostic),
      })
      return {
        ok: true as const,
        text: rendered.text,
        receipt: rendered.receipt,
        warnings: [...sourceConfigWarnings(source), ...projectionWarnings],
      }
    }
    case 'verify': {
      const parsed = parseRegisteredMermaid(source)
      if (!parsed.ok) {
        // Self-describing tool: when the header names a known family, hand back
        // that family's canonical example so a failed authoring attempt gets the
        // correct dialect in the same response — no need to fetch capabilities.json.
        const hint = familyExampleForSource(source)
        return { ok: false as const, errors: parsed.error, ...(hint ?? {}) }
      }
      if (parsed.value.body.kind === 'preserved') {
        throw new MermaidFamilyDetectionError(
          familyDetectionDiagnosticFromPreservedBody(parsed.value.body),
        )
      }
      const v = verifyMermaid(parsed.value)
      const summary = mcpVerificationSummary(parsed.value)
      // Echo the detected family + a one-line summary so `ok:true` is never a
      // silent pass on the wrong kind of diagram: an agent that asked for an
      // architecture diagram and reads `family:"flowchart"` here sees the
      // mismatch in the same result it was already going to read, without
      // having to know to call `describe` separately.
      return { ok: v.ok, family: parsed.value.kind, summary, warnings: v.warnings, checks: v.checks, layout: { bounds: v.layout.bounds, nodes: v.layout.nodes.length, edges: v.layout.edges.length } }
    }
  }
}

function sourceConfigWarnings(source: string) { return configWarningsForMermaid(source) }

function familyExampleForSource(source: string): { family: string; example: string } | undefined {
  const first = source.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? ''
  const header = first.split(/\s+/)[0] ?? ''
  for (const f of BUILTIN_FAMILY_METADATA) {
    if (f.headers.some(h => header === h)) return { family: f.id, example: f.example }
  }
  return undefined
}

function svgOptions(args: Record<string, unknown>): RenderOptions {
  // Public MCP SVG is commonly embedded by downstream agent UIs. It must
  // never carry active tags/event handlers or external fetches from Mermaid
  // init/config payloads; unlike the local library, this direct tool exposes no
  // caller-selectable security mode.
  const opts = projectMcpRenderOptions(args)
  // The hosted boundary owns this policy. An advanced options object cannot
  // weaken it even though the same canonical request fields are accepted.
  return { ...opts, ...HOSTED_RENDER_OPTIONS }
}

