import { R as RenderRequestReceipt } from './paint-certification-D4KXvaqY.js';
export { P as PaintLayoutCertificationError, v as verifyNoExternalRefs } from './paint-certification-D4KXvaqY.js';
import { R as RenderOptions } from './types-CNsEXVPT.js';
import './svg-styles-24_BFqX1.js';

interface RenderedSvg {
    readonly svg: string;
    readonly receipt: RenderRequestReceipt;
}
declare function renderMermaidSVGWithReceipt(source: string, options?: RenderOptions): RenderedSvg;
declare function renderMermaidSVG(source: string, options?: RenderOptions): string;

export { RenderOptions, RenderRequestReceipt, type RenderedSvg, renderMermaidSVG, renderMermaidSVGWithReceipt };
