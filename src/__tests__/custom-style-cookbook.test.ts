import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCookbookScreenshots } from '../../scripts/docs/custom-style-cookbook.ts'
import { validateStyleSpec } from '../index.ts'
import { styleKind } from '../scene/style-registry.ts'

const REPO = join(import.meta.dir, '..', '..')
const EXAMPLE_STYLES = [
  'examples/styles/transit-route-map.style.json',
  'examples/styles/mid-century-report.style.json',
  'examples/styles/star-chart-atlas.style.json',
] as const

describe('custom style cookbook docs', () => {
  it('exports the style schema through package.json and keeps the file parseable', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(pkg.exports['./style-spec.schema.json']).toBe('./docs/schemas/style-spec.schema.json')

    const schemaPath = join(REPO, 'docs/schemas/style-spec.schema.json')
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    expect(schema.$id).toBe('https://agentic-mermaid.dev/schemas/style-spec.schema.json')
    expect(schema.properties.$schema.type).toBe('string')
    expect(schema.properties.stroke.enum).toEqual(['crisp', 'jittered', 'freehand'])
  })

  it('keeps cookbook JSON examples accepted by the runtime validator', () => {
    for (const rel of EXAMPLE_STYLES) {
      const style = JSON.parse(readFileSync(join(REPO, rel), 'utf8'))
      expect(validateStyleSpec(style), rel).toEqual([])
      expect(styleKind(style), rel).toBe('look')
    }

    expect(validateStyleSpec({
      $schema: 'https://agentic-mermaid.dev/schemas/style-spec.schema.json',
      colors: { bg: '#fff' },
    })).toEqual([])
  })

  it('keeps cookbook screenshots in sync with the generator', () => {
    for (const { path, png } of buildCookbookScreenshots()) {
      expect(existsSync(path), path).toBe(true)
      expect(readFileSync(path)).toEqual(Buffer.from(png))
    }
  })
})
