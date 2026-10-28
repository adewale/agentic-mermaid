import { startEditor } from './app.js';

// Standalone worker recovery is automatic; hosted reload controls are absent.
startEditor({ EDITOR_EXAMPLES, SUPPORTED_FAMILY_LIST, EDITOR_PRESET_FONTS });
