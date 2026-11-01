"use strict";

const pool = require("../config/db");
const { parsePathId } = require("../services/batchValidation");
const { parseBatchIdList } = require("../services/quizAudience");

function parseInvitationId(rawId) {
    if (typeof rawId !== "string" || !/^[1-9]\d*$/.test(rawId)) return null;

    try {
        const id = BigInt(rawId);
        if (id > 9223372036854775807n) return null;
        return rawId;
    } catch {
        return null;
    }
}

async function assignQuizBatches(req, res) {
    const quizId = parsePathId(req.params.id);
    const batchIds = parseBatchIdList(req.body?.batch_ids);

    if (quizId === null) {
        return res.status(400).json({ error: "Quiz ID must be a positive integer." });
    }

    if (!batchIds) {
        return res.status(400).json({
            error: "Provide 1–50 valid positive batch IDs in batch_ids."
        });
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const quizResult = await client.query(
            "SELECT id, audience_mode FROM quizzes WHERE id = $1 FOR UPDATE",
            [quizId]
        );

        const quiz = quizResult.rows[0];

        if (!quiz) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ error: "Quiz not found." });
        }

        if (quiz.audience_mode !== "batch") {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({
                error: "Only batch-mode quizzes can be assigned to batches."
            });
        }

        const existingBatches = await client.query(
            "SELECT id FROM batches WHERE id = ANY($1::int[])",
            [batchIds]
        );

        if (existingBatches.rowCount !== batchIds.length) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({
                error: "One or more batches were not found."
            });
        }

        await client.query(
            `INSERT INTO quiz_batches (quiz_id, batch_id, assigned_by)
             SELECT $1::integer, batch_id, $3, batch_id, $3
             FROM unnest($2::int[]) AS batch_id
             ON CONFLICT (quiz_id, batch_id) DO NOTHING`,
            [quizId, batchIds, req.user.id]
        );

        // Snapshot current members of the batches being assigned.
        // A student in multiple batches receives one invitation.
        await client.query(
            `INSERT INTO quiz_invitations (quiz_id, student_id)
             SELECT DISTINCT $1::integer, bs.student_id
             FROM batch_students bs
             WHERE bs.batch_id = ANY($2::int[])
             ON CONFLICT (quiz_id, student_id)
             DO UPDATE SET state = 'invited', revoked_at = NULL`,
            [quizId, batchIds]
        );

        // Preserve the source-batch provenance for each invitation.
        await client.query(
            `INSERT INTO quiz_invitation_batches (invitation_id, batch_id)
             SELECT qi.id, bs.batch_id
             FROM quiz_invitations qi
             JOIN batch_students bs ON bs.student_id = qi.student_id
             WHERE qi.quiz_id = $1
               AND bs.batch_id = ANY($2::int[])
             ON CONFLICT (invitation_id, batch_id) DO NOTHING`,
            [quizId, batchIds]
        );

        const summary = await client.query(
            `SELECT COUNT(*)::int AS invitation_count
             FROM quiz_invitations
             WHERE quiz_id = $1 AND state = 'invited'`,
            [quizId]
        );

        await client.query("COMMIT");
        transactionOpen = false;

        return res.status(200).json({
            message: "Batch assignment and invitation snapshot completed.",
            assigned_batch_ids: batchIds,
            active_invitation_count: summary.rows[0].invitation_count
        });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Quiz batch assignment rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function refreshQuizInvitations(req, res) {
    const quizId = parsePathId(req.params.id);

    if (quizId === null) {
        return res.status(400).json({ error: "Quiz ID must be a positive integer." });
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const quizResult = await client.query(
            "SELECT id, audience_mode FROM quizzes WHERE id = $1 FOR UPDATE",
            [quizId]
        );

        const quiz = quizResult.rows[0];

        if (!quiz) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ error: "Quiz not found." });
        }

        if (quiz.audience_mode !== "batch") {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({
                error: "Only batch-mode quizzes support invitation refresh."
            });
        }

        const assigned = await client.query(
            "SELECT batch_id FROM quiz_batches WHERE quiz_id = $1",
            [quizId]
        );

        if (assigned.rowCount === 0) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(409).json({
                error: "Assign at least one batch before refreshing invitations."
            });
        }

        // Re-invite every student currently eligible through an assigned batch.
        await client.query(
            `INSERT INTO quiz_invitations (quiz_id, student_id)
             SELECT DISTINCT $1::integer, bs.student_id
             FROM quiz_batches qb
             JOIN batch_students bs ON bs.batch_id = qb.batch_id
             WHERE qb.quiz_id = $1::integer
             ON CONFLICT (quiz_id, student_id)
             DO UPDATE SET state = 'invited', revoked_at = NULL`,
            [quizId]
        );

        // Add current source batches without deleting historical provenance.
        await client.query(
            `INSERT INTO quiz_invitation_batches (invitation_id, batch_id)
             SELECT qi.id, bs.batch_id
             FROM quiz_invitations qi
             JOIN quiz_batches qb ON qb.quiz_id = qi.quiz_id
             JOIN batch_students bs
               ON bs.batch_id = qb.batch_id
              AND bs.student_id = qi.student_id
             WHERE qi.quiz_id = $1
             ON CONFLICT (invitation_id, batch_id) DO NOTHING`,
            [quizId]
        );

        // Revoke active invitations only when a student is no longer
        // a member of ANY batch currently assigned to this quiz.
        const revoked = await client.query(
            `UPDATE quiz_invitations qi
             SET state = 'revoked', revoked_at = NOW()
             WHERE qi.quiz_id = $1
               AND qi.state = 'invited'
               AND NOT EXISTS (
                   SELECT 1
                   FROM quiz_batches qb
                   JOIN batch_students bs ON bs.batch_id = qb.batch_id
                   WHERE qb.quiz_id = qi.quiz_id
                     AND bs.student_id = qi.student_id
               )
             RETURNING qi.id`,
            [quizId]
        );

        const summary = await client.query(
            `SELECT
                COUNT(*) FILTER (WHERE state = 'invited')::int AS invited,
                COUNT(*) FILTER (WHERE state = 'revoked')::int AS revoked
             FROM quiz_invitations
             WHERE quiz_id = $1`,
            [quizId]
        );

        await client.query("COMMIT");
        transactionOpen = false;

        return res.json({
            message: "Invitation snapshot refreshed.",
            invited_count: summary.rows[0].invited,
            revoked_count: summary.rows[0].revoked,
            newly_revoked_count: revoked.rowCount
        });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Invitation refresh rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function listQuizInvitations(req, res) {
    const quizId = parsePathId(req.params.id);

    if (quizId === null) {
        return res.status(400).json({ error: "Quiz ID must be a positive integer." });
    }

    const quizResult = await pool.query(
        "SELECT id, title, audience_mode FROM quizzes WHERE id = $1",
        [quizId]
    );

    const quiz = quizResult.rows[0];

    if (!quiz) {
        return res.status(404).json({ error: "Quiz not found." });
    }

    if (quiz.audience_mode !== "batch") {
        return res.status(409).json({
            error: "Invitation details are available for batch-mode quizzes."
        });
    }

    const result = await pool.query(
        `SELECT
            qi.id AS invitation_id,
            qi.student_id,
            u.name AS student_name,
            u.email AS student_email,
            qi.state,
            qi.created_at AS invited_at,
            qi.revoked_at,
            COALESCE(source_batches.batches, '[]'::jsonb) AS source_batches,
            COALESCE(attempt_stats.attempt_count, 0)::int AS attempt_count,
            COALESCE(attempt_stats.completed_count, 0)::int AS completed_count,
            COALESCE(attempt_stats.in_progress_count, 0)::int AS in_progress_count,
            COALESCE(attempt_stats.auto_submitted_count, 0)::int AS auto_submitted_count
         FROM quiz_invitations qi
         JOIN users u ON u.id = qi.student_id
         LEFT JOIN LATERAL (
             SELECT jsonb_agg(
                 jsonb_build_object('id', b.id, 'name', b.name)
                 ORDER BY lower(b.name), b.id
             ) AS batches
             FROM quiz_invitation_batches qib
             JOIN batches b ON b.id = qib.batch_id
             WHERE qib.invitation_id = qi.id
         ) source_batches ON TRUE
         LEFT JOIN LATERAL (
             SELECT
                 COUNT(*)::int AS attempt_count,
                 COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
                 COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress_count,
                 COUNT(*) FILTER (WHERE status = 'auto_submitted')::int AS auto_submitted_count
             FROM attempts
             WHERE quiz_id = qi.quiz_id AND user_id = qi.student_id
         ) attempt_stats ON TRUE
         WHERE qi.quiz_id = $1
         ORDER BY lower(u.name), u.id`,
        [quizId]
    );

    return res.json({ quiz, invitations: result.rows });
}

async function revokeQuizInvitation(req, res) {
    const quizId = parsePathId(req.params.id);
    const invitationId = parseInvitationId(req.params.invitationId);

    if (quizId === null || invitationId === null) {
        return res.status(400).json({
            error: "Quiz ID and invitation ID must be valid positive integers."
        });
    }

    const client = await pool.connect();
    let transactionOpen = false;

    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const quiz = await client.query(
            "SELECT id, audience_mode FROM quizzes WHERE id = $1 FOR UPDATE",
            [quizId]
        );

        if (!quiz.rows[0]) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({ error: "Quiz not found." });
        }

        const result = await client.query(
            `UPDATE quiz_invitations
             SET state = 'revoked', revoked_at = NOW()
             WHERE id = $1 AND quiz_id = $2 AND state = 'invited'
             RETURNING id, quiz_id, student_id, state, revoked_at`,
            [invitationId, quizId]
        );

        if (!result.rows[0]) {
            await client.query("ROLLBACK");
            transactionOpen = false;
            return res.status(404).json({
                error: "Active invitation not found."
            });
        }

        await client.query("COMMIT");
        transactionOpen = false;

        return res.json({
            message: "Invitation revoked. Existing attempts are not interrupted.",
            invitation: result.rows[0]
        });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Invitation revoke rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    assignQuizBatches,
    refreshQuizInvitations,
    listQuizInvitations,
    revokeQuizInvitation
};
