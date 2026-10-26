import { benchmarkContext } from './benchmark-context.ts'

/** Set-wide pin admission runs before cache lookup. Its unrelated peer pins
 * cannot change clocks for this artifact, whose actual version/bytes are bound
 * separately. Keep all executing controller/worker/oracle sources in context. */
export function baselineMeasurementContext(root: string, node: string, producers: readonly string[]) {
  const context = benchmarkContext(root, node, producers)
  return {
    ...context,
    producers: context.producers.filter(object => {
      const path = object.split('\t')[1]
      return path !== 'eval/benchmark/tool-versions.ts' && path !== 'eval/benchmark/tool-versions.json'
    }),
  }
}
