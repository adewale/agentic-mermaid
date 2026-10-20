use wasm_bindgen::prelude::*;

/// A browser-callable adapter around Bezel's unmodified public renderer.
#[wasm_bindgen]
pub fn render(source: &str) -> Result<String, JsValue> {
    mermaid::render(source, &mermaid::Options::default(), &mermaid::Metrics)
        .map(|drawing| drawing.svg)
        .map_err(|error| JsValue::from_str(&error.to_string()))
}
