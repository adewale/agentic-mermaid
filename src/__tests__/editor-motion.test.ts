import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(import.meta.dir, '..', '..', 'editor', 'js', 'motion.js'), 'utf8')

type Frame = (time: number) => void
type Motion = {
  adaptiveRenderDelay(value: number | null): number
  makeVelocityTracker(): { push(time: number, x: number, y: number): void; get(): { vx: number; vy: number }; reset(): void }
  springTo(options: { from: number; to: number; velocity?: number; response?: number; onFrame?(value: number, velocity: number): void; onDone?(): void }): { cancel(): void; getState(): { value: number; velocity: number } }
  decay2d(options: { vx: number; vy: number; rate?: number; onFrame(dx: number, dy: number, vx: number, vy: number): boolean | void; onDone?(): void }): { cancel(): void }
}

function loadMotion() {
  let now = 0
  let nextId = 1
  const frames = new Map<number, Frame>()
  const motion = new Function('window', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', `${source}; return EditorMotion;`)(
    { matchMedia: () => ({ matches: false }) },
    { now: () => now },
    (frame: Frame) => { const id = nextId++; frames.set(id, frame); return id },
    (id: number) => { frames.delete(id) },
  ) as Motion
  return {
    motion,
    step(ms: number) {
      now += ms
      const queued = [...frames.entries()]
      frames.clear()
      queued.forEach(([, frame]) => frame(now))
    },
    pending: () => frames.size,
  }
}

describe('editor motion primitives', () => {
  test('bounds adaptive render debounce from measured successful work', () => {
    const { motion } = loadMotion()
    expect(motion.adaptiveRenderDelay(null)).toBe(300)
    expect(motion.adaptiveRenderDelay(10)).toBe(60)
    expect(motion.adaptiveRenderDelay(80)).toBe(120)
    expect(motion.adaptiveRenderDelay(400)).toBe(300)
  })

  test('tracks signed pointer velocity over the recent sample window', () => {
    const { motion } = loadMotion()
    const tracker = motion.makeVelocityTracker()
    tracker.push(0, 10, 20)
    tracker.push(50, 35, 5)
    expect(tracker.get()).toEqual({ vx: 500, vy: -300 })
    tracker.reset()
    expect(tracker.get()).toEqual({ vx: 0, vy: 0 })
  })

  test('exposes live spring velocity for interruption and settles exactly once', () => {
    const { motion, step, pending } = loadMotion()
    const frames: Array<{ value: number; velocity: number }> = []
    let done = 0
    const spring = motion.springTo({
      from: 1,
      to: 2,
      response: 0.3,
      onFrame(value, velocity) { frames.push({ value, velocity }) },
      onDone() { done++ },
    })
    for (let i = 0; i < 120 && pending(); i++) step(16)
    expect(done).toBe(1)
    expect(frames.at(-1)).toEqual({ value: 2, velocity: 0 })
    expect(spring.getState()).toEqual({ value: 2, velocity: 0 })
  })

  test('cancels decay without calling its completion callback', () => {
    const { motion, step, pending } = loadMotion()
    let done = 0
    let frames = 0
    const decay = motion.decay2d({ vx: 800, vy: 0, onFrame() { frames++ }, onDone() { done++ } })
    step(16)
    decay.cancel()
    for (let i = 0; i < 20 && pending(); i++) step(16)
    expect(frames).toBe(1)
    expect(done).toBe(0)
  })
})
