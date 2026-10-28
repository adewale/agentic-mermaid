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
  test.each([true, false])('draws freestanding notes without classes or namespaces (ASCII=%s)', useAscii => {
    const result = renderMermaidASCIIWithReceipt('classDiagram\nnote "First freestanding note"\nnote "Second freestanding note"', { useAscii, colorMode: 'none' })
    expect(result.text).toContain('First freestanding note')
    expect(result.text).toContain('Second freestanding note')
    const document = terminalDocumentOf(result)!
    const notes = document.regions().filter(region => region.kind === 'node')
    expect(notes).toHaveLength(2)
    const boxes = notes.map(bounds).sort((a, b) => a.top - b.top)
    expect(boxes[1]!.top).toBeGreaterThan(boxes[0]!.bottom)
  })

  test.each([13, 33, 37, 38] as const)('reserves final card faces and opposing routing lanes (case %s)', ordinal => {
    for (const useAscii of [false, true]) {
      const result = renderMermaidASCIIWithReceipt(namespacePackingCases[ordinal]!, { useAscii, colorMode: 'none' })
      const doc = terminalDocumentOf(result)!, regions = doc.regions()
      const hub = regions.find(region => region.kind === 'node' && region.id === 'ns:Domain')!
      expect(hub.parentId).toBe(ordinal === 13 ? undefined : 'Root')
      expect(regions.find(region => region.kind === 'node' && region.id === 'class-namespace:Domain')!.parentId).toBe(ordinal === 13 ? undefined : 'Root')
      if (ordinal !== 13) {
        const inner = regions.find(region => region.kind === 'cluster' && region.id === 'Root.Domain')!
        expect(inner.parentId).toBe('Root')
        expect(inner.members).toContain(ordinal === 33 ? 'C11' : ordinal === 37 ? 'C9' : 'C8')
      }
      const edges = regions.filter(region => region.kind === 'edge')
      expect(edges).toHaveLength(({ 13: 45, 33: 44, 37: 34, 38: 25 }[ordinal]!) + 1)
      const authored = [...namespacePackingCases[ordinal]!.matchAll(/^`([^`]+)`(?: "([^"]*)")? ([.*o<|>\-]+)(?: "([^"]*)")? `([^`]+)`(?: : (.*))?$/gm)]
      expect(authored).toHaveLength(edges.length - 1)
      for (const [index, relation] of authored.entries()) {
        const id = `relationship:${index}`
        expect(edges.find(edge => edge.id === id)).toMatchObject({ from: relation[1], to: relation[5] })
        for (const [suffix, text] of [['from', relation[2]], ['to', relation[4]]] as const) if (text) expect(regions.find(region => region.id === `${id}:${suffix}-cardinality`)?.projectedText).toBe(text)
        if (relation[6]) expect(edges.find(edge => edge.id === id)?.projectedText).toBe(relation[6].trim())
      }
      expect(regions.filter(region => region.kind === 'node')).toHaveLength(({ 13: 23, 33: 23, 37: 18, 38: 17 }[ordinal]!) + 2)
      const notes = regions.filter(region => region.annotationTarget?.id === hub.id)
      expect(notes).toHaveLength(1)
      expect(notes[0]!.projectedText).toBe(`owned note ${ordinal}\nsecond line`)
      for (const node of regions.filter(region => region.kind === 'node')) for (const side of ['T', 'R', 'B', 'L']) {
        const ports = edges.flatMap(region => region.ports!.filter(port => port.nodeId === node.id && port.side === side))
        const extent = side === 'T' || side === 'B' ? node.canvasColEnd - node.canvasColStart : node.rowSpan!
        if (ports.length) expect(extent).toBeGreaterThanOrEqual(ports.length * 3 + 2)
        expect(new Set(ports.map(port => `${port.x},${port.y}`)).size).toBe(ports.length)
        for (const port of ports) {
          const edge = edges.find(region => region.ports!.includes(port))!
          expect(doc.cell(port.x, port.y)?.owners.some(owner => owner.kind === 'edge' && owner.id === edge.id)).toBe(true)
          for (const marker of port.markers ?? []) expect(doc.cell(port.x, port.y)?.marker).toMatchObject(marker)
        }
      }
      for (const group of regions.filter(region => region.kind === 'cluster')) {
        const headerInk = [...doc.entries()].filter(([x, y, cell]) => y === group.canvasRow && x > group.canvasColStart && x < group.canvasColEnd - 1 && cell.owners.some(owner => owner.kind === 'edge'))
        expect(headerInk).toEqual([])
      }
      expect(() => doc.assertMarkers()).not.toThrow()
    }
  })

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

// Retained authored cases exercise namespace-induced face changes and opposing marker approaches.
const namespacePackingCases: Record<number, string> = {
  13: `classDiagram
direction RL
class \`ns:Domain\`["Card 13-0 WWWWWWWWWWW 👩‍💻"] {
  +String value0
  +step0()
}
class \`class-namespace:Domain\`["Card 13-1 WWWWW"] {
  +String value1
}
class \`__interface_0\`["Card 13-2 WW"] {
  +String value2
}
class \`C3\`["Card 13-3 WWWWWWWWW 👩‍💻"] {
  +String value3
}
class \`C4\`["Card 13-4 WWWWWWWWWWWW"] {
  +String value4
}
class \`C5\`["Card 13-5 WWWWWW"] {
  +String value5
}
class \`C6\`["Card 13-6 W 👩‍💻"] {
  +String value6
}
class \`C7\`["Card 13-7 "] {
  +String value7
}
class \`C8\`["Card 13-8 W"] {
  +String value8
}
class \`C9\`["Card 13-9 WWWWWWWWWWW 👩‍💻"] {
  +String value9
  +step9()
}
class \`C10\`["Card 13-10 W"] {
  +String value10
  +step10()
}
class \`C11\`["Card 13-11 WWWWWWWWW"] {
  +String value11
}
class \`C12\`["Card 13-12 WWWWWWWWWWWW 👩‍💻"] {
  +String value12
  +step12()
}
class \`C13\`["Card 13-13 "] {
  +String value13
}
class \`C14\`["Card 13-14 WWWWWWW"] {
  +String value14
}
class \`C15\`["Card 13-15 WWWWWWW 👩‍💻"] {
  +String value15
}
class \`C16\`["Card 13-16 WWWWW"] {
  +String value16
}
class \`C17\`["Card 13-17 WWWWWWWWWWWW"] {
  +String value17
  +step17()
}
class \`C18\`["Card 13-18 WWWW 👩‍💻"] {
  +String value18
  +step18()
}
class \`C19\`["Card 13-19 WWWWWWWWW"] {
  +String value19
}
class \`C20\`["Card 13-20 WWWWWWWWWW"] {
  +String value20
}
class \`C21\`["Card 13-21 WW 👩‍💻"] {
  +String value21
}
class \`C22\`["Card 13-22 W"] {
  +String value22
  +step22()
}
\`ns:Domain\` "1" --> \`class-namespace:Domain\`
\`ns:Domain\` "1..*" --> \`__interface_0\`
\`ns:Domain\` "*" <|-- \`C3\`
\`ns:Domain\` "0..1" *-- \`C4\`
\`ns:Domain\` "0..1" *-- \`C5\`
\`ns:Domain\` "1" ..|> \`C6\`
\`ns:Domain\` "0..1" o-- \`C7\`
\`ns:Domain\` "0..1" ..> \`C8\` : edge 7 xxxxxxxxxxxx
\`ns:Domain\` "1..*" *-- \`C9\` : edge 8 xxxxxxxxxxxxxx
\`ns:Domain\` "*" o-- \`C10\`
\`ns:Domain\` "1" ..> \`C11\` : edge 10 xxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` "1" *-- \`C12\`
\`ns:Domain\` "*" -- \`C13\`
\`ns:Domain\` "*" <|-- \`C14\`
\`ns:Domain\` "1" ..|> \`C15\`
\`ns:Domain\` "1..*" ..|> \`C16\` : edge 15 xxxxxxxxxxxxxx
\`ns:Domain\` "1" o-- \`C17\` : edge 16 xxxxxxxxxxxxx
\`ns:Domain\` "0..1" -- \`C18\`
\`ns:Domain\` "0..1" <|-- \`C19\`
\`ns:Domain\` "1" o-- \`C20\`
\`ns:Domain\` "0..1" ..|> \`C21\` : edge 20 xx
\`ns:Domain\` "1" ..|> \`C22\`
\`class-namespace:Domain\` "1" *-- \`C22\`
\`__interface_0\` "1..*" ..> \`C22\`
\`C3\` "1" -- \`C22\` : edge 24 xxxxxxxxxxxxxxxxxxxxxxxx
\`C4\` "*" <|-- \`C22\` : edge 25 xxxxxxxxxxxx
\`C5\` "*" *-- \`C22\`
\`C6\` "1" ..> \`C22\` : edge 27 xxxxxxxxxxxxx
\`C7\` "1..*" *-- \`C22\` : edge 28 xxxxxxxxxxxxxxxxxxxx
\`C8\` "1..*" -- \`C22\` : edge 29 xxxxxxxxxx
\`C9\` "*" --> \`C22\` : edge 30 xxxxxxxxxx
\`C10\` "*" *-- \`C22\`
\`C11\` "1" --> \`C22\`
\`C12\` "1..*" --> \`C22\`
\`C13\` "*" <|-- \`C22\`
\`C14\` "0..1" *-- \`C22\`
\`C15\` "0..1" *-- \`C22\`
\`C16\` "1" ..|> \`C22\`
\`C17\` "0..1" o-- \`C22\`
\`C18\` "0..1" ..> \`C22\` : edge 39 xxxxxxxxxxxx
\`C19\` "1..*" *-- \`C22\` : edge 40 xxxxxxxxxxxxxx
\`C20\` "*" o-- \`C22\`
\`C21\` "1" ..> \`C22\` : edge 42 xxxxxxxxxxxxxxxxxxxx
\`class-namespace:Domain\` "1" *-- \`ns:Domain\`
\`C22\` "*" -- \`C22\`
note for \`ns:Domain\` "owned note 13<br/>second line"
note "free note 13"
`,
  38: `---
title: Class compact 38
---
classDiagram
direction BT
namespace Root {
  class \`ns:Domain\`["Card 38-0 WWWW 👩‍💻"] {
    +String value0
    +step0()
  }
  class \`class-namespace:Domain\`["Card 38-1 WWWW"] {
    +String value1
    +step1()
  }
  class \`__interface_0\`["Card 38-2 WWWWW"] {
    +String value2
    +step2()
  }
  class \`C3\`["Card 38-3 WWWW 👩‍💻"] {
    +String value3
    +step3()
  }
  class \`C4\`["Card 38-4 WWWWWWWWWWW"] {
    +String value4
    +step4()
  }
  class \`C5\`["Card 38-5 WWWW"] {
    +String value5
  }
  class \`C6\`["Card 38-6 WWWWWWWWW 👩‍💻"] {
    +String value6
  }
  class \`C7\`["Card 38-7 WWWW"] {
    +String value7
    +step7()
  }
  namespace Domain {
    class \`C8\`["Card 38-8 WWWWWWWWWWWW"] {
      +String value8
      +step8()
    }
    class \`C9\`["Card 38-9  👩‍💻"] {
      +String value9
      +step9()
    }
    class \`C10\`["Card 38-10 WWWWWWWW"] {
      +String value10
      +step10()
    }
    class \`C11\`["Card 38-11 WWW"] {
      +String value11
      +step11()
    }
    class \`C12\`["Card 38-12 WWWWW 👩‍💻"] {
      +String value12
    }
    class \`C13\`["Card 38-13 WWWWW"] {
      +String value13
    }
    class \`C14\`["Card 38-14 WWWWWWWWWW"] {
      +String value14
      +step14()
    }
    class \`C15\`["Card 38-15 WWWWWWW 👩‍💻"] {
      +String value15
      +step15()
    }
    class \`C16\`["Card 38-16 WWWWW"] {
      +String value16
      +step16()
    }
  }
}
\`ns:Domain\` "1..*" ..> \`class-namespace:Domain\` : edge 0 xxxxxxxxxxxxxxxxxxx
\`class-namespace:Domain\` "0..1" -- \`__interface_0\` : edge 1 xxxxxxxxxxxxxxxxxx
\`__interface_0\` "0..1" *-- \`C3\` : edge 2 xxx
\`C3\` "0..1" ..> \`C4\`
\`C4\` "1" o-- \`C5\`
\`C5\` "1..*" *-- \`C6\` : edge 5 xxxxxxxxxxxxxxx
\`C6\` "1" *-- \`C7\` : edge 6 xxxxxxxxxxxxxxxxxxxxxx
\`C7\` "1" *-- \`C8\` : edge 7 xxxxxxx
\`C8\` "1..*" ..|> \`C9\` : edge 8 xxxxxxx
\`C9\` "0..1" *-- \`C10\` : edge 9 xx
\`C10\` "0..1" ..> \`C11\`
\`C11\` "1..*" --> \`C12\`
\`C12\` "*" -- \`C13\` : edge 12 xxxxxxxxxxxxx
\`C13\` "0..1" <|-- \`C14\` : edge 13 xxxxxxxxxx
\`C14\` "*" o-- \`C15\` : edge 14 xxxxxxxxxxxxx
\`C15\` "*" ..> \`C16\`
\`C16\` "1..*" --> \`ns:Domain\` : edge 16 x
\`ns:Domain\` "1" o-- \`__interface_0\` : edge 17 xxxxxxxxxxxxxxxxxxxxxxxx
\`C3\` "0..1" -- \`C5\` : edge 18 xxxxxxxxxxxxxxxxxxxxxxx
\`C6\` "*" *-- \`C8\` : edge 19 xxxxxxxxxxxxxxxxxxxx
\`C9\` "1..*" -- \`C11\` : edge 20 xxxxxxxxxx
\`C12\` "1" -- \`C14\`
\`C15\` "1" --> \`ns:Domain\` : edge 22 xxxxxxxxx
\`ns:Domain\` "1" --> \`class-namespace:Domain\` : edge 23 xxxxxxxxxxx
\`class-namespace:Domain\` "1..*" <|-- \`ns:Domain\` : edge 24 xxxxxxxxxxxxxxxxxxxxxx
note for \`ns:Domain\` "owned note 38<br/>second line"
note "free note 38"
`,
  33: `---
title: Class compact 33
---
classDiagram
direction TB
namespace Root {
  class \`ns:Domain\`["Card 33-0 WWW 👩‍💻"] {
    +String value0
    +step0()
  }
  class \`class-namespace:Domain\`["Card 33-1 WWWWWWWWW"] {
    +String value1
    +step1()
  }
  class \`__interface_0\`["Card 33-2 W"] {
    +String value2
    +step2()
  }
  class \`C3\`["Card 33-3  👩‍💻"] {
    +String value3
  }
  class \`C4\`["Card 33-4 WWWW"] {
    +String value4
    +step4()
  }
  class \`C5\`["Card 33-5 WWWWWWWWWWWW"] {
    +String value5
  }
  class \`C6\`["Card 33-6 WWWWWWWWWW 👩‍💻"] {
    +String value6
    +step6()
  }
  class \`C7\`["Card 33-7 WWWWWWWWWWWW"] {
    +String value7
  }
  class \`C8\`["Card 33-8 "] {
    +String value8
  }
  class \`C9\`["Card 33-9 WWWWWWWWWW 👩‍💻"] {
    +String value9
  }
  class \`C10\`["Card 33-10 WWWWWWWWW"] {
    +String value10
    +step10()
  }
  namespace Domain {
    class \`C11\`["Card 33-11 WWW"] {
      +String value11
    }
    class \`C12\`["Card 33-12 WWWWWWWW 👩‍💻"] {
      +String value12
    }
    class \`C13\`["Card 33-13 "] {
      +String value13
    }
    class \`C14\`["Card 33-14 WWWWWWWWWWWW"] {
      +String value14
      +step14()
    }
    class \`C15\`["Card 33-15 WWWWWWW 👩‍💻"] {
      +String value15
      +step15()
    }
    class \`C16\`["Card 33-16 WWWWWWW"] {
      +String value16
    }
    class \`C17\`["Card 33-17 WWWWWWW"] {
      +String value17
      +step17()
    }
    class \`C18\`["Card 33-18 WWWWWWW 👩‍💻"] {
      +String value18
    }
    class \`C19\`["Card 33-19 WWWWWWWWWWWW"] {
      +String value19
    }
    class \`C20\`["Card 33-20 WW"] {
      +String value20
      +step20()
    }
    class \`C21\`["Card 33-21 WWWW 👩‍💻"] {
      +String value21
    }
    class \`C22\`["Card 33-22 WWWW"] {
      +String value22
    }
  }
}
\`ns:Domain\` "1..*" *-- \`class-namespace:Domain\` : edge 0 xxxxxxxx
\`ns:Domain\` "0..1" ..> \`__interface_0\`
\`ns:Domain\` "1..*" o-- \`C3\` : edge 2 xxxxxxxxxxxx
\`ns:Domain\` "1" *-- \`C4\`
\`ns:Domain\` "1..*" -- \`C5\` : edge 4 xxxxx
\`ns:Domain\` "1..*" --> \`C6\`
\`ns:Domain\` "1" <|-- \`C7\`
\`ns:Domain\` "0..1" ..> \`C8\`
\`ns:Domain\` "*" -- \`C9\` : edge 8 xxxxxxxxxxxx
\`ns:Domain\` "0..1" *-- \`C10\`
\`ns:Domain\` "1" --> \`C11\`
\`ns:Domain\` "0..1" ..|> \`C12\`
\`ns:Domain\` "0..1" --> \`C13\` : edge 12 xxxxxxxxxxxxxxx
\`ns:Domain\` "1" ..|> \`C14\` : edge 13 x
\`ns:Domain\` "*" ..|> \`C15\`
\`ns:Domain\` "1" ..> \`C16\` : edge 15 xxxxxxxxxxxxxxxx
\`ns:Domain\` "0..1" o-- \`C17\`
\`ns:Domain\` "*" <|-- \`C18\`
\`ns:Domain\` "1" *-- \`C19\` : edge 18 xxxxxxx
\`ns:Domain\` "0..1" -- \`C20\`
\`ns:Domain\` "1" ..|> \`C21\`
\`ns:Domain\` "*" -- \`C22\`
\`class-namespace:Domain\` "0..1" ..> \`C22\`
\`__interface_0\` "*" ..|> \`C22\` : edge 23 xxxxxxxxxxxxxxxxxxxxxx
\`C3\` "*" ..> \`C22\` : edge 24
\`C4\` "1..*" ..|> \`C22\` : edge 25 xxxxxxxxxxxxxxxxxxxx
\`C5\` "1..*" -- \`C22\` : edge 26 xxxxxxxx
\`C6\` "1" -- \`C22\` : edge 27 xxxxx
\`C7\` "0..1" *-- \`C22\` : edge 28 xxxxxxxxxxxxxxxxxxxx
\`C8\` "*" -- \`C22\`
\`C9\` "0..1" ..> \`C22\` : edge 30 xxxx
\`C10\` "1" ..> \`C22\` : edge 31 xxxxxxxxxxxxxxxxxxx
\`C11\` "1..*" *-- \`C22\` : edge 32 xxxxxxxx
\`C12\` "0..1" ..> \`C22\`
\`C13\` "1..*" o-- \`C22\` : edge 34 xxxxxxxxxxxx
\`C14\` "1" *-- \`C22\`
\`C15\` "1..*" -- \`C22\` : edge 36 xxxxx
\`C16\` "1..*" --> \`C22\`
\`C17\` "1" <|-- \`C22\`
\`C18\` "0..1" ..> \`C22\`
\`C19\` "*" -- \`C22\` : edge 40 xxxxxxxxxxxx
\`C20\` "0..1" *-- \`C22\`
\`C21\` "1" --> \`C22\`
\`C22\` "0..1" ..|> \`C22\`
note for \`ns:Domain\` "owned note 33<br/>second line"
note "free note 33"
`,
  37: `classDiagram
direction BT
namespace Root {
  class \`ns:Domain\`["Card 37-0 WWWWWWWW 👩‍💻"] {
    +String value0
    +step0()
  }
  class \`class-namespace:Domain\`["Card 37-1 WW"] {
    +String value1
    +step1()
  }
  class \`__interface_0\`["Card 37-2 WWWWWWWW"] {
    +String value2
  }
  class \`C3\`["Card 37-3 WWWWWWWW 👩‍💻"] {
    +String value3
  }
  class \`C4\`["Card 37-4 "] {
    +String value4
  }
  class \`C5\`["Card 37-5 WWWW"] {
    +String value5
  }
  class \`C6\`["Card 37-6 WW 👩‍💻"] {
    +String value6
  }
  class \`C7\`["Card 37-7 W"] {
    +String value7
    +step7()
  }
  class \`C8\`["Card 37-8 WW"] {
    +String value8
  }
  namespace Domain {
    class \`C9\`["Card 37-9 WWWWW 👩‍💻"] {
      +String value9
    }
    class \`C10\`["Card 37-10 WWWWW"] {
      +String value10
      +step10()
    }
    class \`C11\`["Card 37-11 WWWWWWWWWWW"] {
      +String value11
    }
    class \`C12\`["Card 37-12 WWWWWWWWWWWW 👩‍💻"] {
      +String value12
      +step12()
    }
    class \`C13\`["Card 37-13 "] {
      +String value13
      +step13()
    }
    class \`C14\`["Card 37-14 WWWWWWWWWWW"] {
      +String value14
      +step14()
    }
    class \`C15\`["Card 37-15 WWWWWW 👩‍💻"] {
      +String value15
      +step15()
    }
    class \`C16\`["Card 37-16 WWWWW"] {
      +String value16
      +step16()
    }
    class \`C17\`["Card 37-17 WWWWWWWWWW"] {
      +String value17
      +step17()
    }
  }
}
\`ns:Domain\` --> \`class-namespace:Domain\`
\`ns:Domain\` <|-- \`__interface_0\`
\`ns:Domain\` ..|> \`C3\`
\`ns:Domain\` ..> \`C4\`
\`ns:Domain\` o-- \`C5\`
\`ns:Domain\` --> \`C6\` : edge 5 xxxxxxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..> \`C7\`
\`ns:Domain\` -- \`C8\`
\`ns:Domain\` --> \`C9\` : edge 8 xxxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` o-- \`C10\`
\`ns:Domain\` ..> \`C11\` : edge 10 xxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..> \`C12\` : edge 11 xxxxxxxxxxxxxxxxxxxx
\`ns:Domain\` *-- \`C13\` : edge 12 xxxxxxxxxx
\`ns:Domain\` o-- \`C14\` : edge 13 xxxxx
\`ns:Domain\` *-- \`C15\` : edge 14 xxxxxxxxx
\`ns:Domain\` *-- \`C16\` : edge 15 xxxxxxxxxxxxxxxxxxx
\`ns:Domain\` ..|> \`C17\`
\`class-namespace:Domain\` -- \`C17\` : edge 17 xxxxxxxxxxxxxxxxxxxxxxxx
\`__interface_0\` --> \`C17\` : edge 18 xxxxxx
\`C3\` <|-- \`C17\`
\`C4\` --> \`C17\`
\`C5\` ..|> \`C17\` : edge 21 xxxxxxxxxxxxxxxxx
\`C6\` ..|> \`C17\`
\`C7\` <|-- \`C17\` : edge 23 xxxxxx
\`C8\` <|-- \`C17\` : edge 24 x
\`C9\` --> \`C17\` : edge 25 xxxxxxxxxxxxxxxxxxxx
\`C10\` <|-- \`C17\`
\`C11\` ..> \`C17\` : edge 27 xxxxxxxxxxxxxxxxxxxxxx
\`C12\` <|-- \`C17\` : edge 28 xxxxxxxxxxxxxxxxx
\`C13\` ..|> \`C17\`
\`C14\` <|-- \`C17\` : edge 30 xxx
\`C15\` ..> \`C17\` : edge 31 xxxxxxxxxxxxxxxxx
\`C16\` --> \`C17\`
\`class-namespace:Domain\` <|-- \`ns:Domain\`
note for \`ns:Domain\` "owned note 37<br/>second line"
note "free note 37"
`,
}
