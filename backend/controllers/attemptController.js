const pool = require("../config/db");
const {
    publishAttemptStarted,
    publishAttemptCompleted,
    publishAttemptAutoSubmitted
} = require("../realtime/events");

const MAX_INT32 = 2147483647;
const MAX_HISTORY_LIMIT = 100;

function parsePathId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;
    const id = Number(rawId);
    return Number.isSafeInteger(id) && id <= MAX_INT32 ? id : null;
}

async function startAttempt(req, res) {
    const quizId = req.body?.quiz_id;
    if (!Number.isInteger(quizId) || quizId < 1 || quizId > MAX_INT32) {
        return res.status(400).json({ error: "quiz_id must be a positive integer." });
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;

        // Serializing starts for a student keeps attempt_number unique under concurrent requests.
        await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [req.user.id]);
        const quizResult = await client.query(
            `SELECT id, title, duration_minutes FROM quizzes
             WHERE id = $1 AND is_active = TRUE FOR SHARE`,
            [quizId]
        );
        const quiz = quizResult.rows[0];
        if (!quiz) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ error: "Active quiz not found." });
        }

        const questionCount = await client.query("SELECT COUNT(*)::int AS total FROM questions WHERE quiz_id = $1", [quizId]);
        if (questionCount.rows[0].total === 0) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({ error: "This quiz has no questions yet." });
        }

        const numberResult = await client.query(
            "SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number FROM attempts WHERE user_id = $1 AND quiz_id = $2",
            [req.user.id, quizId]
        );
        const attemptResult = await client.query(
            `INSERT INTO attempts (user_id, quiz_id, attempt_number, status, violation_count, is_auto_submitted)
             VALUES ($1, $2, $3, 'in_progress', 0, FALSE)
             RETURNING id, quiz_id, attempt_number, status, score, percentage, violation_count,
                       start_time, end_time, is_auto_submitted`,
            [req.user.id, quizId, numberResult.rows[0].attempt_number]
        );
        const questionsResult = await client.query(
            `SELECT id, question_text, options, question_order
             FROM questions WHERE quiz_id = $1 ORDER BY question_order ASC`,
            [quizId]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        publishAttemptStarted({
            id: attemptResult.rows[0].id,
            user_id: req.user.id,
            quiz_id: quizId,
            quiz_title: quiz.title,
            attempt_number: attemptResult.rows[0].attempt_number,
            status: "in_progress",
            start_time: attemptResult.rows[0].start_time
        });
        return res.status(201).json({
            attempt: { ...attemptResult.rows[0], quiz_title: quiz.title, duration_minutes: quiz.duration_minutes },
            questions: questionsResult.rows
        });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Attempt transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function listMyAttempts(req, res) {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_HISTORY_LIMIT) {
        return res.status(400).json({ error: "limit must be an integer from 1 to 100." });
    }
    const result = await pool.query(
        `SELECT a.id, a.quiz_id, q.title AS quiz_title, a.attempt_number, a.status, a.score,
                a.percentage::float8 AS percentage, a.violation_count, a.start_time, a.end_time, a.is_auto_submitted
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.user_id = $1
         ORDER BY a.start_time DESC, a.id DESC LIMIT $2`,
        [req.user.id, limit]
    );
    return res.json({ attempts: result.rows });
}

async function listTeacherMonitoring(req, res) {
    const [attemptsResult, violationsResult, summaryResult, statusResult, violationTypesResult, scoreDistributionResult] = await Promise.all([
        pool.query(
            `SELECT a.id, a.user_id, u.name AS student_name, u.email AS student_email,
                    a.quiz_id, q.title AS quiz_title, q.duration_minutes, a.attempt_number, a.status, a.score,
                    a.percentage::float8 AS percentage, a.violation_count, a.start_time,
                    a.end_time, a.is_auto_submitted,
                    GREATEST(a.start_time,
                      COALESCE((SELECT MAX(answer.answered_at) FROM answers answer WHERE answer.attempt_id = a.id), a.start_time),
                      COALESCE((SELECT MAX(v.created_at) FROM violations v WHERE v.attempt_id = a.id), a.start_time),
                      COALESCE(a.end_time, a.start_time)) AS last_activity,
                    (SELECT COUNT(*)::int FROM questions question WHERE question.quiz_id = a.quiz_id) AS question_count,
                    (SELECT COUNT(*)::int FROM answers answer WHERE answer.attempt_id = a.id) AS answered_count
             FROM attempts a
             JOIN users u ON u.id = a.user_id
             JOIN quizzes q ON q.id = a.quiz_id
             ORDER BY CASE WHEN a.status = 'in_progress' THEN 0 ELSE 1 END,
                      a.start_time DESC, a.id DESC
             LIMIT 100`
        ),
        pool.query(
            `SELECT v.id, v.attempt_id, v.type, v.message, v.question_number, v.created_at,
                    a.quiz_id, q.title AS quiz_title, a.attempt_number,
                    u.name AS student_name, u.email AS student_email
             FROM violations v
             JOIN attempts a ON a.id = v.attempt_id
             JOIN users u ON u.id = a.user_id
             JOIN quizzes q ON q.id = a.quiz_id
             ORDER BY v.created_at DESC, v.id DESC
             LIMIT 20`
        ),
        pool.query(`SELECT
            (SELECT COUNT(*)::int FROM users WHERE role = 'student') AS total_students,
            (SELECT COUNT(*)::int FROM quizzes WHERE is_active = TRUE) AS active_quizzes,
            (SELECT COUNT(*)::int FROM attempts WHERE status = 'in_progress') AS live_attempts,
            (SELECT COUNT(*)::int FROM attempts WHERE status = 'completed') AS completed_attempts,
            (SELECT COUNT(*)::int FROM violations) AS total_violations,
            (SELECT COUNT(*)::int FROM attempts WHERE status = 'auto_submitted' OR is_auto_submitted = TRUE) AS auto_submitted_attempts,
            COALESCE((SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('completed','auto_submitted')) / NULLIF(COUNT(*),0))::int FROM attempts), 0) AS completion_rate`),
        pool.query("SELECT status, COUNT(*)::int AS total FROM attempts GROUP BY status ORDER BY status"),
        pool.query("SELECT type, COUNT(*)::int AS total FROM violations GROUP BY type ORDER BY total DESC, type"),
        pool.query(`SELECT bucket, COUNT(*)::int AS total FROM (
            SELECT CASE
              WHEN percentage < 20 THEN '0–19%'
              WHEN percentage < 40 THEN '20–39%'
              WHEN percentage < 60 THEN '40–59%'
              WHEN percentage < 80 THEN '60–79%'
              ELSE '80–100%'
            END AS bucket,
            CASE WHEN percentage < 20 THEN 1 WHEN percentage < 40 THEN 2 WHEN percentage < 60 THEN 3 WHEN percentage < 80 THEN 4 ELSE 5 END AS sort_order
            FROM attempts WHERE status IN ('completed', 'auto_submitted') AND percentage IS NOT NULL
        ) scores GROUP BY bucket, sort_order ORDER BY sort_order`)
    ]);
    return res.json({
        attempts: attemptsResult.rows,
        violations: violationsResult.rows,
        summary: summaryResult.rows[0],
        analytics: {
            attempts_by_status: statusResult.rows,
            violations_by_type: violationTypesResult.rows,
            score_distribution: scoreDistributionResult.rows,
            completion_statistics: [
                { label: "Submitted", total: Number(summaryResult.rows[0].completed_attempts) + Number(summaryResult.rows[0].auto_submitted_attempts) },
                { label: "In progress", total: Number(summaryResult.rows[0].live_attempts) },
                { label: "Completion rate", total: Number(summaryResult.rows[0].completion_rate), suffix: "%" }
            ]
        }
    });
}

async function getTeacherAttemptDetail(req, res) {
    const attemptId = parsePathId(req.params.id);
    if (attemptId === null) return res.status(400).json({ error: "Attempt ID must be a positive integer." });
    const result = await pool.query(
        `SELECT a.id, a.user_id, u.name AS student_name, u.email AS student_email,
                a.quiz_id, q.title AS quiz_title, q.duration_minutes, a.attempt_number,
                a.status, a.score, a.percentage::float8 AS percentage, a.violation_count,
                a.start_time, a.end_time, a.is_auto_submitted
         FROM attempts a JOIN users u ON u.id = a.user_id JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.id = $1 LIMIT 1`, [attemptId]
    );
    const attempt = result.rows[0];
    if (!attempt) return res.status(404).json({ error: "Attempt not found." });
    const [answers, violations] = await Promise.all([
        pool.query(
            `SELECT q.id AS question_id, q.question_text, q.options, q.question_order,
                    answer.selected_option, answer.answered_at,
                    CASE WHEN $2 = 'in_progress' THEN NULL ELSE q.correct_answer END AS correct_answer
             FROM questions q LEFT JOIN answers answer ON answer.question_id = q.id AND answer.attempt_id = $1
             WHERE q.quiz_id = $3 ORDER BY q.question_order ASC`,
            [attemptId, attempt.status, attempt.quiz_id]
        ),
        pool.query(
            `SELECT id, type, message, question_number, created_at
             FROM violations WHERE attempt_id = $1 ORDER BY created_at DESC, id DESC`, [attemptId]
        )
    ]);
    return res.json({ attempt, answers: answers.rows, violations: violations.rows });
}

async function getMyAttempt(req, res) {
    const attemptId = parsePathId(req.params.id);
    if (attemptId === null) return res.status(400).json({ error: "Attempt ID must be a positive integer." });

    const result = await pool.query(
        `SELECT a.id, a.quiz_id, q.title AS quiz_title, q.duration_minutes, a.attempt_number,
                a.status, a.score, a.percentage::float8 AS percentage, a.violation_count, a.start_time, a.end_time,
                a.is_auto_submitted
         FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
         WHERE a.id = $1 AND a.user_id = $2 LIMIT 1`,
        [attemptId, req.user.id]
    );
    const attempt = result.rows[0];
    if (!attempt) return res.status(404).json({ error: "Attempt not found." });

    const answers = await pool.query(
        `SELECT q.id AS question_id, q.question_text, q.options, q.question_order,
                answer.selected_option, answer.answered_at
         FROM questions q
         LEFT JOIN answers answer ON answer.question_id = q.id AND answer.attempt_id = $1
         WHERE q.quiz_id = $2 ORDER BY q.question_order ASC`,
        [attemptId, attempt.quiz_id]
    );
    return res.json({ attempt, questions: answers.rows });
}

async function saveAnswer(req, res) {
    const attemptId = parsePathId(req.params.id);
    const questionId = parsePathId(req.params.questionId);
    if (attemptId === null || questionId === null) {
        return res.status(400).json({ error: "Attempt and question IDs must be positive integers." });
    }
    const selectedOption = req.body?.selected_option;
    if (selectedOption !== null && !Number.isInteger(selectedOption)) {
        return res.status(400).json({ error: "selected_option must be an option index or null to clear the answer." });
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;
        const attemptResult = await client.query(
            `SELECT a.id, a.user_id, a.quiz_id, a.attempt_number, a.status, a.start_time,
                    q.title AS quiz_title, q.duration_minutes,
                    (a.start_time + q.duration_minutes * INTERVAL '1 minute' <= NOW()) AS expired
             FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
             WHERE a.id = $1 AND a.user_id = $2 FOR UPDATE OF a`,
            [attemptId, req.user.id]
        );
        const attempt = attemptResult.rows[0];
        if (!attempt) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Attempt not found." });
        }
        if (attempt.status !== "in_progress") {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "This attempt is already submitted." });
        }
        if (attempt.expired) {
            const summary = await calculateAndFinish(client, attemptId, attempt.quiz_id, true);
            await client.query("COMMIT"); transactionOpen = false;
            publishAttemptAutoSubmitted({
                id: attempt.id, user_id: attempt.user_id, quiz_id: attempt.quiz_id,
                quiz_title: attempt.quiz_title, attempt_number: attempt.attempt_number,
                status: "auto_submitted", violation_count: summary.attempt.violation_count,
                score: summary.attempt.score, percentage: summary.attempt.percentage,
                is_auto_submitted: true, end_time: summary.attempt.end_time, reason: "time_limit"
            });
            return res.status(409).json({ error: "The quiz time limit has elapsed; the attempt was submitted.", result: summary });
        }

        const questionResult = await client.query(
            "SELECT options FROM questions WHERE id = $1 AND quiz_id = $2",
            [questionId, attempt.quiz_id]
        );
        if (!questionResult.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Question not found for this quiz." });
        }
        const options = questionResult.rows[0].options;
        if (selectedOption !== null && (selectedOption < 0 || selectedOption >= options.length)) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(400).json({ error: "selected_option must match an available option." });
        }

        const saved = await client.query(
            `INSERT INTO answers (attempt_id, question_id, selected_option)
             VALUES ($1, $2, $3)
             ON CONFLICT (attempt_id, question_id)
             DO UPDATE SET selected_option = EXCLUDED.selected_option, answered_at = NOW()
             RETURNING question_id, selected_option, answered_at`,
            [attemptId, questionId, selectedOption]
        );
        await client.query("COMMIT"); transactionOpen = false;
        return res.json({ answer: saved.rows[0] });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Answer transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function calculateAndFinish(client, attemptId, quizId, autoSubmitted) {
    const scoreResult = await client.query(
        `SELECT COUNT(*) FILTER (WHERE answer.selected_option = question.correct_answer)::int AS score,
                COUNT(question.id)::int AS total_questions
         FROM questions question
         LEFT JOIN answers answer ON answer.question_id = question.id AND answer.attempt_id = $1
         WHERE question.quiz_id = $2`,
        [attemptId, quizId]
    );
    const score = scoreResult.rows[0].score;
    const total = scoreResult.rows[0].total_questions;
    const percentage = total === 0 ? 0 : Math.round((score / total) * 100);
    const status = autoSubmitted ? "auto_submitted" : "completed";
    const result = await client.query(
        `UPDATE attempts SET score = $2, percentage = $3, status = $4,
                end_time = NOW(), is_auto_submitted = $5
         WHERE id = $1
         RETURNING id, quiz_id, attempt_number, status, score, percentage, violation_count,
                   start_time, end_time, is_auto_submitted`,
        [attemptId, score, percentage, status, autoSubmitted]
    );
    const completedAttempt = result.rows[0];
    completedAttempt.percentage = completedAttempt.percentage === null ? null : Number(completedAttempt.percentage);
    return { attempt: completedAttempt, total_questions: total };
}

async function submitAttempt(req, res) {
    const attemptId = parsePathId(req.params.id);
    if (attemptId === null) return res.status(400).json({ error: "Attempt ID must be a positive integer." });

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN"); transactionOpen = true;
        const result = await client.query(
            `SELECT a.id, a.user_id, a.quiz_id, a.attempt_number, a.status, q.title AS quiz_title,
                    (a.start_time + q.duration_minutes * INTERVAL '1 minute' <= NOW()) AS expired
             FROM attempts a JOIN quizzes q ON q.id = a.quiz_id
             WHERE a.id = $1 AND a.user_id = $2 FOR UPDATE OF a`,
            [attemptId, req.user.id]
        );
        const attempt = result.rows[0];
        if (!attempt) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Attempt not found." });
        }
        if (attempt.status !== "in_progress") {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "This attempt is already submitted." });
        }
        const summary = await calculateAndFinish(client, attemptId, attempt.quiz_id, attempt.expired);
        await client.query("COMMIT"); transactionOpen = false;
        if (attempt.expired) publishAttemptAutoSubmitted({
            id: attempt.id, user_id: attempt.user_id, quiz_id: attempt.quiz_id,
            quiz_title: attempt.quiz_title, attempt_number: attempt.attempt_number,
            status: "auto_submitted", violation_count: summary.attempt.violation_count,
            score: summary.attempt.score, percentage: summary.attempt.percentage,
            is_auto_submitted: true, end_time: summary.attempt.end_time, reason: "time_limit"
        });
        else publishAttemptCompleted({
            id: attempt.id, user_id: attempt.user_id, quiz_id: attempt.quiz_id,
            quiz_title: attempt.quiz_title, attempt_number: attempt.attempt_number,
            status: summary.attempt.status, score: summary.attempt.score,
            percentage: summary.attempt.percentage, end_time: summary.attempt.end_time,
            reason: "student_submitted"
        });
        return res.json({ result: { ...summary, elapsed_time_enforced: Boolean(attempt.expired) } });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Submit transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { startAttempt, listMyAttempts, listTeacherMonitoring, getTeacherAttemptDetail, getMyAttempt, saveAnswer, submitAttempt, calculateAndFinish };
