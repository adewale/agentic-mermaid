# Third-party notices

## ELK Layered TypeScript translation

Files under `src/elk-layered/org/eclipse/elk/` translate Eclipse ELK tag
`v0.11.0`, revision `54123e884b1ae743b453260f713b20c9bf5787f2`.
They retain their upstream class and method names and EPL-2.0 notices.

The idiomatic TypeScript implementation under `src/elk-layered/kernel/`
ports algorithms from the same revision, with the published elkjs `0.11.1`
GWT output defining JavaScript numeric and ordering behavior. Its GWT merge
sorting and Guava fuzzy comparisons retain the original Google/Guava
Apache-2.0 notices alongside EPL-2.0 attribution.

- Source: <https://github.com/eclipse/elk/tree/54123e884b1ae743b453260f713b20c9bf5787f2>
- Copyright: Kiel University and other contributors, as identified in each file.
- License: **EPL-2.0**, reproduced in `LICENSES/ELK-EPL-2.0.md`.

Java compatibility operations under `src/elk-layered/java/` reproduce the
numeric and collection operations needed by that translation. List, hash-map and
enum-set iteration and decimal parsing adapt GWT 2.11.0, the compiler runtime
used by elkjs 0.11.1. Original GWT portions retain Apache-2.0 notices alongside
the translation's EPL-2.0 notice; Apache-2.0 is reproduced in
`LICENSES/Apache-2.0.txt`.

- Source: <https://github.com/gwtproject/gwt/tree/2.11.0/user/super/com/google/gwt/emul/java>
- Copyright: Google Inc. and other contributors, as identified upstream.

The JavaScript-host JSON adapter translates elkjs `0.11.1`, revision
`572e73323791d05f09b0815ff639af2b67f202ab`,
`src/java-additional/org/eclipse/elk/graph/json/JsonAdapter.xtend`.
It retains its EPL-2.0 notice and the same adapter operations as the ELK source.

EMF compatibility classes under `src/elk-layered/org/eclipse/emf/` translate
the EMF-GWT `2.12.4` platform used by that elkjs build, published as
`com.genmymodel.emf.gwt:emf-common:2.12.4` and
`com.genmymodel.emf.gwt:emf-ecore:2.12.4`. Original IBM Corporation, Ed Merks
and other contributor notices are retained. The translations use EPL-2.0
under the original EPL-1.0 section 7 subsequent-version option; the license
is reproduced in `LICENSES/ELK-EPL-2.0.md`.

Guava compatibility classes under `src/elk-layered/com/google/common/` translate
Guava `31.1-jre`, the Guava-GWT version used by that elkjs build. Original
Guava Authors Apache-2.0 notices are retained alongside the translation's
EPL-2.0 notice. Apache-2.0 is reproduced in `LICENSES/Apache-2.0.txt`.

- Source: <https://repo.maven.apache.org/maven2/com/google/guava/guava-gwt/31.1-jre/guava-gwt-31.1-jre-sources.jar>
- Copyright: The Guava Authors, as identified in each file.

## Pele parser and fishbone layout adaptations

The native Block and Requirement parsers and Ishikawa layout adapt browserless
implementations from Pele, with Agentic Mermaid's typed bodies, editing,
measurement, Scene, styling and output contracts applied locally.

- Source: <https://github.com/kepano/pele/tree/8603bf3313add9143cd417015d4a6bd6c522dada>
- Copyright: © 2026 kepano
- License: **MIT**, reproduced in [`LICENSES/pele-MIT.txt`](LICENSES/pele-MIT.txt).

The native UseCase, Wardley, Cynefin, Railroad and Venn grammar readers also
adapt Pele revision `3a2f075ee0c3d914f0fad3545fc0f193693975ac` under the same
MIT license. Shared grammar tokenization and Venn circle geometry are adapted
from that revision. Each adapted source file names its provenance; native
models, checked edits, prepared text and Scene output use local contracts.

- Source: <https://github.com/kepano/pele/tree/3a2f075ee0c3d914f0fad3545fc0f193693975ac>

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
