These two synchronous programs are built from Mermaid 12.2.0 source
`1fb7869866dd619168d840291c9c54b4f129758b`, Khroma 2.1.0 and es-toolkit 1.53.0.
They contain no Mermaid parser, renderer, DOM or Node runtime dependency.

`merge.js` owns directive argument tokens, init-layer sanitization, nonclobbering
bounded assignment, legacy diagram scoping, wrap processing and frontmatter
merge. Raw directive names, argument presence and occurrence count survive until
the pinned phase consumes them. `directive-types.ts` contains the selectors
extracted from those same pinned functions for lightweight source ownership. Its directive lexer, detectInit and processDirectives are copied from
trusted pinned TypeScript initializers rather than approximated by hand. The
argument constructor checks complete token consumption and argument type; it
preserves negative zero and shields source-global preprocessing. Native normalization uses that
program, retaining authored strings that Mermaid neutralizes. Invalid consumed
config remains readable for repair; its fallback is not canonical admission.

`runtime.js` also executes the actual scoped/global appearance and theme color
calculations. It validates clones and discards derived colors. Each call creates
fresh module state and defaults. The generated loop counter stops after 100000
executed loop bodies; this is a validation work limit, not a claim that Mermaid
rejects the source. Both normal return and failure discard the entire instance.

Generate with the repository Bun version after `bun run reference:mermaid`:

```
bun scripts/build/generate-mermaid-config-runtime.ts
```

The generator checks source/dependency revisions, captures actual default values
(including undefined keys and JavaScript font accessors), removes logging, bundles
only this dependency closure and instruments loops in the trusted emitted AST.
The generated files are committed because production imports them. MIT notices
are in `LICENSES/Mermaid-MIT.txt`, `LICENSES/Khroma-MIT.txt` and
`LICENSES/es-toolkit-MIT.txt`. Correctness tests exercise public config reads/exports
against the independent pinned runtime rather than comparing generated files.
