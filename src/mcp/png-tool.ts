import { renderMermaidPNGWithReceipt } from '../agent/png.ts'
import { renderConfigWarningsForMermaid } from '../agent/verify.ts'
import { projectNativePngOutputPolicyInput } from '../png-contract.ts'
import { mcpRenderReceipt } from './receipt-summary.ts'
import { projectMcpRenderOptions } from './tool-surface.ts'

/** The local render_png payload, computed in the supervised renderer. The
 * server owns delivery (base64, image block, managed file or URL), so the PNG
 * crosses the process boundary once, as base64. */
export function runLocalPngTool(args: Record<string, unknown>): { ok: true; png_base64: string; receipt: unknown; runtime: unknown; warnings: unknown[] } {
  const source = args.source as string
  const fontWarnings: Array<Record<string, unknown>> = []
  const renderOptions = projectMcpRenderOptions(args)
  const rendered = renderMermaidPNGWithReceipt(source, {
    ...renderOptions,
    ...projectNativePngOutputPolicyInput(args),
    onWarning: warning => fontWarnings.push(warning as unknown as Record<string, unknown>),
  })
  const warnings = [...renderConfigWarningsForMermaid(source, renderOptions), ...fontWarnings]
    .filter((warning, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(warning)) === index)
  return {
    ok: true,
    png_base64: Buffer.from(rendered.png).toString('base64'),
    receipt: mcpRenderReceipt(rendered.receipt, args),
    runtime: rendered.runtime,
    warnings,
  }
}
