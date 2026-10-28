import { minify } from '@swc/core'

/** Optimize complete ESM chunks while retaining argument arity, observable
 * property reads, numeric semantics and legal notices. Hashing belongs to the
 * emitting bundler, after this transformation. */
export async function compressBrowserModule(code: string): Promise<string> {
  const result = await minify(code, {
    ecma: 2022, module: true, toplevel: true, mangle: true,
    compress: {
      defaults: true, toplevel: true, keep_fargs: true, pure_getters: false,
      unsafe: false, unsafe_math: false, inline: 3, passes: 5,
    },
    format: { comments: 'some', inlineScript: true },
  })
  if (!result.code) throw new Error('Browser compression produced no module')
  return result.code
}
