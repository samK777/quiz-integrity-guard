require("../server"); // Loads local .env before the database and JWT modules are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const server = app.server;
const io = app.io;
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const studentEmail = `qig-realtime-student-${suffix}@example.com`;
const teacherEmail = `qig-realtime-teacher-${suffix}@example.com`;
const quizTitle = `QIG Realtime ${suffix}`;
let port;
let socket;
let userIds = [];
let quizIds = [];

async function request(path, token, method = "GET", body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

function tokenFor(id) {
    return jwt.sign({ sub: String(id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

function connectSocket(token) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Socket.IO connection timed out")), 5000);
        ws.addEventListener("message", event => {
            const packet = String(event.data);
            if (packet.startsWith("0")) {
                const auth = token ? { token } : {};
                ws.send(`40${JSON.stringify(auth)}`);
            } else if (packet.startsWith("40{")) {
                clearTimeout(timeout);
                resolve(ws);
            } else if (packet.startsWith("44")) {
                clearTimeout(timeout);
                ws.close();
                reject(new Error(packet));
            }
        });
        ws.addEventListener("error", event => {
            clearTimeout(timeout);
            reject(new Error(`WebSocket error: ${event.message || "connection failed"}`));
        });
    });
}

function waitForEvent(ws, eventName) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            ws.removeEventListener("message", onMessage);
            reject(new Error(`Timed out waiting for ${eventName}`));
        }, 3000);
        function onMessage(event) {
            const packet = String(event.data);
            if (!packet.startsWith("42")) return;
            const [name, payload] = JSON.parse(packet.slice(2));
            if (name !== eventName) return;
            clearTimeout(timeout);
            ws.removeEventListener("message", onMessage);
            resolve(payload);
        }
        ws.addEventListener("message", onMessage);
    });
}

test("Socket.IO authenticates teachers and broadcasts committed events", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");
    await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, resolve);
    });
    port = server.address().port;

    try {
        const hash = await bcrypt.hash("RealtimeTestPass42!", 12);
        const users = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Realtime Student', $1, $2, 'student'), ('Realtime Teacher', $3, $2, 'teacher')
             RETURNING id, email`,
            [studentEmail, hash, teacherEmail]
        );
        const ids = Object.fromEntries(users.rows.map(row => [row.email, row.id]));
        userIds = Object.values(ids);
        const studentToken = tokenFor(ids[studentEmail]);
        const teacherToken = tokenFor(ids[teacherEmail]);

        await assert.rejects(connectSocket(null), /44/);
        await assert.rejects(connectSocket("invalid-token"), /44/);
        await assert.rejects(connectSocket(studentToken), /44/);
        socket = await connectSocket(teacherToken);
        const shortLivedSocket = await connectSocket(jwt.sign(
            { sub: String(ids[teacherEmail]) }, process.env.JWT_SECRET, { expiresIn: "1s" }
        ));
        const disconnectedOnExpiry = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Socket remained connected after its JWT expired")), 3000);
            shortLivedSocket.addEventListener("close", () => { clearTimeout(timeout); resolve(); }, { once: true });
        });
        await disconnectedOnExpiry;

        const quiz = await pool.query(
            "INSERT INTO quizzes (title, duration_minutes, is_active) VALUES ($1, 15, TRUE) RETURNING id",
            [quizTitle]
        );
        const quizId = quiz.rows[0].id;
        quizIds.push(quizId);
        await pool.query(
            `INSERT INTO questions (quiz_id, question_text, options, correct_answer, question_order)
             VALUES ($1, 'Question one', '["A", "B"]'::jsonb, 1, 1),
                    ($1, 'Question two', '["A", "B"]'::jsonb, 1, 2),
                    ($1, 'Question three', '["A", "B"]'::jsonb, 1, 3)`,
            [quizId]
        );

        const startEvent = waitForEvent(socket, "attempt:started");
        const started = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const attemptId = (await started.json()).attempt.id;
        const startedPayload = await startEvent;
        assert.equal(startedPayload.id, attemptId);
        assert.equal(startedPayload.status, "in_progress");
        assert.equal(startedPayload.quiz_title, quizTitle);
        const violationEvent = waitForEvent(socket, "violation:created");
        const report = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "tab_switch", question_number: 1, message: "Switched tab"
        });
        assert.equal(report.status, 201);
        const payload = await violationEvent;
        assert.equal(payload.violation.type, "tab_switch");
        assert.equal(payload.attempt.id, attemptId);
        assert.equal(payload.student.email, studentEmail);
        const persisted = await pool.query("SELECT COUNT(*)::int AS total FROM violations WHERE attempt_id = $1", [attemptId]);
        assert.equal(persisted.rows[0].total, 1);

        const normalStartEvent = waitForEvent(socket, "attempt:started");
        const normalStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const normalAttemptId = (await normalStart.json()).attempt.id;
        assert.equal((await normalStartEvent).id, normalAttemptId);
        const completionEvent = waitForEvent(socket, "attempt:completed");
        const normalSubmit = await request(`/api/attempts/${normalAttemptId}/submit`, studentToken, "POST", {});
        assert.equal(normalSubmit.status, 200);
        const completionPayload = await completionEvent;
        assert.equal(completionPayload.id, normalAttemptId);
        assert.equal(completionPayload.status, "completed");
        assert.equal(completionPayload.reason, "student_submitted");

        await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", { type: "copy_attempt", question_number: 1 });
        const violationAtThreshold = waitForEvent(socket, "violation:created");
        const autoSubmitEvent = waitForEvent(socket, "attempt:auto_submitted");
        const finalReport = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", { type: "fullscreen_exit", question_number: 2 });
        assert.equal(finalReport.status, 201);
        const [lastViolation, autoSubmitted] = await Promise.all([violationAtThreshold, autoSubmitEvent]);
        assert.equal(lastViolation.attempt.status, "auto_submitted");
        assert.equal(autoSubmitted.id, attemptId);
        assert.equal(autoSubmitted.reason, "violation_threshold");
        assert.equal(autoSubmitted.violation_count, 3);
        assert.equal(autoSubmitted.status, "auto_submitted");

        const timedStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const timedAttemptId = (await timedStart.json()).attempt.id;
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [timedAttemptId]);
        const timeoutEvent = waitForEvent(socket, "attempt:auto_submitted");
        const timedSubmit = await request(`/api/attempts/${timedAttemptId}/submit`, studentToken, "POST", {});
        assert.equal(timedSubmit.status, 200);
        const timedPayload = await timeoutEvent;
        assert.equal(timedPayload.id, timedAttemptId);
        assert.equal(timedPayload.reason, "time_limit");

        const expiredAnswerStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const expiredAnswerId = (await expiredAnswerStart.json()).attempt.id;
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [expiredAnswerId]);
        const answerTimeoutEvent = waitForEvent(socket, "attempt:auto_submitted");
        const lateAnswer = await request(`/api/attempts/${expiredAnswerId}/answers/1`, studentToken, "PUT", { selected_option: 0 });
        assert.equal(lateAnswer.status, 409);
        assert.equal((await answerTimeoutEvent).id, expiredAnswerId);

        const expiredEditStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const expiredEditId = (await expiredEditStart.json()).attempt.id;
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [expiredEditId]);
        const editTimeoutEvent = waitForEvent(socket, "attempt:auto_submitted");
        const addQuestionAfterExpiry = await request(`/api/quizzes/${quizId}/questions`, teacherToken, "POST", {
            question_text: "Created after timeout", options: ["A", "B"], correct_answer: 0
        });
        assert.equal(addQuestionAfterExpiry.status, 201);
        const editedTimeout = await editTimeoutEvent;
        assert.equal(editedTimeout.id, expiredEditId);
        assert.equal(editedTimeout.reason, "time_limit");
    } finally {
        if (socket) socket.close();
        await new Promise(resolve => io.close(resolve));
        if (userIds.length) {
            await pool.query("DELETE FROM attempts WHERE user_id = ANY($1::integer[]) OR quiz_id = ANY($2::integer[])", [userIds, quizIds]);
        }
        if (quizIds.length) await pool.query("DELETE FROM quizzes WHERE id = ANY($1::integer[])", [quizIds]);
        if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [userIds]);
        await pool.end();
    }
});
