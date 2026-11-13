import { createOwnedCompoundObstacleIndexFactory, isCompoundObstacleIndexFor } from '../layout/compound-obstacle-index.ts'
import { describe, expect, test } from 'bun:test'
import fc from 'fast-check'
import { createCompoundObstacleIndex, createCompoundPeerGuard } from '../layout/compound-obstacle-index.ts'
import { segmentEntersMeasuredBox } from '../layout/measured-route-safety.ts'
import { fcParameters } from './helpers/fc-parameters.ts'

const budget = () => ({ pairs: 1_000_000, arcs: 65536, swaps: 1_000_000 })
const fail = (reason: string): never => { throw new Error(reason) }

describe('compound immutable obstacle queries', () => {
  test('keeps strict boundary, zero-area and unsafe-cell fallback behavior', () => {
    const large = 2 ** 60
    const boxes = Array.from({ length: 40 }, (_, index) => ({ x: large, y: index * 100, width: 512, height: 30 }))
    boxes.push({ x: large, y: 50, width: 0, height: 20 }, { x: large, y: 80, width: 512, height: 0 })
    const index = createCompoundObstacleIndex(boxes, budget(), fail)
    expect(index.containsPoint(large + 256, 10)).toBe(true)
    expect(index.containsPoint(large + 256, 30)).toBe(false)
    expect(index.containsPoint(large, 10)).toBe(false)
    expect(index.containsPoint(large + 256, 80)).toBe(false)
    expect(index.entersSegment(large, -1, large, 40)).toBe(false)
    expect(index.entersSegment(large + 256, -1, large + 256, 40)).toBe(true)
    expect(index.entersSegment(large, 30, large + 512, 30)).toBe(false)
  })

  test('preserves exact linear point and orthogonal segment predicates', () => {
    const coordinate = fc.integer({ min: -4096, max: 4096 }).map(value => value / 4)
    const rectangle = fc.record({ x: coordinate, y: coordinate,
      width: fc.integer({ min: 0, max: 1024 }).map(value => value / 4),
      height: fc.integer({ min: 0, max: 1024 }).map(value => value / 4) })
    fc.assert(fc.property(fc.array(rectangle, { minLength: 32, maxLength: 60 }), coordinate, coordinate, coordinate, fc.boolean(), (boxes, x, y, end, vertical) => {
      const index = createCompoundObstacleIndex(boxes, budget(), fail)
      expect(index.containsPoint(x, y)).toBe(boxes.some(box => x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height))
      const a = { x, y }, b = vertical ? { x, y: end } : { x: end, y }
      expect(index.entersSegment(a.x, a.y, b.x, b.y)).toBe(boxes.some(box => segmentEntersMeasuredBox(a, b, box)))
      for (const box of boxes.slice(0, 3)) {
        expect(index.containsPoint(box.x, box.y)).toBe(boxes.some(other => box.x > other.x && box.x < other.x + other.width && box.y > other.y && box.y < other.y + other.height))
      }
    }), fcParameters({ numRuns: 80, seed: 449034 }))
  })

  test('answers large blocked, clear and edge-contact batches inside the unchanged work pools', () => {
    const boxes = Array.from({ length: 100 }, (_, index) => ({ x: 0, y: index * 200, width: 80, height: 20 }))
    const work = { pairs: 8000, arcs: 65536, swaps: 1_000_000 }
    const index = createCompoundObstacleIndex(boxes, work, fail)
    for (let row = 0; row < boxes.length; row++) {
      expect(index.containsPoint(40, row * 200 + 80)).toBe(false)
      expect(index.containsPoint(40, row * 200 + 10)).toBe(true)
      expect(index.entersSegment(-10, row * 200 + 10, 100, row * 200 + 10)).toBe(true)
      expect(index.entersSegment(-10, row * 200 + 20, 100, row * 200 + 20)).toBe(false)
    }
    expect(work.pairs).toBeGreaterThan(0)
    expect(work.arcs).toBeGreaterThan(0)
    expect(() => createCompoundObstacleIndex(boxes, { ...budget(), arcs: 0 }, fail)).toThrow('visibility-arc limit')
  })

  test('projects exact nearest strict scanline boundaries with degenerate and unsafe coordinates', () => {
    for (const base of [0, 2 ** 60]) {
      const boxes = Array.from({ length: 40 }, (_, i) => ({ x: base + i * 1024, y: i * 100, width: 512, height: 30 }))
      boxes.push({ x: base + 256, y: 100, width: 0, height: 100 }, { x: base + 256, y: 200, width: 512, height: 0 })
      const bounds = { x: base - 1024, y: -100, width: 45056, height: 5000 }, index = createCompoundObstacleIndex(boxes, budget(), fail)
      const actual = { left: 0, right: 0, top: 0, bottom: 0 }
      for (const point of [{ x: base - 512, y: 15 }, { x: base + 256, y: 30 }, { x: base + 256, y: 150 }, { x: base + 512, y: 200 }]) {
        const expected = { left: bounds.x, right: bounds.x + bounds.width, top: bounds.y, bottom: bounds.y + bounds.height }
        for (const box of boxes) {
          if (point.y > box.y && point.y < box.y + box.height) {
            if (box.x >= point.x) expected.right = Math.min(expected.right, box.x)
            if (box.x + box.width <= point.x) expected.left = Math.max(expected.left, box.x + box.width)
          }
          if (point.x > box.x && point.x < box.x + box.width) {
            if (box.y >= point.y) expected.bottom = Math.min(expected.bottom, box.y)
            if (box.y + box.height <= point.y) expected.top = Math.max(expected.top, box.y + box.height)
          }
        }
        index.projectPoint(point.x, point.y, bounds, actual)
        expect(actual).toEqual(expected)
      }
    }
  })

  test('projects many separated scanlines within the original work reserve', () => {
    const boxes = Array.from({ length: 100 }, (_, i) => ({ x: i * 200, y: i * 200, width: 80, height: 20 }))
    const work = { ...budget(), pairs: 5000 }, index = createCompoundObstacleIndex(boxes, work, fail)
    const bounds = { x: -20, y: -20, width: 20000, height: 20000 }, result = { left: 0, right: 0, top: 0, bottom: 0 }
    for (let i = 0; i < boxes.length; i++) {
      index.projectPoint(i * 200 - 10, i * 200 + 10, bounds, result)
      expect(result).toEqual({ left: -20, right: i * 200, top: -20, bottom: 19980 })
    }
    expect(work.pairs).toBeGreaterThan(0)
  })

})


// Frozen direct predicate oracle from the boundary router before indexing.
function originalPeerGuard(peers: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[], a: { x: number; y: number }, b: { x: number; y: number }, arrival: number, axis: number): boolean {
  const on = (p: typeof a, c: typeof a, d: typeof a) => (c.x === d.x ? Math.abs(p.x - c.x) < 1e-7 : Math.abs(p.y - c.y) < 1e-7)
    && p.x >= Math.min(c.x, d.x) && p.x <= Math.max(c.x, d.x) && p.y >= Math.min(c.y, d.y) && p.y <= Math.max(c.y, d.y)
  for (const [c, d] of peers) {
    if (arrival !== axis && on(a, c, d)) return false
    const vertical = a.x === b.x, peerVertical = c.x === d.x
    if (vertical === peerVertical) {
      const separation = Math.abs(vertical ? a.x - c.x : a.y - c.y)
      const overlap = Math.min(vertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x), vertical ? Math.max(c.y, d.y) : Math.max(c.x, d.x))
        - Math.max(vertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x), vertical ? Math.min(c.y, d.y) : Math.min(c.x, d.x))
      if (separation <= .5 && overlap > .01 || separation === 0 && overlap >= 0) return false
    } else {
      const p = { x: vertical ? a.x : c.x, y: vertical ? c.y : a.y }
      if (on(p, a, b) && on(p, c, d) && (p.x === c.x && p.y === c.y || p.x === d.x && p.y === d.y)) return false
    }
  }
  return true
}

describe('compound exact peer lane guards', () => {
  test.each([
    { name: 'inclusive half-unit cell-boundary shaft', peer: [[128, 0], [128, 10]], path: [[128.5, 2], [128.5, 8]], expected: false },
    { name: 'outside half-unit shaft', peer: [[128, 0], [128, 10]], path: [[128.500001, 2], [128.500001, 8]], expected: true },
    { name: 'exact overlap threshold', peer: [[128, 0], [128, .01]], path: [[128.5, 0], [128.5, 1]], expected: true },
    { name: 'above overlap threshold', peer: [[128, 0], [128, .010001]], path: [[128.5, 0], [128.5, 1]], expected: false },
    { name: 'perpendicular peer endpoint', peer: [[128, 10], [140, 10]], path: [[128, 0], [128, 20]], expected: false },
    { name: 'proper perpendicular crossing', peer: [[120, 10], [140, 10]], path: [[128, 0], [128, 20]], expected: true },
    { name: 'turn on peer interior', peer: [[128, 0], [128, 20]], path: [[128, 10], [140, 10]], arrival: 2, axis: 1, expected: false },
    { name: 'collapsed peer contact', peer: [[128, 10], [128, 10]], path: [[128, 0], [128, 20]], expected: false },
    { name: 'negative cell-boundary shaft', peer: [[-128, 0], [-128, 10]], path: [[-128.5, 2], [-128.5, 8]], expected: false },
    { name: 'large-coordinate fallback', peer: [[2 ** 60, 0], [2 ** 60, 10]], path: [[2 ** 60, 2], [2 ** 60, 8]], expected: false },
    { name: 'nonorthogonal fallback', peer: [[128, 0], [130, 10]], path: [[128, 0], [128, 20]], expected: false },
  ])('retains $name', ({ peer, path, expected, arrival = 2, axis = 2 }) => {
    const point = (p: readonly number[]) => ({ x: p[0]!, y: p[1]! })
    const peers: [{ x: number; y: number }, { x: number; y: number }][] = [[point(peer[0]!), point(peer[1]!)], ...Array.from({ length: 40 }, (_, i): [{ x: number; y: number }, { x: number; y: number }] => [{ x: 5000 + i * 8, y: 5000 }, { x: 5000 + i * 8, y: 5010 }])]
    const before = structuredClone(peers), guard = createCompoundPeerGuard(peers, budget(), fail)
    const a = point(path[0]!), b = point(path[1]!)
    expect(originalPeerGuard(peers, a, b, arrival, axis)).toBe(expected)
    expect(guard(a, b, arrival, axis)).toBe(expected)
    expect(peers).toEqual(before)
  })

  test('matches the original exact guard across ordered randomized orthogonal peers', () => {
    const coordinate = fc.integer({ min: -4096, max: 4096 }).map(n => n / 4)
    const segment = fc.tuple(coordinate, coordinate, coordinate, fc.boolean()).map(([x, y, end, vertical]) => [{ x, y }, vertical ? { x, y: end } : { x: end, y }] as const)
    fc.assert(fc.property(fc.array(segment, { minLength: 32, maxLength: 64 }), segment, fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 2 }), (peers, [a, b], arrival, axis) => {
      expect(createCompoundPeerGuard(peers, budget(), fail)(a, b, arrival, axis)).toBe(originalPeerGuard(peers, a, b, arrival, axis))
    }), fcParameters({ numRuns: 100, seed: 449033 }))
  })

  test('preserves far clear probes inside the existing pair reserve', () => {
    const peers = Array.from({ length: 100 }, (_, i) => [{ x: i * 200, y: 0 }, { x: i * 200, y: 20 }] as const)
    const work = { ...budget(), pairs: 5000 }, guard = createCompoundPeerGuard(peers, work, fail)
    for (let i = 0; i < 100; i++) expect(guard({ x: i * 200 + 80, y: 1 }, { x: i * 200 + 80, y: 19 }, 2, 2)).toBe(true)
    expect(work.pairs).toBeGreaterThan(0)
    expect(() => createCompoundPeerGuard(peers, { ...budget(), arcs: 0 }, fail)).toThrow('visibility-arc limit')
  })
})

describe('boundary-owned immutable lane data', () => {
const boxes = (delta=0) => Array.from({length:45},(_,i)=>Object.freeze({x:(i%9)*31+delta,y:Math.floor(i/9)*37+delta,width:20,height:24}))
const budget = (arcs=1e7) => ({pairs:1e7,arcs,swaps:1e7})
const fail = (reason:string):never=>{throw new Error(reason)}
const samples = [-1,0,1,19,20,24,31,64,127.49999999999999,128,158,192,255,256,512]
for (const delta of [0,.01,.5,1,7,127,128,1e17]) test('fresh exact point/segment/projection semantics '+delta,()=>{
 const work=budget(), owned=createOwnedCompoundObstacleIndexFactory(work,fail)
 const first=boxes(), firstView=owned(first), changed=boxes(delta), current=owned(changed), fresh=createCompoundObstacleIndex(changed,budget(),fail)
 expect(isCompoundObstacleIndexFor(current,changed)).toBe(true)
 expect(isCompoundObstacleIndexFor(current,first)).toBe(false)
 for(const x of samples)for(const y of samples){
  expect(current.containsPoint(x,y)).toBe(fresh.containsPoint(x,y))
  expect(current.entersSegment(x,y,x,y+33)).toBe(fresh.entersSegment(x,y,x,y+33))
  expect(current.entersSegment(x,y,x+33,y)).toBe(fresh.entersSegment(x,y,x+33,y))
  const a={left:0,right:0,top:0,bottom:0},b={...a},bounds={x:-256,y:-256,width:1024,height:1024}
  current.projectPoint(x,y,bounds,a);fresh.projectPoint(x,y,bounds,b);expect(a).toEqual(b)
 }
 const original=createCompoundObstacleIndex(first,budget(),fail)
 for(const x of samples)for(const y of samples)expect(firstView.containsPoint(x,y)).toBe(original.containsPoint(x,y))
})
for(const kind of ['small','unsafe','wide','reordered','zero','negative-zero','count'])test('exact fallback/ordinal boundary '+kind,()=>{
 const base=boxes(),work=budget(),owned=createOwnedCompoundObstacleIndexFactory(work,fail);owned(base)
 const changed=kind==='small'?base.slice(0,3):kind==='unsafe'?base.map(b=>({...b,x:1e100})):kind==='wide'?base.map(b=>({...b,width:1e8})):kind==='reordered'?[...base].reverse():kind==='zero'?base.map(b=>({...b,width:0,height:0})):kind==='negative-zero'?base.map(b=>({...b,x:-0,width:0})):base.slice(1)
 const a=owned(changed),b=createCompoundObstacleIndex(changed,budget(),fail)
 for(const x of samples)for(const y of samples){expect(a.containsPoint(x,y)).toBe(b.containsPoint(x,y));expect(a.entersSegment(x,y,x,y+64)).toBe(b.entersSegment(x,y,x,y+64))}
})
test('same memberships retain current exact rectangles and old views',()=>{
 const owned=createOwnedCompoundObstacleIndexFactory(budget(),fail),a=boxes(),b=a.map(r=>({...r,x:r.x+1,width:r.width-2}))
 const old=owned(a),now=owned(b)
 expect(old.containsPoint(.5,1)).toBe(true);expect(now.containsPoint(.5,1)).toBe(false)
 expect(isCompoundObstacleIndexFor(now,b)).toBe(true)
 now.containsPoint=()=>true
 expect(isCompoundObstacleIndexFor(now,b)).toBe(false)
 expect(old.containsPoint(.5,1)).toBe(true)
})
test('repeated endpoint inflation scopes fit original physical arc capacity',()=>{
 const sets=Array.from({length:12},(_,i)=>boxes().map((b,j)=>j===i?{...b,x:b.x+.1,width:b.width-.2}:b))
 const limited=budget(2400),owned=createOwnedCompoundObstacleIndexFactory(limited,fail)
 for(const b of sets)expect(owned(b).containsPoint(1,1)).toBe(true)
 expect(limited.arcs).toBeGreaterThanOrEqual(0)
 const legacy=budget(2400)
 expect(()=>{for(const b of sets)createCompoundObstacleIndex(b,legacy,fail)}).toThrow('visibility-arc limit')
})
test('failed update never mutates already returned query authority',()=>{
 const work=budget(),owned=createOwnedCompoundObstacleIndexFactory(work,fail),a=boxes(),old=owned(a)
 work.arcs=1
 expect(()=>owned(boxes(128))).toThrow('visibility-arc limit')
 work.arcs=1e7;work.pairs=1e7
 expect(old.containsPoint(1,1)).toBe(true)
 const b=boxes(.01),now=owned(b)
 expect(isCompoundObstacleIndexFor(now,b)).toBe(true)
 expect(now.containsPoint(1,1)).toBe(true)
})
test('comparison-budget exception propagates without stale publication',()=>{
 const work=budget(),owned=createOwnedCompoundObstacleIndexFactory(work,fail),a=boxes(),old=owned(a)
 work.pairs=1
 expect(()=>owned(boxes(.01))).toThrow('obstacle-work limit')
 work.pairs=1e7
 expect(old.containsPoint(1,1)).toBe(true)
 expect(owned(boxes(128)).containsPoint(1,1)).toBe(false)
})

})
