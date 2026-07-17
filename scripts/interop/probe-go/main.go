// Official Go MCP SDK probe against both agentic-mermaid servers.
// Run from this directory (see the plan doc's multi-client section):
//
//	bun run ../serve-hosted.ts   # note the printed URL
//	go run . <hosted-url>
//
// Probes the hosted Streamable HTTP endpoint and the local stdio bin with the
// reference Go client (default configuration, standalone SSE stream enabled),
// printing one PASS/FAIL line per check and exiting nonzero on any failure.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var serverSupported = []string{"2024-11-05", "2025-03-26", "2025-06-18"}
var failures int

func check(label string, ok bool, detail string) {
	status := "PASS"
	if !ok {
		status = "FAIL"
		failures++
	}
	if detail != "" {
		fmt.Printf("%s %s — %s\n", status, label, detail)
	} else {
		fmt.Printf("%s %s\n", status, label)
	}
}

func textOf(result *mcp.CallToolResult) string {
	for _, content := range result.Content {
		if text, ok := content.(*mcp.TextContent); ok {
			return text.Text
		}
	}
	return ""
}

func sortedNames(result *mcp.ListToolsResult) []string {
	names := []string{}
	for _, tool := range result.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return names
}

func probeHosted(ctx context.Context, url string) {
	client := mcp.NewClient(&mcp.Implementation{Name: "agentic-mermaid-interop-go", Version: "0.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: url}, nil)
	check("hosted: connect (default config, standalone SSE enabled)", err == nil, fmt.Sprint(err))
	if err != nil {
		return
	}
	defer session.Close()

	init := session.InitializeResult()
	check("hosted: negotiated version is server-supported", slices.Contains(serverSupported, init.ProtocolVersion), init.ProtocolVersion)
	check("hosted: server identity", init.ServerInfo.Name == "agentic-mermaid-hosted", init.ServerInfo.Name)
	check("hosted: sessionless (no session id issued)", session.ID() == "", session.ID())

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		check("hosted: tools/list", false, err.Error())
		return
	}
	names := sortedNames(tools)
	check("hosted: 9-tool surface", len(names) == 9, strings.Join(names, ","))

	rendered, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "render_svg", Arguments: map[string]any{"source": "flowchart LR\n  A --> B"}})
	if err != nil {
		check("hosted: render_svg round-trip", false, err.Error())
		return
	}
	check("hosted: render_svg round-trip", strings.Contains(textOf(rendered), "<svg"), fmt.Sprintf("%d bytes", len(textOf(rendered))))
}

func probeStdio(ctx context.Context) {
	repoRoot, err := filepath.Abs("../../..")
	if err != nil {
		check("stdio: resolve repo root", false, err.Error())
		return
	}
	command := exec.Command("bun", "run", "src/mcp/mcp-bin.ts")
	command.Dir = repoRoot
	client := mcp.NewClient(&mcp.Implementation{Name: "agentic-mermaid-interop-go", Version: "0.0.0"}, nil)
	session, err := client.Connect(ctx, &mcp.CommandTransport{Command: command}, nil)
	check("stdio: connect (spawns the bin)", err == nil, fmt.Sprint(err))
	if err != nil {
		return
	}
	defer session.Close()

	init := session.InitializeResult()
	check("stdio: negotiates the pinned 2024-11-05", init.ProtocolVersion == "2024-11-05", init.ProtocolVersion)

	tools, err := session.ListTools(ctx, nil)
	if err != nil {
		check("stdio: tools/list", false, err.Error())
		return
	}
	names := sortedNames(tools)
	check("stdio: 4-tool surface", len(names) == 4, strings.Join(names, ","))

	executed, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "execute", Arguments: map[string]any{"code": "return 1 + 41"}})
	if err != nil {
		check("stdio: real sandbox execute", false, err.Error())
		return
	}
	var payload struct {
		Value any `json:"value"`
	}
	text := textOf(executed)
	jsonErr := json.Unmarshal([]byte(text), &payload)
	check("stdio: real sandbox execute", jsonErr == nil && fmt.Sprint(payload.Value) == "42", text)
}

func main() {
	if len(os.Args) < 2 {
		fmt.Println("usage: go run . <hosted-mcp-url>")
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	probeHosted(ctx, os.Args[1])
	probeStdio(ctx)
	if failures > 0 {
		os.Exit(1)
	}
}
