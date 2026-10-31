const pool = require("../config/db");
const { parsePathId } = require("../services/batchValidation");
const { parseInviteCode, hashInviteCode, createInviteCode } = require("../services/batchInvite");

const INVITE_VALID_DAYS = 14;

async function createBatchInvite(req, res) {
    const batchId = parsePathId(req.params.id);
    if (batchId === null) return res.status(400).json({ error: "Batch ID must be a positive integer." });

    const code = createInviteCode();
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;
        const batch = await client.query("SELECT id FROM batches WHERE id = $1 FOR UPDATE", [batchId]);
        if (!batch.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Batch not found." });
        }
        await client.query("UPDATE batch_invites SET revoked_at = NOW() WHERE batch_id = $1 AND revoked_at IS NULL", [batchId]);
        const created = await client.query(
            `INSERT INTO batch_invites (batch_id, token_hash, created_by, expires_at)
             VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 day'))
             RETURNING expires_at`,
            [batchId, hashInviteCode(code), req.user.id, INVITE_VALID_DAYS]
        );
        await client.query("COMMIT"); transactionOpen = false;
        return res.status(201).json({ invite: { code, expires_at: created.rows[0].expires_at, valid_days: INVITE_VALID_DAYS } });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch invite rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function revokeBatchInvite(req, res) {
    const batchId = parsePathId(req.params.id);
    if (batchId === null) return res.status(400).json({ error: "Batch ID must be a positive integer." });
    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN"); transactionOpen = true;
        const batch = await client.query("SELECT id FROM batches WHERE id = $1 FOR UPDATE", [batchId]);
        if (!batch.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Batch not found." });
        }
        const result = await client.query(
            `UPDATE batch_invites SET revoked_at = NOW()
             WHERE batch_id = $1 AND revoked_at IS NULL
             RETURNING id`,
            [batchId]
        );
        if (!result.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "No active invite link exists for this batch." });
        }
        await client.query("COMMIT"); transactionOpen = false;
        return res.json({ revoked: true });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch invite revocation rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function requestBatchJoin(req, res) {
    const code = parseInviteCode(req.body?.code);
    if (!code) return res.status(400).json({ error: "Provide a valid batch invite code." });

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;
        const invite = await client.query(
            `SELECT i.batch_id, b.name AS batch_name
             FROM batch_invites i JOIN batches b ON b.id = i.batch_id
             WHERE i.token_hash = $1 AND i.revoked_at IS NULL AND i.expires_at > NOW()
             FOR SHARE OF i`,
            [hashInviteCode(code)]
        );
        if (!invite.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "This invite link is invalid, expired, or revoked." });
        }
        const { batch_id: batchId, batch_name: batchName } = invite.rows[0];
        const member = await client.query("SELECT 1 FROM batch_students WHERE batch_id = $1 AND student_id = $2", [batchId, req.user.id]);
        if (member.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "You are already a member of this batch." });
        }
        const created = await client.query(
            `INSERT INTO batch_join_requests (batch_id, student_id)
             VALUES ($1, $2)
             ON CONFLICT (batch_id, student_id) WHERE status = 'pending' DO NOTHING
             RETURNING id, batch_id, status, requested_at`,
            [batchId, req.user.id]
        );
        if (!created.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "You already have a pending request for this batch." });
        }
        await client.query("COMMIT"); transactionOpen = false;
        return res.status(201).json({ request: { ...created.rows[0], batch_name: batchName } });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch join request rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function listMyBatchJoinRequests(req, res) {
    const result = await pool.query(
        `SELECT r.id, r.batch_id, b.name AS batch_name, r.status, r.requested_at, r.resolved_at
         FROM batch_join_requests r JOIN batches b ON b.id = r.batch_id
         WHERE r.student_id = $1 ORDER BY r.requested_at DESC, r.id DESC`,
        [req.user.id]
    );
    return res.json({ requests: result.rows });
}

async function listBatchJoinRequests(req, res) {
    const batchId = parsePathId(req.params.id);
    const status = req.query.status || "pending";
    if (batchId === null) return res.status(400).json({ error: "Batch ID must be a positive integer." });
    if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: "Status must be pending, approved, or rejected." });

    const batch = await pool.query("SELECT id, name FROM batches WHERE id = $1", [batchId]);
    if (!batch.rows[0]) return res.status(404).json({ error: "Batch not found." });
    const result = await pool.query(
        `SELECT r.id, r.student_id, u.name AS student_name, u.email AS student_email,
                r.status, r.requested_at, r.resolved_at
         FROM batch_join_requests r JOIN users u ON u.id = r.student_id
         WHERE r.batch_id = $1 AND r.status = $2
         ORDER BY r.requested_at, r.id`,
        [batchId, status]
    );
    return res.json({ batch: batch.rows[0], requests: result.rows });
}

async function resolveBatchJoinRequest(req, res) {
    const batchId = parsePathId(req.params.id);
    const requestId = parsePathId(req.params.requestId);
    const decision = req.body?.decision;
    if (batchId === null || requestId === null) return res.status(400).json({ error: "Batch and request IDs must be positive integers." });
    if (decision !== "approved" && decision !== "rejected") return res.status(400).json({ error: "Decision must be approved or rejected." });

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN"); transactionOpen = true;
        const batch = await client.query("SELECT id FROM batches WHERE id = $1 FOR KEY SHARE", [batchId]);
        if (!batch.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Batch not found." });
        }
        const joinRequest = await client.query(
            `SELECT id, batch_id, student_id, status FROM batch_join_requests
             WHERE id = $1 AND batch_id = $2 FOR UPDATE`,
            [requestId, batchId]
        );
        if (!joinRequest.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Join request not found." });
        }
        if (joinRequest.rows[0].status !== "pending") {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "This join request has already been reviewed." });
        }

        let membershipAdded = false;
        if (decision === "approved") {
            const membership = await client.query(
                `INSERT INTO batch_students (batch_id, student_id) VALUES ($1, $2)
                 ON CONFLICT (batch_id, student_id) DO NOTHING RETURNING student_id`,
                [batchId, joinRequest.rows[0].student_id]
            );
            membershipAdded = Boolean(membership.rows[0]);
        }
        const resolved = await client.query(
            `UPDATE batch_join_requests
             SET status = $3, resolved_at = NOW(), resolved_by = $4
             WHERE id = $1 AND batch_id = $2 AND status = 'pending'
             RETURNING id, batch_id, student_id, status, requested_at, resolved_at, resolved_by`,
            [requestId, batchId, decision, req.user.id]
        );
        await client.query("COMMIT"); transactionOpen = false;
        return res.json({ request: resolved.rows[0], membership_added: membershipAdded });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch request decision rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    createBatchInvite,
    revokeBatchInvite,
    requestBatchJoin,
    listMyBatchJoinRequests,
    listBatchJoinRequests,
    resolveBatchJoinRequest
};
