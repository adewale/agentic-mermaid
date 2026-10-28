import { startEditor } from './app.js';
import { initialize as initializeRuntimeRecovery } from './runtime-recovery.js';

// The document generator emits these catalogs immediately before this bundle.
startEditor({ EDITOR_EXAMPLES, SUPPORTED_FAMILY_LIST, EDITOR_PRESET_FONTS }, initializeRuntimeRecovery);
