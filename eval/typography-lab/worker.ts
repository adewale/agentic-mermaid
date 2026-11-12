// Renders lab cases under the typography option the preload installed and
// writes, per case, the SVG, its size, every drawn text with its font size,
// and the geometry warnings verify reports for it.
//   AM_TYPOGRAPHY_POLICY='{"option":"option1","base":16}' \
//     bun --preload ./eval/typography-lab/policy-preload.ts eval/typography-lab/worker.ts <in.json> <out.json>
import { readFileSync, writeFileSync } from 'node:fs'
import { renderMermaidSVG } from '../../src/index.ts'
import { verifyMermaid } from '../../src/agent/index.ts'

/** verify codes that mean text no longer fits the geometry drawn for it. */
export const INTEGRITY_CODES = ['LABEL_OVERFLOW', 'NODE_OVERLAP', 'CONTENT_OCCLUDED', 'OFF_CANVAS', 'GROUP_BREACH', 'LABELS_HIDDEN'] as const

export interface WorkerCase { readonly id: string; readonly source: string }
export interface DrawnText { readonly text: string; readonly size: number }
export interface WorkerResult {
  readonly id: string
  readonly ok: boolean
  readonly error?: string
  readonly svg?: string
  readonly width?: number
  readonly height?: number
  readonly texts?: readonly DrawnText[]
  readonly integrity?: Readonly<Record<string, number>>
}

const decode = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').trim()

export function drawnTexts(svg: string): DrawnText[] {
  const out: DrawnText[] = []
  for (const m of svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const size = Number(/\sfont-size="([\d.]+)"/.exec(m[1]!)?.[1] ?? /font-size:\s*([\d.]+)/.exec(m[1]!)?.[1])
    const text = decode(m[2]!)
    if (text && Number.isFinite(size)) out.push({ text, size })
  }
  return out
}

function renderCase({ id, source }: WorkerCase): WorkerResult {
  let svg: string
  try { svg = renderMermaidSVG(source) } catch (error) { return { id, ok: false, error: String(error).slice(0, 300) } }
  const viewBox = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg)
  const integrity: Record<string, number> = {}
  try {
    const result = verifyMermaid(source) as { warnings?: { code: string }[] }
    for (const warning of result.warnings ?? []) {
      if ((INTEGRITY_CODES as readonly string[]).includes(warning.code)) integrity[warning.code] = (integrity[warning.code] ?? 0) + 1
    }
  } catch (error) {
    integrity.VERIFY_FAILED = 1
  }
  return { id, ok: true, svg, width: Number(viewBox?.[3]), height: Number(viewBox?.[4]), texts: drawnTexts(svg), integrity }
}

if (import.meta.main) {
  const [input, output] = process.argv.slice(2)
  if (!input || !output) throw new Error('usage: worker.ts <cases.json> <out.json>')
  const cases = JSON.parse(readFileSync(input, 'utf8')) as WorkerCase[]
  writeFileSync(output, JSON.stringify(cases.map(renderCase)))
}
