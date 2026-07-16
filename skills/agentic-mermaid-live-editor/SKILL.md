---
name: agentic-mermaid-live-editor-development
description: >-
  Develop and debug the Agentic Mermaid browser editor, including its modular UI,
  render/verify pipeline, examples, configuration, exports, URL sharing, website
  integration, and browser regression tests.
---

# Agentic Mermaid live editor development

Edit the modular editor sources and preserve the contracts shared by the standalone editor and the deployed website.

## Source map

| Path | Role |
|---|---|
| `editor/js/` | Editor behavior. Treat `sharing.js`, `rendering.js`, and `state.js` as contract sources. |
| `editor/css/` | Editor styling. |
| `editor/html/` | Top bar and workspace partials. |
| `editor/examples.ts` | Canonical editor examples. |
| `scripts/site/editor.ts` | Assemble the standalone `editor.html`. |
| `website/build.ts` | Assemble the deployed `/editor/` and all public pages that link to it. |
| `scripts/site/editor-state-url.ts` | Canonical build-time encoder and validator for editor-state URLs. |
| `src/browser.ts` | Browser renderer API exposed as `window.__mermaid`. |

Do not edit generated `editor.html` or `website/public/` files directly.

## Build and test cycle

Run the target that owns the changed surface:

```bash
bun run editor          # standalone editor.html
bun run website         # production website/public, including /editor/
bun run website:check   # committed generated inputs are current
bun run typecheck
```

For behavior changes, also run the focused editor unit tests and the browser lane. The browser lane requires Playwright Chromium and `AM_BROWSER_TESTS=1`.

## State contract

Keep editor state in the canonical shape from `editor/js/state.js`:

```js
state = {
  palette: 'paper',
  style: 'crisp',
  seed: 0,
  zoom: 1,
  config: {},
}
```

- `palette` stores the registered palette input name.
- `style` stores the registered Look input name or `crisp`.
- `seed` affects styled ink without changing layout.
- `config` contains admitted serializable render options.
- Browser chrome dark/light mode is separate from diagram appearance and must not rewrite `state.palette`.

When adding state, update serialization, sanitization, restoration, control hydration, and tests together.

## Render and verification boundary

Follow the pipeline in `editor/js/rendering.js`:

```text
editor input
  -> scheduleRender()
  -> doRender()
  -> buildOptions()
  -> renderMermaidSVGWithReceipt()
  -> verifyNoExternalRefs()
  -> insertStrictRenderedSvg()
  -> verifyMermaid()
  -> retain the receipt-bearing artifact only when verification succeeds
```

Keep `security: "strict"` and `embedFontImport: false` host-owned. Admit restored configuration through `SHARED_RENDER_OPTION_FIELDS` and `validateSerializableRenderOptions`; never trust hash or storage data directly. Insert one parsed SVG node with `replaceChildren`, not arbitrary shared HTML.

Do not enable share or export actions from stale DOM. Require the current source, receipt digests, verified artifact, and preview SVG to agree.

## URL sharing contract

Treat the URL payload as a versioned producer/consumer boundary. The canonical state is:

```ts
{
  source: string
  palette?: string
  style?: string
  seed?: number
  config?: Record<string, unknown>
}
```

The hash codec is:

```text
deflate:<base64url(deflate-raw(UTF-8(JSON(state))))>
```

Use `editor/js/sharing.js` as the browser source of truth. For Node/build-time links, import `editorStateHref()` or `hostedEditorStateHref()` from `scripts/site/editor-state-url.ts`. Never hand-roll base64, compression, field names, or `/editor/` URL assembly in another producer.

Keep these behaviors:

- Reject unknown fields such as the removed `theme` alias.
- Bound encoded and decoded bytes.
- Fail closed on corrupt, unsupported, or oversized hashes.
- Do not restore a draft, query example, or plausible default after hash decode failure.
- Use `?example=<id>` only for canonical editor examples; use a state hash for source/config/style snapshots.
- Update the hash only after a current render verifies successfully.

When changing this contract, update the browser codec, build-time codec, every producer, checked-in deep links, and both unit and real-navigation tests in the same change.

## Configuration controls

For an existing render option:

1. Add accessible controls in `editor/html/left-panel.html` or the relevant partial.
2. Store UI state in `editor/js/config-panel.js`.
3. Include the value in `readConfig()` and restore it in `hydrateConfigControls()`.
4. Keep `state.config` serializable and admitted by the shared render-options schema.
5. Render through `buildOptions()`; do not patch the preview into a state the renderer cannot reproduce.

For new public options, update the library contract first, then the editor. Do not create an editor-only alias.

## Examples

Add or edit examples in `editor/examples.ts`. Preserve stable IDs because `/editor/?example=<id>`, the sidebar, website examples, and tests depend on them. Examples may supply source and admitted config; loading one must preserve the user-selected Palette unless the URL snapshot explicitly carries a palette.

## Export behavior

Keep SVG, PNG, ASCII, and Unicode exports derived from current receipt-bearing artifacts. Preserve strict SVG verification and self-hosted font handling. PNG scale changes output dimensions; it must not change diagram semantics or silently fall back after an error.

## Regression gates

Use these tests when touching editor links or state:

```bash
bun test src/__tests__/editor-link-contract.test.ts
bun test src/__tests__/editor-security-closures.test.ts
bun test src/__tests__/website-build.test.ts
AM_BROWSER_TESTS=1 bun test src/__tests__/website-browser-a11y.test.ts --timeout 600000
```

The repository-wide link contract must decode every checked-in hosted editor deep link. The website build contract must decode every generated HTML/JSON editor-state link and reject legacy hashes or unknown fields. The browser test must navigate from a real public page into the editor and verify that initialization preserves the hash and source.

## Common pitfalls

- Updating a decoder without migrating every producer.
- Updating unit fixtures to the new codec while leaving public links untouched.
- Reintroducing `theme` where the editor state contract requires `palette`.
- Testing the editor only with hashes manufactured inside the editor test suite.
- Editing generated outputs instead of modular sources.
- Letting dark/light chrome mutate diagram appearance.
- Restoring drafts after a broken share URL, which can make unrelated local content look shared.
- Enabling copy/export from a stale or unverified preview.
