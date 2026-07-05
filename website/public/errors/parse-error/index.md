# Parse error

> The source could not be parsed. Preserve the source and point to the line/column when available.

## How to recover

The source is not valid Mermaid for any known family, so it never became a diagram. Preserve the original text and surface the parser’s line/column; fix the offending line, or return the failure untouched rather than guessing a rewrite that changes intent.

## Related

Often pairs with [UNSUPPORTED_SYNTAX](/warnings/UNSUPPORTED_SYNTAX/) when syntax parses in mermaid.js but not the structured model.

```
am verify diagram.mmd --json
```

Full page: https://agentic-mermaid.dev/errors/parse-error/
