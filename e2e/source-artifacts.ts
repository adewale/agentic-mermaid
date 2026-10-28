import { expect } from 'bun:test'
import { deserialize } from 'node:v8'
import { fileURLToPath } from 'node:url'
import { useTestChildren } from '../src/__tests__/helpers/test-child.ts'
import type { RenderOptions, ConfigDiagnostic } from '../src/types.ts'
import type { GraphicalSvgArtifact } from '../src/graphical-render.ts'
import type { PreviewArtifact } from '../src/browser-editor-protocol.ts'

const root = fileURLToPath(new URL('../', import.meta.url))
const runChild = useTestChildren(30_000)
type Example = { source: string; options: RenderOptions }
type SvgOutcome = GraphicalSvgArtifact | { error: string }
type Preview = Pick<PreviewArtifact, 'svg' | 'receipt' | 'verification'>

/** Compare emitted artifacts with the same production execution mode. The
 * unit preload forces Scene cross-checks in the parent; those checks choose
 * a different rendering path and intentionally change certification receipts.
 * A fresh source realm preserves complete values, including undefined fields. */
async function sourceArtifacts(mode: 'svg' | 'diagnostics' | 'preview', examples: readonly Example[]): Promise<unknown> {
  const child = await runChild(process.execPath, ['--eval', `
    const { serialize } = await import('node:v8')
    const api = await import('./src/index.ts')
    const { renderAndVerifyMermaid } = await import('./src/agent/verify.ts')
    const { mode, examples } = JSON.parse(await Bun.stdin.text())
    const results = examples.map(({ source, options }) => {
      if (mode === 'preview') {
        const result = renderAndVerifyMermaid(source, { ...options, security: 'strict', embedFontImport: false })
        return { svg: result.svg, receipt: result.receipt, verification: {
          ok: result.verification.ok, warnings: result.verification.warnings, checks: result.verification.checks,
        } }
      }
      const diagnostics = []
      try {
        const result = api.renderMermaidSVGWithReceipt(source, {
          ...options, ...(mode === 'diagnostics' ? { onConfigDiagnostic: value => diagnostics.push(value) } : {}),
        })
        return { svg: result.svg, receipt: result.receipt, ...(mode === 'diagnostics' ? { diagnostics } : {}) }
      } catch (error) { return { error: String(error) } }
    })
    process.stdout.write(serialize(results).toString('base64'))
  `], { cwd: root, env: { ...process.env, AGENTIC_MERMAID_SCENE_ASSERTIONS: '0' }, input: JSON.stringify({ mode, examples }) })
  expect(child.status, child.stderr).toBe(0)
  expect(child.signal).toBeNull()
  return deserialize(Buffer.from(child.stdout, 'base64'))
}

export async function sourcePreviews(examples: readonly Example[]): Promise<Preview[]> {
  return await sourceArtifacts('preview', examples) as Preview[]
}

export async function sourceSvgOutcome(source: string, options: RenderOptions): Promise<SvgOutcome> {
  return (await sourceArtifacts('svg', [{ source, options }]) as SvgOutcome[])[0]!
}

export async function sourceSvgArtifact(source: string, options: RenderOptions): Promise<GraphicalSvgArtifact> {
  const result = await sourceSvgOutcome(source, options)
  if ('error' in result) throw new Error(result.error)
  return result
}

export async function sourceSvgWithDiagnostics(source: string, options: RenderOptions): Promise<GraphicalSvgArtifact & { diagnostics: ConfigDiagnostic[] }> {
  const [result] = await sourceArtifacts('diagnostics', [{ source, options }]) as ((GraphicalSvgArtifact & { diagnostics: ConfigDiagnostic[] }) | { error: string })[]
  if (!result || 'error' in result) throw new Error(result?.error ?? 'Missing source result')
  return result
}
