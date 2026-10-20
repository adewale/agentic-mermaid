// Shared diagnostic state stays with backend execution evidence across lazy
// families; retain this internal import path for observers and stage timers.
export { withRenderStageObserver, measureRenderStage, type RenderStage, type RenderStageSample } from './layout/backend.ts'
