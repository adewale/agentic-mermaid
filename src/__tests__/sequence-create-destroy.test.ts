/**
 * Sequence `create participant` / `destroy` — family-elevation-plan §Sequence
 * item 4 (feature stage). Upstream semantics
 * (https://mermaid.js.org/syntax/sequenceDiagram.html §Actor creation and
 * destruction): a `create` directive binds the participant's appearance to the
 * next message it receives (aliases supported); `destroy` ends the lifeline at
 * the next message the actor sends or receives, drawn as an X cross.
 */
import { describe, it, expect } from 'bun:test'
import { Resvg } from '@resvg/resvg-js'
import { fileURLToPath } from 'node:url'
import { parseSequenceDiagram } from '../sequence/parser.ts'
import { layoutSequenceDiagram } from '../sequence/layout.ts'
import { renderMermaidSVG, renderMermaidSVGWithReceipt } from '../index.ts'
import { resolveRenderRequest } from '../render-contract.ts'
import { positionResolvedFamily } from '../positioning.ts'
import { lowerPositionedFamilyScene } from '../graphical-render.ts'
import { inspectScenePrimitives } from '../scene/inspection.ts'
import { prepareResvgMarkerOrientation } from '../resvg-marker-orientation.ts'
import { PaintLayoutCertificationError } from '../scene/paint-certification.ts'
import type { PositionedSequenceDiagram } from '../sequence/types.ts'
import type { RenderOptions } from '../types.ts'

function parse(text: string) {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'))
  return parseSequenceDiagram(lines)
}

const SRC = `sequenceDiagram
  participant A as Alice
  participant B as Bob
  A->>B: start
  create actor D as Donald
  A->>D: welcome
  D-->>A: thanks
  destroy D
  A-xD: goodbye
  A->>B: done`

describe('parseSequenceDiagram – create/destroy', () => {
  it('binds creation only to the next inbound message for that actor', () => {
    const d = parse(`sequenceDiagram
  participant A
  create participant C
  C->>A: outgoing
  A->>C: received`)
    expect(d.actors.find(actor => actor.id === 'C')?.createMessageIndex).toBe(1)
  })

  it('binds creation to the next message and respects the alias', () => {
    const d = parse(SRC)
    const donald = d.actors.find(a => a.id === 'D')!
    expect(donald).toBeDefined()
    expect(donald.label).toBe('Donald')
    expect(donald.type).toBe('actor')
    expect(donald.createMessageIndex).toBe(1) // "A->>D: welcome"
  })

  it('binds destruction to the next message involving the actor', () => {
    const d = parse(SRC)
    const donald = d.actors.find(a => a.id === 'D')!
    expect(donald.destroyMessageIndex).toBe(3) // "A-xD: goodbye"
  })

  it('create participant (box form) works too', () => {
    const d = parse(`sequenceDiagram
      A->>B: hi
      create participant C
      A->>C: spawn`)
    const c = d.actors.find(a => a.id === 'C')!
    expect(c.type).toBe('participant')
    expect(c.label).toBe('C')
    expect(c.createMessageIndex).toBe(1)
  })

  it('create/destroy with no following message stays inert (full lifeline)', () => {
    const d = parse(`sequenceDiagram
      A->>B: hi
      destroy B`)
    expect(d.actors.find(a => a.id === 'B')!.destroyMessageIndex).toBeUndefined()
  })
})

describe('sequence create/destroy layout', () => {
  it('created lifeline starts at the create message; destroyed ends at the destroy message', () => {
    const p = layoutSequenceDiagram(parse(SRC))
    const donaldLife = p.lifelines.find(l => l.actorId === 'D')!
    const aliceLife = p.lifelines.find(l => l.actorId === 'A')!
    const createMsg = p.messages[1]!
    const destroyMsg = p.messages[3]!

    // Alice's lifeline spans the whole diagram; Donald's starts at the create
    // message and ends at the destroy message.
    expect(donaldLife.topY).toBeGreaterThan(aliceLife.topY)
    expect(donaldLife.topY).toBeGreaterThanOrEqual(createMsg.y)
    expect(donaldLife.bottomY).toBe(destroyMsg.y)
    expect(donaldLife.bottomY).toBeLessThan(aliceLife.bottomY)

    // The created actor's header box sits on the create message row.
    const donald = p.actors.find(a => a.id === 'D')!
    expect(donald.y).toBeGreaterThan(p.actors.find(a => a.id === 'A')!.y)
    expect(createMsg.y).toBeGreaterThanOrEqual(donald.y)
    expect(createMsg.y).toBeLessThanOrEqual(donald.y + donald.height)
  })

  it.each([
    ['right', 'participant A\ncreate participant C as Created\nA->>C: Welcome'],
    ['left', 'create participant C as Created\nA->>C: Welcome'],
  ])('creation arrows meet the %s participant header without losing their labels', (_direction, body) => {
    const sourceText = `sequenceDiagram\n${body}`
    const certifications: Array<string | undefined> = []
    const backgroundCertifications: Array<string | undefined> = []
    const literalCertifications: Array<string | undefined> = []
    for (const lineWidth of [1, 3]) {
      const options: RenderOptions = lineWidth === 1 ? {} : { style: { roles: { edge: { lineWidth } } } }
      const request = resolveRenderRequest(sourceText, options)
      const layout = positionResolvedFamily('sequence', request)
      const p = layout.positioned as PositionedSequenceDiagram
      const message = p.messages[0]!, source = p.actors.find(actor => actor.id === 'A')!, target = p.actors.find(actor => actor.id === 'C')!
      const attachment = source.x < target.x ? target.bounds.x : target.bounds.x + target.bounds.width
      expect(message.x1).toBe(source.x)
      expect(message.x2).toBe(attachment)
      expect(message.x2).not.toBe(target.x)
      expect(message.points.at(-1)).toEqual({ x: attachment, y: message.y })
      expect(message).toMatchObject({ from: 'A', to: 'C', endHead: 'filled', label: 'Welcome' })
      expect(message.labelPosition.bounds.x).toBeGreaterThanOrEqual(Math.min(message.x1, message.x2))
      expect(message.labelPosition.bounds.x + message.labelPosition.bounds.width).toBeLessThanOrEqual(Math.max(message.x1, message.x2))

      const inspection = inspectScenePrimitives(lowerPositionedFamilyScene(request, layout))
      const header = inspection.primitives.find(primitive => primitive.id === 'actor:C:box')!
      const connector = inspection.primitives.find(primitive => primitive.id === 'message:A->C#0:line')!
      expect(header.owner).toEqual({ id: 'C', role: 'actor' })
      expect(header.order).toBeGreaterThan(connector.order)

      const { svg, receipt } = renderMermaidSVGWithReceipt(sourceText, options)
      const lines = svg.match(/<line\b[^>]*data-from="A"[^>]*data-to="C"[^>]*>/g)!
      expect(lines).toHaveLength(1)
      const line = lines[0]!
      const numberAttr = (tag: string, name: string): number => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1])
      const box = svg.match(/<g\b[^>]*class="actor"[^>]*data-id="C"[^>]*>\s*(<rect\b[^>]*>)/)![1]!
      const boundary = source.x < target.x ? numberAttr(box, 'x') : numberAttr(box, 'x') + numberAttr(box, 'width')
      expect(numberAttr(line, 'x1')).toBeCloseTo(source.x, 3)
      expect(numberAttr(line, 'x2')).toBeCloseTo(boundary, 3)
      expect(numberAttr(line, 'y1')).toBeCloseTo(message.y, 3)
      expect(numberAttr(line, 'y2')).toBeCloseTo(message.y, 3)
      expect(numberAttr(line, 'stroke-width')).toBe(lineWidth)
      expect(line).toContain('data-direction="forward"')
      const markerToken = ' marker-end="url(#seq-arrow)"'
      expect(line).toContain(markerToken)
      const marker = svg.match(/<marker\b[^>]*id="seq-arrow"[^>]*>[\s\S]*?<\/marker>/)![0]
      expect(marker).toContain('refX="8" refY="2.5"')
      expect(marker).toContain('points="0 0, 8 2.5, 0 5"')
      const label = svg.match(/<g\b[^>]*class="message"[^>]*>[\s\S]*?(<text\b[^>]*>Welcome<\/text>)/)![1]!
      expect(label).toContain('data-prepared-text="true"')
      expect(numberAttr(label, 'textLength')).toBeGreaterThan(0)

      // Keep the actual document's resources, header, label and paint order.
      // A small pinned-font crop must lose off-shaft ink when its marker is removed.
      const left = Math.min(message.x1, message.x2) - 2
      const top = message.labelPosition.bounds.y - 2
      const width = Math.abs(message.x2 - message.x1) + 4
      const height = message.y + 2.5 * lineWidth + 2 - top
      const crop = (document: string) => document.replace(/<svg\b[^>]*>/, root => root
        .replace(/\bwidth="[^"]*"/, `width="${width}"`)
        .replace(/\bheight="[^"]*"/, `height="${height}"`)
        .replace(/\bviewBox="[^"]*"/, `viewBox="${left} ${top} ${width} ${height}"`))
      const raster = (document: string) => new Resvg(prepareResvgMarkerOrientation(document), {
        background: '#fff', fitTo: { mode: 'zoom', value: 4 },
        font: { fontFiles: [fileURLToPath(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url))], loadSystemFonts: false, defaultFontFamily: 'Inter' },
      }).render()
      const cropped = crop(svg)
      const actual = raster(cropped), absent = raster(cropped.replace(line, line.replace(markerToken, '')))
      const actualPixels = actual.pixels, absentPixels = absent.pixels
      let offShaft = 0
      for (let y = 0; y < actual.height; y++) for (let x = 0; x < actual.width; x++) {
        if (Math.abs(top + (y + 0.5) / 4 - message.y) <= lineWidth / 2) continue
        const offset = (y * actual.width + x) * 4
        if (actualPixels[offset]! < absentPixels[offset]! || actualPixels[offset + 1]! < absentPixels[offset + 1]! || actualPixels[offset + 2]! < absentPixels[offset + 2]!) offShaft++
      }
      expect(offShaft).toBeGreaterThan(0)
      const withoutLabel = raster(cropped.replace(label, '')).pixels
      expect(Buffer.compare(actualPixels, withoutLabel)).not.toBe(0)
      certifications.push(receipt.layoutCertification?.status)

      const background = renderMermaidSVGWithReceipt(sourceText, { style: { roles: { edge: { lineWidth, strokeColor: '#ffffff' } } } })
      const backgroundLine = background.svg.match(/<line\b[^>]*data-from="A"[^>]*data-to="C"[^>]*>/)![0]
      const backgroundCrop = crop(background.svg)
      expect(Buffer.compare(raster(backgroundCrop).pixels, raster(backgroundCrop.replace(backgroundLine, backgroundLine.replace(markerToken, ''))).pixels)).toBe(0)
      backgroundCertifications.push(background.receipt.layoutCertification?.status)

      const literal = renderMermaidSVGWithReceipt(sourceText, { style: { roles: { edge: { lineWidth, strokeColor: '#111111' } } } })
      const literalLine = literal.svg.match(/<line\b[^>]*data-from="A"[^>]*data-to="C"[^>]*>/)![0]
      const literalCrop = crop(literal.svg)
      expect(literal.svg.match(/<marker\b[^>]*id="seq-arrow"[^>]*>[\s\S]*?<\/marker>/)![0]).toContain('fill="#111111"')
      expect(Buffer.compare(raster(literalCrop).pixels, raster(literalCrop.replace(literalLine, literalLine.replace(markerToken, ''))).pixels)).not.toBe(0)
      literalCertifications.push(literal.receipt.layoutCertification?.status)
    }
    expect({ visible: certifications, literal: literalCertifications, backgroundVisible: backgroundCertifications.map(status => status === 'passed') }).toEqual({ visible: ['passed', 'passed'], literal: ['passed', 'passed'], backgroundVisible: [false, false] })
    for (const lineWidth of [1, 3]) {
      expect(renderMermaidSVGWithReceipt(sourceText, { style: { roles: { edge: { lineWidth } } }, layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
      expect(renderMermaidSVGWithReceipt(sourceText, { style: { roles: { edge: { lineWidth, strokeColor: '#111111' } } }, layoutSafety: 'strict' }).receipt.layoutCertification?.status).toBe('passed')
      expect(() => renderMermaidSVGWithReceipt(sourceText, { style: { roles: { edge: { lineWidth, strokeColor: '#ffffff' } } }, layoutSafety: 'strict' })).toThrow(PaintLayoutCertificationError)
    }
  })

  it('emits an X cross at the destroy point', () => {
    const p = layoutSequenceDiagram(parse(SRC))
    expect(p.destructions).toHaveLength(1)
    const cross = p.destructions[0]!
    const donaldLife = p.lifelines.find(l => l.actorId === 'D')!
    expect(cross.actorId).toBe('D')
    expect(cross.x).toBe(donaldLife.x)
    expect(cross.y).toBe(donaldLife.bottomY)
  })

  it('boxless/plain diagrams have no destructions', () => {
    const p = layoutSequenceDiagram(parse('sequenceDiagram\n  A->>B: hi'))
    expect(p.destructions).toHaveLength(0)
  })
})

describe('sequence create/destroy SVG rendering', () => {
  it('renders the alias label and a destroy cross marker', () => {
    const svg = renderMermaidSVG(SRC)
    expect(svg).toContain('Donald')
    expect(svg).toContain('class="destroy-cross"')
    expect(svg).toContain('data-actor="D"')
  })

  it('plain diagrams render no destroy cross', () => {
    const svg = renderMermaidSVG('sequenceDiagram\n  A->>B: hi')
    expect(svg).not.toContain('destroy-cross')
  })
})
