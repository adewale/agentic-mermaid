import type { RenderOptions } from './types.ts'
import type { AsciiRenderOptions, RenderedAscii } from './ascii/index.ts'
import type { BrowserPngRasterContext, RenderedBrowserPng } from './browser-png.ts'
import type { PortablePngOutputOptions } from './png-contract.ts'
import type { RenderRequestReceipt } from './render-contract.ts'
import type { VerifyResult } from './agent/types.ts'
import type { ApplyOpsInput, OpEnvelope } from './agent/apply.ts'

export interface PreviewArtifact {
  svg: string
  receipt: RenderRequestReceipt
  verification: Pick<VerifyResult, 'ok' | 'warnings' | 'checks'>
  computeMs: number
}
export type EditorWorkerOperation =
  | { operation: 'preview'; source: string; options: RenderOptions }
  | { operation: 'ascii' | 'unicode'; source: string; options: AsciiRenderOptions }
  | { operation: 'png'; source: string; options: RenderOptions; output: number | PortablePngOutputOptions }
  | { operation: 'mutate'; source: string; options: RenderOptions; ops: unknown; mode?: ApplyOpsInput['mode'] }
export type PreviewWorkerRequest = { id: number } & EditorWorkerOperation
export type EditorWorkerArtifact = PreviewArtifact | RenderedAscii | RenderedBrowserPng | { mutation: OpEnvelope }
export type PreviewWorkerResponse =
  | { id: number; ok: true; artifact: EditorWorkerArtifact }
  | { id: number; ok: false; error: string; dependencyLoadFailed?: true }
  | { id: number; kind: 'rasterize'; svg: string; context: BrowserPngRasterContext }
export type EditorRasterResponse =
  | { id: number; kind: 'rasterized'; ok: true; png: Uint8Array }
  | { id: number; kind: 'rasterized'; ok: false; error: string }
