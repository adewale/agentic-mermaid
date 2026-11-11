/** Capture method uncurrying before host instrumentation can observe private
 * receivers or arguments through replaced prototype methods. */
export const uncurryIntrinsic = Function.prototype.call.bind(Function.prototype.bind, Function.prototype.call) as <F extends (...args: never[]) => unknown>(method: F) => (receiver: ThisParameterType<F>, ...args: Parameters<F>) => ReturnType<F>
export const NativeWeakMap = WeakMap, NativeWeakSet = WeakSet

export const weakMapGet = /* @__PURE__ */ uncurryIntrinsic(WeakMap.prototype.get) as <K extends object, V>(map: WeakMap<K, V>, key: K) => V | undefined
export const weakMapSet = /* @__PURE__ */ uncurryIntrinsic(WeakMap.prototype.set) as <K extends object, V>(map: WeakMap<K, V>, key: K, value: V) => void
export const weakMapHas = /* @__PURE__ */ uncurryIntrinsic(WeakMap.prototype.has) as <K extends object, V>(map: WeakMap<K, V>, key: K) => boolean
export const weakMapDelete = /* @__PURE__ */ uncurryIntrinsic(WeakMap.prototype.delete) as <K extends object, V>(map: WeakMap<K, V>, key: K) => boolean
export const weakSetHas = /* @__PURE__ */ uncurryIntrinsic(WeakSet.prototype.has) as <K extends object>(set: WeakSet<K>, key: K) => boolean
export const weakSetAdd = /* @__PURE__ */ uncurryIntrinsic(WeakSet.prototype.add) as <K extends object>(set: WeakSet<K>, key: K) => void
