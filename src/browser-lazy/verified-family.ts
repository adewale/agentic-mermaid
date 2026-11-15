import type { FamilyDescriptor } from '../agent/families.ts'
import { DeferredDependencyError } from '../layout/certification-error.ts'
import { nativeTerminalArtifact, nativeTerminalRenderer } from '../ascii/terminal-artifact.ts'

type TerminalRenderer = NonNullable<FamilyDescriptor['renderAscii']>

/** Keep a complete descriptor's synchronous terminal hook, loading its owning
 * implementation only when an async worker first requests terminal output. */
export function deferredTerminalRenderer(loadModule: () => Promise<{ default: { renderAscii: TerminalRenderer } }>): TerminalRenderer {
  let render: TerminalRenderer | undefined
  const load = async () => { render = (await loadModule()).default.renderAscii }
  return nativeTerminalRenderer((context, model) => {
    if (!render) throw new DeferredDependencyError('Terminal renderer', load)
    const artifact = nativeTerminalArtifact(render, context, model)
    if (!artifact) throw new Error('Built-in terminal renderer did not retain its native drawing')
    return artifact
  })
}
