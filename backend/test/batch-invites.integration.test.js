require("../server");
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const teacherEmails = [`qig-invite-teacher-${suffix}@example.com`, `qig-invite-reviewer-${suffix}@example.com`];
const studentEmails = [`qig-invite-student-a-${suffix}@example.com`, `qig-invite-student-b-${suffix}@example.com`];
const batchName = `QIG Invite Batch ${suffix}`;
let apiServer;
let apiBase;
let userIds = [];
let batchId;

function tokenFor(id) {
    return jwt.sign({ sub: String(id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

async function request(path, token, method = "GET", body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${apiBase}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

test("batch invite requests require student auth and teacher decisions are transactional", async () => {
    assert.equal(process.env.NODE_ENV, "test", "integration tests must run in test mode");
    assert.match(process.env.TEST_DB_NAME || "quiz_integrity_guard_test", /(^|[_-])test($|[_-])/i);
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32);

    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const passwordHash = await bcrypt.hash("BatchInviteTest42!", 12);
        const inserted = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Invite Teacher', $1, $2, 'teacher'), ('Invite Reviewer', $3, $2, 'teacher'),
                    ('Invite Student A', $4, $2, 'student'), ('Invite Student B', $5, $2, 'student')
             RETURNING id, email`,
            [teacherEmails[0], passwordHash, teacherEmails[1], studentEmails[0], studentEmails[1]]
        );
        const ids = Object.fromEntries(inserted.rows.map(row => [row.email, row.id]));
        userIds = Object.values(ids);
        const teacherToken = tokenFor(ids[teacherEmails[0]]);
        const reviewerToken = tokenFor(ids[teacherEmails[1]]);
        const studentAToken = tokenFor(ids[studentEmails[0]]);
        const studentBToken = tokenFor(ids[studentEmails[1]]);

        const createdBatch = await request("/api/batches", teacherToken, "POST", { name: batchName });
        assert.equal(createdBatch.status, 201);
        batchId = (await createdBatch.json()).batch.id;
        assert.equal((await request(`/api/batches/${batchId}/invite`, null, "POST")).status, 401);
        assert.equal((await request(`/api/batches/${batchId}/invite`, studentAToken, "POST")).status, 403);
        assert.equal((await request("/api/batches/join-requests", teacherToken, "POST", { code: "a".repeat(64) })).status, 403);
        assert.equal((await request("/api/batches/join-requests", null, "POST", { code: "a".repeat(64) })).status, 401);

        const firstResponse = await request(`/api/batches/${batchId}/invite`, teacherToken, "POST");
        assert.equal(firstResponse.status, 201);
        const firstCode = (await firstResponse.json()).invite.code;
        assert.match(firstCode, /^[a-f0-9]{64}$/);
        const firstStored = await pool.query("SELECT token_hash FROM batch_invites WHERE batch_id = $1", [batchId]);
        assert.equal(firstStored.rows[0].token_hash, crypto.createHash("sha256").update(firstCode).digest("hex"));
        assert.notEqual(firstStored.rows[0].token_hash, firstCode);

        const replacement = await request(`/api/batches/${batchId}/invite`, reviewerToken, "POST");
        assert.equal(replacement.status, 201);
        const code = (await replacement.json()).invite.code;
        assert.notEqual(code, firstCode);
        assert.equal((await request("/api/batches/join-requests", studentBToken, "POST", { code: firstCode })).status, 404);
        assert.equal((await request("/api/batches/join-requests", studentAToken, "POST", { code: "invalid" })).status, 400);
        assert.equal((await request("/api/batches/join-requests", studentAToken, "POST", { code: "b".repeat(64) })).status, 404);

        const concurrentRequests = await Promise.all([
            request("/api/batches/join-requests", studentAToken, "POST", { code }),
            request("/api/batches/join-requests", studentAToken, "POST", { code })
        ]);
        assert.deepEqual(concurrentRequests.map(response => response.status).sort(), [201, 409]);
        const studentARequest = (await concurrentRequests.find(response => response.status === 201).json()).request;

        const studentBResponse = await request("/api/batches/join-requests", studentBToken, "POST", { code });
        assert.equal(studentBResponse.status, 201);
        const studentBRequest = (await studentBResponse.json()).request;
        assert.equal((await request("/api/batches/join-requests", studentAToken, "POST", { code })).status, 409);
        assert.equal((await request(`/api/batches/${batchId}/join-requests`, studentAToken)).status, 403);
        const pendingResponse = await request(`/api/batches/${batchId}/join-requests`, teacherToken);
        assert.equal(pendingResponse.status, 200);
        assert.equal((await pendingResponse.json()).requests.length, 2);
        assert.equal((await request(`/api/batches/${batchId}/join-requests?status=nope`, teacherToken)).status, 400);
        const ownRequestsResponse = await request("/api/batches/my-join-requests", studentAToken);
        assert.equal((await ownRequestsResponse.json()).requests[0].status, "pending");

        const rejected = await request(`/api/batches/${batchId}/join-requests/${studentARequest.id}/decision`, teacherToken, "POST", { decision: "rejected" });
        assert.equal(rejected.status, 200);
        assert.equal((await rejected.json()).request.status, "rejected");
        assert.equal((await request(`/api/batches/${batchId}/join-requests/${studentARequest.id}/decision`, reviewerToken, "POST", { decision: "approved" })).status, 409);
        const membershipBefore = await pool.query("SELECT COUNT(*)::int AS total FROM batch_students WHERE batch_id=$1 AND student_id=$2", [batchId, ids[studentEmails[0]]]);
        assert.equal(membershipBefore.rows[0].total, 0);

        const resubmitted = await request("/api/batches/join-requests", studentAToken, "POST", { code });
        assert.equal(resubmitted.status, 201);
        const resubmittedRequest = (await resubmitted.json()).request;
        assert.equal(resubmittedRequest.status, "pending");
        const directAdd = await request(`/api/batches/${batchId}/students`, reviewerToken, "POST", { student_id: ids[studentEmails[0]] });
        assert.equal(directAdd.status, 201);
        assert.equal((await request(`/api/batches/${batchId}/join-requests/${resubmittedRequest.id}/decision`, teacherToken, "POST", { decision: "rejected" })).status, 409);
        const studentAHistory = await request("/api/batches/my-join-requests", studentAToken);
        assert.equal((await studentAHistory.json()).requests[0].status, "approved");

        const concurrentApprovals = await Promise.all([
            request(`/api/batches/${batchId}/join-requests/${studentBRequest.id}/decision`, teacherToken, "POST", { decision: "approved" }),
            request(`/api/batches/${batchId}/join-requests/${studentBRequest.id}/decision`, reviewerToken, "POST", { decision: "approved" })
        ]);
        assert.deepEqual(concurrentApprovals.map(response => response.status).sort(), [200, 409]);
        const approved = await concurrentApprovals.find(response => response.status === 200).json();
        assert.equal(approved.request.status, "approved");
        assert.equal(approved.membership_added, true);
        const membershipAfter = await pool.query("SELECT COUNT(*)::int AS total FROM batch_students WHERE batch_id=$1 AND student_id=$2", [batchId, ids[studentEmails[1]]]);
        assert.equal(membershipAfter.rows[0].total, 1);
        const pendingAfter = await request(`/api/batches/${batchId}/join-requests`, teacherToken);
        assert.equal((await pendingAfter.json()).requests.length, 0);

        assert.equal((await request(`/api/batches/${batchId}/invite`, teacherToken, "DELETE")).status, 200);
        assert.equal((await request("/api/batches/join-requests", studentAToken, "POST", { code })).status, 404);
        assert.equal((await request(`/api/batches/${batchId}/invite`, teacherToken, "DELETE")).status, 404);

        const expiringResponse = await request(`/api/batches/${batchId}/invite`, teacherToken, "POST");
        const expiringCode = (await expiringResponse.json()).invite.code;
        await pool.query("UPDATE batch_invites SET expires_at = NOW() - INTERVAL '1 minute' WHERE batch_id = $1 AND revoked_at IS NULL", [batchId]);
        assert.equal((await request("/api/batches/join-requests", studentAToken, "POST", { code: expiringCode })).status, 404);

        const batchListResponse = await request("/api/batches", teacherToken);
        const listedBatch = (await batchListResponse.json()).batches.find(item => item.id === batchId);
        assert.equal(listedBatch.pending_count, 0);
        assert.equal(listedBatch.membership_count, 2);
    } finally {
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (batchId) await pool.query("DELETE FROM batches WHERE id = $1", [batchId]);
        if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [userIds]);
        await pool.end();
    }
});
