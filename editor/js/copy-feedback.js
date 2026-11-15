import '../../shared/browser/copy-feedback.js';

// The same clipboard feedback implementation also serves classic site scripts.
export const setCopyFeedback = globalThis.setCopyFeedback;
