/**
 * Pure helpers exposed for host tests and tooling. Not part of the stable
 * semver surface: they may change in any release.
 */

export { captureNow, normalizeLabel, escapeMarkdownLabel, taskPrefix, sanitizeContext } from './capture';
export { parseDocument, countTasks, toggleTask, isInsideFence, isHttpUrl, MAX_RENDER_CHARS } from './markdown';
export { planOpenInsertion, planCloseRemoval, lineBoundsAt } from './insertion';
export { resolveAdapter, storageKey, parseEnvelope, serializeEnvelope, createMemoryStorage } from './storage';
export { utf8Bytes, contentHash } from './util';
