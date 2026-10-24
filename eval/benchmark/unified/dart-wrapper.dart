// Compile with dart compile js -O2 -o dart.js dart-wrapper.dart from a package
// depending on the exact mermaid_core version being measured. Keep the SDK,
// dependency resolution and compiler flags alongside the benchmark evidence.
import 'dart:js_interop';
import 'package:mermaid_core/mermaid_core.dart';

@JS('globalThis.mermaidDartRender')
external set mermaidDartRender(JSFunction render);

void main() {
  const engine = Mermaid(measurer: ApproximateTextMeasurer());
  mermaidDartRender = ((JSString source) =>
      renderSceneToSvg(engine.render(source.toDart)).toJS).toJS;
}
