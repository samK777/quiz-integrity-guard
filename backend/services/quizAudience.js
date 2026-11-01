"use strict";

// Pure input-validation helpers for quiz audience-mode features.
// No I/O — fully unit-testable in isolation.

const MAX_INT32 = 2147483647;
const VALID_MODES = new Set(["global", "batch"]);
const MAX_BATCH_IDS = 50;

/**
 * Validates an audience_mode value.
 * Returns the value unchanged if valid, or null if invalid.
 * @param {unknown} value
 * @returns {'global'|'batch'|null}
 */
function validateAudienceMode(value) {
    if (typeof value !== "string") return null;
    return VALID_MODES.has(value) ? value : null;
}

/**
 * Validates and deduplicates a list of batch IDs.
 * Accepts a non-empty array of 1–50 positive 32-bit integers.
 * Returns the deduplicated sorted array, or null on any validation error.
 * @param {unknown} raw
 * @returns {number[]|null}
 */
function parseBatchIdList(raw) {
    if (!Array.isArray(raw)) return null;
    if (raw.length === 0 || raw.length > MAX_BATCH_IDS) return null;
    const seen = new Set();
    for (const item of raw) {
        if (!Number.isInteger(item) || item < 1 || item > MAX_INT32) return null;
        seen.add(item);
    }
    return [...seen].sort((a, b) => a - b);
}

/**
 * Validates an invitation ID from a URL path parameter.
 * Returns the parsed positive integer or null.
 * @param {unknown} rawId
 * @returns {number|null}
 */
function parseInvitationId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;
    const id = Number(rawId);
    return Number.isSafeInteger(id) && id <= MAX_INT32 ? id : null;
}

module.exports = { validateAudienceMode, parseBatchIdList, parseInvitationId };
