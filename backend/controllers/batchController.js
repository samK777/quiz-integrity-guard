const pool = require("../config/db");
const { parsePathId, normalizeBatchName, parseStudentIdentifier } = require("../services/batchValidation");

async function createBatch(req, res) {
    const name = normalizeBatchName(req.body?.name);
    if (!name) return res.status(400).json({ error: "Batch name must be a non-empty string of at most 120 characters." });

    try {
        const result = await pool.query(
            `INSERT INTO batches (name, created_by) VALUES ($1, $2)
             RETURNING id, name, created_by, created_at`,
            [name, req.user.id]
        );
        return res.status(201).json({ batch: { ...result.rows[0], membership_count: 0 } });
    } catch (error) {
        if (error.code === "23505") return res.status(409).json({ error: "A batch with this name already exists." });
        throw error;
    }
}

async function listBatches(req, res) {
    const result = await pool.query(
        `SELECT b.id, b.name, b.created_by, b.created_at,
                COUNT(bs.student_id)::int AS membership_count,
                (SELECT COUNT(*)::int FROM batch_join_requests r
                 WHERE r.batch_id = b.id AND r.status = 'pending') AS pending_count
         FROM batches b LEFT JOIN batch_students bs ON bs.batch_id = b.id
         GROUP BY b.id ORDER BY lower(b.name), b.id`
    );
    return res.json({ batches: result.rows });
}

async function getBatchStudents(req, res) {
    const batchId = parsePathId(req.params.id);
    if (batchId === null) return res.status(400).json({ error: "Batch ID must be a positive integer." });

    const batchResult = await pool.query(
        `SELECT b.id, b.name, b.created_by, b.created_at, COUNT(bs.student_id)::int AS membership_count
         FROM batches b LEFT JOIN batch_students bs ON bs.batch_id = b.id
         WHERE b.id = $1 GROUP BY b.id`,
        [batchId]
    );
    const batch = batchResult.rows[0];
    if (!batch) return res.status(404).json({ error: "Batch not found." });

    const studentsResult = await pool.query(
        `SELECT u.id, u.name, u.email, bs.added_at
         FROM batch_students bs JOIN users u ON u.id = bs.student_id
         WHERE bs.batch_id = $1 ORDER BY lower(u.name), u.id`,
        [batchId]
    );
    return res.json({ batch, students: studentsResult.rows });
}

async function addStudentToBatch(req, res) {
    const batchId = parsePathId(req.params.id);
    const identifier = parseStudentIdentifier(req.body);
    if (batchId === null) return res.status(400).json({ error: "Batch ID must be a positive integer." });
    if (!identifier) return res.status(400).json({ error: "Provide exactly one valid student_id or registered student email." });

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;

        const batchResult = await client.query("SELECT id FROM batches WHERE id = $1 FOR KEY SHARE", [batchId]);
        if (!batchResult.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Batch not found." });
        }

        const studentResult = identifier.kind === "id"
            ? await client.query("SELECT id, name, email, role FROM users WHERE id = $1 FOR KEY SHARE", [identifier.value])
            : await client.query("SELECT id, name, email, role FROM users WHERE lower(email) = $1 FOR KEY SHARE", [identifier.value]);
        const student = studentResult.rows[0];
        if (!student) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Registered account not found." });
        }
        if (student.role !== "student") {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(422).json({ error: "Only registered student accounts can be added to a batch." });
        }

        const membershipResult = await client.query(
            `INSERT INTO batch_students (batch_id, student_id)
             VALUES ($1, $2) ON CONFLICT (batch_id, student_id) DO NOTHING
             RETURNING batch_id, student_id, added_at`,
            [batchId, student.id]
        );
        if (!membershipResult.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(409).json({ error: "This student is already in the batch." });
        }

        // A teacher's direct add fulfils any outstanding request for this student.
        await client.query(
            `UPDATE batch_join_requests
             SET status = 'approved', resolved_at = NOW(), resolved_by = $3
             WHERE batch_id = $1 AND student_id = $2 AND status = 'pending'`,
            [batchId, student.id, req.user.id]
        );

        await client.query("COMMIT"); transactionOpen = false;
        return res.status(201).json({ membership: membershipResult.rows[0], student: { id: student.id, name: student.name, email: student.email } });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch membership rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

async function removeStudentFromBatch(req, res) {
    const batchId = parsePathId(req.params.id);
    const studentId = parsePathId(req.params.studentId);
    if (batchId === null || studentId === null) return res.status(400).json({ error: "Batch and student IDs must be positive integers." });

    const client = await pool.connect();
    let transactionOpen = false;
    try {
        await client.query("BEGIN");
        transactionOpen = true;
        const batch = await client.query("SELECT id FROM batches WHERE id = $1 FOR KEY SHARE", [batchId]);
        if (!batch.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Batch not found." });
        }
        const student = await client.query("SELECT id FROM users WHERE id = $1 AND role = 'student' FOR KEY SHARE", [studentId]);
        if (!student.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Student account not found." });
        }
        const removed = await client.query(
            "DELETE FROM batch_students WHERE batch_id = $1 AND student_id = $2 RETURNING batch_id, student_id",
            [batchId, studentId]
        );
        if (!removed.rows[0]) {
            await client.query("ROLLBACK"); transactionOpen = false;
            return res.status(404).json({ error: "Student is not a member of this batch." });
        }
        await client.query("COMMIT"); transactionOpen = false;
        return res.json({ membership: removed.rows[0], removed: true });
    } catch (error) {
        if (transactionOpen) {
            try { await client.query("ROLLBACK"); } catch (rollbackError) {
                console.error("Batch membership rollback failed:", rollbackError.message);
            }
        }
        throw error;
    } finally {
        client.release();
    }
}

module.exports = { createBatch, listBatches, getBatchStudents, addStudentToBatch, removeStudentFromBatch };
