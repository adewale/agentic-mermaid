/**
 * Development server with live reload for mermaid samples.
 *
 * Usage: bun run packages/mermaid/dev.ts
 *
 * - Runs `index.ts` to generate index.html on startup
 * - Runs `editor.ts` to generate editor.html on startup
 * - Watches `src/` and `index.ts` for file changes
 * - On change, rebuilds index.html and notifies browsers via SSE
 * - Serves index.html with an injected live-reload script
 *
 * Routes:
 *   /         → index.html (samples showcase, as before)
 *   /editor   → editor.html (live diagram editor)
 *
 * This avoids manually re-running the build and refreshing the browser —
 * just save a file and the page updates automatically.
 */

import { watch } from 'fs'
import { join } from 'path'

const PORT = 3456
const ROOT = import.meta.dir

// ============================================================================
// Build management
// ============================================================================

let building = false
const sseClients = new Set<ReadableStreamDefaultController>()

async function rebuild(): Promise<void> {
  if (building) return
  building = true
  console.log('\x1b[36m[dev]\x1b[0m Rebuilding samples...')
  const t0 = performance.now()

  const samplesProc = Bun.spawn(['bun', 'run', join(ROOT, 'index.ts')], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const editorProc = Bun.spawn(['bun', 'run', join(ROOT, 'editor.ts')], {
    cwd: ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  await Promise.all([samplesProc.exited, editorProc.exited])

  const ms = (performance.now() - t0).toFixed(0)
  if (samplesProc.exitCode === 0 && editorProc.exitCode === 0) {
    console.log(`\x1b[32m[dev]\x1b[0m Rebuilt in ${ms}ms`)
    // Notify all connected browsers to reload
    for (const client of sseClients) {
      try {
        client.enqueue('data: reload\n\n')
      } catch {
        sseClients.delete(client)
      }
    }
  } else {
    console.error(
      `\x1b[31m[dev]\x1b[0m Build failed (samples exit ${samplesProc.exitCode}, editor exit ${editorProc.exitCode})`,
    )
  }
  building = false
}

// ============================================================================
// File watching — debounced to coalesce rapid saves
// ============================================================================

let debounce: Timer | null = null
function onFileChange(_event: string, filename: string | null): void {
  // Ignore generated outputs
  if (filename === 'index.html' || filename === 'editor.html') return
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    console.log(`\x1b[90m[dev]\x1b[0m Change detected${filename ? `: ${filename}` : ''}`)
    rebuild()
  }, 150)
}

// Watch the entire mermaid package for changes (excludes *.html outputs)
watch(ROOT, { recursive: true }, onFileChange)

// ============================================================================
// HTTP server
// ============================================================================

// Initial build before starting the server
await rebuild()

console.log(`\x1b[36m[dev]\x1b[0m Server running at \x1b[1mhttp://localhost:${PORT}\x1b[0m`)
console.log(`\x1b[36m[dev]\x1b[0m   /         → samples showcase`)
console.log(`\x1b[36m[dev]\x1b[0m   /editor   → live diagram editor\n`)

const liveReloadScript = `  <script>
    // Live reload — SSE connection to dev server.
    // When the server signals a rebuild, the page reloads automatically.
    // If the connection drops (server restarting), it reconnects with backoff.
    ;(function() {
      function connect() {
        var es = new EventSource('/__dev_events');
        es.onmessage = function(e) {
          if (e.data === 'reload') location.reload();
        };
        es.onerror = function() {
          es.close();
          setTimeout(connect, 500);
        };
      }
      connect();
    })();
  </script>
</body>`

function injectLiveReload(html: string): string {
  return html.replace('</body>', liveReloadScript)
}

async function serveHtml(filename: string): Promise<Response> {
  const file = Bun.file(join(ROOT, filename))
  if (!(await file.exists())) {
    return new Response(`${filename} not found — build may have failed`, { status: 404 })
  }
  return new Response(injectLiveReload(await file.text()), {
    headers: { 'Content-Type': 'text/html' },
  })
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // SSE endpoint — browsers connect here to receive reload signals
    if (url.pathname === '/__dev_events') {
      let controller!: ReadableStreamDefaultController
      const stream = new ReadableStream({
        start(c) {
          controller = c
          sseClients.add(controller)
        },
        cancel() {
          sseClients.delete(controller)
        },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Live editor
    if (url.pathname === '/editor' || url.pathname === '/editor.html') {
      return serveHtml('editor.html')
    }

    // Samples showcase (default, as before)
    return serveHtml('index.html')
  },
})
