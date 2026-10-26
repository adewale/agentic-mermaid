// Exact first-party descriptor identities. Replacement and extension hooks
// cannot acquire private cache ownership by copying a native lowering hook.
const owned = new WeakMap<object, string | undefined>()
const hookFields = ['layout', 'projectPositioned', 'lowerScene', 'normalizeRequest', 'configDiagnostics', 'statementEnds'] as const
export function enrollOwnedFamily(descriptor: object): void {
  if (owned.has(descriptor)) return
  owned.set(descriptor, undefined)
  // Installers supply fresh plain snapshots. Frozen own data cannot change;
  // optional absent hooks remain compatible with their captured surface.
  if (!Object.isFrozen(descriptor)) return
  const id = Object.getOwnPropertyDescriptor(descriptor, 'id')
  if (!id || !('value' in id) || typeof id.value !== 'string') return
  for (const field of hookFields) {
    const hook = Object.getOwnPropertyDescriptor(descriptor, field)
    if (hook && !('value' in hook)) return
  }
  owned.set(descriptor, id.value)
}
export function isOwnedFamily(descriptor: object): boolean { return owned.has(descriptor) }

/** Custom/replacement descriptors stop before any property or proxy read. */
export function hasOriginalOwnedFamilyHooks(descriptor: object, familyId: string): boolean {
  const originalId = owned.get(descriptor)
  return originalId !== undefined && originalId === familyId
}
