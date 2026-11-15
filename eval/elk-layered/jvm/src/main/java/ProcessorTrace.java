import java.nio.file.Files;
import java.nio.file.Path;
import java.io.UncheckedIOException;
import org.eclipse.elk.alg.layered.ElkLayered;
import org.eclipse.elk.alg.layered.JsonDebugUtil;
import org.eclipse.elk.alg.layered.graph.LGraph;
import org.eclipse.elk.alg.layered.graph.transform.ElkGraphTransformer;
import org.eclipse.elk.alg.layered.options.LayeredOptions;
import org.eclipse.elk.core.alg.ILayoutProcessor;
import org.eclipse.elk.core.data.LayoutMetaDataService;
import org.eclipse.elk.core.options.HierarchyHandling;
import org.eclipse.elk.core.testing.TestController;
import org.eclipse.elk.core.util.BasicProgressMonitor;
import org.eclipse.elk.graph.json.ElkGraphJson;

/** A manual divergence debugger, not an output oracle or a CI check. */
public final class ProcessorTrace {
    public static void main(String[] args) throws Exception {
        if (args.length != 2) {
            throw new IllegalArgumentException("ProcessorTrace <ELK-input.json> <output-directory>");
        }
        Path output = Path.of(args[1]);
        Files.createDirectories(output);
        LayoutMetaDataService.getInstance();
        LGraph graph = new ElkGraphTransformer().importGraph(
            ElkGraphJson.forGraph(Files.readString(Path.of(args[0]))).toElk());
        Files.writeString(output.resolve("import.json"), JsonDebugUtil.createDebugGraph(graph));
        ElkLayered layered = new ElkLayered();
        if (graph.getProperty(LayeredOptions.HIERARCHY_HANDLING) == HierarchyHandling.INCLUDE_CHILDREN) {
            // The step API is flat-only. Trace the upstream compound pipeline
            // through its processor callbacks instead of flattening the input.
            TestController controller = new TestController("org.eclipse.elk.layered");
            controller.addLayoutExecutionListener(new TestController.ILayoutExecutionListener() {
                private int step;

                @Override
                public void layoutProcessorReady(ILayoutProcessor<?> processor, Object currentGraph, boolean root) {
                    try {
                        Files.writeString(output.resolve("current-processor.txt"), processor.getClass().getName());
                    } catch (java.io.IOException exception) {
                        throw new UncheckedIOException(exception);
                    }
                }

                @Override
                public void layoutProcessorFinished(ILayoutProcessor<?> processor, Object currentGraph, boolean root) {
                    try {
                        Files.writeString(output.resolve(String.format("%03d-%s.json", step++, processor.getClass().getName())),
                            JsonDebugUtil.createDebugGraph((LGraph) currentGraph));
                    } catch (java.io.IOException exception) {
                        throw new UncheckedIOException(exception);
                    }
                }
            });
            layered.setTestController(controller);
            layered.doCompoundLayout(graph, new BasicProgressMonitor());
            return;
        }
        ElkLayered.TestExecutionState state = layered.prepareLayoutTest(graph);
        dump(state, output, "prepared");
        while (!layered.isLayoutTestFinished(state)) {
            String processor = layered.getLayoutTestConfiguration(state).get(state.getStep()).getClass().getName();
            String step = String.format("%03d-%s", state.getStep(), processor);
            // Written before execution so an exception identifies its processor.
            Files.writeString(output.resolve("current-processor.txt"), processor);
            layered.runLayoutTestStep(state);
            dump(state, output, step);
        }
    }

    private static void dump(ElkLayered.TestExecutionState state, Path output, String step) throws Exception {
        for (int component = 0; component < state.getGraphs().size(); component++) {
            Files.writeString(output.resolve(step + "-component-" + component + ".json"),
                JsonDebugUtil.createDebugGraph(state.getGraphs().get(component)));
        }
    }
}
