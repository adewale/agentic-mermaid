# Batch a repository

Use JSONL batch checks when an agent needs to verify many diagrams and report warnings without stopping at the first failure.

```bash
find docs -name "*.mmd" | am batch --jsonl
```

Local-first rule: use the package, CLI, or self-hosted MCP. This website is not a REST render API and does not run hosted Code Mode `execute(code)`.
