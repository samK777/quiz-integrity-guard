-- Phase 2: Batch-targeted quiz assignment and eligibility snapshots.
-- Adds audience_mode to quizzes and three new tables.
-- Existing quizzes, attempts, answers, violations, batches, and users are untouched.
-- Apply ONCE to quiz_integrity_guard_test, verify, then apply to quiz_integrity_guard.
-- Do NOT apply if quizzes.audience_mode already exists (check with \d quizzes first).

BEGIN;

-- 1. Add audience_mode to quizzes.
--    Default 'global' means every existing quiz immediately becomes globally visible
--    with no data migration needed.
ALTER TABLE quizzes
    ADD COLUMN audience_mode VARCHAR(16) NOT NULL DEFAULT 'global'
        CHECK (audience_mode IN ('global', 'batch'));

-- 2. quiz_batches: records which batches a teacher has assigned to a quiz.
--    Removing a batch assignment does NOT automatically revoke existing invitations;
--    that requires an explicit snapshot refresh followed by revocation.
CREATE TABLE quiz_batches (
    quiz_id     INTEGER     NOT NULL REFERENCES quizzes(id)  ON DELETE CASCADE,
    batch_id    INTEGER     NOT NULL REFERENCES batches(id)  ON DELETE CASCADE,
    assigned_by INTEGER     NOT NULL REFERENCES users(id)    ON DELETE RESTRICT,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT quiz_batches_pkey PRIMARY KEY (quiz_id, batch_id)
);

CREATE INDEX idx_quiz_batches_quiz_id  ON quiz_batches (quiz_id);
CREATE INDEX idx_quiz_batches_batch_id ON quiz_batches (batch_id);

-- 3. quiz_invitations: one row per eligible student per quiz (snapshot).
--    ON CONFLICT (quiz_id, student_id) DO UPDATE is used during refresh to
--    re-invite previously revoked students.
--    revoke_consistent check: 'invited' rows must have revoked_at NULL;
--    'revoked' rows must have a revoked_at timestamp.
CREATE TABLE quiz_invitations (
    id         BIGSERIAL   PRIMARY KEY,
    quiz_id    INTEGER     NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    student_id INTEGER     NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    state      VARCHAR(16) NOT NULL DEFAULT 'invited'
                   CHECK (state IN ('invited', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT quiz_invitations_unique_student    UNIQUE (quiz_id, student_id),
    CONSTRAINT quiz_invitations_revoke_consistent CHECK (
        (state = 'invited'  AND revoked_at IS NULL)
        OR (state = 'revoked' AND revoked_at IS NOT NULL)
    )
);

CREATE INDEX idx_quiz_invitations_quiz_id    ON quiz_invitations (quiz_id);
CREATE INDEX idx_quiz_invitations_student_id ON quiz_invitations (student_id, state);

-- 4. quiz_invitation_batches: source-batch provenance per invitation.
--    Allows teachers to see which batch(es) made a student eligible.
--    ON CONFLICT DO NOTHING is used during refresh to add new source batches
--    without removing existing provenance rows.
CREATE TABLE quiz_invitation_batches (
    invitation_id BIGINT  NOT NULL REFERENCES quiz_invitations(id) ON DELETE CASCADE,
    batch_id      INTEGER NOT NULL REFERENCES batches(id)          ON DELETE CASCADE,
    CONSTRAINT quiz_invitation_batches_pkey PRIMARY KEY (invitation_id, batch_id)
);

CREATE INDEX idx_quiz_invitation_batches_invitation ON quiz_invitation_batches (invitation_id);
CREATE INDEX idx_quiz_invitation_batches_batch      ON quiz_invitation_batches (batch_id);

COMMIT;
