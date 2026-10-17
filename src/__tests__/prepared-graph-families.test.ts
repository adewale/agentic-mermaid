import { beforeAll, describe, expect, test } from 'bun:test'
import { decodeXML } from 'entities'
import { renderMermaidSVG } from '../index.ts'
import { measureRenderedText, renderedTextReady } from './helpers/rendered-text.ts'
import { layoutMindmap } from '../mindmap/layout.ts'
import { parseMindmap } from '../mindmap/parser.ts'
import { parseGitGraph } from '../gitgraph/parser.ts'
import { layoutGitGraph } from '../gitgraph/layout.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { renderPositionedMermaidSVG } from '../graphical-render.ts'

beforeAll(() => renderedTextReady())

const label = 'abcdefghijklmno'.repeat(4)
const examples = {
  flowchart: `flowchart TD\n A[${label}] -->|${label}| B[End]`,
  state: `stateDiagram-v2\n state "${label}" as A\n A --> B: ${label}\n note right of B : ${label}`,
  class: `classDiagram\n class A["${label}"]\n A --> B : ${label}`,
  er: `erDiagram\n A["${label}"] ||--o{ B : ${label}`,
}

describe('prepared graph-family display contracts', () => {
  for (const [family, source] of Object.entries(examples)) {
    test(`${family} allocates resolved tracking for node and relationship labels`, () => {
      const svg = renderMermaidSVG(source, { style: { roles: {
        node: { letterSpacing: 4, textTransform: 'uppercase' },
        edge: { letterSpacing: 4, textTransform: 'uppercase' },
      } } })
      const texts = measureRenderedText(svg).texts.filter(text => text.content === label.toUpperCase())
      expect(texts.length).toBeGreaterThanOrEqual(2)
      for (const text of texts) {
        expect(text.offCanvasPixels, `${family}: ${text.content}`).toBe(0)
        expect(text.pixels).toBeGreaterThan(0)
      }
    }, 60_000)
  }

  for (const [family, source] of [
    ['flowchart', 'flowchart TD\n subgraph G["First<br/>Second<br/>Third<br/>Fourth<br/>Fifth"]\n Child[Below heading]\n end'],
    ['state', 'stateDiagram-v2\n state "First<br/>Second<br/>Third<br/>Fourth<br/>Fifth" as G {\n state Child\n }'],
    ['er', 'erDiagram\n subgraph G["First<br/>Second<br/>Third<br/>Fourth<br/>Fifth"]\n Child\n end'],
    ['class', 'classDiagram\n namespace G["First<br/>Second<br/>Third<br/>Fourth<br/>Fifth"] {\n class Child\n }'],
  ]) {
    test(`${family} reserves complete multiline container headers before child placement`, () => {
      const texts = measureRenderedText(renderMermaidSVG(source!)).texts
      const header = texts.find(text => text.content.includes('First'))!
      const child = texts.find(text => text.content === (family === 'flowchart' ? 'Below heading' : 'Child'))!
      expect(header).toBeDefined()
      expect(child).toBeDefined()
      expect(header.offCanvasPixels).toBe(0)
      expect(child.box!.y).toBeGreaterThan(header.box!.y + header.box!.height)
    }, 60_000)
  }

  test('mindmap keeps authored graphemes and formatting through narrow wrapping', () => {
    const diagram = layoutMindmap(parseMindmap('mindmap\n root["<b>antidisestablishmentarianism</b> é 東京 👩🏽‍💻"]'), { maxNodeWidth: 75 })
    const node = diagram.nodes[0]!
    expect(node.labelBlock!.prepared.source).toBe('<b>antidisestablishmentarianism</b> é 東京 👩🏽‍💻')
    expect(node.labelBlock!.lineBlocks.flatMap(line => line.runs).filter(run => run.bold).map(run => run.text).join('').replace(/-/g, '')).toBe('antidisestablishmentarianism')
    expect(node.labelBlock!.lineBlocks.flatMap(line => line.runs).map(run => run.text).join('')).toContain('👩🏽‍💻')
  })

  test('mindmap applies casing once before wrapping with resolved typography', () => {
    const word = 'antidisestablishmentarianism'.repeat(3)
    const source = `---\nconfig:\n  mindmap:\n    maxNodeWidth: 90\n---\nmindmap\n root[${word}]`
    const svg = renderMermaidSVG(source, { style: { roles: { node: { fontSize: 20, fontWeight: 700, letterSpacing: 3, textTransform: 'capitalize' } } } })
    const text = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)].map(match => decodeXML(match[1]!.replace(/<[^>]+>/g, ''))).join('')
    expect(text.replace(/[\s-]/g, '')).toBe(`A${word.slice(1)}`)
    for (const rendered of measureRenderedText(svg).texts) expect(rendered.offCanvasPixels).toBe(0)
  }, 60_000)

  test('ER literal comments retain tag characters in both glyph width and text', () => {
    const plain = 'Literal code & exact punctuation'
    const render = (comment: string) => measureRenderedText(renderMermaidSVG(`erDiagram\n A {\n string field "${comment}"\n }`)).texts.find(text => text.content === comment)!
    const unadorned = render(plain)
    const tagged = render(`<b>${plain}</b>`)
    expect(tagged).toBeDefined()
    expect(tagged.offCanvasPixels).toBe(0)
    expect(tagged.box!.width).toBeGreaterThan(unadorned.box!.width + 20)
  }, 60_000)

  for (const [family, label, source] of [
    ['class', 'नमस्ते दुनिया'.repeat(8), `classDiagram\n class A {\n +String ${'नमस्ते दुनिया'.repeat(8)}\n }`],
    ['er', 'X 👨‍👩‍👧‍👦 '.repeat(8).trim(), `erDiagram\n A {\n string field "${'X 👨‍👩‍👧‍👦 '.repeat(8)}"\n }`],
  ]) {
    test(`${family} contains literal member/comment text across fallback shaping`, () => {
      const rendered = measureRenderedText(renderMermaidSVG(source!)).texts.find(text => text.content.includes(label!))!
      expect(rendered).toBeDefined()
      expect(rendered.offCanvasPixels).toBe(0)
      expect(rendered.pixels).toBeGreaterThan(0)
    }, 60_000)
  }

  test('Class notes paint the same font size their prepared geometry allocates', () => {
    const source = 'classDiagram\n class A\n note for A "Prepared note typography"'
    const note = measureRenderedText(renderMermaidSVG(source)).texts.find(text => text.content === 'Prepared note typography')!
    expect(note.fontSize).toBe(12)
    expect(note.offCanvasPixels).toBe(0)
  })

  for (const direction of ['TB', 'BT']) {
    test(`GitGraph ${direction} separates complete multiline commit labels`, () => {
      const source = `gitGraph ${direction}:\n commit id:"one"\n commit id:"two"\n commit id:"three"`
      const model = parseGitGraph(source)
      for (const commit of model.commits) commit.message = Array.from({ length: 10 }, (_, line) => `${commit.id} line ${line}`).join('\n')
      const svg = renderPositionedMermaidSVG(resolveRenderRequest(source, {}, 'svg'), { positioned: layoutGitGraph(model) }, []).svg
      const texts = measureRenderedText(svg).texts.filter(text => text.content.includes('line 0')).sort((a, b) => a.box!.y - b.box!.y)
      expect(texts).toHaveLength(3)
      for (let i = 1; i < texts.length; i++) expect(texts[i]!.box!.y).toBeGreaterThan(texts[i - 1]!.box!.y + texts[i - 1]!.box!.height)
    }, 60_000)
  }

  test('GitGraph uses resolved case, fonts and tracking for branches, commits, tags and title', () => {
    const source = '---\ntitle: history title\n---\ngitGraph\n commit id:"first" msg:"commit message" tag:"release tag"\n branch feature\n commit msg:"next message"'
    const svg = renderMermaidSVG(source, { style: { roles: {
      node: { textTransform: 'uppercase', fontSize: 22, fontWeight: 800, letterSpacing: 3 },
      group: { textTransform: 'uppercase', fontSize: 20, fontWeight: 700, letterSpacing: 2 },
    } } })
    const texts = measureRenderedText(svg).texts
    for (const expected of ['HISTORY TITLE', 'FEATURE', 'COMMIT MESSAGE', 'RELEASE TAG']) {
      const rendered = texts.find(text => text.content === expected)!
      expect(rendered).toBeDefined()
      expect(rendered.offCanvasPixels).toBe(0)
      expect(rendered.pixels).toBeGreaterThan(0)
    }
  }, 60_000)

  for (const direction of ['LR', 'TB', 'BT']) {
    test(`gitGraph ${direction} contains complete multiline literal commit messages and tags`, () => {
      // The source grammar preserves literal backslash-n. Typed diagrams can
      // carry authored hard breaks, so exercise that owning layout boundary.
      const source = `gitGraph ${direction}:\n commit id:"first"\n commit id:"next" msg:"Next"`
      const diagram = parseGitGraph(source)
      diagram.commits[0]!.message = '<b>First\nSecond\nThird\nFourth</b>'
      diagram.commits[0]!.tags = ['v1\nCandidate']
      diagram.branches[0]!.name = 'Main\n東京\nRelease'
      for (const entry of diagram.commits) entry.branch = diagram.branches[0]!.name
      diagram.title = 'History\nAcross lines\nStill visible'
      const request = resolveRenderRequest(source, {}, 'svg')
      const svg = renderPositionedMermaidSVG(request, { positioned: layoutGitGraph(diagram) }, []).svg
      const texts = measureRenderedText(svg).texts
      const commit = texts.find(text => text.content.includes('<b>First'))!
      expect(commit).toBeDefined()
      expect(commit.content).toContain('Fourth</b>')
      expect(svg.match(/class="git-commit-label"[\s\S]*?<\/text>/)![0].match(/<tspan\b/g)).toHaveLength(4)
      expect(commit.offCanvasPixels).toBe(0)
      for (const text of texts) expect(text.offCanvasPixels).toBe(0)
    }, 60_000)
  }
})
