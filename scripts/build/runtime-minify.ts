import { minify } from '@swc/core'

/** Private browser delivery uses ordinary semantics-preserving compression.
 * Getters remain observable, function arity stays intact, and unsafe rewrites
 * are disabled. This changes emitted JavaScript, never rendering contracts. */
export async function minifyBrowserRuntime(source: string, preserveDeclarations?: string[]): Promise<string> {
  const result = await minify(source, {
    ecma: 2022, module: true, mangle: preserveDeclarations ? { reserved: preserveDeclarations } : true,
    compress: {
      defaults: true, ecma: 2022, toplevel: true,
      unsafe: false, pure_getters: false, keep_fargs: true,
      reduce_funcs: false, inline: 3, passes: 6,
      ...(preserveDeclarations ? { top_retain: preserveDeclarations } : {}),
    },
    format: { comments: 'some', inlineScript: true },
  })
  if (!result.code) throw new Error('Browser runtime compression produced no module')
  return result.code
}
