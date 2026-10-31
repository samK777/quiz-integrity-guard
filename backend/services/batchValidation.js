const MAX_INT32 = 2147483647;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePathId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;
    const id = Number(rawId);
    return Number.isSafeInteger(id) && id <= MAX_INT32 ? id : null;
}

function normalizeBatchName(name) {
    if (typeof name !== "string") return null;
    const normalized = name.trim();
    return normalized.length >= 1 && normalized.length <= 120 ? normalized : null;
}

function parseStudentIdentifier(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return null;
    const hasId = Object.prototype.hasOwnProperty.call(body, "student_id");
    const hasEmail = Object.prototype.hasOwnProperty.call(body, "email");
    if (hasId === hasEmail) return null;

    if (hasId) {
        const id = body.student_id;
        return Number.isInteger(id) && id > 0 && id <= MAX_INT32 ? { kind: "id", value: id } : null;
    }

    if (typeof body.email !== "string" || body.email.trim().length > 150 || !emailPattern.test(body.email.trim())) return null;
    return { kind: "email", value: body.email.trim().toLowerCase() };
}

module.exports = { parsePathId, normalizeBatchName, parseStudentIdentifier };
