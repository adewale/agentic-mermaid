import { describe, expect, test } from 'bun:test'
import { renderMermaidASCIIWithReceipt } from '../ascii/index.ts'
import { terminalDocumentOf, type TerminalDocument, type TerminalRegion } from '../ascii/terminal-document.ts'

function bounds(region: TerminalRegion) {
  expect(region.ownedCellSpans.length, region.id).toBeGreaterThan(0)
  return {
    left: region.canvasColStart, right: region.canvasColEnd - 1,
    top: region.canvasRow, bottom: region.canvasRow + region.rowSpan! - 1,
  }
}

function namespaceFrame(document: TerminalDocument, id: string) {
  const region = document.regions().find(region => region.kind === 'cluster' && region.id === id)
  expect(region, id).toBeDefined()
  const box = bounds(region!)
  const owns = (x: number, y: number) => document.cell(x, y)?.owners.some(owner => owner.kind === 'cluster' && owner.id === id)
  for (let y = box.top; y <= box.bottom; y++) for (const x of [box.left, box.right]) {
    expect(owns(x, y), `${id} side at ${x},${y}`).toBe(true)
    expect(document.cell(x, y)?.stroke, `${id} side ink at ${x},${y}`).toBeDefined()
    expect(document.cell(x, y)?.glyph.trim()).not.toBe('')
  }
  for (let x = box.left; x <= box.right; x++) {
    expect(owns(x, box.top), `${id} header at ${x}`).toBe(true)
    expect(owns(x, box.bottom), `${id} bottom at ${x}`).toBe(true)
    expect(document.cell(x, box.bottom)?.stroke, `${id} bottom ink at ${x}`).toBeDefined()
  }
  return box
}

function contained(child: ReturnType<typeof bounds>, parent: ReturnType<typeof bounds>) {
  expect(child.left).toBeGreaterThan(parent.left)
  expect(child.right).toBeLessThan(parent.right)
  expect(child.top).toBeGreaterThan(parent.top)
  expect(child.bottom).toBeLessThan(parent.bottom)
}

describe('Class terminal namespace frames (B05/CL4)', () => {
  test('draws a complete namespace frame containing its member classes', () => {
    const result = renderMermaidASCIIWithReceipt(`classDiagram
      namespace Domain {
        class Account
        class Ledger
      }
      Account --> Ledger`, { useAscii: true, colorMode: 'none' })
    const document = terminalDocumentOf(result)!
    const namespace = namespaceFrame(document, 'Domain')
    for (const id of ['Account', 'Ledger']) {
      const member = document.regions().find(region => region.kind === 'node' && region.id === id)
      expect(member, id).toBeDefined()
      expect(member!.parentId).toBe('Domain')
      expect(result.text).toContain(id)
      contained(bounds(member!), namespace)
    }
    expect(result.text).toMatch(/\+[-]+ Domain [-]+\+/)
  })

  test('keeps nested namespace frames and class boxes spatially contained', () => {
    const result = renderMermaidASCIIWithReceipt(`classDiagram
      namespace Company {
        namespace Platform {
          class API
        }
      }`, { colorMode: 'none' })
    const document = terminalDocumentOf(result)!
    const company = namespaceFrame(document, 'Company')
    const platform = namespaceFrame(document, 'Company.Platform')
    contained(platform, company)
    const api = document.regions().find(region => region.kind === 'node' && region.id === 'API')
    expect(api).toBeDefined()
    expect(api!.parentId).toBe('Company.Platform')
    contained(bounds(api!), platform)
    for (const label of ['Company', 'Platform', 'API']) expect(result.text).toContain(label)
  })
})
