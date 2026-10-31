const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeBatchName, parsePathId, parseStudentIdentifier } = require("../services/batchValidation");
const { parseInviteCode, hashInviteCode } = require("../services/batchInvite");

test("batch names are trimmed and bounded", () => {
    assert.equal(normalizeBatchName("  CCE Semester 5  "), "CCE Semester 5");
    assert.equal(normalizeBatchName("   "), null);
    assert.equal(normalizeBatchName("x".repeat(121)), null);
    assert.equal(normalizeBatchName(5), null);
});

test("batch and student path IDs reject malformed and overflowing values", () => {
    assert.equal(parsePathId("1"), 1);
    assert.equal(parsePathId("2147483647"), 2147483647);
    for (const value of ["0", "-1", "1.2", "abc", "2147483648", "01", 1, null]) {
        assert.equal(parsePathId(value), null, `expected ${String(value)} to be rejected`);
    }
});

test("student identifier accepts one valid ID or normalized email", () => {
    assert.deepEqual(parseStudentIdentifier({ student_id: 42 }), { kind: "id", value: 42 });
    assert.deepEqual(parseStudentIdentifier({ email: " Student@Example.COM " }), { kind: "email", value: "student@example.com" });
    for (const body of [null, [], {}, { student_id: "42" }, { student_id: 0 }, { email: "bad" }, { email: "a".repeat(146) + "@b.com" }, { email: "a@b.com", student_id: 42 }]) {
        assert.equal(parseStudentIdentifier(body), null, `expected ${JSON.stringify(body)} to be rejected`);
    }
});

test("batch invite codes have a strict token shape and are stored as hashes", () => {
    const code = "a".repeat(64);
    assert.equal(parseInviteCode(code), code);
    assert.equal(parseInviteCode(code.toUpperCase()), code);
    assert.equal(parseInviteCode("a".repeat(63)), null);
    assert.equal(parseInviteCode("x".repeat(64)), null);
    assert.equal(parseInviteCode(42), null);
    assert.notEqual(hashInviteCode(code), code);
    assert.match(hashInviteCode(code), /^[a-f0-9]{64}$/);
});

test("teacher batch portal provides create, membership, loading, and removal UI states", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const portalHtml = fs.readFileSync(path.join(__dirname, "../../portal/index.html"), "utf8");
    const portalJs = fs.readFileSync(path.join(__dirname, "../../portal/app.js"), "utf8");
    const styles = fs.readFileSync(path.join(__dirname, "../../portal/styles.css"), "utf8");
    for (const id of ["createBatchForm", "batchList", "addBatchStudentForm", "batchStudentList", "closeBatchDetail", "createBatchInvite", "revokeBatchInvite", "batchInviteOutput", "batchJoinRequests", "studentBatchJoinForm", "studentBatchRequests"]) {
        assert.match(portalHtml, new RegExp(`id="${id}"`));
    }
    assert.match(portalHtml, /href="#teacherBatches">Batches/);
    assert.match(portalJs, /backendRequest\('\/api\/batches'/);
    assert.match(portalJs, /data-view-batch/);
    assert.match(portalJs, /data-remove-batch-student/);
    assert.ok(portalJs.includes("'/api/batches/join-requests'"));
    assert.ok(portalJs.includes("data-batch-request-decision"));
    assert.ok(portalHtml.includes("Create invite link"));
    assert.match(portalJs, /Loading batches/);
    assert.match(portalJs, /Could not add student:/);
    assert.match(styles, /\.batch-card/);
    assert.match(styles, /\.batch-add-form/);
});
