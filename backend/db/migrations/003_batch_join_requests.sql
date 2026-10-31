-- Add revocable batch invite links and teacher-reviewed student join requests.
-- Existing batch and application records are preserved.
BEGIN;

CREATE TABLE batch_invites (
    id BIGSERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_batch_invites_one_unrevoked_per_batch
    ON batch_invites (batch_id) WHERE revoked_at IS NULL;

CREATE TABLE batch_join_requests (
    id BIGSERIAL PRIMARY KEY,
    batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ,
    resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT batch_join_requests_resolution_consistent CHECK (
        (status = 'pending' AND resolved_at IS NULL AND resolved_by IS NULL)
        OR (status IN ('approved', 'rejected') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL)
    )
);

CREATE UNIQUE INDEX idx_batch_join_requests_one_pending
    ON batch_join_requests (batch_id, student_id) WHERE status = 'pending';
CREATE INDEX idx_batch_join_requests_batch_status
    ON batch_join_requests (batch_id, status, requested_at DESC);
CREATE INDEX idx_batch_join_requests_student
    ON batch_join_requests (student_id, requested_at DESC);

COMMIT;
