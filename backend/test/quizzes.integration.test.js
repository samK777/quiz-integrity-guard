require("../server"); // Loads local .env before the database and JWT modules are used.
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const app = require("../server");
const pool = require("../config/db");

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const studentEmail = `qig-quiz-student-${suffix}@example.com`;
const teacherOneEmail = `qig-quiz-teacher-one-${suffix}@example.com`;
const teacherTwoEmail = `qig-quiz-teacher-two-${suffix}@example.com`;
const titlePrefix = `QIG Integration ${suffix}`;
let apiServer;
let apiBase;

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

test("quiz management enforces roles and hides answers from students", async () => {
    assert.ok(process.env.JWT_SECRET && Buffer.byteLength(process.env.JWT_SECRET, "utf8") >= 32,
        "set a JWT_SECRET of at least 32 bytes in backend/.env");

    apiServer = await new Promise((resolve, reject) => {
        const server = app.listen(0, () => resolve(server));
        server.once("error", reject);
    });
    apiBase = `http://127.0.0.1:${apiServer.address().port}`;

    try {
        const hash = await bcrypt.hash("QuizTestPass42!", 12);
        const inserted = await pool.query(
            `INSERT INTO users (name, email, password_hash, role)
             VALUES ('Quiz Test Student', $1, $2, 'student'),
                    ('Quiz Test Teacher One', $3, $2, 'teacher'),
                    ('Quiz Test Teacher Two', $4, $2, 'teacher')
             RETURNING id, email`,
            [studentEmail, hash, teacherOneEmail, teacherTwoEmail]
        );
        const ids = Object.fromEntries(inserted.rows.map(row => [row.email, row.id]));
        const studentToken = tokenFor(ids[studentEmail]);
        const teacherOneToken = tokenFor(ids[teacherOneEmail]);
        const teacherTwoToken = tokenFor(ids[teacherTwoEmail]);

        assert.equal((await request("/api/quizzes", null)).status, 401);
        assert.equal((await request("/api/quizzes", teacherOneToken)).status, 403);
        assert.equal((await request("/api/quizzes/manage", null)).status, 401);
        assert.equal((await request("/api/quizzes/manage", studentToken)).status, 403);

        const createActive = await request("/api/quizzes", teacherOneToken, "POST", {
            title: `${titlePrefix} Active`,
            description: "Integration test quiz",
            duration_minutes: 15
        });
        assert.equal(createActive.status, 201);
        const activeBody = await createActive.json();
        const activeId = activeBody.quiz.id;
        assert.equal(activeBody.quiz.is_active, true);

        const invalidQuiz = await request("/api/quizzes", teacherOneToken, "POST", {
            title: "", duration_minutes: 0
        });
        assert.equal(invalidQuiz.status, 400);

        const createInactive = await request("/api/quizzes", teacherOneToken, "POST", {
            title: `${titlePrefix} Inactive`,
            duration_minutes: 10,
            is_active: false
        });
        assert.equal(createInactive.status, 201);
        const inactiveId = (await createInactive.json()).quiz.id;
        const teacherQuizList = await request("/api/quizzes/manage", teacherOneToken);
        assert.equal(teacherQuizList.status, 200);
        const teacherQuizListBody = await teacherQuizList.json();
        assert.ok(teacherQuizListBody.quizzes.some(quiz => String(quiz.id) === String(inactiveId)));

        const studentCreate = await request("/api/quizzes", studentToken, "POST", {
            title: `${titlePrefix} Student Attempt`, duration_minutes: 5
        });
        assert.equal(studentCreate.status, 403);

        assert.equal((await request("/api/quizzes/not-an-id", studentToken)).status, 400);
        assert.equal((await request("/api/quizzes/2147483648", studentToken)).status, 400);
        assert.equal((await request("/api/quizzes", studentToken)).status, 200);
        const listBody = await (await request("/api/quizzes", studentToken)).json();
        assert.ok(listBody.quizzes.some(quiz => String(quiz.id) === String(activeId)));
        assert.ok(!listBody.quizzes.some(quiz => String(quiz.id) === String(inactiveId)));

        assert.equal((await request(`/api/quizzes/${inactiveId}`, studentToken)).status, 404);
        assert.equal((await request("/api/quizzes/999999999", studentToken)).status, 404);

        const invalidQuestionId = await request("/api/quizzes/not-an-id/questions", teacherOneToken, "POST", {
            question_text: "Question?", options: ["A", "B"], correct_answer: 0
        });
        assert.equal(invalidQuestionId.status, 400);
        const indexOutOfRange = await request(`/api/quizzes/${activeId}/questions`, teacherOneToken, "POST", {
            question_text: "Question?", options: ["A", "B"], correct_answer: 2
        });
        assert.equal(indexOutOfRange.status, 400);
        const emptyOption = await request(`/api/quizzes/${activeId}/questions`, teacherOneToken, "POST", {
            question_text: "Question?", options: ["A", "  "], correct_answer: 0
        });
        assert.equal(emptyOption.status, 400);
        const invalidQuestionBody = await request(`/api/quizzes/${activeId}/questions`, teacherOneToken, "POST", {
            question_text: " ", options: [], correct_answer: 0
        });
        assert.equal(invalidQuestionBody.status, 400);

        // A second teacher can add a question to the first teacher's quiz under the
        // approved shared-workspace model (there is intentionally no ownership field).
        const addQuestion = await request(`/api/quizzes/${activeId}/questions`, teacherTwoToken, "POST", {
            question_text: "What is 2 + 2?",
            options: ["3", "4", "5", "6"],
            correct_answer: 1
        });
        assert.equal(addQuestion.status, 201);
        const createdQuestion = (await addQuestion.json()).question;
        assert.equal(createdQuestion.question_order, 1);
        assert.equal("correct_answer" in createdQuestion, false);

        const studentQuestionPost = await request(`/api/quizzes/${activeId}/questions`, studentToken, "POST", {
            question_text: "Student injection?", options: ["No", "Yes"], correct_answer: 0
        });
        assert.equal(studentQuestionPost.status, 403);

        const detail = await request(`/api/quizzes/${activeId}`, studentToken);
        assert.equal(detail.status, 200);
        const detailBody = await detail.json();
        assert.equal(detailBody.questions.length, 1);
        assert.deepEqual(detailBody.questions[0].options, ["3", "4", "5", "6"]);
        assert.equal("correct_answer" in detailBody.questions[0], false);
        assert.equal(JSON.stringify(detailBody).includes("correct_answer"), false);
    } finally {
        if (apiServer) await new Promise(resolve => apiServer.close(resolve));
        await pool.query("DELETE FROM quizzes WHERE title LIKE $1", [`${titlePrefix}%`]);
        await pool.query("DELETE FROM users WHERE email = ANY($1::varchar[])", [[studentEmail, teacherOneEmail, teacherTwoEmail]]);
        await pool.end();
    }
});
