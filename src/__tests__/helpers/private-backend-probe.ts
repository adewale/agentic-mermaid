import { fileURLToPath } from 'node:url'
import { privateBuiltinConformancePlugin, verifyPrivateBuiltinConformanceSource } from '../../../scripts/build/private-builtin-conformance.ts'
import { runtimeRenderContractPlugin } from '../../../scripts/build/runtime-render-contract.ts'
import { minifyBrowserRuntime } from '../../../scripts/build/runtime-minify.ts'

/** The same compiled private consumer runs in Bun and actual browser engines. */
export async function buildPrivateBackendProbe(): Promise<string> {
  const scene = fileURLToPath(new URL('../../scene/', import.meta.url))
  const shell = fileURLToPath(new URL('../../shared/scene-document.ts', import.meta.url))
  const source = `
    import ${JSON.stringify(`${scene}builtin-backends.ts`)};
    import { knownBackendDescriptors, getBackend, registerBackend } from ${JSON.stringify(`${scene}backend.ts`)};
    import { shape } from ${JSON.stringify(`${scene}marks.ts`)};
    import { sceneDocument } from ${JSON.stringify(shell)};
    export const reports = knownBackendDescriptors().map(value => value.conformance);
    globalThis.__privateBuiltinReports = reports;
    export function renderProbe(mode = 'valid') {
      const colors = { bg: '#fff', fg: '#111', font: 'Inter' };
      const doc = sceneDocument('flowchart', { width: 40, height: 40 }, colors, false, [
        shape({ id: 'box', role: 'node', geometry: { kind: 'rect', x: 5, y: 5, width: 20, height: 20, rx: 0 },
          paint: { fill: mode === 'unsafe' ? 'url(https://example.test/paint)' : '#fff', stroke: '#111', strokeWidth: '1' } }),
      ]);
      if (mode === 'invalid') doc.width = NaN;
      if (mode === 'external') doc.family = 'family:unexpected';
      return getBackend('default').render(doc, { seed: 0 });
    }
    export function customRegistration() { registerBackend({}, {}); }
  `
  const plugin = privateBuiltinConformancePlugin(runtimeRenderContractPlugin({ schemaDocumentation: false, conformanceObservations: false, sourceOnlySceneAdmission: true }))
  const result = await Bun.build({
    entrypoints: ['private-backend-probe'], target: 'browser', format: 'esm', minify: true,
    plugins: [{ name: 'private-backend-probe-entry', setup(build) {
      build.onResolve({ filter: /^private-backend-probe$/ }, () => ({ path: 'probe.ts', namespace: 'private-backend-probe' }))
      build.onLoad({ filter: /.*/, namespace: 'private-backend-probe' }, () => ({ contents: source, loader: 'ts', resolveDir: scene }))
    } }, plugin],
  })
  verifyPrivateBuiltinConformanceSource(plugin)
  if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, 'Private backend probe build failed')
  return minifyBrowserRuntime(await result.outputs[0]!.text())
}
