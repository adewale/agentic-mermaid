// Ambient declarations for the workerd-only pieces of the website Worker:
// wrangler module rules (text/data/wasm imports) and the Cache API global.

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

declare const caches: {
  default: {
    match(key: Request): Promise<Response | undefined>
    put(key: Request, response: Response): Promise<void>
  }
}
