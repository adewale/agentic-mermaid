import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildCookbookScreenshots } from '../../scripts/docs/custom-style-cookbook.ts'
import {
  CUSTOM_STYLE_CATALOG,
  customStylePath,
  customStyleSamplePath,
  customStyleScreenshotPath,
} from '../../scripts/docs/custom-style-catalog.ts'
import {
  knownStyleDescriptors,
  registerStyle,
  renderMermaidSVG,
  validateStyleSpec,
} from '../index.ts'
import { styleKind } from '../scene/style-registry.ts'

const REPO = join(import.meta.dir, '..', '..')
describe('custom style cookbook docs', () => {
  it('exports the style schema through package.json and keeps the file parseable', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    expect(pkg.exports['./style-spec.schema.json']).toBe('./docs/schemas/style-spec.schema.json')

    const schemaPath = join(REPO, 'docs/schemas/style-spec.schema.json')
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
    expect(schema.$id).toBe('https://agentic-mermaid.dev/schemas/style-spec.schema.json')
    expect(schema.properties.$schema.type).toBe('string')
    expect(schema.properties.font.description).toContain('rendering environment supplies the font face')
    expect(schema.properties.stroke.enum).toEqual(['crisp', 'jittered', 'freehand'])
  })

  it('keeps cookbook JSON examples accepted by the runtime validator', () => {
    expect(new Set(CUSTOM_STYLE_CATALOG.examples.map(entry => entry.id)).size).toBe(CUSTOM_STYLE_CATALOG.examples.length)
    expect(new Set(CUSTOM_STYLE_CATALOG.examples.map(entry => entry.style)).size).toBe(CUSTOM_STYLE_CATALOG.examples.length)
    expect(new Set(CUSTOM_STYLE_CATALOG.examples.map(entry => entry.screenshot)).size).toBe(CUSTOM_STYLE_CATALOG.examples.length)
    expect(CUSTOM_STYLE_CATALOG.examples.filter(entry => entry.docsOnly).map(entry => entry.id)).toEqual(['cupertino-prototype'])
    expect(existsSync(customStyleSamplePath())).toBe(true)
    for (const entry of CUSTOM_STYLE_CATALOG.examples) {
      const style = JSON.parse(readFileSync(customStylePath(entry), 'utf8'))
      expect(validateStyleSpec(style), entry.style).toEqual([])
      expect(styleKind(style), entry.style).toBe('look')
      expect(customStyleScreenshotPath(entry).endsWith(entry.screenshot)).toBe(true)
    }

    expect(validateStyleSpec({
      $schema: 'https://agentic-mermaid.dev/schemas/style-spec.schema.json',
      colors: { bg: '#fff' },
    })).toEqual([])
  })

  it('projects every catalog entry into the Markdown cookbook exactly once', () => {
    const cookbook = readFileSync(join(REPO, 'docs/custom-style-cookbook.md'), 'utf8')
    const occurrences = (needle: string) => cookbook.split(needle).length - 1
    for (const entry of CUSTOM_STYLE_CATALOG.examples) {
      const tick = '`'
      const styleLink = `[${tick}examples/styles/${entry.style}${tick}](../examples/styles/${entry.style})`
      const screenshotLink = `](./assets/style-cookbook/${entry.screenshot})`
      expect(occurrences(styleLink), styleLink).toBe(1)
      expect(occurrences(screenshotLink), screenshotLink).toBe(1)
    }
  })

  it('renders the Cupertino prototype through public APIs without making it built-in', () => {
    const prototype = JSON.parse(readFileSync(join(REPO, 'examples/styles/cupertino-prototype.style.json'), 'utf8'))
    const source = readFileSync(join(REPO, 'examples/styles/cupertino-prototype.mmd'), 'utf8')
    const names = () => knownStyleDescriptors().map(descriptor => descriptor.inputName)
    expect(validateStyleSpec(prototype)).toEqual([])
    expect(prototype.name).toBe('look:cupertino-prototype')
    expect(names()).not.toContain('cupertino')
    expect(names()).not.toContain('look:cupertino-prototype')

    const inline = renderMermaidSVG(source, { style: prototype, shadow: true, security: 'strict' })
    expect(inline).toContain('<svg')
    expect(inline).toContain('Routing core')

    const unregister = registerStyle(prototype)
    try {
      expect(names()).toContain('look:cupertino-prototype')
      expect(renderMermaidSVG(source, {
        style: 'look:cupertino-prototype', shadow: true, security: 'strict',
      })).toContain('<svg')
    } finally {
      expect(unregister()).toBe(true)
    }
    expect(names()).not.toContain('look:cupertino-prototype')
  })

  it('keeps the custom-font recipe valid and linked from its entry points', () => {
    const guide = readFileSync(join(REPO, 'docs/custom-fonts.md'), 'utf8')
    const json = guide.match(/```json\n([\s\S]*?)\n```/)?.[1]
    expect(json).toBeDefined()
    expect(validateStyleSpec(JSON.parse(json!))).toEqual([])

    for (const rel of [
      'README.md',
      'docs/README.md',
      'docs/api.md',
      'docs/custom-style-cookbook.md',
      'docs/features.md',
      'docs/style-authoring.md',
      'docs/theming.md',
    ]) {
      expect(readFileSync(join(REPO, rel), 'utf8'), rel).toContain('custom-fonts.md')
    }

    for (const term of ['fontDirs', 'loadSystemFonts', "security: 'strict'", 'Inter', 'DejaVu']) {
      expect(guide, term).toContain(term)
    }
  })

  it('keeps cookbook screenshots in sync with the generator', () => {
    for (const { path, png } of buildCookbookScreenshots()) {
      expect(existsSync(path), path).toBe(true)
      expect(readFileSync(path)).toEqual(Buffer.from(png))
    }
  })
})
