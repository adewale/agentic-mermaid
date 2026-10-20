//go:build ignore

// Native worker for peer-bench.ts. Compile with a temporary module replacing
// tuios.dev/sketch with the pinned checkout; never time an RPC or process spawn.
package main

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"tuios.dev/sketch"
	sketchtext "tuios.dev/sketch/text"
)

type timing struct {
	WarmCalls, Samples               int
	WarmupMs, MinSampleMs, MaxCaseMs float64
}
type workload struct {
	ID, Source string
	Expected   []string
}
type job struct {
	Output    string
	Timing    timing
	Workloads []workload
}

var sink string

func render(source, output string) (value string, err error) {
	defer func() {
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v", p)
		}
	}()
	if output == "svg" {
		svg, err := sketch.Render(source, sketch.RenderOptions{})
		return svg.Data, err
	}
	d, err := sketch.Parse(source, sketch.ParseOptions{})
	if err != nil {
		return "", err
	}
	lines, err := sketchtext.Draw(d, sketchtext.Options{})
	return strings.Join(lines, "\n"), err
}

func missingLabels(output, rendered string, expected []string) []string {
	seen := map[string]bool{}
	if output == "svg" {
		decoder := xml.NewDecoder(strings.NewReader(rendered))
		var runs []string
		for {
			token, err := decoder.Token()
			if err != nil {
				break
			}
			switch token := token.(type) {
			case xml.StartElement:
				if token.Name.Local == "text" || token.Name.Local == "tspan" {
					runs = append(runs, "")
				}
			case xml.CharData:
				for i := range runs {
					runs[i] += string(token)
				}
			case xml.EndElement:
				if (token.Name.Local == "text" || token.Name.Local == "tspan") && len(runs) > 0 {
					seen[strings.Join(strings.Fields(runs[len(runs)-1]), " ")] = true
					runs = runs[:len(runs)-1]
				}
			}
		}
	}
	var missing []string
	for _, label := range expected {
		found := seen[label]
		if output != "svg" {
			pattern := regexp.MustCompile(`(^|[^\p{L}\p{N}_])` + regexp.QuoteMeta(label) + `($|[^\p{L}\p{N}_])`)
			found = pattern.MatchString(rendered)
		}
		if !found {
			missing = append(missing, label)
		}
	}
	return missing
}

func elapsed(start time.Time) float64 { return float64(time.Since(start)) / float64(time.Millisecond) }
func median(values []float64) float64 {
	copy := append([]float64(nil), values...)
	sort.Float64s(copy)
	i := len(copy) / 2
	if len(copy)%2 == 0 {
		return (copy[i-1] + copy[i]) / 2
	}
	return copy[i]
}

func measure(w workload, j job) map[string]any {
	result := map[string]any{"type": "result", "workload": w.ID, "status": "error"}
	start := time.Now()
	first, err := render(w.Source, j.Output)
	if err != nil {
		result["detail"] = err.Error()
		unsupported := err == sketchtext.ErrUnsupported
		if e, ok := err.(*sketch.Error); ok && e.Code == sketch.CodeUnsupported {
			unsupported = true
		}
		if unsupported {
			result["status"] = "unsupported"
		}
		return result
	}
	result["firstMs"] = elapsed(start)
	result["outputBytes"] = len(first)
	if strings.TrimSpace(first) == "" {
		result["detail"] = "returned no output"
		return result
	}
	if missing := missingLabels(j.Output, first, w.Expected); len(missing) > 0 {
		result["status"], result["missing"] = "lost-labels", len(missing)
		result["detail"] = strings.Join(missing[:min(3, len(missing))], ", ")
		return result
	}
	timed := func(calls int) (float64, error) {
		start := time.Now()
		for range calls {
			sink, err = render(w.Source, j.Output)
			if err != nil {
				return 0, err
			}
		}
		return elapsed(start), nil
	}
	caseStart := time.Now()
	warmCalls, warmMs := 0, 0.0
	for warmCalls < j.Timing.WarmCalls || warmMs < j.Timing.WarmupMs {
		ms, err := timed(1)
		if err != nil {
			result["detail"] = err.Error()
			return result
		}
		warmCalls++
		warmMs += ms
		if warmMs >= j.Timing.MaxCaseMs/4 {
			break
		}
	}
	perCall := warmMs / float64(warmCalls)
	iterations := max(1, int(math.Ceil(j.Timing.MinSampleMs/math.Max(perCall, 1e-6))))
	affordable := int(math.Floor((j.Timing.MaxCaseMs - elapsed(caseStart)) / math.Max(perCall*float64(iterations), 1e-6)))
	count := max(3, min(j.Timing.Samples, affordable))
	var samples []float64
	for range count {
		ms, err := timed(iterations)
		if err != nil {
			result["detail"] = err.Error()
			return result
		}
		samples = append(samples, ms/float64(iterations))
		if len(samples) >= 3 && elapsed(caseStart) > j.Timing.MaxCaseMs {
			break
		}
	}
	mid := median(samples)
	var deviations []float64
	for _, value := range samples {
		deviations = append(deviations, math.Abs(value-mid))
	}
	result["status"], result["warmCalls"], result["iterations"] = "ok", warmCalls, iterations
	result["samplesMs"], result["medianMs"], result["madMs"] = samples, mid, median(deviations)
	return result
}

func main() {
	input, err := os.Open(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer input.Close()
	var j job
	if err := json.NewDecoder(input).Decode(&j); err != nil {
		panic(err)
	}
	out, err := os.OpenFile(os.Args[2], os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		panic(err)
	}
	defer out.Close()
	emit := func(line map[string]any) {
		if err := json.NewEncoder(out).Encode(line); err != nil {
			panic(err)
		}
	}
	// Static initialization is complete before main; not a dynamic import time.
	emit(map[string]any{"type": "import", "importMs": 0, "setupMs": 0})
	for _, w := range j.Workloads {
		emit(map[string]any{"type": "start", "workload": w.ID})
		emit(measure(w, j))
	}
	end := map[string]any{"type": "end"}
	if file, err := os.Open("/proc/self/statm"); err == nil {
		data, _ := io.ReadAll(file)
		file.Close()
		fields := strings.FieldsFunc(string(data), unicode.IsSpace)
		if len(fields) > 1 {
			if pages, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
				end["rssBytes"] = pages * int64(os.Getpagesize())
			}
		}
	}
	emit(end)
}
