import { R as RenderOptions } from './types-CNsEXVPT.js';
import { S as StyleInput } from './svg-styles-24_BFqX1.js';

/** Optional browser-only backend. No ZenUML dependency enters the default graph. */
declare class ZenUMLBackendError extends Error {
    readonly code: 'UNSUPPORTED_RUNTIME' | 'BACKEND_UNAVAILABLE' | 'INVALID_SOURCE' | 'RENDER_FAILED' | 'UNSUPPORTED_APPEARANCE';
    constructor(code: 'UNSUPPORTED_RUNTIME' | 'BACKEND_UNAVAILABLE' | 'INVALID_SOURCE' | 'RENDER_FAILED' | 'UNSUPPORTED_APPEARANCE', message: string);
}
declare const UPSTREAM_ZENUML_CAPABILITIES: Readonly<{
    maturity: "experimental";
    sourcePreservation: true;
    nativeParse: false;
    typedEditing: false;
    rendering: "optional-browser-iframe";
    asynchronous: true;
    terminal: false;
    node: false;
    cli: false;
    mcp: false;
    backend: "@zenuml/core@3.47.9";
    nativeScene: false;
    styles: false;
    palettes: true;
    rolePaints: true;
    reusableSession: true;
}>;
interface UpstreamZenUMLRenderOptions {
    timeoutMs?: number;
    /** Named palettes or paint-only node/edge/group/label fragments. Native Look
     * geometry, fonts and sketch effects are rejected, never silently ignored. */
    style?: StyleInput | StyleInput[];
}
interface UpstreamZenUMLOptions extends UpstreamZenUMLRenderOptions {
    /** URL of the shipped zenuml-frame.global.js, served by the consumer. */
    backendURL: string | URL;
}
interface UpstreamZenUMLRenderer {
    /** Requests are serialized; at most 32 calls may be pending per session. */
    render(source: string, options?: UpstreamZenUMLRenderOptions): Promise<string>;
    /** Release the isolated backend and reject active and queued requests. */
    dispose(): void;
}
/** An explicitly owned session retains one isolated backend. Every render
 * still parses and lays out its input; no source/SVG result cache is used. */
declare function createUpstreamZenUMLRenderer(options: UpstreamZenUMLOptions): UpstreamZenUMLRenderer;
/** One-shot rendering shares the session implementation and always releases
 * its frame. Use createUpstreamZenUMLRenderer for repeated previews, then dispose it. */
declare function renderUpstreamZenUMLSVG(source: string, options: UpstreamZenUMLOptions): Promise<string>;

declare const ZENUML_CAPABILITIES: Readonly<{
    maturity: "experimental";
    sourcePreservation: true;
    nativeParse: true;
    typedEditing: true;
    rendering: "native-scene";
    asynchronous: true;
    terminal: true;
    node: true;
    cli: true;
    mcp: true;
    backend: "native-sequence-scene";
    nativeScene: true;
    styles: true;
    palettes: true;
    rolePaints: true;
    reusableSession: true;
}>;
interface ZenUMLRenderOptions extends RenderOptions {
    /** Deadline for asynchronous dependency loading. Synchronous layout cannot
     * be interrupted while the JavaScript event loop is executing it. */
    timeoutMs?: number;
}
type ZenUMLOptions = ZenUMLRenderOptions;
interface ZenUMLRenderer {
    render(source: string, options?: ZenUMLRenderOptions): Promise<string>;
    dispose(): void;
}
/** Native Zen sessions serialize rendering and retain no source/SVG results.
 * Named defaults resolve at each request's synchronous admission boundary. */
declare function createZenUMLRenderer(options?: ZenUMLOptions): ZenUMLRenderer;
declare function renderZenUMLSVG(source: string, options?: ZenUMLOptions): Promise<string>;

export { UPSTREAM_ZENUML_CAPABILITIES, type UpstreamZenUMLOptions, type UpstreamZenUMLRenderOptions, type UpstreamZenUMLRenderer, ZENUML_CAPABILITIES, ZenUMLBackendError, type ZenUMLOptions, type ZenUMLRenderOptions, type ZenUMLRenderer, createUpstreamZenUMLRenderer, createZenUMLRenderer, renderUpstreamZenUMLSVG, renderZenUMLSVG };
