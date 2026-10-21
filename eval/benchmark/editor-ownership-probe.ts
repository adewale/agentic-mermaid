// Experimental build only; does not change the shipping editor. Reuse the hosted
// async facade in the standalone main realm, initializing engines on demand for
// text/PNG export. The worker alone initializes preview engines at startup.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { benchmarkOptions, driverRevision, sha256 } from './browser-bench-host.ts'

const options = benchmarkOptions(['--html', '--out', '--mode'], ['--html', '--out'])
const html = readFileSync(resolve(options.get('--html')!), 'utf8'), out = resolve(options.get('--out')!)
const mode = options.get('--mode') ?? 'deferred'
if (!['deferred', 'worker-only'].includes(mode)) throw new Error('--mode must be deferred or worker-only')
const entry = `import '${resolve(import.meta.dir, '../../src/browser-hosted.ts')}';
if (typeof window === 'undefined') {
  await import('${resolve(import.meta.dir, '../../src/browser-preview-worker.ts')}');
} else {
  const script = document.getElementById('editor-runtime');
  if (!script?.textContent) throw new Error('Runtime source missing');
  globalThis.__ownershipProbeRuntime = new Blob([script.textContent], { type: 'text/javascript' });
}`
const clientModule = `import { PreviewWorkerClient, createPreviewWorker } from '${resolve(import.meta.dir, '../../src/browser-preview-client.ts')}';
export { PreviewSupersededError } from '${resolve(import.meta.dir, '../../src/browser-preview-client.ts')}';
const client = new PreviewWorkerClient(() => createPreviewWorker(URL.createObjectURL(globalThis.__ownershipProbeRuntime)));
export const renderEditorPreview = (source, options = {}) => client.render(source, options);
export const cancelPendingEditorPreview = () => client.cancelPending();
window.addEventListener('pagehide', () => client.dispose());`
const result = await Bun.build({ entrypoints: ['ownership-probe'], target: 'browser', format: 'esm', minify: true,
  plugins: [{ name: 'ownership-probe', setup(b) {
    b.onResolve({ filter: /^ownership-probe$/ }, () => ({ path: 'probe.js', namespace: 'ownership-probe' }))
    b.onLoad({ filter: /.*/, namespace: 'ownership-probe' }, () => ({ contents: mode === 'worker-only' ? `import '${resolve(import.meta.dir, 'editor-ownership-rpc.ts')}';` : entry, loader: 'js' }))
    b.onResolve({ filter: /browser-preview-runtime\.ts$/ }, () => ({ path: 'client.js', namespace: 'ownership-client' }))
    b.onLoad({ filter: /.*/, namespace: 'ownership-client' }, () => ({ contents: clientModule, loader: 'js' }))
  } }] })
if (!result.success || result.outputs.length !== 1) throw new AggregateError(result.logs, 'Ownership probe must remain one self-contained module')
const bundle = await result.outputs[0]!.text()
let replacements = 0
const candidate = html.replace(/(<script type="module" id="editor-runtime">)[\s\S]*?(<\/script>)/, (_, start, end) => { replacements++; return start + '\n' + bundle + '\n' + end })
if (replacements !== 1) throw new Error('Expected standalone runtime script')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, candidate)
writeFileSync(out + '.json', JSON.stringify({ experimental: true, driverRevision: driverRevision(),
  original: { raw: Buffer.byteLength(html), gzip: gzipSync(html, { level: 9 }).length, sha256: sha256(Buffer.from(html)) },
  candidate: { raw: Buffer.byteLength(candidate), gzip: gzipSync(candidate, { level: 9 }).length, sha256: sha256(Buffer.from(candidate)) },
  mode, scope: mode === 'deferred' ? 'Defers standalone main-realm initialization until export. Main uses hosted async editor facade, not the full synchronous public browser adapter. PNG/text exports still initialize main engines on demand; this is not permanent worker-only ownership.' : 'Serial-call experiment: preview, text and PNG projection/validation in worker; Canvas callback on main thread. Does not implement production queue/cancellation/crash-retry/admission policy.' }, null, 2) + '\n')
console.log(out)
