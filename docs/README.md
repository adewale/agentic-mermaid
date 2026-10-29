# Agentic Mermaid documentation

Start with [Getting started](getting-started.md) to render a diagram. For an
agent editing an existing diagram, use the
[operating guide](../Instructions_for_agents.md), then the
[editing cookbook](agent-api-cookbook.md).

## Choose a task

| Task | Guide |
| --- | --- |
| Render SVG, PNG or terminal text | [Getting started](getting-started.md) |
| Choose a diagram type | [Family examples](diagram-families.md) · [Choosing a diagram](choosing-a-diagram.md) |
| Edit a diagram through the API | [Editing cookbook](agent-api-cookbook.md) |
| Connect an MCP client | [MCP setup and transports](mcp-http-transport.md) |
| Render in a browser or React app | [Browser](browser.md) · [React](react.md) |
| Set colors, typography or drawing style | [Theming](theming.md) · [Style authoring](style-authoring.md) · [Visual cookbook](custom-style-cookbook.md) |
| Supply fonts | [Custom fonts](custom-fonts.md) |
| Use ASCII or Unicode | [Terminal output](ascii.md) |
| Configure Mermaid frontmatter or directives | [Configuration](config.md) |
| Understand a warning or failed render | [Quality](quality.md) · [Warning reference](https://agentic-mermaid.dev/warnings/) · [Error reference](https://agentic-mermaid.dev/errors/) |

## API and behavior

- [API reference](api.md): functions, options, results and shared vocabulary.
- [Editing limits](agent-mutation-policy.md): typed and source-preserving edits.
- [Agent architecture](../AGENT_NATIVE.md): preservation, determinism and verification.
- [Security](../SECURITY.md): strict output, offline rendering and server boundaries.
- [Features](features.md) and [fork differences](fork-differences.md).
- [Comparison](comparison.md): dated measurements and differences from other tools.
- [Skills](../skills/): instructions for diagram authoring and editor work.

Run `am capabilities --json` for the families and operations in your installed
version. Use `am styles` to discover its styles. These commands are the current
inventories; dated reports describe only the revisions they measured.

## Contribute

Repository-only documentation uses GitHub links so this index also works from
an installed npm package.

| Work | Start here |
| --- | --- |
| Understand the renderer | [System architecture](https://github.com/adewale/agentic-mermaid/blob/main/docs/design/system/README.md) |
| Work on one diagram family | [Family implementation notes](https://github.com/adewale/agentic-mermaid/blob/main/docs/design/families/README.md) |
| Add a family | [Adding diagram types](https://github.com/adewale/agentic-mermaid/blob/main/docs/contributing/adding-diagram-types.md) |
| Change layout or rendering | [Route contracts](https://github.com/adewale/agentic-mermaid/blob/main/docs/design/system/route-contracts.md) · [Visual review](https://github.com/adewale/agentic-mermaid/blob/main/docs/contributing/visual-review-evidence.md) |
| Select validation | [Testing strategy](testing-strategy.md) |
| Update documentation | [Doc consistency](https://github.com/adewale/agentic-mermaid/blob/main/docs/contributing/doc-consistency.md) |
| Prepare a release | [Release procedure](https://github.com/adewale/agentic-mermaid/blob/main/docs/contributing/releasing.md) |

## Project records

[TODO.md](https://github.com/adewale/agentic-mermaid/blob/main/TODO.md) is the
active backlog. The [project index](https://github.com/adewale/agentic-mermaid/blob/main/docs/project/README.md)
separates current plans from completed and superseded work. Historical research
and benchmark receipts are context for those decisions, not additional release gates.

See the [changelog](../CHANGELOG.md) for release notes and
[Trident results](https://github.com/adewale/trident/blob/main/RESULTS.md) for
performance measurements and their scope.
