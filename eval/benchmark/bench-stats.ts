// Statistics shared by the micro and peer benchmarks.

export const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

type GcStats = { beforeGC: { heapStatistics: { usedHeapSize: number } }; afterGC: { heapStatistics: { usedHeapSize: number } } }
type GcProfilerLike = { start(): void; stop(): { statistics: GcStats[] } | undefined }

/** V8 heap allocated while `run` executes (awaited, so async renders work),
 * estimated from GC boundaries as in the release benchmark. Node only: Bun has
 * no GCProfiler. Blind to WASM linear memory and native heap. */
export async function allocationProbe(): Promise<((run: () => unknown) => Promise<number>) | undefined> {
  if (process.versions.bun) return undefined
  const { GCProfiler, getHeapStatistics } = await import('node:v8')
  if (typeof GCProfiler !== 'function') return undefined
  return async run => {
    const profiler = new GCProfiler() as unknown as GcProfilerLike
    const start = getHeapStatistics().used_heap_size
    profiler.start()
    await run()
    const end = getHeapStatistics().used_heap_size
    const statistics = profiler.stop()?.statistics ?? []
    let allocated = 0
    let previous = start
    for (const gc of statistics) {
      allocated += Math.max(0, gc.beforeGC.heapStatistics.usedHeapSize - previous)
      previous = gc.afterGC.heapStatistics.usedHeapSize
    }
    return allocated + Math.max(0, end - previous)
  }
}
