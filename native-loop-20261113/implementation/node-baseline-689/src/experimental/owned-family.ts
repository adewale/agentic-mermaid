// Exact first-party descriptor identities. Replacement and extension hooks
// cannot acquire private cache ownership by copying a native lowering hook.
// Both installers construct fresh plain frozen snapshots before enrollment.
const owned = new WeakSet<object>()
export function enrollOwnedFamily(descriptor: object): void { owned.add(descriptor) }
export function isOwnedFamily(descriptor: object): boolean { return owned.has(descriptor) }
