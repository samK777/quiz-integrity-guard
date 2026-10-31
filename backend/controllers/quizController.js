const pool = require("../config/db");
const { publishAttemptAutoSubmitted } = require("../realtime/events");

const MAX_INT32 = 2147483647;

function parseQuizId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;
    const id = Number(rawId);
    return Number.isSafeInteger(id) && id <= MAX_INT32 ? id : null;
}

function validQuizInput(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const { title, description, duration_minutes, is_active } = body;
    return typeof title === "string" && title.trim().length >= 1 && title.trim().length <= 200 &&
        (description === undefined || description === null ||
            (typeof description === "string" && description.length <= 5000)) &&
        Number.isInteger(duration_minutes) && duration_minutes >= 1 && duration_minutes <= 1440 &&
        (is_active === undefined || typeof is_active === "boolean");
}

function validQuestionInput(body) {
    if (!body || typeof body !== "object" || Array.isArray(body)) return false;
    const { question_text, options, correct_answer } = body;
    return typeof question_text === "string" && question_text.trim().length >= 1 && question_text.trim().length <= 5000 &&
        Array.isArray(options) && options.length >= 2 && options.length <= 10 &&
        options.every(option => typeof option === "string" && option.trim().length >= 1 && option.trim().length <= 1000) &&
        Number.isInteger(correct_answer) && correct_answer >= 0 && correct_answer < options.length;
}

async function listActiveQuizzes(req, res) {
    const result = await pool.query(
        `SELECT q.id, q.title, q.description, q.duration_minutes, q.is_active, q.created_at,
                COUNT(question.id)::int AS question_count
         FROM quizzes q
         LEFT JOIN questions question ON question.quiz_id = q.id
         WHERE q.is_active = TRUE
         GROUP BY q.id
         ORDER BY q.created_at DESC NULLS LAST, q.id DESC`
    );
    return res.json({ quizzes: result.rows });
}

async function listTeacherQuizzes(req, res) {
    const result = await pool.query(
        `SELECT q.id, q.title, q.description, q.duration_minutes, q.is_active, q.created_at,
                COUNT(question.id)::int AS question_count
         FROM quizzes q
         LEFT JOIN questions question ON question.quiz_id = q.id
         GROUP BY q.id
         ORDER BY q.created_at DESC NULLS LAST, q.id DESC`
    );
    return res.json({ quizzes: result.rows });
}

async function getActiveQuiz(req, res) {
    const quizId = parseQuizId(req.params.id);
    if (quizId === null) return res.status(400).json({ error: "Quiz ID must be a positive integer." });

    const quizResult = await pool.query(
        `SELECT id, title, description, duration_minutes, is_active, created_at
         FROM quizzes WHERE id = $1 AND is_active = TRUE LIMIT 1`,
        [quizId]
    );
    const quiz = quizResult.rows[0];
    if (!quiz) return res.status(404).json({ error: "Quiz not found." });

    // Explicitly select only student-safe fields. Never select correct_answer here.
    const questionsResult = await pool.query(
        `SELECT id, question_text, options, question_order
         FROM questions WHERE quiz_id = $1 ORDER BY question_order ASC`,
        [quizId]
    );
    return res.json({ quiz, questions: questionsResult.rows });
}

async function createQuiz(req, res) {
    if (!validQuizInput(req.body)) {
        return res.status(400).json({
            error: "Provide a title (1–200 characters), duration_minutes (1–1440), optional description (up to 5000 characters), and optional boolean is_active."
        });
    }
    const { title, description = null, duration_minutes, is_active = true } = req.body;
    const result = await pool.query(
        `INSERT INTO quizzes (title, description, duration_minutes, is_active)
         VALUES ($1, $2, $3, $4)
         RETURNING id, title, description, duration_minutes, is_active, created_at`,
        [title.trim(), description, duration_minutes, is_active]
    );
    return res.status(201).json({ quiz: result.rows[0] });
}

async function addQuestion(req, res) {
    const quizId = parseQuizId(req.params.id);
    if (quizId === null) return res.status(400).json({ error: "Quiz ID must be a positive integer." });
    if (!validQuestionInput(req.body)) {
        return res.status(400).json({
            error: "Provide question_text, 2–10 non-empty option strings, and a zero-based correct_answer index within the options."
        });
    }

    const { question_text, options, correct_answer } = req.body;
    const client = await pool.connect();
    let transactionOpen = false;
    let expiredAttempts = [];
    try {
        await client.query("BEGIN");
        transactionOpen = true;

        // Serializing inserts on the parent quiz prevents concurrent requests from
        // choosing the same next question_order (which is unique per quiz).
        const quizResult = await client.query("SELECT id FROM quizzes WHERE id = $1 FOR UPDATE", [quizId]);
        if (quizResult.rowCount === 0) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ error: "Quiz not found." });
        }

        // Close overdue attempts first so abandoned sessions do not block teachers forever.
        const expiredResult = await client.query(
            `WITH expired_scores AS (
                 SELECT attempt.id, attempt.user_id, attempt.quiz_id, attempt.attempt_number,
                        quiz.title AS quiz_title, COUNT(question.id)::int AS total_questions,
                        COUNT(question.id) FILTER (WHERE answer.selected_option = question.correct_answer)::int AS score
                 FROM attempts attempt
                 JOIN quizzes quiz ON quiz.id = attempt.quiz_id
                 JOIN questions question ON question.quiz_id = quiz.id
                 LEFT JOIN answers answer ON answer.attempt_id = attempt.id AND answer.question_id = question.id
                 WHERE attempt.quiz_id = $1 AND attempt.status = 'in_progress'
                   AND attempt.start_time + quiz.duration_minutes * INTERVAL '1 minute' <= NOW()
                 GROUP BY attempt.id, quiz.title
             )
             UPDATE attempts attempt
             SET score = expired_scores.score,
                 percentage = CASE WHEN expired_scores.total_questions = 0 THEN 0
                                    ELSE ROUND(100.0 * expired_scores.score / expired_scores.total_questions) END,
                 status = 'auto_submitted', end_time = NOW(), is_auto_submitted = TRUE
             FROM expired_scores WHERE attempt.id = expired_scores.id
             RETURNING attempt.id, attempt.user_id, attempt.quiz_id, attempt.attempt_number,
                       expired_scores.quiz_title, attempt.violation_count, attempt.score,
                       attempt.percentage, attempt.end_time`,
            [quizId]
        );
        expiredAttempts = expiredResult.rows;
        const activeAttempt = await client.query(
            "SELECT 1 FROM attempts WHERE quiz_id = $1 AND status = 'in_progress' LIMIT 1",
            [quizId]
        );
        if (activeAttempt.rowCount > 0) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({ error: "Questions cannot be changed while students have attempts in progress." });
        }

        const orderResult = await client.query(
            "SELECT COALESCE(MAX(question_order), 0) + 1 AS next_order FROM questions WHERE quiz_id = $1",
            [quizId]
        );
        const nextOrder = orderResult.rows[0].next_order;
        const insertResult = await client.query(
            `INSERT INTO questions (quiz_id, question_text, options, correct_answer, question_order)
             VALUES ($1, $2, $3::jsonb, $4, $5)
             RETURNING id, quiz_id, question_text, options, question_order`,
            [quizId, question_text.trim(), JSON.stringify(options.map(option => option.trim())), correct_answer, nextOrder]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        for (const attempt of expiredAttempts) {
            publishAttemptAutoSubmitted({ ...attempt, percentage: Number(attempt.percentage), status: "auto_submitted", is_auto_submitted: true, reason: "time_limit" });
        }
        return res.status(201).json({ question: insertResult.rows[0] });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Question transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listActiveQuizzes, listTeacherQuizzes, getActiveQuiz, createQuiz, addQuestion };
