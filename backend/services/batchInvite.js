const crypto = require("node:crypto");

function parseInviteCode(value) {
    if (typeof value !== "string") return null;
    const code = value.trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(code) ? code : null;
}

function hashInviteCode(code) {
    return crypto.createHash("sha256").update(code, "utf8").digest("hex");
}

function createInviteCode() {
    return crypto.randomBytes(32).toString("hex");
}

module.exports = { parseInviteCode, hashInviteCode, createInviteCode };
