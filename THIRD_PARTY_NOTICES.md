# Third-party notices

## Pele parser and fishbone layout adaptations

The native Block and Requirement parsers and Ishikawa layout adapt browserless
implementations from Pele, with Agentic Mermaid's typed bodies, editing,
measurement, Scene, styling and output contracts applied locally.

- Source: <https://github.com/kepano/pele/tree/8603bf3313add9143cd417015d4a6bd6c522dada>
- Copyright: © 2026 kepano
- License: **MIT**, reproduced in [`LICENSES/pele-MIT.txt`](LICENSES/pele-MIT.txt).

## Mermaid 12.2.0 stable-family tests

The six new family compatibility benches preserve pinned Mermaid test cases and
documented examples from source commit
`1fb7869866dd619168d840291c9c54b4f129758b`. They are verification inputs, not
runtime code, and are excluded from the npm package.

- Source: <https://github.com/mermaid-js/mermaid/tree/1fb7869866dd619168d840291c9c54b4f129758b>
- Copyright: © 2014–2022 Knut Sveidqvist
- License: **MIT**, reproduced in `LICENSES/Mermaid-MIT.txt`.

## Material Design Icons (curated Architecture icon paths)

A size-bounded subset of SVG path data in `src/architecture/icons.ts` is
derived from **@iconify-json/mdi 1.2.3**, the Iconify packaging of Material
Design Icons.

- Source: <https://www.npmjs.com/package/@iconify-json/mdi/v/1.2.3>
- Upstream project: <https://github.com/Templarian/MaterialDesign>
- License: **Apache License 2.0**
- Packaged license copy: [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt)
- Canonical license URL: <https://www.apache.org/licenses/LICENSE-2.0>

Only curated path data is bundled. Agentic Mermaid does not fetch Iconify packs
at runtime and does not bundle the full npm package. The published
`@iconify-json/mdi@1.2.3` tarball contains no upstream `NOTICE` file to
reproduce.

## Mermaid syntax references

The Mermaid syntax references under
`skills/agentic-mermaid-diagram-workflow/references/upstream/` are copied from
Mermaid 12.2.0, source commit `1fb7869866dd619168d840291c9c54b4f129758b`.

- Source: <https://github.com/mermaid-js/mermaid/tree/1fb7869866dd619168d840291c9c54b4f129758b/docs/syntax>
- Copyright: © 2014–2022 Knut Sveidqvist
- License: **MIT**, reproduced in `LICENSES/Mermaid-MIT.txt` and included in the npm package.

## Mermaid pinned test specifications

The revision-bound oracle vendors two upstream Mermaid test specifications at
`eval/mermaid-upstream-suite-bench/upstream-f3dea583/` solely to verify the
26/69-block provenance inventory offline.

- Source: <https://github.com/mermaid-js/mermaid/tree/f3dea58385fd5c7dd1f4e9c9c1876751ae6943cc>
- Copyright: © 2014–2022 Knut Sveidqvist
- License: **MIT**
- Repository license copy: `eval/mermaid-upstream-suite-bench/upstream-f3dea583/LICENSE.mermaid.txt` (the upstream specs are verification-only and excluded from the npm package)

## Pinned Mermaid configuration compatibility program

`src/shared/pinned-mermaid-config/runtime.js` contains the pure configuration,
merge, appearance, theme and color programs from Mermaid 12.2.0 source
`1fb7869866dd619168d840291c9c54b4f129758b`, Khroma 2.1.0 and es-toolkit 1.53.0.
It has no diagram parser, renderer or DOM implementation. Regenerate it with
`scripts/build/generate-mermaid-config-runtime.ts` and the policy reference.

- Mermaid: MIT, copyright 2014–2022 Knut Sveidqvist; `LICENSES/Mermaid-MIT.txt`.
- Khroma: MIT, copyright 2019-present Fabio Spampinato, Andrew Maney; `LICENSES/Khroma-MIT.txt`.
- es-toolkit: MIT, copyright 2024 Viva Republica, Inc.; `LICENSES/es-toolkit-MIT.txt`.

## Optional ZenUML browser backend

`dist/zenuml-frame.global.js` bundles **@zenuml/core 3.47.9** and its
transitive browser dependencies. It is loaded only by the explicit asynchronous
`agentic-mermaid/zenuml` API in a disposable iframe. The default SVG, agent,
terminal and browser entries do not import it.

- Source: <https://github.com/mermaid-js/zenuml-core>
- License: **MIT**, reproduced in `LICENSES/zenuml-core-MIT.txt`.
- Dependency notices are retained in the separately built browser script.

The development-only Mermaid ZenUML addon 1.0.1 is the configured positive
control; the product backend calls the same core native SVG API directly.
Event Modeling tests and syntax investigation use the pinned Mermaid reference
identified above. Its layout, text measurement and drawing implementation are
Agentic Mermaid's.

## Standalone editor payload decoder

The standalone HTML uses a bounded, build-only projection of `brotli` 1.3.3
(<https://github.com/devongovett/brotli.js/tree/e36051345f6d27a56e5f39ea70d2f789b8574046>).
Package metadata and README declare MIT and name Devon Govett; the published
package and pinned tree contain no LICENSE/COPYING/NOTICE file. Standard MIT
terms are reproduced in `LICENSES/Brotli-MIT.txt` without inventing a copyright
year. Actual decoder files retain **Copyright 2013 Google Inc. All Rights
Reserved.** and Apache License 2.0 headers; full terms are in
`LICENSES/Apache-2.0.txt`. The build adds loop, output-allocation and window
limits; it does not change the compressed format or expose a decoder API.

The emitted HTML also includes the full MIT notice of `base64-js` 1.5.1 and
Pako 1.0.11's MIT license and Zlib CRC header (Jean-loup Gailly, Mark Adler,
Vitaly Puzrin and Andrey Tupitsin). Decoder notices stay outside the opaque
worker payload. These dependencies do not enter the public Node/Scene API.

## D3 named connector interpolation

The shared named-curve projection uses **d3-shape 1.3.7**. Its installed
dependency closure includes **d3-path 1.0.9**. Both licenses are reproduced.

- d3-shape: <https://github.com/d3/d3-shape/tree/v1.3.7>; BSD-3-Clause, copyright 2010–2015 Mike Bostock; `LICENSES/d3-shape-BSD-3-Clause.txt`.
- d3-path: <https://github.com/d3/d3-path/tree/v1.0.9>; BSD-3-Clause, copyright 2015–2016 Mike Bostock; `LICENSES/d3-path-BSD-3-Clause.txt`.

The exact installed license terms are reproduced in the listed files and
included in the npm package.
