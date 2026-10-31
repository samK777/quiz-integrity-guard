const pool = require("../config/db");
const { calculateAndFinish } = require("./attemptController");
const { publishViolationCreated, publishAttemptAutoSubmitted } = require("../realtime/events");

const MAX_INT32 = 2147483647;
const MAX_VIOLATIONS = 3;
const VIOLATION_TYPES = new Set([
    "tab_switch",
    "window_blur",
    "copy_attempt",
    "paste_attempt",
    "cut_attempt",
    "right_click",
    "keyboard_shortcut",
    "fullscreen_exit",
    "inactivity",
    "fast_submission",
    "devtools_opened",
    "screenshot_attempt"
]);

function parseId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;
    const id = Number(rawId);
    return Number.isSafeInteger(id) && id <= MAX_INT32 ? id : null;
}

async function listViolations(req, res) {
    const attemptId = parseId(req.params.id);
    if (attemptId === null) return res.status(400).json({ error: "Attempt ID must be a positive integer." });

    const ownerFilter = req.user.role === "student" ? "AND user_id = $2" : "";
    const params = req.user.role === "student" ? [attemptId, req.user.id] : [attemptId];
    const attempt = await pool.query(`SELECT id FROM attempts WHERE id = $1 ${ownerFilter} LIMIT 1`, params);
    if (!attempt.rows[0]) return res.status(404).json({ error: "Attempt not found." });

    const result = await pool.query(
        `SELECT id, attempt_id, type, message, question_number, created_at
         FROM violations WHERE attempt_id = $1 ORDER BY created_at ASC, id ASC`,
        [attemptId]
    );
    return res.json({ violations: result.rows });
}

async function createViolation(req, res) {
    const attemptId = parseId(req.params.id);
    if (attemptId === null) return res.status(400).json({ error: "Attempt ID must be a positive integer." });

    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        typeof body.type !== "string" || !VIOLATION_TYPES.has(body.type) ||
        (body.question_number !== undefined && body.question_number !== null &&
            (!Number.isInteger(body.question_number) || body.question_number < 1)) ||
        (body.message !== undefined && body.message !== null &&
            (typeof body.message !== "string" || body.message.length > 500))) {
        return res.status(400).json({
            error: "Provide a supported violation type, an optional positive question_number, and an optional message up to 500 characters."
        });
    }

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN"); transactionOpen = true;
        const attemptResult = await client.query(
            `SELECT a.id, a.user_id, a.quiz_id, a.attempt_number, a.status, q.title AS quiz_title,
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
            const result = await calculateAndFinish(client, attemptId, attempt.quiz_id, true);
            await client.query("COMMIT"); transactionOpen = false;
            publishAttemptAutoSubmitted({
                id: attempt.id, user_id: attempt.user_id, quiz_id: attempt.quiz_id,
                quiz_title: attempt.quiz_title, attempt_number: attempt.attempt_number,
                status: "auto_submitted", violation_count: result.attempt.violation_count,
                score: result.attempt.score, percentage: result.attempt.percentage,
                is_auto_submitted: true, end_time: result.attempt.end_time, reason: "time_limit"
            });
            return res.status(409).json({ error: "The quiz time limit has elapsed; the attempt was submitted.", result });
        }

        const countResult = await client.query("SELECT COUNT(*)::int AS total FROM questions WHERE quiz_id = $1", [attempt.quiz_id]);
        if (body.question_number != null && body.question_number > countResult.rows[0].total) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(400).json({ error: "question_number is outside this quiz." });
        }

        const violationResult = await client.query(
            `INSERT INTO violations (attempt_id, type, message, question_number)
             VALUES ($1, $2, $3, $4)
             RETURNING id, attempt_id, type, message, question_number, created_at`,
            [attemptId, body.type, body.message ?? null, body.question_number ?? null]
        );
        const updatedAttempt = await client.query(
            `UPDATE attempts SET violation_count = violation_count + 1
             WHERE id = $1
             RETURNING id, quiz_id, status, violation_count, score, percentage, is_auto_submitted`,
            [attemptId]
        );
        const autoSubmitted = updatedAttempt.rows[0].violation_count >= MAX_VIOLATIONS;
        let result = null;
        let attemptResponse = updatedAttempt.rows[0];
        if (autoSubmitted) {
            result = await calculateAndFinish(client, attemptId, attempt.quiz_id, true);
            attemptResponse = result.attempt;
        }
        await client.query("COMMIT"); transactionOpen = false;
        const eventPayload = {
            violation: violationResult.rows[0],
            attempt: {
                id: attemptId,
                user_id: attempt.user_id,
                quiz_id: attempt.quiz_id,
                quiz_title: attempt.quiz_title,
                attempt_number: attempt.attempt_number,
                status: attemptResponse.status,
                violation_count: attemptResponse.violation_count,
                is_auto_submitted: attemptResponse.is_auto_submitted
            },
            student: { id: req.user.id, name: req.user.name, email: req.user.email }
        };
        publishViolationCreated(eventPayload);
        if (autoSubmitted) publishAttemptAutoSubmitted({ ...eventPayload.attempt, score: result.attempt.score, percentage: result.attempt.percentage, end_time: result.attempt.end_time, reason: "violation_threshold" });
        return res.status(201).json({
            violation: violationResult.rows[0],
            attempt: attemptResponse,
            auto_submitted: autoSubmitted,
            ...(result ? { result: { total_questions: result.total_questions, score: result.attempt.score, percentage: result.attempt.percentage } } : {})
        });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Violation transaction rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { listViolations, createViolation };
