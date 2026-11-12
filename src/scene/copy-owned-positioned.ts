import { uncurryIntrinsic } from '../shared/intrinsics.ts'
import { clonePositioned } from '../experimental/position-cache.ts'
import { isImmutablePixelTextPart, transferRetainedPixelText } from '../shared/prepared-text.ts'
import { transferConstructedBundleRoute } from '../layout/bundle-routes.ts'

const recordPrototype = Object.prototype, mapPrototype = Map.prototype, setPrototype = Set.prototype
const NativeMap = Map, NativeSet = Set, NativeArray = Array
const isArray = Array.isArray, getPrototypeOf = Object.getPrototypeOf
const ownDescriptors = Object.getOwnPropertyDescriptors, ownKeys = Object.keys, defineOwn = Object.defineProperty
const mapEntries = Map.prototype.entries, setValues = Set.prototype.values
const mapNext = Object.getPrototypeOf(new Map().entries()).next as MapIterator<[unknown, unknown]>['next']
const setNext = Object.getPrototypeOf(new Set().values()).next as SetIterator<unknown>['next']
// Bind once: even later changes to Function.prototype.call must not expose a
// private source through the memo or a collection iterator's argument list.
const privateMapHas = uncurryIntrinsic(Map.prototype.has) as (map: Map<unknown, unknown>, key: unknown) => boolean
const privateMapGet = uncurryIntrinsic(Map.prototype.get) as (map: Map<unknown, unknown>, key: unknown) => unknown
const privateMapSet = uncurryIntrinsic(Map.prototype.set) as (map: Map<unknown, unknown>, key: unknown, value: unknown) => void
const privateSetAdd = uncurryIntrinsic(Set.prototype.add) as (set: Set<unknown>, value: unknown) => void
const privateMapEntries = uncurryIntrinsic(mapEntries) as (map: object) => MapIterator<[unknown, unknown]>
const privateSetValues = uncurryIntrinsic(setValues) as (set: object) => SetIterator<unknown>
const privateMapNext = uncurryIntrinsic(mapNext) as (iterator: MapIterator<[unknown, unknown]>) => IteratorResult<[unknown, unknown]>
const privateSetNext = uncurryIntrinsic(setNext) as (iterator: SetIterator<unknown>) => IteratorResult<unknown>
function clonedKind(value: object): 'record' | 'array' | 'map' | 'set' | 'native' {
  if (isArray(value)) return 'array'
  const prototype = getPrototypeOf(value)
  return prototype === recordPrototype || prototype === null ? 'record'
    : prototype === mapPrototype ? 'map' : prototype === setPrototype ? 'set' : 'native'
}

const UNSUPPORTED_PRIVATE_COPY = Symbol('unsupported private positioned copy')
/** Only captured lowering invokes this after positioning proves private borrow
 * ownership. Foreign/public graphs retain their structuredClone-first boundary.
 * Copy mutable containers while sharing constructor-owned immutable text. */
export function copyOwnedPositioned<T>(source: T): T {
  const seen = new NativeMap<object, unknown>()
  const copy = (value: unknown): unknown => {
    if (typeof value === 'function' || typeof value === 'symbol') throw UNSUPPORTED_PRIVATE_COPY
    if (value === null || typeof value !== 'object') return value
    if (isImmutablePixelTextPart(value)) return value
    if (privateMapHas(seen, value)) return privateMapGet(seen, value)
    const kind = clonedKind(value)
    if (kind === 'native') throw UNSUPPORTED_PRIVATE_COPY
    const result = kind === 'map' ? new NativeMap() : kind === 'set' ? new NativeSet()
      : kind === 'array' ? new NativeArray((value as unknown[]).length) : {}
    privateMapSet(seen, value, result)
    if (kind === 'map') {
      const iterator = privateMapEntries(value)
      for (let next = privateMapNext(iterator); !next.done; next = privateMapNext(iterator)) {
        const pair = next.value
        privateMapSet(result as Map<unknown, unknown>, copy(pair[0]), copy(pair[1]))
      }
    } else if (kind === 'set') {
      const iterator = privateSetValues(value)
      for (let next = privateSetNext(iterator); !next.done; next = privateSetNext(iterator)) privateSetAdd(result as Set<unknown>, copy(next.value))
    } else {
      const descriptors = ownDescriptors(value), keys = ownKeys(descriptors)
      for (let index = 0; index < keys.length; index++) {
        const key = keys[index]!
        const descriptor = descriptors[key]!
        if (!descriptor.enumerable) continue
        if (!('value' in descriptor)) throw UNSUPPORTED_PRIVATE_COPY
        // Define own properties so __proto__ stays data, as in native cloning.
        defineOwn(result, key, { value: copy(descriptor.value), writable: true, enumerable: true, configurable: true })
      }
    }
    transferConstructedBundleRoute(value, result)
    transferRetainedPixelText(value, result)
    return result
  }
  try { return copy(source) as T } catch (error) {
    if (error !== UNSUPPORTED_PRIVATE_COPY) throw error
    return clonePositioned(source, true)
  }
}
