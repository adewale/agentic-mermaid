// The read-only MCP Apps view (extension io.modelcontextprotocol/ui,
// specification 2026-01-26) that UI-capable hosts render for the hosted
// `preview` tool. It is one self-contained document — inline style and
// script, no network — so it runs under the spec's default sandbox CSP
// (`default-src 'none'; script-src/style-src 'self' 'unsafe-inline';
// img-src 'self' data:`) and the resource can declare that it needs no
// external origin at all.
//
// The view is passive: it never calls tools. It completes the ui/initialize
// handshake, then renders the `preview` result the host forwards in
// ui/notifications/tool-result. The diagram is shown as an <img> with a
// data: URL, so the SVG can never run script or touch this document even if
// a future renderer bug let markup through, and every other value is written
// with textContent rather than parsed as HTML.
//
// The script is plain ES2017 inside a TypeScript template literal: apart from
// the one deliberate version interpolation, it must not contain backticks or
// `${`.

import { PACKAGE_VERSION } from '../../version.ts'

export const PREVIEW_VIEW_URI = 'ui://agentic-mermaid/preview'

const PREVIEW_VIEW_SCRIPT = `
(function () {
  'use strict'
  var PROTOCOL_VERSION = '2026-01-26'
  var VIEW_VERSION = ${JSON.stringify(PACKAGE_VERSION)}
  var host = window.parent
  var view = document.getElementById('view')
  var nextId = 1
  var pending = {}
  var initialized = false
  var lastSize = ''

  function send(message) { host.postMessage(message, '*') }
  function notify(method, params) { send({ jsonrpc: '2.0', method: method, params: params || {} }) }
  function request(method, params) {
    var id = nextId++
    send({ jsonrpc: '2.0', id: id, method: method, params: params })
    return new Promise(function (resolve, reject) { pending[id] = { resolve: resolve, reject: reject } })
  }

  function node(tag, className, text) {
    var element = document.createElement(tag)
    if (className) element.className = className
    if (text !== undefined) element.textContent = String(text)
    return element
  }

  // The root's box, not its scroll size: scrollHeight never drops below the
  // frame's own height, so content that shrinks could never report it.
  function reportSize() {
    if (!initialized) return
    var box = document.documentElement.getBoundingClientRect()
    var width = Math.ceil(box.width)
    var height = Math.ceil(box.height)
    var size = width + 'x' + height
    if (size === lastSize) return
    lastSize = size
    notify('ui/notifications/size-changed', { width: width, height: height })
  }

  function applyHostContext(context) {
    if (!context || typeof context !== 'object') return
    var root = document.documentElement
    if (context.theme === 'light' || context.theme === 'dark') {
      root.style.colorScheme = context.theme
      root.setAttribute('data-theme', context.theme)
    }
    var variables = context.styles && context.styles.variables
    if (variables && typeof variables === 'object') {
      Object.keys(variables).forEach(function (name) {
        var value = variables[name]
        if (name.indexOf('--') === 0 && typeof value === 'string') root.style.setProperty(name, value)
      })
    }
  }

  function showStatus(text, isError) {
    view.textContent = ''
    view.appendChild(node('p', isError ? 'status error' : 'status', text))
    reportSize()
  }

  function messageOf(value) {
    if (value && typeof value === 'object' && typeof value.message === 'string') return value.message
    return String(value)
  }

  // Verify warnings carry structured fields rather than prose, for example
  // { code: 'LABEL_OVERFLOW', target: 'A', charCount: 62, limit: 40 }.
  function warningDetail(warning) {
    if (typeof warning.message === 'string') return warning.message
    return Object.keys(warning).filter(function (key) {
      var value = warning[key]
      return key !== 'code' && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    }).map(function (key) { return key + ': ' + warning[key] }).join(', ')
  }

  function payloadOf(result) {
    if (!result || typeof result !== 'object') return null
    if (result.structuredContent && typeof result.structuredContent === 'object') return result.structuredContent
    var content = Array.isArray(result.content) ? result.content : []
    for (var i = 0; i < content.length; i++) {
      var item = content[i]
      if (item && item.type === 'text' && typeof item.text === 'string') {
        try { return JSON.parse(item.text) } catch (error) { return { ok: false, error: { message: item.text } } }
      }
    }
    return null
  }

  // isError alone decides nothing: the tool sets it whenever ok is false, and
  // a diagram that fails verification or a source that fails to parse still
  // has something to show.
  function render(result) {
    var payload = payloadOf(result)
    if (!payload || typeof payload !== 'object') return showStatus('The preview tool returned no diagram.', true)
    if (payload.error) return showStatus(messageOf(payload.error), true)
    if (typeof payload.svg !== 'string') {
      if (payload.errors === undefined) return showStatus(result.isError ? 'The preview failed.' : 'The preview tool returned no diagram.', true)
      view.textContent = ''
      view.appendChild(node('p', 'status error', 'The diagram could not be parsed.'))
      var problems = node('ul', 'problems')
      var errors = Array.isArray(payload.errors) ? payload.errors : [payload.errors]
      errors.forEach(function (error) { problems.appendChild(node('li', '', messageOf(error))) })
      view.appendChild(problems)
      return reportSize()
    }
    var warnings = Array.isArray(payload.warnings) ? payload.warnings : []
    view.textContent = ''
    var header = node('header', 'header')
    header.appendChild(node('span', 'family', payload.family || 'diagram'))
    var verdict = payload.ok
      ? (warnings.length === 0 ? 'Verified' : 'Verified with ' + warnings.length + (warnings.length === 1 ? ' warning' : ' warnings'))
      : 'Needs attention'
    header.appendChild(node('span', payload.ok ? 'verdict ok' : 'verdict attention', verdict))
    view.appendChild(header)
    if (payload.summary) view.appendChild(node('p', 'summary', payload.summary))
    if (typeof payload.svg === 'string') {
      var figure = node('figure', 'diagram')
      var image = document.createElement('img')
      image.alt = payload.summary || 'Rendered Mermaid diagram'
      image.addEventListener('load', function () {
        // An empty diagram renders as a 0x0 SVG: show its warnings, not a blank box.
        if (image.naturalWidth === 0) figure.hidden = true
        reportSize()
      })
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(payload.svg)
      figure.appendChild(image)
      view.appendChild(figure)
    }
    if (warnings.length > 0) {
      var list = node('ul', 'warnings')
      warnings.forEach(function (warning) {
        var item = node('li')
        item.appendChild(node('code', '', warning && warning.code ? warning.code : 'WARNING'))
        var detail = warning && typeof warning === 'object' ? warningDetail(warning) : ''
        if (detail) item.appendChild(document.createTextNode(' — ' + detail))
        list.appendChild(item)
      })
      view.appendChild(list)
    }
    reportSize()
  }

  window.addEventListener('message', function (event) {
    if (event.source !== host) return
    var message = event.data
    if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0') return
    if (message.method === undefined && message.id !== undefined) {
      var waiting = pending[message.id]
      if (!waiting) return
      delete pending[message.id]
      if (message.error) waiting.reject(message.error)
      else waiting.resolve(message.result)
      return
    }
    switch (message.method) {
      case 'ui/notifications/tool-input':
        showStatus('Rendering the diagram…')
        break
      case 'ui/notifications/tool-result':
        render(message.params)
        break
      case 'ui/notifications/tool-cancelled':
        showStatus('The preview was cancelled.')
        break
      case 'ui/notifications/host-context-changed':
        applyHostContext(message.params)
        break
      case 'ui/resource-teardown':
        if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} })
        break
      default:
        if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } })
    }
  })

  if (typeof ResizeObserver === 'function') new ResizeObserver(reportSize).observe(document.body)

  request('ui/initialize', {
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: 'agentic-mermaid-preview', version: VIEW_VERSION },
    capabilities: {},
    appCapabilities: { availableDisplayModes: ['inline'] }
  }).then(function (result) {
    applyHostContext(result && result.hostContext)
    initialized = true
    notify('ui/notifications/initialized', {})
    reportSize()
  }, function () {
    showStatus('This host did not start the preview.', true)
  })
})()
`

/** Colors and type fall back to the Agentic Mermaid design tokens (DESIGN.md)
 * and defer to the host's standard style variables when it sends them. */
const PREVIEW_VIEW_STYLE = `
:root {
  color-scheme: light dark;
  --am-surface: var(--color-background-primary, light-dark(#F5F0E4, #1C1A15));
  --am-ink: var(--color-text-primary, light-dark(#221E16, #EDE7DB));
  --am-muted: var(--color-text-secondary, light-dark(#5C5546, #B8AE9C));
  --am-line: var(--color-border-primary, light-dark(#D8D0C1, #3A3529));
  --am-attention: light-dark(#9A4A24, #E0956B);
  --am-ok: light-dark(#2F6B4F, #8CCFAE);
  --am-font: var(--font-sans, "Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif);
  --am-mono: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
}
* { box-sizing: border-box; margin: 0; }
body { background: var(--am-surface); color: var(--am-ink); font: 14px/1.5 var(--am-font); padding: 12px; }
.header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; }
.family { font-weight: 600; }
.verdict { font: 600 12px/1.6 var(--am-mono); border: 1px solid currentColor; border-radius: 999px; padding: 0 8px; }
.verdict.ok { color: var(--am-ok); }
.verdict.attention, .status.error { color: var(--am-attention); }
.summary, .status { color: var(--am-muted); margin-top: 4px; }
.diagram { margin-top: 10px; background: #fff; border: 1px solid var(--am-line); border-radius: 6px; padding: 8px; overflow: auto; }
.diagram img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.warnings, .problems { margin-top: 10px; padding-left: 18px; }
.warnings li, .problems li { margin-top: 2px; }
code { font: 12px var(--am-mono); }
`

export const PREVIEW_VIEW_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentic Mermaid preview</title>
<style>${PREVIEW_VIEW_STYLE}</style>
</head>
<body>
<main id="view" aria-live="polite"><p class="status">Waiting for the diagram…</p></main>
<script>${PREVIEW_VIEW_SCRIPT}</script>
</body>
</html>
`
