export const variants = [
  { id: 'shipped-off', features: [] }, { id: 'fonts', features: ['fonts'] },
  { id: 'elk-order', features: ['elk-order'] },
  { id: 'wrap', features: ['wrap'] }, { id: 'all', features: ['fonts', 'elk-order', 'wrap'] },
  { id: 'all-minus-fonts', features: ['elk-order', 'wrap'] },
  { id: 'all-minus-order', features: ['fonts', 'wrap'] },
  { id: 'all-minus-wrap', features: ['fonts', 'elk-order'] },
]

/** Current requests only. Frozen report labels are not rewritten or admitted here. */
export function assertCurrentConfiguration(backend: unknown, features: readonly string[]): void {
  if (backend !== 'elk') throw new RangeError('Current font-layout captures support only elk; Native (agentic) has been retired')
  for (const feature of features) {
    if (feature === 'ports') throw new RangeError('The Native ports feature has been retired')
    if (!['fonts', 'elk-order', 'wrap'].includes(feature)) throw new RangeError(`Unknown font-layout feature: ${feature}`)
  }
}
