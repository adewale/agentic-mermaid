// Ambient module declarations so the website Worker — imported by
// src/__tests__/website-build.test.ts to exercise host/path routing — also
// type-checks under the ROOT tsconfig. These mirror the module rules in
// website/src/worker-env.d.ts (wrangler Text/Data/Wasm imports); the worker
// casts the `caches` global itself, so no Cache API declaration is needed here
// (declaring one would clash with the DOM `CacheStorage` in the root lib set).
declare module '*.js.txt' {
  const text: string
  export default text
}
declare module '*.ttf' {
  const data: ArrayBuffer
  export default data
}
declare module '*.wasm' {
  const mod: WebAssembly.Module
  export default mod
}
