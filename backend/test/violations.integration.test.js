require("../server"); // Loads local .env before the database and JWT modules are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const studentEmail = `qig-violation-student-${suffix}@example.com`;
const otherEmail = `qig-violation-other-${suffix}@example.com`;
const teacherEmail = `qig-violation-teacher-${suffix}@example.com`;
const quizTitle = `QIG Violation ${suffix}`;
let apiServer;
let apiBase;
let userIds = [];
let quizIds = [];

async function request(path, token, method = "GET", body) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(`${apiBase}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
}

function tokenFor(id) {
    return jwt.sign({ sub: String(id) }, process.env.JWT_SECRET, { expiresIn: "10m" });
}

test("violation reporting enforces ownership and three-strike submission", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");
    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const hash = await bcrypt.hash("ViolationTestPass42!", 12);
        const users = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Violation Student', $1, $2, 'student'),
                    ('Other Violation Student', $3, $2, 'student'),
                    ('Violation Teacher', $4, $2, 'teacher')
             RETURNING id, email`,
            [studentEmail, hash, otherEmail, teacherEmail]
        );
        const ids = Object.fromEntries(users.rows.map(row => [row.email, row.id]));
        userIds = Object.values(ids);
        const studentToken = tokenFor(ids[studentEmail]);
        const otherToken = tokenFor(ids[otherEmail]);
        const teacherToken = tokenFor(ids[teacherEmail]);

        const quiz = await pool.query(
            "INSERT INTO quizzes (title, duration_minutes, is_active) VALUES ($1, 15, TRUE) RETURNING id",
            [quizTitle]
        );
        const quizId = quiz.rows[0].id;
        quizIds.push(quizId);
        const questions = await pool.query(
            `INSERT INTO questions (quiz_id, question_text, options, correct_answer, question_order)
             VALUES ($1, 'Q1', '["A", "B"]'::jsonb, 1, 1),
                    ($1, 'Q2', '["A", "B"]'::jsonb, 1, 2),
                    ($1, 'Q3', '["A", "B"]'::jsonb, 1, 3),
                    ($1, 'Q4', '["A", "B"]'::jsonb, 1, 4)
             RETURNING id, question_order`,
            [quizId]
        );
        const questionOne = questions.rows.find(row => row.question_order === 1).id;
        const started = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        assert.equal(started.status, 201);
        const attemptId = (await started.json()).attempt.id;
        assert.equal((await request(`/api/attempts/${attemptId}/violations`, null)).status, 401);
        assert.equal((await request(`/api/attempts/${attemptId}/violations`, otherToken)).status, 404);
        assert.equal((await request(`/api/attempts/${attemptId}/violations`, teacherToken)).status, 200);
        assert.equal((await request(`/api/attempts/${attemptId}/violations`, teacherToken, "POST", {
            type: "tab_switch", question_number: 1
        })).status, 403);

        await request(`/api/attempts/${attemptId}/answers/${questionOne}`, studentToken, "PUT", { selected_option: 1 });
        assert.equal((await request(`/api/attempts/nope/violations`, studentToken, "POST", {})).status, 400);
        const invalidType = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "made_up_event", question_number: 1
        });
        assert.equal(invalidType.status, 400);
        const invalidQuestion = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "tab_switch", question_number: 5
        });
        assert.equal(invalidQuestion.status, 400);
        const oversizedMessage = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "tab_switch", question_number: 1, message: "x".repeat(501)
        });
        assert.equal(oversizedMessage.status, 400);

        const one = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "screenshot_attempt", message: "Screenshot shortcut received by the extension"
        });
        assert.equal(one.status, 201);
        const oneBody = await one.json();
        assert.equal(oneBody.violation.type, "screenshot_attempt");
        assert.equal(oneBody.violation.question_number, null);
        assert.equal(oneBody.attempt.violation_count, 1);
        assert.equal(oneBody.auto_submitted, false);

        const two = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "copy_attempt", question_number: 2
        });
        assert.equal(two.status, 201);
        assert.equal((await two.json()).attempt.violation_count, 2);

        const three = await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "fullscreen_exit", question_number: 2
        });
        assert.equal(three.status, 201);
        const threeBody = await three.json();
        assert.equal(threeBody.auto_submitted, true);
        assert.equal(threeBody.attempt.status, "auto_submitted");
        assert.equal(threeBody.attempt.is_auto_submitted, true);
        assert.equal(threeBody.attempt.violation_count, 3);
        assert.equal(threeBody.result.score, 1);
        assert.equal(threeBody.result.total_questions, 4);
        assert.equal(threeBody.result.percentage, 25);
        assert.equal((await request(`/api/attempts/${attemptId}/violations`, studentToken, "POST", {
            type: "tab_switch", question_number: 1
        })).status, 409);

        const studentList = await request(`/api/attempts/${attemptId}/violations`, studentToken);
        const teacherList = await request(`/api/attempts/${attemptId}/violations`, teacherToken);
        assert.equal((await studentList.json()).violations.length, 3);
        assert.equal((await teacherList.json()).violations.length, 3);

        const expiredStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const expiredId = (await expiredStart.json()).attempt.id;
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [expiredId]);
        const afterTime = await request(`/api/attempts/${expiredId}/violations`, studentToken, "POST", {
            type: "window_blur", question_number: 1
        });
        assert.equal(afterTime.status, 409);
        const expiredStatus = await pool.query("SELECT status, violation_count FROM attempts WHERE id = $1", [expiredId]);
        assert.equal(expiredStatus.rows[0].status, "auto_submitted");
        assert.equal(expiredStatus.rows[0].violation_count, 0);
    } finally {
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        if (userIds.length) {
            await pool.query("DELETE FROM attempts WHERE user_id = ANY($1::integer[]) OR quiz_id = ANY($2::integer[])", [userIds, quizIds]);
        }
        if (quizIds.length) await pool.query("DELETE FROM quizzes WHERE id = ANY($1::integer[])", [quizIds]);
        if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::integer[])", [userIds]);
        await pool.end();
    }
});
