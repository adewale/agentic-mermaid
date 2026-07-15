import { describe, expect, it } from 'bun:test'
import { createHash } from 'node:crypto'
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
  renderMermaidASCII,
  renderMermaidSVG,
  validateStyleSpec,
} from '../index.ts'
import { styleKind } from '../scene/style-registry.ts'
import { verifyMermaid } from '../agent/index.ts'

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
    expect(CUSTOM_STYLE_CATALOG.examples.filter(entry => entry.docsOnly).map(entry => entry.id)).toEqual([
      'cupertino-prototype',
      'vercel-inspired-prototype',
      'cloudflare-workers-inspired-prototype',
    ])
    expect(existsSync(customStyleSamplePath())).toBe(true)
    for (const entry of CUSTOM_STYLE_CATALOG.examples) {
      expect(existsSync(customStyleSamplePath(entry)), entry.id).toBe(true)
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

  it('renders every documentation prototype through public APIs without making one built in', () => {
    const prototypes = CUSTOM_STYLE_CATALOG.examples.filter(entry => entry.docsOnly)
    const names = () => knownStyleDescriptors().map(descriptor => descriptor.inputName)
    for (const entry of prototypes) {
      const prototype = JSON.parse(readFileSync(customStylePath(entry), 'utf8'))
      const source = readFileSync(customStyleSamplePath(entry), 'utf8')
      expect(validateStyleSpec(prototype), entry.id).toEqual([])
      expect(prototype.name, entry.id).toBe(`look:${entry.id}`)
      expect(prototype.roles, entry.id).toBeDefined()
      expect(prototype.constraints, entry.id).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'contrast', action: 'warn' }),
      ]))
      expect(names(), entry.id).not.toContain(prototype.name)

      const inline = renderMermaidSVG(source, {
        style: prototype,
        ...entry.renderOptions,
        security: 'strict',
      })
      expect(inline, entry.id).toContain('<svg')
      const verification = verifyMermaid(source, {
        renderOptions: { style: prototype, ...entry.renderOptions },
      })
      expect(verification.ok, entry.id).toBe(true)
      expect(verification.warnings.filter(warning => warning.code.startsWith('BRAND_CONSTRAINT_')), entry.id).toEqual([])

      const unregister = registerStyle(prototype)
      try {
        expect(names(), entry.id).toContain(prototype.name)
        expect(renderMermaidSVG(source, {
          style: prototype.name,
          ...entry.renderOptions,
          security: 'strict',
        }), entry.id).toBe(inline)
      } finally {
        expect(unregister(), entry.id).toBe(true)
      }
      expect(names(), entry.id).not.toContain(prototype.name)
    }

    const cupertino = JSON.parse(readFileSync(join(REPO, 'examples/styles/cupertino-prototype.style.json'), 'utf8'))
    expect(cupertino.roles).toMatchObject({
      node: { cornerRadius: 10 },
      edge: { bendRadius: 16 },
      group: { cornerRadius: 26 },
    })
  })

  it('makes Vercel and Cloudflare prototype policy visible in their own fixtures', () => {
    const render = (id: string) => {
      const entry = CUSTOM_STYLE_CATALOG.examples.find(candidate => candidate.id === id)!
      const style = JSON.parse(readFileSync(customStylePath(entry), 'utf8'))
      const source = readFileSync(customStyleSamplePath(entry), 'utf8')
      return { source, style, svg: renderMermaidSVG(source, { style, security: 'strict' }) }
    }
    const vercel = render('vercel-inspired-prototype')
    expect(vercel.style.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'category', value: 'line-0', role: 'series' }),
    ]))
    const { bindings: _bindings, semanticSlots: _semanticSlots, ...unboundVercel } = vercel.style
    const unboundVercelSvg = renderMermaidSVG(vercel.source, { style: unboundVercel, security: 'strict' })
    expect(unboundVercelSvg).toMatch(/class="xychart-line[^"]*"[^>]*style="[^"]*stroke:#565656/)
    expect(vercel.svg).toMatch(/class="xychart-line[^"]*"[^>]*style="[^"]*stroke:#0070f3/)

    const cloudflare = render('cloudflare-workers-inspired-prototype')
    expect(cloudflare.style.bindings).toEqual(expect.arrayContaining([
      expect.objectContaining({ channel: 'category', value: 'Runtime', role: 'task' }),
    ]))
    expect(cloudflare.svg).toMatch(/<rect[^>]*data-task="run"[^>]*fill:#ff4801[^>]*data-brand-cue="pattern"/)
    expect(renderMermaidASCII(cloudflare.source, {
      style: cloudflare.style,
      colorMode: 'none',
      useAscii: true,
    })).toContain('%%%%')
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

  it('pins manual visual approval to every documentation prototype screenshot', () => {
    const approval = JSON.parse(readFileSync(join(REPO, 'eval/style-prototype-evidence/visual-approval.json'), 'utf8')) as {
      status: string
      artifacts: Array<{ id: string; path: string; sha256: string }>
    }
    expect(approval.status).toBe('approved')
    expect(approval.artifacts.map(artifact => artifact.id)).toEqual(
      CUSTOM_STYLE_CATALOG.examples.filter(entry => entry.docsOnly).map(entry => entry.id),
    )
    for (const artifact of approval.artifacts) {
      const bytes = readFileSync(join(REPO, artifact.path))
      expect(createHash('sha256').update(bytes).digest('hex'), artifact.path).toBe(artifact.sha256)
    }
  })

  it('keeps cookbook screenshots in sync with the generator', () => {
    for (const { path, png } of buildCookbookScreenshots()) {
      expect(existsSync(path), path).toBe(true)
      expect(readFileSync(path)).toEqual(Buffer.from(png))
    }
  })
})
