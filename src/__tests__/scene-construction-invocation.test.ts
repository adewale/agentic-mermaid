import { expect, test } from 'bun:test'
import { getFamily } from '../agent/core.ts'
import { parseClassDiagram } from '../class/parser.ts'
import { layoutClassDiagram } from '../class/layout.ts'
import { lowerClassScene } from '../class/renderer.ts'
import { parseC4Diagram } from '../c4/parser.ts'
import { layoutC4Diagram } from '../c4/layout.ts'
import { parseErDiagram } from '../er/parser.ts'
import { layoutErDiagram } from '../er/layout.ts'
import { invokeSceneLowering } from '../scene/lowering-invocation.ts'
import { sceneWithPublicConstruction } from '../browser-lazy/family.ts'
import type { SceneDoc } from '../scene/ir.ts'

const family = getFamily('class')!
const lower = family.lowerScene!
function context() {
  return { positioned: layoutClassDiagram(parseClassDiagram(['classDiagram', 'class A'])),
    colors: { bg: '#fff', fg: '#111', embedFontImport: false }, resolved: { renderOptions: {} } }
}
function group(scene: SceneDoc) {
  const node = scene.parts.find(part => part.kind === 'group' && part.role === 'class-box')
  if (!node || node.kind !== 'group') throw new Error('Missing actual Class group')
  return node
}
function expectPublic(scene: SceneDoc): void {
  expect(Object.getOwnPropertyDescriptor(group(scene), 'open')?.writable).toBe(true)
}
function expectInternal(scene: SceneDoc): void {
  expect(typeof Object.getOwnPropertyDescriptor(group(scene), 'open')?.get).toBe('function')
}

test('nested public, other-family and engine lowerings restore their representation scopes', () => {
  const outer = context(), middle = context()
  const outerClasses = outer.positioned.classes, middleClasses = middle.positioned.classes
  let enteredOuter = false, enteredMiddle = false
  Object.defineProperty(middle.positioned, 'classes', { get() {
    if (!enteredMiddle) { enteredMiddle = true; expectPublic(lower(context())) }
    return middleClasses
  } })
  Object.defineProperty(outer.positioned, 'classes', { get() {
    if (!enteredOuter) {
      enteredOuter = true
      expectInternal(invokeSceneLowering(family, lower, middle))
      const positioned = layoutC4Diagram(parseC4Diagram('C4Context\nSystem(a,"A")'))
      // A different enrolled public hook must mask the Class public scope.
      expect(() => getFamily('c4')!.lowerScene!({ ...context(), positioned })).not.toThrow()
      const receiver = { token: 'authored receiver' }
      expectInternal(invokeSceneLowering(receiver, function (this: unknown, ctx) {
        expect(this).toBe(receiver)
        return lowerClassScene(ctx as ReturnType<typeof context>)
      }, context()))
    }
    return outerClasses
  } })
  expectPublic(lower(outer))
  expect(enteredOuter && enteredMiddle).toBe(true)
  expectInternal(lowerClassScene(context()))
})

test('failed lowering restores the public scope and exact engine-context association', () => {
  for (const internal of [false, true]) {
    const ctx = context(), classes = ctx.positioned.classes
    Object.defineProperty(ctx.positioned, 'classes', { configurable: true, get() { throw new Error('authored lowering failure') } })
    expect(() => internal ? invokeSceneLowering(family, lower, ctx) : lower(ctx)).toThrow('authored lowering failure')
    Object.defineProperty(ctx.positioned, 'classes', { value: classes, writable: true, configurable: true })
    expectPublic(lower(ctx))
    expectInternal(lowerClassScene(context()))
  }
})

test('copied and proxied contexts and a second wrapper cannot borrow exact engine enrollment', () => {
  const other = sceneWithPublicConstruction(lowerClassScene)
  const ctx = context(), classes = ctx.positioned.classes
  let entered = false
  Object.defineProperty(ctx.positioned, 'classes', { get() {
    if (!entered) {
      entered = true
      expectPublic(lower({ ...ctx }))
      expectPublic(lower(new Proxy(ctx, {})))
      expectPublic(other(ctx))
    }
    return classes
  } })
  expectInternal(invokeSceneLowering(family, lower, ctx))
  expect(entered).toBe(true)
})

test('public non-Class groups retain data while nested engine lowering retains private views', () => {
  const er = getFamily('er')!, lowerEr = er.lowerScene!
  const make = () => ({ positioned: layoutErDiagram(parseErDiagram(['erDiagram', 'A ||--|| B : owns'])),
    colors: { bg: '#fff', fg: '#111', embedFontImport: false }, resolved: { renderOptions: {} } })
  const entity = (doc: SceneDoc) => doc.parts.find(node => node.kind === 'group' && node.role === 'entity')!
  const outer = make(), entities = outer.positioned.entities
  let entered = false
  Object.defineProperty(outer.positioned, 'entities', { get() {
    if (!entered) {
      entered = true
      expect(typeof Object.getOwnPropertyDescriptor(entity(invokeSceneLowering(er, lowerEr, make())), 'open')?.get).toBe('function')
      expect(Object.getOwnPropertyDescriptor(entity(lowerEr(make())), 'open')?.writable).toBe(true)
    }
    return entities
  } })
  expect(Object.getOwnPropertyDescriptor(entity(lowerEr(outer)), 'open')?.writable).toBe(true)
  expect(entered).toBe(true)
  expect(typeof Object.getOwnPropertyDescriptor(entity(invokeSceneLowering(er, lowerEr, make())), 'open')?.get).toBe('function')
})
