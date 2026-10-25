// Exact first-party descriptor identities. Replacement and extension hooks
// cannot acquire private cache ownership by copying a native lowering hook.
const owned = new WeakSet<object>()
const hookFields = ['id', 'layout', 'projectPositioned', 'lowerScene', 'normalizeRequest', 'configDiagnostics', 'statementEnds'] as const
const originalHooks = new WeakMap<object, readonly unknown[]>()
export function enrollOwnedFamily(descriptor: object): void {
  if (owned.has(descriptor)) return
  owned.add(descriptor)
  // Only first-party installers call this, after capturing and freezing their
  // descriptor. Never replace the original surface on repeated enrollment.
  originalHooks.set(descriptor, hookFields.map(field => Object.getOwnPropertyDescriptor(descriptor, field)?.value))
}
export function isOwnedFamily(descriptor: object): boolean { return owned.has(descriptor) }

/** Custom/replacement descriptors stop before any property or proxy read. */
export function hasOriginalOwnedFamilyHooks(descriptor: object, familyId: string): boolean {
  const original = originalHooks.get(descriptor)
  if (!original || original[0] !== familyId) return false
  return hookFields.every((field, index) => {
    const current = Object.getOwnPropertyDescriptor(descriptor, field)
    return current === undefined ? original[index] === undefined
      : 'value' in current && current.value === original[index]
  })
}
