require("../server"); // Loads local .env before the database and JWT modules are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const studentEmail = `qig-attempt-student-${suffix}@example.com`;
const otherStudentEmail = `qig-attempt-other-${suffix}@example.com`;
const teacherEmail = `qig-attempt-teacher-${suffix}@example.com`;
const quizTitle = `QIG Attempt ${suffix}`;
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

test("attempt lifecycle saves answers and scores securely", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");
    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const hash = await bcrypt.hash("AttemptTestPass42!", 12);
        const users = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Attempt Student', $1, $2, 'student'),
                    ('Other Attempt Student', $3, $2, 'student'),
                    ('Attempt Teacher', $4, $2, 'teacher')
             RETURNING id, email`,
            [studentEmail, hash, otherStudentEmail, teacherEmail]
        );
        const ids = Object.fromEntries(users.rows.map(row => [row.email, row.id]));
        userIds = Object.values(ids);
        const studentToken = tokenFor(ids[studentEmail]);
        const otherStudentToken = tokenFor(ids[otherStudentEmail]);
        const teacherToken = tokenFor(ids[teacherEmail]);

        const activeQuiz = await pool.query(
            "INSERT INTO quizzes (title, description, duration_minutes, is_active) VALUES ($1, 'Attempt test', 15, TRUE) RETURNING id",
            [quizTitle]
        );
        const quizId = activeQuiz.rows[0].id;
        quizIds.push(quizId);
        const inactiveQuiz = await pool.query(
            "INSERT INTO quizzes (title, duration_minutes, is_active) VALUES ($1, 15, FALSE) RETURNING id",
            [`${quizTitle} inactive`]
        );
        quizIds.push(inactiveQuiz.rows[0].id);
        const questions = await pool.query(
            `INSERT INTO questions (quiz_id, question_text, options, correct_answer, question_order)
             VALUES ($1, '2 + 2?', '["3", "4", "5"]'::jsonb, 1, 1),
                    ($1, 'Capital of France?', '["Rome", "Paris", "Berlin"]'::jsonb, 1, 2)
             RETURNING id, question_order`,
            [quizId]
        );
        const questionOne = questions.rows.find(question => question.question_order === 1).id;
        const questionTwo = questions.rows.find(question => question.question_order === 2).id;

        assert.equal((await request("/api/attempts", null, "POST", { quiz_id: quizId })).status, 401);
        assert.equal((await request("/api/attempts", teacherToken, "POST", { quiz_id: quizId })).status, 403);
        assert.equal((await request("/api/attempts", studentToken, "POST", { quiz_id: "bad" })).status, 400);
        assert.equal((await request("/api/attempts", studentToken, "POST", { quiz_id: inactiveQuiz.rows[0].id })).status, 404);

        const start = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        assert.equal(start.status, 201);
        const started = await start.json();
        const attemptId = started.attempt.id;
        assert.equal((await request("/api/attempts/monitoring", studentToken)).status, 403);
        const monitoring = await request("/api/attempts/monitoring", teacherToken);
        assert.equal(monitoring.status, 200);
        const monitoringBody = await monitoring.json();
        assert.ok(monitoringBody.attempts.some(attempt => String(attempt.id) === String(attemptId)));
        assert.ok(Number.isInteger(monitoringBody.summary.total_students));
        assert.ok(Number.isInteger(monitoringBody.summary.active_quizzes));
        assert.ok(Number.isInteger(monitoringBody.summary.live_attempts));
        assert.ok(Array.isArray(monitoringBody.analytics.attempts_by_status));
        assert.ok(Array.isArray(monitoringBody.analytics.violations_by_type));
        assert.ok(Array.isArray(monitoringBody.analytics.score_distribution));
        const studentMonitoringDetail = await request(`/api/attempts/monitoring/${attemptId}`, studentToken);
        assert.equal(studentMonitoringDetail.status, 403);
        const liveTeacherDetail = await request(`/api/attempts/monitoring/${attemptId}`, teacherToken);
        assert.equal(liveTeacherDetail.status, 200);
        const liveTeacherBody = await liveTeacherDetail.json();
        assert.equal(liveTeacherBody.attempt.student_email, studentEmail);
        assert.equal(liveTeacherBody.answers[0].correct_answer, null);
        assert.equal(started.attempt.status, "in_progress");
        assert.equal(started.attempt.attempt_number, 1);
        assert.equal(started.questions.length, 2);
        assert.equal(JSON.stringify(started).includes("correct_answer"), false);

        const saved = await request(`/api/attempts/${attemptId}/answers/${questionOne}`, studentToken, "PUT", { selected_option: 1 });
        assert.equal(saved.status, 200);
        assert.equal((await saved.json()).answer.selected_option, 1);
        assert.equal((await request(`/api/attempts/${attemptId}/answers/${questionOne}`, studentToken, "PUT", { selected_option: 8 })).status, 400);
        assert.equal((await request(`/api/attempts/${attemptId}/answers/0`, studentToken, "PUT", { selected_option: 1 })).status, 400);
        assert.equal((await request(`/api/attempts/${attemptId}/answers/${questionTwo}`, otherStudentToken, "PUT", { selected_option: 1 })).status, 404);

        // Adding questions is paused while attempts are active so the scoring total stays stable.
        const blockedQuestionAdd = await request(`/api/quizzes/${quizId}/questions`, teacherToken, "POST", {
            question_text: "Concurrent change?", options: ["No", "Yes"], correct_answer: 0
        });
        assert.equal(blockedQuestionAdd.status, 409);

        assert.equal((await request(`/api/attempts/${attemptId}`, otherStudentToken)).status, 404);
        const details = await request(`/api/attempts/${attemptId}`, studentToken);
        assert.equal(details.status, 200);
        const detailBody = await details.json();
        assert.equal(detailBody.questions[0].selected_option, 1);
        assert.equal(JSON.stringify(detailBody).includes("correct_answer"), false);

        const submitted = await request(`/api/attempts/${attemptId}/submit`, studentToken, "POST", { score: 999, percentage: 100 });
        assert.equal(submitted.status, 200);
        const result = (await submitted.json()).result;
        assert.equal(result.attempt.status, "completed");
        assert.equal(result.attempt.score, 1);
        assert.equal(result.total_questions, 2);
        assert.equal(result.attempt.percentage, 50);
        assert.equal(result.attempt.is_auto_submitted, false);
        const submittedTeacherDetail = await request(`/api/attempts/monitoring/${attemptId}`, teacherToken);
        assert.equal(submittedTeacherDetail.status, 200);
        assert.equal((await submittedTeacherDetail.json()).answers[0].correct_answer, 1);
        assert.equal((await request(`/api/attempts/${attemptId}/submit`, studentToken, "POST", {})).status, 409);
        assert.equal((await request(`/api/attempts/${attemptId}/answers/${questionTwo}`, studentToken, "PUT", { selected_option: 1 })).status, 409);

        const allowedQuestionAdd = await request(`/api/quizzes/${quizId}/questions`, teacherToken, "POST", {
            question_text: "After the attempt?", options: ["Yes", "No"], correct_answer: 0
        });
        assert.equal(allowedQuestionAdd.status, 201);

        const history = await request("/api/attempts", studentToken);
        assert.equal(history.status, 200);
        const historyBody = await history.json();
        assert.equal(historyBody.attempts.length, 1);
        assert.equal(historyBody.attempts[0].score, 1);
        assert.equal((await (await request("/api/attempts", otherStudentToken)).json()).attempts.length, 0);
        assert.equal((await request("/api/attempts/bad", studentToken)).status, 400);

        const secondStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        assert.equal(secondStart.status, 201);
        const secondAttemptId = (await secondStart.json()).attempt.id;
        assert.equal((await pool.query("SELECT attempt_number FROM attempts WHERE id = $1", [secondAttemptId])).rows[0].attempt_number, 2);
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [secondAttemptId]);
        const expiredSubmit = await request(`/api/attempts/${secondAttemptId}/submit`, studentToken, "POST", {});
        assert.equal(expiredSubmit.status, 200);
        const expiredResult = (await expiredSubmit.json()).result;
        assert.equal(expiredResult.attempt.status, "auto_submitted");
        assert.equal(expiredResult.attempt.is_auto_submitted, true);
        assert.equal(expiredResult.elapsed_time_enforced, true);

        const thirdStart = await request("/api/attempts", studentToken, "POST", { quiz_id: quizId });
        const thirdAttemptId = (await thirdStart.json()).attempt.id;
        await pool.query("UPDATE attempts SET start_time = NOW() - INTERVAL '2 hours' WHERE id = $1", [thirdAttemptId]);
        const addAfterAbandonedAttempt = await request(`/api/quizzes/${quizId}/questions`, teacherToken, "POST", {
            question_text: "After an expired attempt?", options: ["Yes", "No"], correct_answer: 0
        });
        assert.equal(addAfterAbandonedAttempt.status, 201);
        const abandoned = await pool.query("SELECT status, is_auto_submitted FROM attempts WHERE id = $1", [thirdAttemptId]);
        assert.equal(abandoned.rows[0].status, "auto_submitted");
        assert.equal(abandoned.rows[0].is_auto_submitted, true);
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
