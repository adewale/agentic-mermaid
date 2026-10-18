# Third-party notices

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
