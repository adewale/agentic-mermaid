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
`1fb7869866dd619168d840291c9c54b4f129758b`, Khroma 2.1.0 and lodash-es 4.18.1.
It has no diagram parser, renderer or DOM implementation. Regenerate it with
`scripts/build/generate-mermaid-config-runtime.ts` and the policy reference.

- Mermaid: MIT, copyright 2014–2022 Knut Sveidqvist; `LICENSES/Mermaid-MIT.txt`.
- Khroma: MIT, copyright 2019-present Fabio Spampinato, Andrew Maney; `LICENSES/Khroma-MIT.txt`.
- lodash-es: MIT, copyright JS Foundation and other contributors; `LICENSES/lodash-MIT.txt`.

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
