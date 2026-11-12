// A tool declared in the catalog, with no harness code: per output, the public export to call
// with the Mermaid source, an optional JSON options argument, and the returned field holding
// the output when it is not the return value itself. Shared by the Node worker and browser bundle.
export function declaredRenderer(api, binding, output) {
  if (!binding || typeof binding.export !== 'string') throw Error(`Declared adapter has no API binding for ${output}`)
  const render = binding.export.split('.').reduce((value, key) => value?.[key], api)
  if (typeof render !== 'function') throw Error(`Declared public export is not a function: ${binding.export}`)
  const pick = value => (binding.result ? value?.[binding.result] : value)
  return source => {
    const value = binding.options === undefined ? render(source) : render(source, structuredClone(binding.options))
    return value && typeof value.then === 'function' ? value.then(pick) : pick(value)
  }
}
