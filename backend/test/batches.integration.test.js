require("../server");
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const teacherEmails = [`qig-batch-teacher-${suffix}@example.com`, `qig-batch-other-teacher-${suffix}@example.com`];
const studentEmail = `qig-batch-student-${suffix}@example.com`;
const batchName = `QIG Batch ${suffix}`;
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

test("batch API enforces teacher access and manages student membership transactionally", async () => {
    assert.equal(process.env.NODE_ENV, "test", "integration tests must run in test mode");
    assert.match(process.env.TEST_DB_NAME || "quiz_integrity_guard_test", /(^|[_-])test($|[_-])/i);
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");

    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, "127.0.0.1", () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const hash = await bcrypt.hash("BatchTestPass42!", 12);
        const inserted = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Batch Teacher', $1, $2, 'teacher'), ('Other Batch Teacher', $3, $2, 'teacher'), ('Batch Student', $4, $2, 'student')
             RETURNING id, email`,
            [teacherEmails[0], hash, teacherEmails[1], studentEmail]
        );
        const ids = Object.fromEntries(inserted.rows.map(row => [row.email, row.id]));
        userIds = Object.values(ids);
        const teacherToken = tokenFor(ids[teacherEmails[0]]);
        const otherTeacherToken = tokenFor(ids[teacherEmails[1]]);
        const studentToken = tokenFor(ids[studentEmail]);

        assert.equal((await request("/api/batches", null, "POST", { name: batchName })).status, 401);
        assert.equal((await request("/api/batches", studentToken, "POST", { name: batchName })).status, 403);
        assert.equal((await request("/api/batches", studentToken)).status, 403);
        assert.equal((await request("/api/batches", teacherToken, "POST", { name: "   " })).status, 400);

        const created = await request("/api/batches", teacherToken, "POST", { name: `  ${batchName}  ` });
        assert.equal(created.status, 201);
        const createdBody = await created.json();
        batchId = createdBody.batch.id;
        assert.equal(createdBody.batch.name, batchName);
        assert.equal(createdBody.batch.membership_count, 0);
        assert.equal((await request("/api/batches", otherTeacherToken, "POST", { name: batchName.toUpperCase() })).status, 409);

        const list = await request("/api/batches", otherTeacherToken);
        assert.equal(list.status, 200);
        assert.ok((await list.json()).batches.some(batch => String(batch.id) === String(batchId)));
        assert.equal((await request("/api/batches/not-an-id/students", teacherToken)).status, 400);
        assert.equal((await request("/api/batches/2147483648/students", teacherToken)).status, 400);
        assert.equal((await request("/api/batches/2147483647/students", teacherToken)).status, 404);

        const empty = await request(`/api/batches/${batchId}/students`, otherTeacherToken);
        assert.equal(empty.status, 200);
        assert.equal((await empty.json()).students.length, 0);

        const invalidIdentifier = await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { student_id: "bad" });
        assert.equal(invalidIdentifier.status, 400);
        assert.equal((await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { student_id: ids[studentEmail], email: studentEmail })).status, 400);
        assert.equal((await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { email: "missing@example.com" })).status, 404);
        assert.equal((await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { student_id: ids[teacherEmails[1]] })).status, 422);
        assert.equal((await request(`/api/batches/2147483647/students`, teacherToken, "POST", { email: studentEmail })).status, 404);

        const concurrentAdds = await Promise.all([
            request(`/api/batches/${batchId}/students`, teacherToken, "POST", { email: studentEmail.toUpperCase() }),
            request(`/api/batches/${batchId}/students`, otherTeacherToken, "POST", { student_id: ids[studentEmail] })
        ]);
        assert.deepEqual(concurrentAdds.map(response => response.status).sort(), [201, 409]);
        const addedByEmail = concurrentAdds.find(response => response.status === 201);
        assert.equal(addedByEmail.headers.get("content-type").includes("application/json"), true);
        assert.equal((await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { student_id: ids[studentEmail] })).status, 409);

        const members = await request(`/api/batches/${batchId}/students`, otherTeacherToken);
        const memberBody = await members.json();
        assert.equal(memberBody.batch.membership_count, 1);
        assert.equal(memberBody.students[0].email, studentEmail);
        assert.equal((await request("/api/batches", teacherToken).then(response => response.json())).batches.find(batch => batch.id === batchId).membership_count, 1);

        assert.equal((await request(`/api/batches/${batchId}/students/${ids[teacherEmails[1]]}`, teacherToken, "DELETE")).status, 404);
        const removed = await request(`/api/batches/${batchId}/students/${ids[studentEmail]}`, teacherToken, "DELETE");
        assert.equal(removed.status, 200);
        assert.equal((await removed.json()).removed, true);
        assert.equal((await request(`/api/batches/${batchId}/students/${ids[studentEmail]}`, teacherToken, "DELETE")).status, 404);

        // Inject a test-only database failure after request validation and verify the transaction leaves no membership.
        await pool.query(`CREATE OR REPLACE FUNCTION public.qig_test_reject_batch_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'simulated batch insert failure'; END; $$`);
        await pool.query(`CREATE TRIGGER qig_test_reject_batch_member BEFORE INSERT ON batch_students FOR EACH ROW EXECUTE FUNCTION public.qig_test_reject_batch_member()`);
        try {
            const failedInsert = await request(`/api/batches/${batchId}/students`, teacherToken, "POST", { student_id: ids[studentEmail] });
            assert.equal(failedInsert.status, 500);
            const count = await pool.query("SELECT COUNT(*)::int AS total FROM batch_students WHERE batch_id = $1 AND student_id = $2", [batchId, ids[studentEmail]]);
            assert.equal(count.rows[0].total, 0);
        } finally {
            await pool.query("DROP TRIGGER IF EXISTS qig_test_reject_batch_member ON batch_students");
            await pool.query("DROP FUNCTION IF EXISTS public.qig_test_reject_batch_member()");
        }
    } finally {
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (batchId) await pool.query("DELETE FROM batches WHERE id = $1", [batchId]);
        if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [userIds]);
        await pool.end();
    }
});
