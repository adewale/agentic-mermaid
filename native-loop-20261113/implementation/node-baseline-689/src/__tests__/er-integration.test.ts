/**
 * Integration tests for ER diagrams — end-to-end parse → layout → render.
 */
import { describe, it, expect } from 'bun:test'
import { renderMermaidSVG } from '../index.ts'

describe('renderMermaidSVG – ER diagrams', () => {
  it('renders a basic ER diagram to valid SVG', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER ||--o{ ORDER : places`)
    expect(svg).toContain('<svg')
    expect(svg).toContain('</svg>')
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toContain('places')
  })

  it('renders left-side }o instead of silently dropping the relationship (lukilabs#124 class)', () => {
    // The old sort-based cardinality parser rejected }o, dropping the line —
    // and with it both entities — producing an empty diagram.
    const svg = renderMermaidSVG(`erDiagram
      ORDER }o--|| CUSTOMER : belongs_to`)
    expect(svg).toContain('ORDER')
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('belongs_to')
  })

  it('renders aliased entities and all comma-separated key badges', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER["Customer Account"] {
        int account_id PK, FK "shared key"
      }
      CUSTOMER ||--o{ ORDER : places`)
    expect(svg).toContain('Customer Account')
    expect(svg).toContain('PK,FK')
    expect(svg).toContain('shared key')
    expect(svg).not.toContain('CUSTOMER[&quot;Customer Account&quot;]')
  })

  it('renders entity with attributes', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER {
        int id PK
        string name
        string email UK
      }`)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('id')
    expect(svg).toContain('name')
    expect(svg).toContain('email')
    // PK/UK key badges
    expect(svg).toContain('PK')
    expect(svg).toContain('UK')
  })

  it('renders relationship lines between entities', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--o{ B : has`)
    // Should have polyline for the relationship
    expect(svg).toContain('<polyline')
  })

  it('renders non-identifying (dashed) relationships', () => {
    const svg = renderMermaidSVG(`erDiagram
      USER ||..o{ LOG : generates`)
    expect(svg).toContain('stroke-dasharray')
  })

  it('renders with dark colors', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--|| B : links`, { bg: '#18181B', fg: '#FAFAFA' })
    expect(svg).toContain('--bg:#18181B')
  })

  it('renders entity boxes with header and attribute rows', () => {
    const svg = renderMermaidSVG(`erDiagram
      USER {
        int id PK
        string name
        string email
      }`)
    // Should have rectangles for entity box and header
    const rectCount = (svg.match(/<rect /g) ?? []).length
    expect(rectCount).toBeGreaterThanOrEqual(2) // outer box + header
  })

  it('renders a complete e-commerce schema', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER {
        int id PK
        string name
        string email UK
      }
      ORDER {
        int id PK
        date created
        int customer_id FK
      }
      PRODUCT {
        int id PK
        string name
        float price
      }
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT ||--o{ LINE_ITEM : includes`)
    expect(svg).toContain('CUSTOMER')
    expect(svg).toContain('ORDER')
    expect(svg).toContain('PRODUCT')
    expect(svg).toContain('LINE_ITEM')
    expect(svg).toContain('places')
    expect(svg).toContain('contains')
    expect(svg).toContain('includes')
  })
})

// ============================================================================
// Label positioning tests — verify that relationship labels sit ON the
// polyline path, not floating in space. The renderer's midpoint() computes
// the arc-length midpoint of the relationship polyline. These tests parse
// the SVG output to verify positioning for both straight and multi-segment
// (orthogonal, bent) paths.
// ============================================================================

/** Extract entity box rects from SVG: returns Map<label, {x, y, width, height, rightEdge}> */
function extractEntityBoxes(svg: string): Map<string, { x: number; y: number; width: number; height: number; rightEdge: number }> {
  const boxes = new Map<string, { x: number; y: number; width: number; height: number; rightEdge: number }>()

  // Entity header text: <text x="..." y="..." ... font-weight="700" ...>LABEL</text>
  const headerPattern = /<text x="([\d.]+)" y="([\d.]+)"[^>]*font-weight="700"[^>]*>([^<]+)<\/text>/g
  let match
  while ((match = headerPattern.exec(svg)) !== null) {
    const centerX = parseFloat(match[1]!)
    const label = match[3]!

    // Find the corresponding outer rect that contains this text.
    const rectPattern = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="0" ry="0"/g
    let rectMatch
    while ((rectMatch = rectPattern.exec(svg)) !== null) {
      const rx = parseFloat(rectMatch[1]!)
      const ry = parseFloat(rectMatch[2]!)
      const rw = parseFloat(rectMatch[3]!)
      const rh = parseFloat(rectMatch[4]!)
      if (centerX >= rx && centerX <= rx + rw) {
        boxes.set(label, { x: rx, y: ry, width: rw, height: rh, rightEdge: rx + rw })
        break
      }
    }
  }

  return boxes
}

/** Extract relationship label positions from SVG: returns Map<label, {x, y}> */
function extractLabelPositions(svg: string): Map<string, { x: number; y: number }> {
  const labels = new Map<string, { x: number; y: number }>()
  // Relationship labels use font-size="11" font-weight="400" — match flexibly
  // regardless of attribute order
  const labelPattern = /<text x="([\d.]+)" y="([\d.]+)"[^>]*font-size="11"[^>]*font-weight="400"[^>]*>([^<]+)<\/text>/g
  let match
  while ((match = labelPattern.exec(svg)) !== null) {
    labels.set(match[3]!, { x: parseFloat(match[1]!), y: parseFloat(match[2]!) })
  }
  return labels
}

/** Extract polyline paths from SVG: returns array of point arrays */
function extractPolylines(svg: string): Array<Array<{ x: number; y: number }>> {
  const polylines: Array<Array<{ x: number; y: number }>> = []
  // Match polylines with points attribute anywhere in the tag
  const pattern = /<polyline[^>]*points="([^"]+)"[^>]*>/g
  let match
  while ((match = pattern.exec(svg)) !== null) {
    const points = match[1]!.split(' ').map(p => {
      const [x, y] = p.split(',')
      return { x: parseFloat(x!), y: parseFloat(y!) }
    })
    polylines.push(points)
  }
  return polylines
}

/**
 * Check if a point lies on (or very near) a polyline path.
 * Computes the minimum distance from the point to any segment of the polyline.
 * Returns the minimum distance in pixels.
 */
function distanceToPolyline(point: { x: number; y: number }, polyline: Array<{ x: number; y: number }>): number {
  let minDist = Infinity
  for (let i = 1; i < polyline.length; i++) {
    const a = polyline[i - 1]!
    const b = polyline[i]!
    const dist = pointToSegmentDist(point, a, b)
    if (dist < minDist) minDist = dist
  }
  return minDist
}

/** Distance from point P to line segment AB */
function pointToSegmentDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2)
  // Project P onto AB, clamped to [0,1]
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq))
  const projX = a.x + t * dx
  const projY = a.y + t * dy
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2)
}

/** Relationship polylines keyed by their `data-label` (the relationship's label text). */
function extractRelationshipPolylines(svg: string): Map<string, Array<{ x: number; y: number }>> {
  const polylines = new Map<string, Array<{ x: number; y: number }>>()
  const pattern = /<polyline class="er-relationship"[^>]* data-label="([^"]*)"[^>]* points="([^"]+)"/g
  for (const match of svg.matchAll(pattern)) {
    polylines.set(match[1]!, match[2]!.split(' ').map(p => {
      const [x, y] = p.split(',')
      return { x: parseFloat(x!), y: parseFloat(y!) }
    }))
  }
  return polylines
}

function labelPill(svg: string, label: string) {
  const anchor = extractLabelPositions(svg).get(label)
  expect(anchor, label).toBeDefined()
  // Chrome marks intentionally have no public data-id. Locate the actual
  // painted background that encloses this authored label's anchor.
  const boxes = (svg.match(/<rect\b[^>]*>/g) ?? []).map(tag => {
    const number = (name: string) => Number(tag.match(new RegExp(`\\b${name}="([^"]+)"`))?.[1])
    const x = number('x'), y = number('y'), width = number('width'), height = number('height')
    return { left: x, right: x + width, top: y, bottom: y + height, x: x + width / 2, y: y + height / 2, width, height }
  }).filter(box => [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0 && box.left <= anchor!.x && box.right >= anchor!.x && box.top <= anchor!.y && box.bottom >= anchor!.y)
  expect(boxes, `one painted background for ${label}`).toHaveLength(1)
  return boxes[0]!
}

/**
 * For each relationship label, whether it sits within 2px of ITS OWN
 * relationship polyline (paired by label text), so a label that drifts onto a
 * neighbouring relationship's line fails by name.
 */
function labelsOnOwnPolyline(svg: string, positions = extractLabelPositions(svg)): Record<string, boolean> {
  const own = extractRelationshipPolylines(svg)
  return Object.fromEntries([...positions].map(([name, pos]) => {
    const polyline = own.get(name)
    return [name, polyline !== undefined && distanceToPolyline(pos, polyline) < 2]
  }))
}

// ─── Straight-line label positioning ────────────────────────────────────────

describe('renderMermaidSVG – ER label positioning (straight lines)', () => {
  it('label is between the two entity boxes horizontally', () => {
    const svg = renderMermaidSVG(`erDiagram
      TEACHER }|--o{ COURSE : teaches`)

    const boxes = extractEntityBoxes(svg)
    const labels = extractLabelPositions(svg)

    const teacher = boxes.get('TEACHER')!
    const course = boxes.get('COURSE')!
    const label = labels.get('teaches')!

    // Label x should be between the two entity box edges
    const leftEdge = Math.min(teacher.rightEdge, course.rightEdge)
    const rightEdge = Math.max(teacher.x, course.x)
    expect(label.x).toBeGreaterThan(leftEdge)
    expect(label.x).toBeLessThan(rightEdge)
  })

  it('the complete label background clears both entity boxes', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--o{ B : links`)

    const boxes = extractEntityBoxes(svg)
    const boxA = boxes.get('A')!
    const boxB = boxes.get('B')!
    const pill = labelPill(svg, 'links')

    const leftBox = boxA.x < boxB.x ? boxA : boxB
    const rightBox = boxA.x < boxB.x ? boxB : boxA

    expect(pill.left).toBeGreaterThan(leftBox.rightEdge)
    expect(pill.right).toBeLessThan(rightBox.x)
  })

  it('label is approximately at the horizontal midpoint of the gap', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER ||--o{ ORDER : places`)

    const boxes = extractEntityBoxes(svg)
    const labels = extractLabelPositions(svg)

    const customer = boxes.get('CUSTOMER')!
    const order = boxes.get('ORDER')!
    const label = labels.get('places')!

    const leftBox = customer.x < order.x ? customer : order
    const rightBox = customer.x < order.x ? order : customer
    const gapMidpoint = (leftBox.rightEdge + rightBox.x) / 2

    expect(Math.abs(label.x - gapMidpoint)).toBeLessThan(15)
  })

  it('label sits on (or very near) its relationship polyline', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--o{ B : connects`)

    // Label should be within 2px of its own relationship polyline
    expect(labelsOnOwnPolyline(svg)).toEqual({ connects: true })
  })
})

// ─── Multi-entity diagrams with orthogonal routing ──────────────────────────

describe('renderMermaidSVG – ER label positioning (multi-segment paths)', () => {
  it('all labels in a multi-relationship diagram sit near a polyline', () => {
    const svg = renderMermaidSVG(`erDiagram
      ORDER ||--|{ LINE_ITEM : contains
      ORDER ||..o{ SHIPMENT : ships-via
      PRODUCT ||--o{ LINE_ITEM : includes
      PRODUCT ||..o{ REVIEW : receives`)

    // Every relationship label is found, within 2px of its own polyline
    expect(labelsOnOwnPolyline(svg)).toEqual({ contains: true, 'ships-via': true, includes: true, receives: true })
  })

  it('non-identifying relationship labels also sit on their dashed polylines', () => {
    const svg = renderMermaidSVG(`erDiagram
      USER ||..o{ LOG_ENTRY : generates
      USER ||..o{ SESSION : opens`)

    expect(labelsOnOwnPolyline(svg)).toEqual({ generates: true, opens: true })
  })

  it('labels in e-commerce schema all sit on their polylines', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT ||--o{ LINE_ITEM : includes`)

    expect(labelsOnOwnPolyline(svg)).toEqual({ places: true, contains: true, includes: true })
  })

  it('label is not at the endpoint of any polyline', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--o{ B : links`)

    const labels = extractLabelPositions(svg)
    const polylines = extractPolylines(svg)
    const label = labels.get('links')!
    expect(polylines).toHaveLength(1)

    for (const pl of polylines) {
      const start = pl[0]!
      const end = pl[pl.length - 1]!
      const distToStart = Math.sqrt((label.x - start.x) ** 2 + (label.y - start.y) ** 2)
      const distToEnd = Math.sqrt((label.x - end.x) ** 2 + (label.y - end.y) ** 2)
      // At least one endpoint should be far from the label (>5px)
      expect(Math.min(distToStart, distToEnd)).toBeGreaterThan(5)
    }
  })

  it('multiple labels in same diagram have distinct positions', () => {
    const svg = renderMermaidSVG(`erDiagram
      CUSTOMER ||--o{ ORDER : places
      ORDER ||--|{ LINE_ITEM : contains
      PRODUCT ||--o{ LINE_ITEM : includes`)

    const labels = extractLabelPositions(svg)
    expect([...labels.keys()].sort()).toEqual(['contains', 'includes', 'places'])
    const positions = [...labels.values()]

    // Each label should have a unique position (no two labels at same x,y)
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const dx = positions[i]!.x - positions[j]!.x
        const dy = positions[i]!.y - positions[j]!.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        expect(dist).toBeGreaterThan(10) // at least 10px apart
      }
    }
  })

  it('label background pill also sits on the polyline', () => {
    const svg = renderMermaidSVG(`erDiagram
      A ||--o{ B : test`)

    const pill = labelPill(svg, 'test')
    expect(labelsOnOwnPolyline(svg, new Map([['test', { x: pill.x, y: pill.y }]]))).toEqual({ test: true })
  })
})
